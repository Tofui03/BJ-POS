import { describe, it, expect } from "vitest";
import {
  effectiveUnitPrice,
  appliedTier,
  priceLine,
  calcReverseQuantity,
  reversePriceLine,
} from "./pricing.js";
import { lineAmount } from "./money.js";
import { PosError } from "./errors.js";
import type { PricedItem } from "./types.js";

const talapia: PricedItem = {
  id: 1,
  key: "talapia",
  name: "Talapia",
  image: "",
  unit: "kg",
  priceCents: 1800,
  active: true,
  tracksTail: false,
  stockMilli: null,
  sortOrder: 0,
  tiers: [{ id: 1, itemId: 1, minQtyMilli: 30000, priceCents: 1500 }],
};

const multiTier: PricedItem = {
  ...talapia,
  // intentionally out of order to prove sorting
  tiers: [
    { id: 2, itemId: 1, minQtyMilli: 50000, priceCents: 1300 },
    { id: 1, itemId: 1, minQtyMilli: 30000, priceCents: 1500 },
  ],
};

const plainItem: PricedItem = {
  id: 3,
  key: "pvc_pipe",
  name: "PVC Pipe",
  image: "",
  unit: "meter",
  priceCents: 450, // RM 4.50 / meter
  active: true,
  tracksTail: false,
  stockMilli: null,
  sortOrder: 0,
  tiers: [],
};

describe("effectiveUnitPrice", () => {
  it("uses the base price below the lowest tier", () => {
    expect(effectiveUnitPrice(talapia, 29999)).toBe(1800);
    expect(effectiveUnitPrice(talapia, 1000)).toBe(1800);
  });

  it("applies the tier exactly at the threshold", () => {
    expect(effectiveUnitPrice(talapia, 30000)).toBe(1500);
  });

  it("keeps the tier above the threshold", () => {
    expect(effectiveUnitPrice(talapia, 45000)).toBe(1500);
  });

  it("picks the highest qualifying tier regardless of input order", () => {
    expect(effectiveUnitPrice(multiTier, 30000)).toBe(1500);
    expect(effectiveUnitPrice(multiTier, 49999)).toBe(1500);
    expect(effectiveUnitPrice(multiTier, 50000)).toBe(1300);
  });

  it("falls back to base with no tiers", () => {
    expect(effectiveUnitPrice({ ...talapia, tiers: [] }, 99999)).toBe(1800);
  });
});

describe("appliedTier", () => {
  it("is null below threshold, the tier above it", () => {
    expect(appliedTier(talapia, 29999)).toBeNull();
    expect(appliedTier(talapia, 30000)?.priceCents).toBe(1500);
  });
});

describe("priceLine", () => {
  it("computes amount from the effective unit price", () => {
    // 30 kg @ RM15 = RM450 = 45000 cents
    expect(priceLine(talapia, 30000)).toMatchObject({ unitCents: 1500, amountCents: 45000 });
    // 2 kg @ RM18 = RM36 = 3600 cents
    expect(priceLine(talapia, 2000)).toMatchObject({ unitCents: 1800, amountCents: 3600 });
  });

  it("rounds fractional cents to whole cents", () => {
    // 1.5 kg @ RM18 = RM27.00 (1800 * 1500 / 1000 = 2700)
    expect(priceLine(talapia, 1500).amountCents).toBe(2700);
  });
});

describe("calcReverseQuantity", () => {
  it("calculates exact quantity from target amount and unit price", () => {
    // RM 10.00 (1000 cents) @ RM 2.00/kg (200 cents) -> 5.000 kg (5000 milli)
    expect(calcReverseQuantity(1000, 200)).toBe(5000);
    // RM 50.00 (5000 cents) @ RM 25.00/kg (2500 cents) -> 2.000 kg (2000 milli)
    expect(calcReverseQuantity(5000, 2500)).toBe(2000);
  });

  it("rounds repeating decimals using ROUND_HALF_UP with zero float drift", () => {
    // RM 10.00 (1000 cents) @ RM 3.00/kg (300 cents) -> 3.33333... kg -> 3333 milli
    expect(calcReverseQuantity(1000, 300)).toBe(3333);
    // RM 20.00 (2000 cents) @ RM 3.00/kg (300 cents) -> 6.66666... kg -> 6667 milli
    expect(calcReverseQuantity(2000, 300)).toBe(6667);
  });

  it("returns 0 milli for 0 target amount", () => {
    expect(calcReverseQuantity(0, 1500)).toBe(0);
  });

  it("rejects negative target amount with PosError", () => {
    expect(() => calcReverseQuantity(-100, 500)).toThrow(PosError);
    expect(() => calcReverseQuantity(-100, 500)).toThrow(/target amount cannot be negative/);
  });

  it("rejects non-positive unit price with PosError", () => {
    expect(() => calcReverseQuantity(1000, 0)).toThrow(PosError);
    expect(() => calcReverseQuantity(1000, -200)).toThrow(PosError);
    expect(() => calcReverseQuantity(1000, 0)).toThrow(/unit price must be positive/);
  });

  it("rejects non-finite inputs with PosError", () => {
    expect(() => calcReverseQuantity(NaN, 500)).toThrow(PosError);
    expect(() => calcReverseQuantity(1000, NaN)).toThrow(PosError);
    expect(() => calcReverseQuantity(Infinity, 500)).toThrow(PosError);
    expect(() => calcReverseQuantity(1000, Infinity)).toThrow(PosError);
  });
});

