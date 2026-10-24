import { describe, expect, it } from "vitest";
import { escapeDriveQueryValue } from "./drive-upload";

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
