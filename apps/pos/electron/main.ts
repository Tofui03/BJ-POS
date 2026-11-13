import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import Database from "better-sqlite3";
import { mergeDotEnv } from "./dotenv";
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
  const dialogOpts = {
    title: "Add product images",
    properties: ["openFile", "multiSelections"] as ("openFile" | "multiSelections")[],
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
  };
  const res = mainWindow
    ? await dialog.showOpenDialog(mainWindow, dialogOpts)
    : await dialog.showOpenDialog(dialogOpts);
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
ipcMain.handle("print:printers", async (e) => {
  const printers = await e.sender.getPrintersAsync();
  return printers.map((p) => ({
    name: p.name,
    displayName: p.displayName || p.name,
    isDefault: p.isDefault,
  }));
});

ipcMain.handle(
  "print:html",
  (_e, html: string, deviceName?: string, pageSize?: "A4" | { width: number; height: number }) => {
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
          {
            silent: true,
            printBackground: true,
            margins: { marginType: "none" },
            ...(deviceName ? { deviceName } : {}),
            ...(pageSize ? { pageSize } : {}),
          },
          (ok, reason) => done(ok, ok ? undefined : reason || "print failed"),
        );
      });
      win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html)).catch((e) => {
        done(false, String(e));
      });
      setTimeout(() => done(false, "print timed out"), 30_000);
    });
  },
);

// Drive credentials come from a .env file (never the DB): DRIVE_FOLDER_ID plus
// DRIVE_SERVICE_ACCOUNT_JSON or DRIVE_SERVICE_ACCOUNT_FILE. Searched in order:
// userData dir, next to the executable, then the working dir (dev).
const dotEnv: Record<string, string> = {};

function loadDotEnv(): void {
  const candidates = [
    path.join(app.getPath("userData"), ".env"),
    path.join(path.dirname(app.getPath("exe")), ".env"),
    path.join(process.cwd(), ".env"),
  ];
  for (const file of candidates) {
    try {
      mergeDotEnv(dotEnv, fs.readFileSync(file, "utf8"));
    } catch {
      continue;
    }
  }
}

ipcMain.handle("drive:config", () => {
  const cfg = loadDriveConfig(dotEnv);
  return { configured: !!cfg, folderId: cfg?.folderId ?? null };
});

function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

ipcMain.handle("app:checkUpdate", async () => {
  const currentVersion = app.getVersion();
  const res = await fetch("https://api.github.com/repos/Tofui03/BJ-POS/releases/latest", {
    headers: { "User-Agent": "Borneo-Jasa-POS", Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub check failed (${res.status})`);
  const data = (await res.json()) as {
    tag_name?: string;
    html_url?: string;
    assets?: Array<{ name?: string; browser_download_url?: string }>;
  };
  const latestVersion = (data.tag_name ?? "").replace(/^v/i, "");
  const exeAsset = data.assets?.find((a) => a.name?.endsWith("-x64.exe"));
  return {
    currentVersion,
    latestVersion: latestVersion || currentVersion,
    hasUpdate: latestVersion ? compareSemver(latestVersion, currentVersion) > 0 : false,
    releaseUrl: data.html_url || "https://github.com/Tofui03/BJ-POS/releases/latest",
    downloadUrl: exeAsset?.browser_download_url || data.html_url || "https://github.com/Tofui03/BJ-POS/releases/latest",
  };
});

ipcMain.handle("app:openExternal", (_e, url: string) => {
  if (typeof url === "string" && url.startsWith("https://github.com/Tofui03/BJ-POS/")) {
    return shell.openExternal(url);
  }
});

ipcMain.handle("app:quit", () => {
  app.quit();
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
  await uploadBytesToDrive(
    cfg,
    row.attachment_name,
    Buffer.from(row.attachment_b64, "base64"),
  );

  // Snapshot beside the workbook. A failed snapshot does not fail the workbook upload.
  const snapshotFile = path.join(os.tmpdir(), `borneo-jasa-pos-snapshot-${Date.now()}.sqlite`);
  try {
    await db.backup(snapshotFile);
    const dbBytes = fs.readFileSync(snapshotFile);
    const dbBackupName = row.attachment_name.replace(/\.xlsx$/i, "") + "-backup.sqlite";
    await uploadBytesToDrive(cfg, dbBackupName, dbBytes, "application/x-sqlite3");
  } catch (backupErr) {
    console.warn("SQLite snapshot upload failed; the workbook was still uploaded.", backupErr);
  } finally {
    try {
      if (fs.existsSync(snapshotFile)) fs.unlinkSync(snapshotFile);
    } catch {}
  }
}

/**
 * Process queued Close Day artifacts. Borneo Jasa v1 uploads to Google Drive.
 * Legacy email rows (channel = 'email') are left unsent; SMTP was removed.
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

    const pending = (
      db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE sent_at IS NULL").get() as { n: number }
    ).n;
    return { sent, pending, lastError };
  } finally {
    outboxBusy = false;
  }
}

ipcMain.handle("drive:process", () => processOutbox());

const POS_ZOOM_FACTOR = 1.0;

function createWindow(): void {
  const win = (mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
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
  dbPath = process.env.BJ_POS_DB_PATH || path.join(app.getPath("userData"), "borneo-jasa-pos.sqlite");
  fresh = !fs.existsSync(dbPath);
  db = openDb();
  imagesDir = path.join(app.getPath("userData"), "images");
  fs.mkdirSync(imagesDir, { recursive: true });
  void backupDaily();
  // Retry queued Close Day uploads while the till is open.
  setInterval(() => void processOutbox().catch(() => {}), 5 * 60_000);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
