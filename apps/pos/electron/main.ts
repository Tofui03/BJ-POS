import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import Database from "better-sqlite3";
import nodemailer from "nodemailer";
import { loadDriveConfig, uploadBytesToDrive } from "./drive-upload";

// On-disk SQLite lives in the main process (native module stays out of the
// sandboxed renderer). The renderer talks to it over IPC via the bridge in
// preload.ts and the SqlDriver in src/ipc-driver.ts — so all the Drizzle query
// code is reused unchanged; only the driver differs from the browser build.

let db: Database.Database;
let dbPath = "";
let fresh = false;
let mainWindow: BrowserWindow | null = null;

// User-added product photos live here (copied in from e.g. a USB drive). Served
// to the renderer as data URLs so they need no custom protocol.
let imagesDir = "";
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

function listImages(): { name: string; dataUrl: string }[] {
  let files: string[] = [];
  try {
    files = fs.readdirSync(imagesDir);
  } catch {
    return [];
  }
  return files
    .filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()))
    .sort()
    .map((name) => {
      const ext = path.extname(name).toLowerCase().slice(1);
      const mime = ext === "jpg" ? "jpeg" : ext;
      const b64 = fs.readFileSync(path.join(imagesDir, name)).toString("base64");
      return { name, dataUrl: `data:image/${mime};base64,${b64}` };
    });
}

function openDb(): Database.Database {
  const d = new Database(dbPath);
  d.pragma("journal_mode = WAL"); // durable + low-memory on modest hardware
  d.pragma("foreign_keys = ON");
  return d;
}

// better-sqlite3 forbids transaction-control statements in prepare(); run them
// through exec() instead. The renderer drives BEGIN/COMMIT via SqlDriver.tx().
const TX_RE = /^\s*(?:begin|commit|rollback|savepoint|release)\b/i;

ipcMain.handle("db:all", (_e, sql: string, params: unknown[] = []) =>
  db.prepare(sql).all(...params),
);
ipcMain.handle("db:values", (_e, sql: string, params: unknown[] = []) =>
  db.prepare(sql).raw().all(...params),
);
ipcMain.handle("db:run", (_e, sql: string, params: unknown[] = []) => {
  if (TX_RE.test(sql)) {
    db.exec(sql);
    return { lastInsertRowid: 0 };
  }
  const info = db.prepare(sql).run(...params);
  return { lastInsertRowid: Number(info.lastInsertRowid) };
});
ipcMain.handle("db:meta", () => ({ fresh }));

ipcMain.handle("images:list", () => listImages());
ipcMain.handle("images:import", async () => {
  const res = await dialog.showOpenDialog(mainWindow ?? undefined, {
    title: "Add product images",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
  });
  if (!res.canceled) {
    for (const src of res.filePaths) {
      const ext = path.extname(src);
      const stem = path.basename(src, ext);
      let name = `${stem}${ext}`;
      let i = 1;
      while (fs.existsSync(path.join(imagesDir, name))) name = `${stem}-${i++}${ext}`;
      fs.copyFileSync(src, path.join(imagesDir, name));
    }
  }
  // The native file dialog can reset the window's zoom to 100%; put the
  // kiosk zoom back before the renderer repaints.
  mainWindow?.webContents.setZoomFactor(POS_ZOOM_FACTOR);
  return listImages();
});
ipcMain.handle("db:reset", () => {
  db.close();
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* file may not exist */
    }
  }
  db = openDb();
  fresh = true;
  return true;
});

// ---------------------------------------------------------------------------
// Local rolling backups: one snapshot per calendar day, keep the last 30. Run
// at every launch — cheap, and it means a corrupted DB or a fat-fingered edit
// can always be rolled back to yesterday.
const KEEP_BACKUPS = 30;

async function backupDaily(): Promise<void> {
  const dir = path.join(app.getPath("userData"), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const today = new Date();
  const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const dest = path.join(dir, `borneo-jasa-pos-${stamp}.sqlite`);
  try {
    if (!fs.existsSync(dest)) await db.backup(dest);
    const files = fs
      .readdirSync(dir)
      .filter((f) => (f.startsWith("borneo-jasa-pos-") || f.startsWith("yft-pos-")) && f.endsWith(".sqlite"))
      .sort();
    for (const f of files.slice(0, Math.max(0, files.length - KEEP_BACKUPS))) {
      fs.unlinkSync(path.join(dir, f));
    }
  } catch (err) {
    console.error("backup failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Silent printing: render the HTML in a hidden window and print straight to
// the default printer — the cashier never sees a print dialog.
ipcMain.handle("print:html", (_e, html: string) => {
  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    let settled = false;
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    const done = (ok: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      win.destroy();
      resolve(error ? { ok, error } : { ok });
    };
    win.webContents.on("did-finish-load", () => {
      win.webContents.print(
        { silent: true, printBackground: true, margins: { marginType: "none" } },
        (ok, reason) => done(ok, ok ? undefined : reason || "print failed"),
      );
    });
    win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html)).catch((e) => {
      done(false, String(e));
    });
    setTimeout(() => done(false, "print timed out"), 30_000);
  });
});