describe("reversePriceLine", () => {
  it("calculates quantity for items without discount tiers", () => {
    // RM 45.00 (4500 cents) @ RM 4.50/m (450 cents) -> 10.000 m (10000 milli)
    const res = reversePriceLine(plainItem, 4500);
    expect(res.qtyMilli).toBe(10000);
    expect(res.unitPriceCents).toBe(450);
    expect(res.lineAmountCents).toBe(4500);
    expect(res.tier).toBeNull();
  });

  it("uses base price when target amount is below tier threshold", () => {
    // Talapia base RM 18, tier at >= 30 kg is RM 15.
    // Budget RM 36.00 (3600 cents): 3600 * 1000 / 1800 = 2000 milli (2 kg) < 30 kg threshold
    const res = reversePriceLine(talapia, 3600);
    expect(res.qtyMilli).toBe(2000);
    expect(res.unitPriceCents).toBe(1800);
    expect(res.lineAmountCents).toBe(3600);
    expect(res.tier).toBeNull();
  });

  it("qualifies for tier price when budget is sufficient for tier threshold", () => {
    // Budget RM 450.00 (45000 cents):
    // At tier RM 15 (1500 cents): 45000 * 1000 / 1500 = 30000 milli (30 kg) >= 30 kg threshold -> qualifies!
    const res = reversePriceLine(talapia, 45000);
    expect(res.qtyMilli).toBe(30000);
    expect(res.unitPriceCents).toBe(1500);
    expect(res.lineAmountCents).toBe(45000);
    expect(res.tier).not.toBeNull();
    expect(res.tier?.priceCents).toBe(1500);
  });

  it("selects highest qualifying tier in multi-tier items", () => {
    // multiTier has:
    // Base: 1800 cents
    // Tier 1: 30,000 milli @ 1500 cents
    // Tier 2: 50,000 milli @ 1300 cents
    // Budget RM 650.00 (65000 cents):
    // Tier 2: 65000 * 1000 / 1300 = 50000 milli >= 50000 -> qualifies!
    const res = reversePriceLine(multiTier, 65000);
    expect(res.qtyMilli).toBe(50000);
    expect(res.unitPriceCents).toBe(1300);
    expect(res.lineAmountCents).toBe(65000);
    expect(res.tier?.priceCents).toBe(1300);
  });

  it("returns 0 quantity and 0 amount for 0 target amount", () => {
    const res = reversePriceLine(talapia, 0);
    expect(res.qtyMilli).toBe(0);
    expect(res.unitPriceCents).toBe(1800);
    expect(res.lineAmountCents).toBe(0);
    expect(res.tier).toBeNull();
  });

  it("maintains mathematical symmetry with lineAmount", () => {
    // Budget RM 10.00 (1000 cents) for Talapia:
    // 1000 * 1000 / 1800 = 555.555... -> 556 milli (0.556 kg)
    const res = reversePriceLine(talapia, 1000);
    expect(res.qtyMilli).toBe(556);
    expect(res.lineAmountCents).toBe(lineAmount(res.unitPriceCents, res.qtyMilli));
    // 1800 * 556 / 1000 = 1000.8 -> 1001 cents
    expect(res.lineAmountCents).toBe(1001);
  });

  it("throws PosError on negative target budget", () => {
    expect(() => reversePriceLine(talapia, -500)).toThrow(PosError);
  });
});
