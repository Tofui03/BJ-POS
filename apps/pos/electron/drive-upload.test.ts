import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mergeDotEnv, parseDotEnv } from "./dotenv";
import { escapeDriveQueryValue, loadDriveConfig } from "./drive-upload";

describe("escapeDriveQueryValue (CWE-116 sanitization)", () => {
  it("leaves safe filenames unchanged", () => {
    expect(escapeDriveQueryValue("sales-2026-10-24.xlsx")).toBe("sales-2026-10-24.xlsx");
  });

  it("escapes single quotes", () => {
    expect(escapeDriveQueryValue("customer's-report.xlsx")).toBe("customer\\'s-report.xlsx");
  });

  it("escapes backslashes first to prevent quote escape bypasses", () => {
    // If input is foo\'bar, without escaping backslash first, it stays as foo\'bar,
    // where the backslash escapes the backslash instead of the quote!
    // With proper escaping: \ becomes \\, then ' becomes \' -> \\\'
    expect(escapeDriveQueryValue("foo\\'bar")).toBe("foo\\\\\\'bar");
  });

  it("handles trailing backslashes properly", () => {
    expect(escapeDriveQueryValue("path\\")).toBe("path\\\\");
  });

  it("handles malicious query injection attempts", () => {
    const malicious = "evil' or trashed = true or 'a'='a";
    const escaped = escapeDriveQueryValue(malicious);
    expect(escaped).toBe("evil\\' or trashed = true or \\'a\\'=\\'a");
  });
});

describe("Drive .env loading", () => {
  it("parses Drive settings and keeps the first assignment", () => {
    const env: Record<string, string> = {};
    mergeDotEnv(
      env,
      [
        "# shop drive",
        'DRIVE_FOLDER_ID="folder-1"',
        'DRIVE_SERVICE_ACCOUNT_JSON={"client_email":"a@b.c","private_key":"k"}',
        "DRIVE_FOLDER_ID=later",
      ].join("\n"),
    );
    mergeDotEnv(env, "DRIVE_FOLDER_ID=second-file\n");
    expect(env.DRIVE_FOLDER_ID).toBe("folder-1");
    expect(parseDotEnv("DRIVE_FOLDER_ID=only").DRIVE_FOLDER_ID).toBe("only");
    const cfg = loadDriveConfig(env);
    expect(cfg?.folderId).toBe("folder-1");
    expect(cfg?.serviceAccount.client_email).toBe("a@b.c");
  });

  it("main loads dotEnv for Drive and does not call the removed mailer", () => {
    const src = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    expect(src).toContain("function loadDotEnv");
    expect(src).toContain("loadDriveConfig(dotEnv)");
    expect(src).not.toContain("nodemailer");
    expect(src).not.toContain("deliverEmailRows");
    expect(src).not.toContain("smtpUser");
  });
});