// ---------------------------------------------------------------------------
// Outbox mailer: the renderer queues daily-report emails in the `outbox` table
// (body + Excel attachment); this loop sends them via the dedicated Gmail
// account (App Password in `settings`) and keeps retrying while offline. A
// fresh DB snapshot rides along as the offsite backup.
const getSetting = (key: string): string | null => {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value || null;
  } catch {
    return null; // settings table not created yet (first run)
  }
};

// SMTP credentials come from a .env file (never the DB): SMTP_USER is the
// dedicated Gmail address, SMTP_PASS its App Password. Searched in order:
// userData dir, next to the executable, then the working dir (dev). Legacy
// settings-table values remain as a fallback for installs configured in-app.
const dotEnv: Record<string, string> = {};

function loadDotEnv(): void {
  const candidates = [
    path.join(app.getPath("userData"), ".env"),
    path.join(path.dirname(app.getPath("exe")), ".env"),
    path.join(process.cwd(), ".env"),
  ];
  for (const file of candidates) {
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
      if (!m || line.trim().startsWith("#")) continue;
      const value = m[2]!.trim().replace(/^["']|["']$/g, "");
      if (!(m[1]! in dotEnv)) dotEnv[m[1]!] = value;
    }
  }
}

const smtpUser = (): string | null => dotEnv.SMTP_USER || getSetting("smtp_user");
const smtpPass = (): string | null => dotEnv.SMTP_PASS || getSetting("smtp_pass");

/** Report recipients: newline/comma-separated list in settings (`report_recipients`). */
function reportRecipients(): string[] {
  const list = (getSetting("report_recipients") ?? "")
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes("@"));
  if (list.length) return list;
  const legacy = getSetting("report_recipient");
  return legacy ? [legacy] : [];
}

ipcMain.handle("mailer:config", () => ({
  hasCredentials: !!(smtpUser() && smtpPass()),
  user: smtpUser(),
}));

ipcMain.handle("drive:config", () => {
  const cfg = loadDriveConfig(dotEnv);
  return { configured: !!cfg, folderId: cfg?.folderId ?? null };
});

let outboxBusy = false;

async function deliverDriveRow(row: {
  id: number;
  attachment_name: string | null;
  attachment_b64: string | null;
}): Promise<void> {
  const cfg = loadDriveConfig(dotEnv);
  if (!cfg) throw new Error("drive not configured");
  if (!row.attachment_name || !row.attachment_b64) {
    throw new Error("outbox row missing workbook attachment");
  }
  // 1. Upload the Close Day Excel workbook
  await uploadBytesToDrive(
    cfg,
    row.attachment_name,
    Buffer.from(row.attachment_b64, "base64"),
  );

  // 2. Offsite Cloud Disaster Recovery: Upload an active SQLite snapshot alongside the workbook.
  // If the till hardware ever dies or suffers catastrophic failure, all customer debt records,
  // order history, and catalog data can be completely restored from Google Drive.
  const snapshotFile = path.join(os.tmpdir(), `borneo-jasa-pos-snapshot-${Date.now()}.sqlite`);
  try {
    await db.backup(snapshotFile);
    const dbBytes = fs.readFileSync(snapshotFile);
    const dbBackupName = row.attachment_name.replace(/\.xlsx$/i, "") + "-backup.sqlite";
    await uploadBytesToDrive(cfg, dbBackupName, dbBytes, "application/x-sqlite3");
  } catch (backupErr) {
    // Non-fatal for the outbox job: log warning so workbook delivery still records success
    console.warn("Cloud SQLite snapshot upload encountered an issue:", backupErr);
  } finally {
    try {
      if (fs.existsSync(snapshotFile)) fs.unlinkSync(snapshotFile);
    } catch {}
  }
}

