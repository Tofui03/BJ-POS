import { ref } from "vue";
import { getRepo } from "./db";

// Typed accessors over the DB `settings` table. The same rows are read by the
// Electron main process (SMTP credentials, recipient) — the table is the one
// config channel both sides share.

export const SETTING_KEYS = {
  pin: "pin",
  ownerPin: "owner_pin",
  smtpUser: "smtp_user", // legacy fallback — the sender now lives in .env (SMTP_USER)
  smtpPass: "smtp_pass", // legacy fallback — the App Password now lives in .env (SMTP_PASS)
  recipient: "report_recipient", // legacy single HQ email (pre-list installs)
  recipients: "report_recipients", // newline/comma-separated list the report is sent TO
  paperWidthMm: "paper_width_mm",
  moneyEntry: "money_entry", // "cents" (till style) | "decimal" (type the point)
  cashierList: "pos.cashiers",
  locale: "pos.locale",
} as const;

export type Locale = "en" | "ms" | "zh" | "bi";

export const currentLocale = ref<Locale>("bi");

/** Load the UI locale from the DB. */
export async function loadLocale(): Promise<Locale> {
  const repo = await getRepo();
  const saved = (await repo.getSetting(SETTING_KEYS.locale)) as Locale | null;
  if (saved === "en" || saved === "ms" || saved === "zh" || saved === "bi") {
    currentLocale.value = saved;
    return saved;
  }
  currentLocale.value = "en";
  return "en";
}

export async function setLocale(loc: Locale): Promise<void> {
  const repo = await getRepo();
  await repo.setSetting(SETTING_KEYS.locale, loc);
  currentLocale.value = loc;
}

/** Confirmation PIN (void / reopen / settings). Defaults to 1234 until changed. */
export async function getPin(): Promise<string> {
  const repo = await getRepo();
  return (await repo.getSetting(SETTING_KEYS.pin)) ?? "1234";
}

/** Owner Report PIN. Defaults to 8888 until changed. */
export async function getOwnerPin(): Promise<string> {
  const repo = await getRepo();
  return (await repo.getSetting(SETTING_KEYS.ownerPin)) ?? "8888";
}

export async function getPaperWidthMm(): Promise<number> {
  const repo = await getRepo();
  const v = Number(await repo.getSetting(SETTING_KEYS.paperWidthMm));
  return v === 58 ? 58 : 80;
}

export type MoneyEntryMode = "cents" | "decimal";

// How the numpad takes RM amounts. Kept in a module ref (like `companies` in
// place.ts) so the dialog reads it synchronously and a change in Settings
// applies to the next numpad without a restart.
// Hardware store default: intuitive decimal entry ("3" = RM 3, press "." for sen).
export const moneyEntry = ref<MoneyEntryMode>("decimal");

/** Load the money-entry mode from the DB (call once at app start). */
export async function loadMoneyEntry(): Promise<void> {
  const repo = await getRepo();
  const saved = await repo.getSetting(SETTING_KEYS.moneyEntry);
  moneyEntry.value = saved === "cents" ? "cents" : "decimal";
}

export async function setMoneyEntry(mode: MoneyEntryMode): Promise<void> {
  const repo = await getRepo();
  await repo.setSetting(SETTING_KEYS.moneyEntry, mode);
  moneyEntry.value = mode;
}

export const parseRecipients = (raw: string): string[] =>
  raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes("@"));

/** Report recipients from the DB list, falling back to the legacy single email. */
export async function getReportRecipients(): Promise<string[]> {
  const repo = await getRepo();
  const list = parseRecipients((await repo.getSetting(SETTING_KEYS.recipients)) ?? "");
  if (list.length) return list;
  const legacy = await repo.getSetting(SETTING_KEYS.recipient);
  return legacy ? [legacy] : [];
}

/** True once the sender credentials (.env on the till) + a recipient exist. */
export async function emailConfigured(): Promise<boolean> {
  const recipients = await getReportRecipients();
  if (recipients.length === 0) return false;
  const config = await window.mailer?.config?.().catch(() => null);
  if (config) return config.hasCredentials;
  // Browser build / older preload: fall back to the legacy in-DB credentials.
  const repo = await getRepo();
  const [u, p] = await Promise.all([
    repo.getSetting(SETTING_KEYS.smtpUser),
    repo.getSetting(SETTING_KEYS.smtpPass),
  ]);
  return !!(u && p);
}

/** True when the till .env has Drive folder + service-account credentials. */
export async function driveConfigured(): Promise<boolean> {
  const config = await window.drive?.config?.().catch(() => null);
  return !!config?.configured;
}
