import type { Milli } from "./types.js";
import { PosError } from "./errors.js";

/**
 * Deduct container tare weight from gross scale reading in milli-units.
 * Clamps result to 0 (cannot be negative) and rounds to whole milli-units,
 * eliminating floating point drift.
 *
 * @param grossMilli Gross reading from the scale in milli-units (e.g. 5000 = 5.000 kg).
 * @param tareMilli Tare weight of the container in milli-units (e.g. 500 = 0.500 kg).
 * @returns Non-negative net weight in milli-units.
 */
export function deductTare(grossMilli: Milli, tareMilli: Milli): Milli {
  if (!Number.isFinite(grossMilli) || grossMilli < 0) {
    throw new PosError("gross weight must be a non-negative number");
  }
  if (!Number.isFinite(tareMilli) || tareMilli < 0) {
    throw new PosError("tare weight must be a non-negative number");
  }
  const net = Math.round(grossMilli - tareMilli);
  return Math.max(0, net);
}

/**
 * Validates that a net weight is positive (> 0) and finite.
 * Supports both single-argument validation `validateNetWeight(netMilli)`
 * and dual-argument gross/tare validation `validateNetWeight(grossMilli, tareMilli)`.
 *
 * Throws PosError if the net weight is <= 0 or invalid.
 */
export function validateNetWeight(netMilli: Milli): void;
export function validateNetWeight(grossMilli: Milli, tareMilli: Milli): Milli;
export function validateNetWeight(grossOrNetMilli: Milli, tareMilli?: Milli): Milli | void {
  if (tareMilli !== undefined) {
    if (!Number.isFinite(grossOrNetMilli) || grossOrNetMilli <= 0) {
      throw new PosError("gross weight must be greater than zero");
    }
    if (!Number.isFinite(tareMilli) || tareMilli < 0) {
      throw new PosError("tare weight must be non-negative");
    }
    if (grossOrNetMilli <= tareMilli) {
      throw new PosError("gross weight must be greater than tare weight");
    }
    const net = Math.round(grossOrNetMilli - tareMilli);
    if (net <= 0) {
      throw new PosError("net weight must be positive after tare deduction");
    }
    return net;
  }

  if (!Number.isFinite(grossOrNetMilli) || grossOrNetMilli <= 0) {
    throw new PosError("net weight must be greater than zero");
  }
}
