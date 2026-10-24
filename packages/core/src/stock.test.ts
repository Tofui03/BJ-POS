import { describe, expect, it } from "vitest";
import { isStockTracked, planStockDeduction, stockLeftMilli } from "./stock.js";
import { PosError } from "./errors.js";

describe("stock indicators", () => {
  it("determines whether an item tracks stock", () => {
    expect(isStockTracked({ stockMilli: 5000 })).toBe(true);
    expect(isStockTracked({ stockMilli: 0 })).toBe(true);
    expect(isStockTracked({ stockMilli: null })).toBe(false);
  });

  it("computes sellable stock left", () => {
    expect(stockLeftMilli({ stockMilli: 5000 })).toBe(5000);
    expect(stockLeftMilli({ stockMilli: 0 })).toBe(0);
    expect(stockLeftMilli({ stockMilli: -100 })).toBe(0);
    expect(stockLeftMilli({ stockMilli: null })).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("planStockDeduction", () => {
  const stockRows = [
    { id: 1, name: "Plywood 9mm", stockMilli: 10000 },
    { id: 2, name: "Nails 2-inch", stockMilli: 5000 },
    { id: 3, name: "Untracked Sand", stockMilli: null },
  ];

  it("plans deduction for single tracked items with sufficient stock", () => {
    const lines = [{ itemId: 1, qtyMilli: 3000 }];
    const plan = planStockDeduction(stockRows, lines);
    expect(plan).toEqual([{ itemId: 1, nextStockMilli: 7000 }]);
  });

  it("omits untracked items and items not in stockRows from plan", () => {
    const lines = [
      { itemId: 3, qtyMilli: 2000 }, // untracked
      { itemId: 99, qtyMilli: 1000 }, // missing from stockRows
    ];
    const plan = planStockDeduction(stockRows, lines);
    expect(plan).toEqual([]);
  });

  it("accumulates stock deductions across multiple lines for the same item", () => {
    const lines = [
      { itemId: 1, qtyMilli: 3000 },
      { itemId: 1, qtyMilli: 2500 },
      { itemId: 2, qtyMilli: 1000 },
    ];
    const plan = planStockDeduction(stockRows, lines);
    expect(plan).toEqual([
      { itemId: 1, nextStockMilli: 4500 },
      { itemId: 2, nextStockMilli: 4000 },
    ]);
  });

  it("allows consuming all available stock down to 0", () => {
    const lines = [{ itemId: 2, qtyMilli: 5000 }];
    const plan = planStockDeduction(stockRows, lines);
    expect(plan).toEqual([{ itemId: 2, nextStockMilli: 0 }]);
  });

  it("throws PosError if requested quantity exceeds available stock", () => {
    const lines = [{ itemId: 1, qtyMilli: 12000 }];
    expect(() => planStockDeduction(stockRows, lines)).toThrow(PosError);
    expect(() => planStockDeduction(stockRows, lines)).toThrow(
      "not enough stock for Plywood 9mm — please add more stock",
    );
  });

  it("throws PosError if accumulated quantity across lines exceeds stock", () => {
    const lines = [
      { itemId: 2, qtyMilli: 3000 },
      { itemId: 2, qtyMilli: 2500 },
    ];
    expect(() => planStockDeduction(stockRows, lines)).toThrow(PosError);
    expect(() => planStockDeduction(stockRows, lines)).toThrow(
      "not enough stock for Nails 2-inch — please add more stock",
    );
  });
});
