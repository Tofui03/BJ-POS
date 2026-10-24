import { PosError } from "./errors.js";

// The business day is defined by the Close Day ritual, not by midnight: sales
// rung up after the cashier closes a day belong to the *next* day. Dates are
// local-time YYYY-MM-DD strings; string comparison == chronological order.

/** Local-time calendar date (YYYY-MM-DD) for an epoch-ms timestamp or Date. */
export function localDateStr(ts: number | Date): string {
  const d = typeof ts === "number" ? new Date(ts) : ts;
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** The calendar day after a YYYY-MM-DD date string. */
export function nextDateStr(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return localDateStr(new Date(y!, m! - 1, d! + 1));
}

/**
 * Which business day a sale made *now* belongs to: today, unless today has
 * already been closed — then tomorrow. Forgetting to close a past day never
 * shifts new sales backwards; only an explicit close pushes them forward.
 */
export function businessDateFor(now: number | Date, todayClosed: boolean): string {
  const today = localDateStr(now);
  return todayClosed ? nextDateStr(today) : today;
}

/**
 * Guard whether a business day can be closed.
 * Throws PosError if closing prematurely (future date) or if already closed.
 */
export function assertCanCloseDay(
  businessDate: string,
  wallToday: string,
  alreadyClosed: boolean,
): void {
  if (businessDate > wallToday) {
    throw new PosError(`cannot close ${businessDate} before that day arrives`);
  }
  if (alreadyClosed) {
    throw new PosError(`day ${businessDate} is already closed`);
  }
}

/**
 * Return IDs of records where localDateStr(r.ts) === reopenedBusinessDate.
 */
export function filterPushedRecordIds<T extends { id: number; ts: number }>(
  records: readonly T[],
  reopenedBusinessDate: string,
): number[] {
  return records
    .filter((r) => localDateStr(r.ts) === reopenedBusinessDate)
    .map((r) => r.id);
}
