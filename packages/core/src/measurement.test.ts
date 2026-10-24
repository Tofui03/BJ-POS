import { describe, it, expect } from "vitest";
import { deductTare, validateNetWeight } from "./measurement.js";
import { PosError } from "./errors.js";

describe("deductTare", () => {
  it("deducts tare weight from gross weight in milli-units", () => {
    // 5.000 kg gross - 0.500 kg tare = 4.500 kg net
    expect(deductTare(5000, 500)).toBe(4500);
    // 12.345 kg gross - 1.234 kg tare = 11.111 kg net
    expect(deductTare(12345, 1234)).toBe(11111);
  });

  it("returns full gross weight when tare is zero", () => {
    expect(deductTare(3500, 0)).toBe(3500);
    expect(deductTare(0, 0)).toBe(0);
  });

  it("returns zero when gross equals tare", () => {
    expect(deductTare(650, 650)).toBe(0);
  });

  it("clamps to zero when gross is less than tare (scale zero drift / empty pan)", () => {
    expect(deductTare(200, 500)).toBe(0);
    expect(deductTare(1, 1000)).toBe(0);
  });

  it("rounds fractional milli-units cleanly without floating point drift", () => {
    expect(deductTare(5000.4, 500.1)).toBe(4500);
    expect(deductTare(5000.6, 500.1)).toBe(4501);
  });

  it("rejects negative gross weight with PosError", () => {
    expect(() => deductTare(-100, 50)).toThrow(PosError);
    expect(() => deductTare(-100, 50)).toThrow(/gross weight must be a non-negative number/);
  });

  it("rejects negative tare weight with PosError", () => {
    expect(() => deductTare(500, -20)).toThrow(PosError);
    expect(() => deductTare(500, -20)).toThrow(/tare weight must be a non-negative number/);
  });

  it("rejects non-finite inputs with PosError", () => {
    expect(() => deductTare(NaN, 50)).toThrow(PosError);
    expect(() => deductTare(500, NaN)).toThrow(PosError);
    expect(() => deductTare(Infinity, 50)).toThrow(PosError);
    expect(() => deductTare(500, -Infinity)).toThrow(PosError);
  });
});

describe("validateNetWeight", () => {
  describe("single-argument form (netMilli)", () => {
    it("accepts strictly positive net weight", () => {
      expect(() => validateNetWeight(1)).not.toThrow();
      expect(() => validateNetWeight(5000)).not.toThrow();
    });

    it("rejects zero net weight with PosError", () => {
      expect(() => validateNetWeight(0)).toThrow(PosError);
      expect(() => validateNetWeight(0)).toThrow(/net weight must be greater than zero/);
    });

    it("rejects negative net weight with PosError", () => {
      expect(() => validateNetWeight(-100)).toThrow(PosError);
      expect(() => validateNetWeight(-100)).toThrow(/net weight must be greater than zero/);
    });

    it("rejects NaN and non-finite net weight with PosError", () => {
      expect(() => validateNetWeight(NaN)).toThrow(PosError);
      expect(() => validateNetWeight(Infinity)).toThrow(PosError);
    });
  });

  describe("dual-argument form (grossMilli, tareMilli)", () => {
    it("returns calculated net weight when gross > tare", () => {
      expect(validateNetWeight(5000, 500)).toBe(4500);
      expect(validateNetWeight(1000, 0)).toBe(1000);
    });

    it("rejects gross weight equal to tare with PosError", () => {
      expect(() => validateNetWeight(500, 500)).toThrow(PosError);
      expect(() => validateNetWeight(500, 500)).toThrow(/gross weight must be greater than tare weight/);
    });

    it("rejects gross weight less than tare with PosError", () => {
      expect(() => validateNetWeight(400, 500)).toThrow(PosError);
      expect(() => validateNetWeight(400, 500)).toThrow(/gross weight must be greater than tare weight/);
    });

    it("rejects non-positive gross weight with PosError", () => {
      expect(() => validateNetWeight(0, 0)).toThrow(PosError);
      expect(() => validateNetWeight(-100, 50)).toThrow(PosError);
    });

    it("rejects negative tare weight with PosError", () => {
      expect(() => validateNetWeight(1000, -100)).toThrow(PosError);
    });

    it("rejects sub-milli difference when net weight rounds to zero with PosError", () => {
      expect(() => validateNetWeight(1000.4, 1000.0)).toThrow(PosError);
      expect(() => validateNetWeight(1000.4, 1000.0)).toThrow(/net weight must be positive after tare deduction/);
      expect(() => validateNetWeight(500.4, 500.1)).toThrow(PosError);
    });
  });
});
