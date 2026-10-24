import { describe, expect, it } from "vitest";
import { assertCents, assertPositiveMilli, fmtQty, fmtQtyUnit, isMeasureUnit, MEASURE_UNITS } from "./money.js";
import { PosError } from "./errors.js";

describe("quantity formatting", () => {
  it("preserves kilogram precision stored in thousandths", () => {
    expect(fmtQtyUnit(1250, "kg")).toBe("1.25 kg");
    expect(fmtQtyUnit(1005, "kg")).toBe("1.005 kg");
  });

  it("does not add insignificant zeroes", () => {
    expect(fmtQty(1000)).toBe("1");
    expect(fmtQty(1500)).toBe("1.5");
  });
});

describe("isMeasureUnit and MEASURE_UNITS", () => {
  it("returns true for kg, ft, and meter", () => {
    expect(isMeasureUnit("kg")).toBe(true);
    expect(isMeasureUnit("ft")).toBe(true);
    expect(isMeasureUnit("meter")).toBe(true);
  });

  it("returns false for discrete count units", () => {
    expect(isMeasureUnit("pcs")).toBe(false);
    expect(isMeasureUnit("box")).toBe(false);
    expect(isMeasureUnit("bag")).toBe(false);
    expect(isMeasureUnit("each")).toBe(false);
  });

  it("MEASURE_UNITS contains exactly kg, ft, and meter", () => {
    expect(Array.from(MEASURE_UNITS).sort()).toEqual(["ft", "kg", "meter"]);
  });
});

describe("assertCents", () => {
  it("accepts zero and positive integers", () => {
    expect(() => assertCents(0)).not.toThrow();
    expect(() => assertCents(100)).not.toThrow();
    expect(() => assertCents(2500, "priceCents")).not.toThrow();
  });

  it("rejects negative numbers with PosError", () => {
    expect(() => assertCents(-1, "priceCents")).toThrow(PosError);
    expect(() => assertCents(-1, "priceCents")).toThrow(
      "priceCents must be a non-negative whole-cent amount (cents)",
    );
  });

  it("rejects fractional amounts", () => {
    expect(() => assertCents(10.5)).toThrow(PosError);
    expect(() => assertCents(0.99, "totalCents")).toThrow(
      "totalCents must be a non-negative whole-cent amount (cents)",
    );
  });

  it("rejects non-integers such as NaN and Infinity", () => {
    expect(() => assertCents(Number.NaN)).toThrow(PosError);
    expect(() => assertCents(Number.POSITIVE_INFINITY)).toThrow(PosError);
  });

  it("uses default field name when not provided", () => {
    expect(() => assertCents(-5)).toThrow("amount must be a non-negative whole-cent amount (cents)");
  });
});

describe("assertPositiveMilli", () => {
  it("accepts strictly positive integers", () => {
    expect(() => assertPositiveMilli(1)).not.toThrow();
    expect(() => assertPositiveMilli(1000)).not.toThrow();
    expect(() => assertPositiveMilli(12500, "qtyMilli")).not.toThrow();
  });

  it("rejects zero", () => {
    expect(() => assertPositiveMilli(0)).toThrow(PosError);
    expect(() => assertPositiveMilli(0, "qtyMilli")).toThrow(
      "qtyMilli must be a positive integer milli-unit (e.g. 1000 for 1.000)",
    );
  });

  it("rejects negative numbers", () => {
    expect(() => assertPositiveMilli(-1)).toThrow(PosError);
    expect(() => assertPositiveMilli(-1000, "line qtyMilli")).toThrow(
      "line qtyMilli must be a positive integer milli-unit (e.g. 1000 for 1.000)",
    );
  });

  it("rejects fractional milli-units", () => {
    expect(() => assertPositiveMilli(1500.5)).toThrow(PosError);
  });

  it("rejects non-integers like NaN and Infinity", () => {
    expect(() => assertPositiveMilli(Number.NaN)).toThrow(PosError);
    expect(() => assertPositiveMilli(Number.POSITIVE_INFINITY)).toThrow(PosError);
  });

  it("uses default field name when not provided", () => {
    expect(() => assertPositiveMilli(-10)).toThrow(
      "quantity must be a positive integer milli-unit (e.g. 1000 for 1.000)",
    );
  });
});
