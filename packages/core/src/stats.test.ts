import { describe, it, expect } from "vitest";
import { periodRange, computeStats, aggregateItemSales } from "./stats.js";
import type { Order, OrderLine } from "./types.js";

const mk = (ts: number, method: Order["method"], totalCents: number): Order => ({
  id: ts, companyId: 1, ts, businessDate: "2026-06-19", invNo: "06-1000", method, totalCents, items: [], voidedAt: null,
});

const line = (over: Partial<OrderLine>): OrderLine => ({
  id: 1, itemId: 1, name: "Milk", image: "", unit: "box",
  priceCents: 650, qtyMilli: 1000, amountCents: 650, tailCount: 0, bulkPrice: false, ...over,
});

describe("periodRange", () => {
  const now = new Date(2026, 5, 19, 14, 30); // 19 Jun 2026

  it("today is the calendar day", () => {
    const [s, e] = periodRange("today", now);
    expect(new Date(s).getDate()).toBe(19);
    expect(e - s).toBe(86_400_000);
  });

  it("month spans the calendar month", () => {
    const [s, e] = periodRange("month", now);
    expect(new Date(s).getMonth()).toBe(5);
    expect(new Date(s).getDate()).toBe(1);
    expect(new Date(e).getMonth()).toBe(6);
  });

  it("all covers everything", () => {
    expect(periodRange("all", now)).toEqual([0, Number.MAX_SAFE_INTEGER]);
  });
});

describe("computeStats", () => {
  it("totals and breaks down by method", () => {
    const stats = computeStats(
      [mk(1, "Cash", 1000), mk(2, "Cash", 500), mk(3, "QR", 2000)],
      "today",
    );
    expect(stats.count).toBe(3);
    expect(stats.totalCents).toBe(3500);
    expect(stats.byMethod.Cash).toEqual({ count: 2, totalCents: 1500 });
    expect(stats.byMethod.QR).toEqual({ count: 1, totalCents: 2000 });
    expect(stats.byMethod.Bank).toEqual({ count: 0, totalCents: 0 });
  });

  it("handles no orders", () => {
    const stats = computeStats([], "all");
    expect(stats.count).toBe(0);
    expect(stats.totalCents).toBe(0);
  });
});

describe("aggregateItemSales", () => {
  it("sums qty + revenue per item and sorts by quantity", () => {
    const orders: Order[] = [
      { ...mk(1, "Cash", 0), items: [
        line({ itemId: 1, name: "Milk", unit: "box", qtyMilli: 20000, amountCents: 13000 }),
        line({ itemId: 2, name: "Fish", unit: "kg", qtyMilli: 3000, amountCents: 5400 }),
      ] },
      { ...mk(2, "QR", 0), items: [
        line({ itemId: 1, name: "Milk", unit: "box", qtyMilli: 10000, amountCents: 6500 }),
      ] },
    ];
    const sales = aggregateItemSales(orders);
    expect(sales).toHaveLength(2);
    expect(sales[0]!.name).toBe("Milk"); // 30 boxes > 3 kg
    expect(sales[0]).toMatchObject({ qtyMilli: 30000, amountCents: 19500, lines: 2 });
    expect(sales[1]).toMatchObject({ name: "Fish", qtyMilli: 3000, amountCents: 5400 });
  });

  it("merges lines of the same item across orders", () => {
    const orders: Order[] = [
      { ...mk(1, "Cash", 0), items: [line({ itemId: 9, name: "Lime", unit: "kg", qtyMilli: 1000, amountCents: 300 })] },
      { ...mk(2, "Cash", 0), items: [line({ itemId: 9, name: "Lime", unit: "kg", qtyMilli: 2000, amountCents: 600 })] },
    ];
    const sales = aggregateItemSales(orders);
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({ itemId: 9, qtyMilli: 3000, amountCents: 900 });
  });
});
