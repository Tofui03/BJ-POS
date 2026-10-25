import { describe, expect, it } from "vitest";
import {
  assertValidRestockQuantity,
  compareStockAscending,
  DEFAULT_LOW_STOCK_THRESHOLD_MILLI,
  filterStockItems,
  formatStockQty,
  getStockStatus,
  isLowStock,
  isStockTracked,
  planStockDeduction,
  stockLeftMilli,
} from "./stock.js";
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

describe("isLowStock", () => {
  it("treats untracked items as not low stock", () => {
    expect(isLowStock({ stockMilli: null })).toBe(false);
    expect(isLowStock({ stockMilli: null }, 10000)).toBe(false);
  });

  it("identifies low stock and out-of-stock items against default threshold (5000 milli)", () => {
    expect(isLowStock({ stockMilli: 5000 })).toBe(true);
    expect(isLowStock({ stockMilli: 1000 })).toBe(true);
    expect(isLowStock({ stockMilli: 0 })).toBe(true);
    expect(isLowStock({ stockMilli: -500 })).toBe(true);
    expect(isLowStock({ stockMilli: 5001 })).toBe(false);
    expect(isLowStock({ stockMilli: 20000 })).toBe(false);
  });

  it("respects custom low stock threshold", () => {
    expect(isLowStock({ stockMilli: 8000 }, 10000)).toBe(true);
    expect(isLowStock({ stockMilli: 10000 }, 10000)).toBe(true);
    expect(isLowStock({ stockMilli: 10001 }, 10000)).toBe(false);
    expect(isLowStock({ stockMilli: 4000 }, 3000)).toBe(false);
  });
});

describe("getStockStatus", () => {
  it("classifies stock status correctly", () => {
    expect(getStockStatus({ stockMilli: null })).toBe("untracked");
    expect(getStockStatus({ stockMilli: 0 })).toBe("out_of_stock");
    expect(getStockStatus({ stockMilli: -200 })).toBe("out_of_stock");
    expect(getStockStatus({ stockMilli: 1000 })).toBe("low_stock");
    expect(getStockStatus({ stockMilli: 5000 })).toBe("low_stock");
    expect(getStockStatus({ stockMilli: 5001 })).toBe("in_stock");
    expect(getStockStatus({ stockMilli: 15000 })).toBe("in_stock");
  });

  it("respects custom threshold for stock status", () => {
    expect(getStockStatus({ stockMilli: 8000 }, 10000)).toBe("low_stock");
    expect(getStockStatus({ stockMilli: 12000 }, 10000)).toBe("in_stock");
  });
});

describe("compareStockAscending", () => {
  it("sorts tracked items lowest-first, putting untracked items at the end", () => {
    const items = [
      { id: 1, name: "Untracked A", stockMilli: null },
      { id: 2, name: "In Stock", stockMilli: 10000 },
      { id: 3, name: "Out of Stock", stockMilli: 0 },
      { id: 4, name: "Negative Stock", stockMilli: -500 },
      { id: 5, name: "Low Stock", stockMilli: 3000 },
      { id: 6, name: "Untracked B", stockMilli: null },
    ];

    const sorted = [...items].sort(compareStockAscending);
    expect(sorted.map((i) => i.id)).toEqual([4, 3, 5, 2, 1, 6]);
  });

  it("tie-breaks by name then id when stock amounts match", () => {
    const items = [
      { id: 10, name: "Zinc Nails", stockMilli: 2000 },
      { id: 11, name: "Brass Screws", stockMilli: 2000 },
      { id: 12, name: "Aluminium Rivets", stockMilli: 2000 },
    ];
    const sorted = [...items].sort(compareStockAscending);
    expect(sorted.map((i) => i.name)).toEqual([
      "Aluminium Rivets",
      "Brass Screws",
      "Zinc Nails",
    ]);
  });
});

describe("filterStockItems", () => {
  const items = [
    {
      id: 1,
      key: "PLY-01",
      name: "Plywood 9mm",
      image: "",
      unit: "pcs" as const,
      priceCents: 3500,
      active: true,
      tracksTail: false,
      stockMilli: 2000, // low stock
      sortOrder: 1,
    },
    {
      id: 2,
      key: "CEM-01",
      name: "Cement 50kg",
      image: "",
      unit: "bag" as const,
      priceCents: 2200,
      active: true,
      tracksTail: false,
      stockMilli: 0, // out of stock
      sortOrder: 2,
    },
    {
      id: 3,
      key: "SND-01",
      name: "River Sand",
      image: "",
      unit: "bag" as const,
      priceCents: 800,
      active: true,
      tracksTail: false,
      stockMilli: null, // untracked
      sortOrder: 3,
    },
    {
      id: 4,
      key: "PNT-01",
      name: "Gloss Paint Red 5L",
      image: "",
      unit: "bottle" as const,
      priceCents: 4500,
      active: true,
      tracksTail: false,
      stockMilli: 15000, // in stock
      sortOrder: 4,
    },
  ];

  it("returns full list when no options provided", () => {
    expect(filterStockItems(items)).toEqual(items);
  });

  it("filters tracked items only", () => {
    const result = filterStockItems(items, { trackedOnly: true });
    expect(result.map((i) => i.id)).toEqual([1, 2, 4]);
  });

  it("filters low stock items only (including out of stock)", () => {
    const result = filterStockItems(items, { lowStockOnly: true });
    expect(result.map((i) => i.id)).toEqual([1, 2]);
  });

  it("filters by keyword search against name or key", () => {
    const byKey = filterStockItems(items, { search: "cem" });
    expect(byKey.map((i) => i.id)).toEqual([2]);

    const byName = filterStockItems(items, { search: "paint" });
    expect(byName.map((i) => i.id)).toEqual([4]);
  });

  it("sorts ascending by stock quantity", () => {
    const sorted = filterStockItems(items, { sortAscending: true });
    expect(sorted.map((i) => i.id)).toEqual([2, 1, 4, 3]);
  });

  it("combines trackedOnly, lowStockOnly, and sortAscending", () => {
    const result = filterStockItems(items, {
      trackedOnly: true,
      lowStockOnly: true,
      sortAscending: true,
    });
    expect(result.map((i) => i.id)).toEqual([2, 1]);
  });
});

describe("formatStockQty & assertValidRestockQuantity", () => {
  it("formats stock quantity with decimal truncation", () => {
    expect(formatStockQty(null)).toBe("—");
    expect(formatStockQty(0)).toBe("0");
    expect(formatStockQty(5000)).toBe("5");
    expect(formatStockQty(12500)).toBe("12.5");
    expect(formatStockQty(12345)).toBe("12.345");
  });

  it("assertValidRestockQuantity verifies positive integer milli", () => {
    expect(() => assertValidRestockQuantity(1000)).not.toThrow();
    expect(() => assertValidRestockQuantity(0)).toThrow(PosError);
    expect(() => assertValidRestockQuantity(-500)).toThrow(PosError);
    expect(() => assertValidRestockQuantity(123.45)).toThrow(PosError);
  });
});
