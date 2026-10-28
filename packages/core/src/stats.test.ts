import { describe, it, expect } from "vitest";
import { periodRange, computeStats, aggregateItemSales, computeFinancialMetrics } from "./stats.js";
import type { Order, OrderLine, Repayment } from "./types.js";

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
    expect(stats.refundsCount).toBe(0);
    expect(stats.refundsTotalCents).toBe(0);
  });

  it("aggregates refundsCount and refundsTotalCents for refund orders", () => {
    const regularOrder = mk(1, "Cash", 5000);
    const refundOrder: Order = {
      ...mk(2, "Cash", -2000),
      refundOfOrderId: 1,
    };
    const stats = computeStats([regularOrder, refundOrder], "today");
    expect(stats.count).toBe(2);
    expect(stats.totalCents).toBe(3000);
    expect(stats.byMethod.Cash).toEqual({ count: 2, totalCents: 3000 });
    expect(stats.refundsCount).toBe(1);
    expect(stats.refundsTotalCents).toBe(2000);
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

  it("deducts returned item quantities and amounts in aggregateItemSales", () => {
    const sale: Order = {
      ...mk(1, "Cash", 5000),
      items: [
        line({ itemId: 10, name: "Drill", unit: "pieces", qtyMilli: 2000, amountCents: 5000 }),
      ],
    };
    const refund: Order = {
      ...mk(2, "Cash", -2500),
      refundOfOrderId: 1,
      items: [
        line({ itemId: 10, name: "Drill", unit: "pieces", qtyMilli: 1000, amountCents: 2500 }),
      ],
    };
    const sales = aggregateItemSales([sale, refund]);
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({ itemId: 10, qtyMilli: 1000, amountCents: 2500 });
  });

  it("filters out items where net quantity and revenue reach 0 or negative", () => {
    const sale: Order = {
      ...mk(1, "Cash", 5000),
      items: [
        line({ itemId: 10, name: "Drill", unit: "pieces", qtyMilli: 2000, amountCents: 5000 }),
        line({ itemId: 20, name: "Hammer", unit: "pieces", qtyMilli: 1000, amountCents: 3000 }),
      ],
    };
    const fullRefundDrill: Order = {
      ...mk(2, "Cash", -5000),
      refundOfOrderId: 1,
      items: [
        line({ itemId: 10, name: "Drill", unit: "pieces", qtyMilli: 2000, amountCents: 5000 }),
      ],
    };
    const sales = aggregateItemSales([sale, fullRefundDrill]);
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({ itemId: 20, qtyMilli: 1000, amountCents: 3000 });
  });
});

describe("computeFinancialMetrics (Triple financial metrics alignment)", () => {
  it("strictly separates Gross Merchandise Sales, Realized Inflow, and Expected Drawer Cash", () => {
    // Orders:
    // Cash sale: 50.00
    // Card sale: 30.00
    // QR sale: 20.00
    // Bank sale: 40.00
    // Credit sale: 100.00
    // Cash refund: -15.00
    // QR refund: -10.00
    const orders: Order[] = [
      mk(1, "Cash", 5000),
      mk(2, "Card", 3000),
      mk(3, "QR", 2000),
      mk(4, "Bank", 4000),
      mk(5, "Credit", 10000),
      { ...mk(6, "Cash", -1500), refundOfOrderId: 1 },
      { ...mk(7, "QR", -1000), refundOfOrderId: 3 },
    ];

    // Repayments (yesterday debt collected today):
    // Cash repayment: 25.00
    // Bank repayment: 60.00
    const repayments: Repayment[] = [
      {
        id: 1, companyId: 1, creditId: 10, orderId: 99, contractorName: "Ah Meng",
        amountCents: 2500, method: "Cash", ts: 100, businessDate: "2026-06-19"
      },
      {
        id: 2, companyId: 1, creditId: 11, orderId: 98, contractorName: "Ah Seng",
        amountCents: 6000, method: "Bank", ts: 200, businessDate: "2026-06-19"
      },
    ];

    const metrics = computeFinancialMetrics(orders, repayments);

    // 1. Gross Merchandise Sales:
    // 50 + 30 + 20 + 40 + 100 - 15 - 10 = 215.00 (21500 cents)
    // MUST NOT include repayments (25 + 60 = 85.00)!
    expect(metrics.grossMerchandiseSalesCents).toBe(21500);

    // 2. Realized Inflow:
    // Non-credit sales net: (50 - 15) + 30 + (20 - 10) + 40 = 35 + 30 + 10 + 40 = 115.00
    // Repayments: 25 + 60 = 85.00
    // Total realized inflow: 115 + 85 = 200.00 (20000 cents)
    // Credit sale (100.00) is excluded!
    expect(metrics.realizedInflowCents).toBe(20000);

    // 3. Expected Drawer Cash:
    // Cash sales (50.00) + Cash repayments (25.00) - Cash refunds (15.00) = 60.00 (6000 cents)
    expect(metrics.expectedDrawerCashCents).toBe(6000);

    expect(metrics.refundsCount).toBe(2);
    expect(metrics.refundsTotalCents).toBe(2500);
    expect(metrics.repaymentsCount).toBe(2);
    expect(metrics.repaymentsTotalCents).toBe(8500);
  });
});