async function deliverEmailRows(
  rows: Array<{
    id: number;
    subject: string;
    body: string;
    attachment_name: string | null;
    attachment_b64: string | null;
  }>,
): Promise<{ sent: number; lastError: string | null }> {
  const user = smtpUser();
  const pass = smtpPass();
  const recipients = reportRecipients();
  if (!user || !pass || recipients.length === 0) {
    return { sent: 0, lastError: "email not configured" };
  }
  const to = recipients.join(", ");
  const auth = { user, pass: pass.replace(/\s+/g, "") };
  const transporter = dotEnv.SMTP_HOST
    ? nodemailer.createTransport({
        host: dotEnv.SMTP_HOST,
        port: Number(dotEnv.SMTP_PORT) || 465,
        secure: (Number(dotEnv.SMTP_PORT) || 465) === 465,
        auth,
      })
    : nodemailer.createTransport({ service: "gmail", auth });

  const snapshot = path.join(os.tmpdir(), `borneo-jasa-pos-snapshot-${Date.now()}.sqlite`);
  let snapshotBuf: Buffer | null = null;
  try {
    await db.backup(snapshot);
    snapshotBuf = fs.readFileSync(snapshot);
    fs.unlinkSync(snapshot);
  } catch {
    snapshotBuf = null;
  }

  let sent = 0;
  let lastError: string | null = null;
  for (const row of rows) {
    const attachments: { filename: string; content: Buffer }[] = [];
    if (row.attachment_name && row.attachment_b64) {
      attachments.push({
        filename: row.attachment_name,
        content: Buffer.from(row.attachment_b64, "base64"),
      });
    }
    if (snapshotBuf) attachments.push({ filename: "borneo-jasa-pos-backup.sqlite", content: snapshotBuf });
    try {
      await transporter.sendMail({ from: user, to, subject: row.subject, text: row.body, attachments });
      db.prepare("UPDATE outbox SET sent_at = ?, last_error = NULL WHERE id = ?").run(Date.now(), row.id);
      sent++;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      db.prepare("UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?").run(lastError, row.id);
    }
  }
  return { sent, lastError };
}

/**
 * Process queued Close Day artifacts. Borneo Jasa v1 uses Google Drive;
 * legacy email rows remain supported.
 */
async function processOutbox(): Promise<{ sent: number; pending: number; lastError: string | null }> {
  if (outboxBusy) return { sent: 0, pending: 0, lastError: "busy" };
  outboxBusy = true;
  let sent = 0;
  let lastError: string | null = null;
  try {
    interface OutboxRow {
      id: number;
      subject: string;
      body: string;
      attachment_name: string | null;
      attachment_b64: string | null;
      channel: string | null;
    }
    let rows: OutboxRow[] = [];
    try {
      rows = db
        .prepare(
          "SELECT id, subject, body, attachment_name, attachment_b64, channel FROM outbox WHERE sent_at IS NULL ORDER BY id",
        )
        .all() as OutboxRow[];
    } catch {
      // Older DBs before the channel column — fall back without it.
      try {
        rows = (
          db
            .prepare(
              "SELECT id, subject, body, attachment_name, attachment_b64 FROM outbox WHERE sent_at IS NULL ORDER BY id",
            )
            .all() as Array<Omit<OutboxRow, "channel">>
        ).map((r) => ({ ...r, channel: "email" }));
      } catch {
        return { sent: 0, pending: 0, lastError: null };
      }
    }
    if (rows.length === 0) return { sent: 0, pending: 0, lastError: null };

    const driveRows = rows.filter((r) => (r.channel ?? "drive") !== "email");
    const emailRows = rows.filter((r) => (r.channel ?? "drive") === "email");

    for (const row of driveRows) {
      try {
        await deliverDriveRow(row);
        db.prepare("UPDATE outbox SET sent_at = ?, last_error = NULL WHERE id = ?").run(Date.now(), row.id);
        sent++;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        db.prepare("UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?").run(
          lastError,
          row.id,
        );
      }
    }

    if (emailRows.length) {
      const emailResult = await deliverEmailRows(emailRows);
      sent += emailResult.sent;
      if (emailResult.lastError) lastError = emailResult.lastError;
    }

    const pending = (
      db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE sent_at IS NULL").get() as { n: number }
    ).n;
    return { sent, pending, lastError };
  } finally {
    outboxBusy = false;
  }
}

ipcMain.handle("mailer:process", () => processOutbox());
ipcMain.handle("drive:process", () => processOutbox());

const POS_ZOOM_FACTOR = 1.0;

function createWindow(): void {
  const win = (mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    // Keep local development easy to exit; packaged cashier builds are locked down.
    kiosk: app.isPackaged,
    backgroundColor: "#f7f6f2",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      zoomFactor: POS_ZOOM_FACTOR,
    },
  }));
  win.setMenu(null);
  win.webContents.on("did-finish-load", () => {
    win.webContents.setZoomFactor(POS_ZOOM_FACTOR);
  });
  win.on("closed", () => {
    mainWindow = null;
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(path.join(__dirname, "../dist/index.html"));
}

// Kiosk machine: a second launch (double-clicked shortcut, auto-start race)
// must focus the running till, never open a second window over it.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  loadDotEnv();
  dbPath = path.join(app.getPath("userData"), "borneo-jasa-pos.sqlite");
  fresh = !fs.existsSync(dbPath);
  db = openDb();
  imagesDir = path.join(app.getPath("userData"), "images");
  fs.mkdirSync(imagesDir, { recursive: true });
  void backupDaily();
  // Retry queued HQ emails in the background while the till runs.
  setInterval(() => void processOutbox().catch(() => {}), 5 * 60_000);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
