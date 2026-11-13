import { ref } from "vue";
import { getRepo } from "./db";

// Typed accessors over the DB `settings` table. The same rows are read by the
// Electron main process (SMTP credentials, recipient) — the table is the one
// config channel both sides share.

export const SETTING_KEYS = {
  pin: "pin",
  paperWidthMm: "paper_width_mm",
  moneyEntry: "money_entry", // "cents" (till style) | "decimal" (type the point)
  cashierList: "pos.cashiers",
  receiptPrinter: "receipt_printer",
  documentPrinter: "document_printer",
} as const;

/** Confirmation PIN (void / reopen / settings). Defaults to 1234 until changed. */
export async function getPin(): Promise<string> {
  const repo = await getRepo();
  return (await repo.getSetting(SETTING_KEYS.pin)) ?? "1234";
}

export async function getPaperWidthMm(): Promise<number> {
  return 80;
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

/** True when the till .env has Drive folder + service-account credentials. */
export async function driveConfigured(): Promise<boolean> {
  const config = await window.drive?.config?.().catch(() => null);
  return !!config?.configured;
}

export async function getReceiptPrinter(): Promise<string> {
  const repo = await getRepo();
  return (await repo.getSetting(SETTING_KEYS.receiptPrinter)) ?? "";
}

export async function setReceiptPrinter(name: string): Promise<void> {
  const repo = await getRepo();
  await repo.setSetting(SETTING_KEYS.receiptPrinter, name);
}

export async function getDocumentPrinter(): Promise<string> {
  const repo = await getRepo();
  return (await repo.getSetting(SETTING_KEYS.documentPrinter)) ?? "";
}

export async function setDocumentPrinter(name: string): Promise<void> {
  const repo = await getRepo();
  await repo.setSetting(SETTING_KEYS.documentPrinter, name);
}
