/** Digit keys for the shared decimal pad, excluding backspace. */
export const DECIMAL_NUMPAD_KEYS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "C", "0", "."] as const;

/**
 * Apply one decimal-pad key. `C` clears, backspace deletes, one decimal point,
 * at most `maxDecimals` digits after the point. A lone "0" is replaced by the next digit.
 * Pass `Infinity` to allow an unlimited fractional part.
 */
export function appendDecimalKey(entry: string, key: string, maxDecimals = 2): string {
  if (key === "C") return "";
  if (key === "⌫") return entry.slice(0, -1);
  if (key === ".") {
    if (entry.includes(".")) return entry;
    return entry ? `${entry}.` : "0.";
  }
  if (!/^\d$/.test(key)) return entry;
  if (Number.isFinite(maxDecimals) && entry.includes(".")) {
    const dec = entry.split(".")[1] ?? "";
    if (dec.length >= maxDecimals) return entry;
  }
  return entry === "0" ? key : `${entry}${key}`;
}

/**
 * One key while a shown value may still be selected.
 * A digit replaces the selection. "." keeps the shown number and starts the fraction,
 * so a quantity of 1 followed by "." and "5" is 1.5, not 0.5.
 */
export function typeDecimalKey(
  entry: string,
  key: string,
  replace: boolean,
  maxDecimals = 2,
): { entry: string; replace: boolean } {
  if (key === "C") return { entry: "", replace: false };
  if (key === "⌫") return { entry: entry.slice(0, -1), replace: false };
  if (replace) {
    if (key === ".") return { entry: entry ? `${entry}.` : "0.", replace: false };
    if (/^\d$/.test(key)) return { entry: key, replace: false };
    return { entry, replace };
  }
  return { entry: appendDecimalKey(entry, key, maxDecimals), replace: false };
}
