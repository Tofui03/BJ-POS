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
