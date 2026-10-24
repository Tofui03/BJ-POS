import Decimal from "decimal.js";
import { PosError } from "./errors.js";
import type { Cents, Milli, Unit } from "./types.js";

/** Assert that a monetary value is a non-negative integer whole-cent amount. */
export function assertCents(val: number, field = "amount"): asserts val is Cents {
  if (!Number.isInteger(val) || val < 0) {
    throw new PosError(`${field} must be a non-negative whole-cent amount (cents)`);
  }
}

/** Assert that a quantity/measurement value is a strictly positive integer milli-unit amount. */
export function assertPositiveMilli(val: number, field = "quantity"): asserts val is Milli {
  if (!Number.isInteger(val) || val <= 0) {
    throw new PosError(`${field} must be a positive integer milli-unit (e.g. 1000 for 1.000)`);
  }
}

// DB/domain store integers; the UI speaks decimals. These are the only places
// the conversion happens, so rounding stays consistent everywhere.

export const toRM = (cents: Cents): number => new Decimal(cents).div(100).toNumber();
export const toCents = (rm: number): Cents =>
  new Decimal(String(rm)).mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();

export const toQty = (milli: Milli): number => new Decimal(milli).div(1000).toNumber();
export const toMilli = (qty: number): Milli =>
  new Decimal(String(qty)).mul(1000).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();

/** Charge for `qtyMilli` units at `priceCents` each, rounded to whole cents. */
export const lineAmount = (priceCents: Cents, qtyMilli: Milli): Cents =>
  new Decimal(priceCents)
    .mul(qtyMilli)
    .div(1000)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();

/** Parse a user-entered price (RM) into cents, rejecting junk/negatives. */
export function priceCentsFrom(value: unknown): Cents {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new RangeError("price must be a non-negative number");
  }
  return toCents(n);
}

/** Display helpers (kept here so formatting rules live in one place). */
export const fmtMoney = (cents: Cents, prefix = "RM"): string =>
  `${prefix} ${toRM(cents).toFixed(2)}`;

export const fmtQty = (milli: Milli): string => {
  // Quantities are stored as thousandths. Decimal keeps all meaningful digits
  // (1.25 and 1.005) while omitting insignificant zeroes (1.500 -> 1.5).
  return new Decimal(milli).div(1000).toDecimalPlaces(3).toString();
};

// "each" reads badly with a count ("1 each"); show pc/pcs instead. Other units
// are used as-is. `milli` decides singular vs plural.
export function unitLabel(unit: Unit, milli?: Milli): string {
  if (unit === "each") return milli != null && toQty(milli) === 1 ? "pc" : "pcs";
  return unit;
}

/** Quantity with its (humanised) unit, e.g. "1.5 kg", "3 pcs", "1 pc". */
export const fmtQtyUnit = (milli: Milli, unit: Unit): string =>
  `${fmtQty(milli)} ${unitLabel(unit, milli)}`;

// Units sold by a measured amount (weight/volume), where the unit clarifies the
// number. Discrete counts (box, bottle, pack, pieces, each) read fine on their
// own, so we don't tack a unit onto those.
export const MEASURE_UNITS: ReadonlySet<Unit> = new Set<Unit>(["kg", "ft", "meter"]);
export const isMeasureUnit = (unit: Unit): boolean => MEASURE_UNITS.has(unit);

/** Quantity, with the unit appended only for measured units (e.g. "1.5 kg"). */
export const fmtQtySold = (milli: Milli, unit: Unit): string =>
  isMeasureUnit(unit) ? fmtQtyUnit(milli, unit) : fmtQty(milli);
