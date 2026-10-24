import crypto from "node:crypto";
import fs from "node:fs";

/** Google service-account JSON (installer drops the file once). */
export interface DriveServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface DriveUploadConfig {
  folderId: string;
  serviceAccount: DriveServiceAccount;
}

function base64url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function accessToken(sa: DriveServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/drive.file",
      aud: sa.token_uri || "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${claim}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const jwt = `${unsigned}.${base64url(signer.sign(sa.private_key))}`;

  const res = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`Drive token failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Drive token response missing access_token");
  return json.access_token;
}

/**
 * Escape a string literal for use inside single quotes in a Google Drive v3 query (`q`).
 * Per Google Drive API query spec & CWE-116: backslashes MUST be escaped before single quotes
 * to prevent backslash-escape bypasses.
 */
export function escapeDriveQueryValue(val: string): string {
  return val.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findFileId(
  token: string,
  folderId: string,
  name: string,
): Promise<string | null> {
  const safeName = escapeDriveQueryValue(name);
  const safeFolderId = escapeDriveQueryValue(folderId);
  const q = encodeURIComponent(
    `name = '${safeName}' and '${safeFolderId}' in parents and trashed = false`,
  );
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Drive list failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { files?: Array<{ id: string }> };
  return json.files?.[0]?.id ?? null;
}

/**
 * Upload (or overwrite) a Close Day workbook into the shared Drive folder.
 * Idempotent on `fileName` within that folder.
 */
export async function uploadBytesToDrive(
  cfg: DriveUploadConfig,
  fileName: string,
  bytes: Buffer,
  mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
): Promise<{ fileId: string; updated: boolean }> {
  const token = await accessToken(cfg.serviceAccount);
  const existingId = await findFileId(token, cfg.folderId, fileName);
  const meta = {
    name: fileName,
    parents: existingId ? undefined : [cfg.folderId],
  };
  const boundary = `pos_${crypto.randomBytes(8).toString("hex")}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
    ),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const url = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";

  const res = await fetch(url, {
    method: existingId ? "PATCH" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`Drive upload failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { id: string };
  return { fileId: json.id, updated: !!existingId };
}

/** Load Drive config from .env values already parsed by main. */
export function loadDriveConfig(env: Record<string, string>): DriveUploadConfig | null {
  const folderId = env.DRIVE_FOLDER_ID?.trim();
  if (!folderId) return null;

  const inline = env.DRIVE_SERVICE_ACCOUNT_JSON?.trim();
  const filePath = env.DRIVE_SERVICE_ACCOUNT_FILE?.trim();
  let raw = inline || "";
  if (!raw && filePath) {
    try {
      raw = fs.readFileSync(filePath, "utf8");
    } catch {
      return null;
    }
  }
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw) as DriveServiceAccount;
    if (!sa.client_email || !sa.private_key) return null;
    return { folderId, serviceAccount: sa };
  } catch {
    return null;
  }
}
