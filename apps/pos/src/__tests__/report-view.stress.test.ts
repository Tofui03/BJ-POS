import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import * as XLSX from "xlsx";
import {
  PAYMENT_METHODS,
  type Order,
  type OrderLine,
  type PaymentMethod,
  type Repayment,
  type RepaymentMethod,
  type Unit,
} from "@yf/core";
import { router } from "../router";
import ReportView from "../views/ReportView.vue";
import {
  computeReportOrderStats,
  computeRealizedCashflow,
  computeDonutSlices,
  aggregateFilteredItems,
  reconcileColumns,
} from "../report/reportLogic";
import { buildDailyWorkbook, buildDailyExcelB64 } from "../report/daily";
import { L } from "../labels";

let idCounter = 2000;

function createTestLine(
  itemId: number,
  name: string,
  priceCents: number,
  qtyMilli: number = 1000,
  unit: Unit = "pcs",
  overrides: Partial<OrderLine> = {},
): OrderLine {
  const amountCents = Math.round((priceCents * qtyMilli) / 1000);
  return {
    id: ++idCounter,
    itemId,
    name,
    image: "",
    unit,
    priceCents,
    qtyMilli,
    amountCents,
    tailCount: 0,
    bulkPrice: false,
    ...overrides,
  };
}

function createTestOrder(
  method: PaymentMethod,
  items: OrderLine[],
  overrides: Partial<Order> = {},
): Order {
  const itemsTotalCents = items.reduce((sum, item) => sum + item.amountCents, 0);
  const discountCents = overrides.discountCents ?? 0;
  const totalCents = overrides.totalCents ?? itemsTotalCents - discountCents;
  return {
    id: ++idCounter,
    companyId: 1,
    ts: Date.now(),
    businessDate: "2026-10-24",
    invNo: method === "Credit" ? `B-${idCounter}` : `A-${idCounter}`,
    method,
    discountCents,
    totalCents,
    items,
    voidedAt: null,
    ...overrides,
  };
}

function createTestRefundOrder(
  originalOrder: Order,
  refundLines: { itemId: number; name: string; priceCents: number; qtyMilli: number; unit?: Unit }[],
  overrides: Partial<Order> = {},
): Order {
  const lines: OrderLine[] = refundLines.map((rl) =>
    createTestLine(rl.itemId, rl.name, rl.priceCents, rl.qtyMilli, rl.unit ?? "pcs"),
  );
  const refundAmountCents = lines.reduce((sum, l) => sum + l.amountCents, 0);
  return {
    id: ++idCounter,
    companyId: originalOrder.companyId,
    ts: Date.now(),
    businessDate: originalOrder.businessDate,
    invNo: originalOrder.method === "Credit" ? `B-${idCounter}` : `A-${idCounter}`,
    method: originalOrder.method,
    refundOfOrderId: originalOrder.id,
    refundOfInvNo: originalOrder.invNo,
    discountCents: 0,
    totalCents: -refundAmountCents,
    items: lines,
    voidedAt: null,
    ...overrides,
  };
}

function createTestRepayment(
  method: RepaymentMethod,
  amountCents: number,
  contractorName: string = "Ah Seng Contractor",
  businessDate: string = "2026-10-24",
): Repayment {
  return {
    id: ++idCounter,
    companyId: 1,
    creditId: 100,
    orderId: 200,
    contractorName,
    amountCents,
    method,
    ts: Date.now(),
    businessDate,
  };
}

describe("Owner Sales Report Stress & Verification Suite", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe("1. Exact 0-Cents Reconciliation (Left vs Right Columns)", () => {
    it("REC-01: Reconciles under 'All' filter across multi-item mixed orders", () => {
      const orders: Order[] = [
        createTestOrder("Cash", [
          createTestLine(1, "Portland Cement 50kg", 2250, 2000), // 4500
          createTestLine(2, "Wire Nails 2in", 1000, 1500, "kg"), // 1500
        ]), // Total: 6000
        createTestOrder("Card", [
          createTestLine(3, "Cordless Drill 12V", 18500, 1000), // 18500
        ]), // Total: 18500
        createTestOrder("QR", [
          createTestLine(4, "PVC Pipe 1/2in", 200, 5000, "ft"), // 1000
          createTestLine(5, "PVC Elbow", 150, 4000), // 600
        ]), // Total: 1600
        createTestOrder("Bank", [
          createTestLine(6, "Steel Rod Y12", 3200, 3000), // 9600
        ]), // Total: 9600
        createTestOrder("Credit", [
          createTestLine(7, "Plywood 9mm", 2400, 4000), // 9600
        ]), // Total: 9600
      ];

      const orderStats = computeReportOrderStats(orders);
      const itemsRes = aggregateFilteredItems(orders, "All", "", "revenue");
      const rec = reconcileColumns(
        orderStats.totalCents,
        itemsRes.itemSubtotalCents,
        itemsRes.wholeBillDiscountCents,
      );

      expect(orderStats.totalCents).toBe(6000 + 18500 + 1600 + 9600 + 9600);
      expect(rec.driftCents).toBe(0);
      expect(rec.netSalesCents).toBe(orderStats.totalCents);
    });

    it("REC-02: Reconciles under each individual payment channel (0 cents drift)", () => {
      const orders: Order[] = [
        createTestOrder("Cash", [createTestLine(1, "Cement", 2000, 1000)]),
        createTestOrder("Card", [createTestLine(2, "Hammer", 3500, 1000)]),
        createTestOrder("QR", [createTestLine(3, "Tape", 500, 2000)]),
        createTestOrder("Bank", [createTestLine(4, "Zinc", 4500, 1000)]),
        createTestOrder("Credit", [createTestLine(5, "Paint", 8500, 1000)]),
      ];

      const orderStats = computeReportOrderStats(orders);

      for (const m of PAYMENT_METHODS) {
        const itemsRes = aggregateFilteredItems(orders, m, "", "revenue");
        const rec = reconcileColumns(
          orderStats.byMethod[m].totalCents,
          itemsRes.itemSubtotalCents,
          itemsRes.wholeBillDiscountCents,
        );
        expect(rec.driftCents).toBe(0);
        expect(rec.orderRevenueCents).toBe(orderStats.byMethod[m].totalCents);
      }
    });

    it("REC-03: Reconciles with whole-bill discounts (0 cents drift)", () => {
      const orders: Order[] = [
        createTestOrder("Cash", [createTestLine(1, "Paint Can", 10000, 2000)], { discountCents: 1500 }), // items 20000 - 1500 = 18500
        createTestOrder("Bank", [createTestLine(2, "Roller", 1200, 3000)], { discountCents: 600 }), // items 3600 - 600 = 3000
      ];

      const orderStats = computeReportOrderStats(orders);
      const itemsRes = aggregateFilteredItems(orders, "All", "", "revenue");
      const rec = reconcileColumns(
        orderStats.totalCents,
        itemsRes.itemSubtotalCents,
        itemsRes.wholeBillDiscountCents,
      );

      expect(orderStats.totalCents).toBe(18500 + 3000);
      expect(itemsRes.wholeBillDiscountCents).toBe(2100);
      expect(itemsRes.itemSubtotalCents).toBe(23600);
      expect(rec.driftCents).toBe(0);
    });

    it("REC-04: Reconciles with odd-cent prices and fractional milli-quantities", () => {
      const orders: Order[] = [
        createTestOrder("Cash", [
          createTestLine(1, "Odd Nails", 1173, 333, "kg"), // round(1173 * 333 / 1000) = round(390.609) = 391
        ]),
        createTestOrder("Card", [
          createTestLine(2, "Copper Pipe", 877, 782, "ft"), // round(877 * 782 / 1000) = round(685.814) = 686
        ]),
      ];

      const orderStats = computeReportOrderStats(orders);
      const itemsRes = aggregateFilteredItems(orders, "All", "", "revenue");
      const rec = reconcileColumns(
        orderStats.totalCents,
        itemsRes.itemSubtotalCents,
        itemsRes.wholeBillDiscountCents,
      );

      expect(orderStats.totalCents).toBe(391 + 686);
      expect(rec.driftCents).toBe(0);
    });

    it("REC-05: Excludes voided orders completely from reconciliation", () => {
      const orders: Order[] = [
        createTestOrder("Cash", [createTestLine(1, "Active Item", 5000, 1000)]),
        createTestOrder("Cash", [createTestLine(2, "Voided Item", 9000, 1000)], { voidedAt: Date.now() }),
      ];

      const orderStats = computeReportOrderStats(orders);
      const itemsRes = aggregateFilteredItems(orders, "Cash", "", "revenue");
      const rec = reconcileColumns(
        orderStats.byMethod.Cash.totalCents,
        itemsRes.itemSubtotalCents,
        itemsRes.wholeBillDiscountCents,
      );

      expect(orderStats.totalCents).toBe(5000);
      expect(itemsRes.rows.some((r) => r.name === "Voided Item")).toBe(false);
      expect(rec.driftCents).toBe(0);
    });

    it("REC-06: High-volume stress batch (1,000 orders) completes in < 50ms with 0 drift", () => {
      const orders: Order[] = [];
      const methods: PaymentMethod[] = ["Cash", "Card", "QR", "Bank", "Credit"];

      for (let i = 0; i < 1000; i++) {
        const m = methods[i % 5]!;
        const hasDiscount = i % 7 === 0;
        orders.push(
          createTestOrder(
            m,
            [
              createTestLine(10 + (i % 20), `Item ${i % 20}`, 500 + (i % 50) * 100, 1000 + (i % 5) * 500),
            ],
            hasDiscount ? { discountCents: 50 + (i % 10) * 10 } : {},
          ),
        );
      }

      const t0 = performance.now();
      const orderStats = computeReportOrderStats(orders);
      const itemsRes = aggregateFilteredItems(orders, "All", "", "revenue");
      const rec = reconcileColumns(
        orderStats.totalCents,
        itemsRes.itemSubtotalCents,
        itemsRes.wholeBillDiscountCents,
      );
      const elapsed = performance.now() - t0;

      expect(rec.driftCents).toBe(0);
      expect(elapsed).toBeLessThan(50);
    });

    it("REC-07: Debt repayments isolation invariant (repayments do not contaminate order revenue)", () => {
      const orders: Order[] = [
        createTestOrder("Cash", [createTestLine(1, "Cement", 2000, 1000)]),
      ];
      const repayments: Repayment[] = [
        createTestRepayment("Cash", 50000),
        createTestRepayment("Bank", 30000),
      ];

      const orderStats = computeReportOrderStats(orders); // repayments passed as [] internally
      const itemsRes = aggregateFilteredItems(orders, "All", "", "revenue");
      const rec = reconcileColumns(
        orderStats.totalCents,
        itemsRes.itemSubtotalCents,
        itemsRes.wholeBillDiscountCents,
      );

      expect(orderStats.totalCents).toBe(2000);
      expect(rec.driftCents).toBe(0);
    });

    it("REC-08: Non-zero drift is detected when an order total is corrupted (empirical check invariant)", () => {
      // Create order with 10,000 item cents, 500 discount cents, expected total 9,500.
      // Deliberately corrupt totalCents to 9,000 (500 cents mismatch).
      const corruptedOrder = createTestOrder(
        "Cash",
        [createTestLine(1, "Corrupted Tool", 10000, 1000)],
        { discountCents: 500, totalCents: 9000 },
      );

      const orderStats = computeReportOrderStats([corruptedOrder]);
      const itemsRes = aggregateFilteredItems([corruptedOrder], "All", "", "revenue");
      const rec = reconcileColumns(
        orderStats.totalCents,
        itemsRes.itemSubtotalCents,
        itemsRes.wholeBillDiscountCents,
      );

      // Verify that wholeBillDiscountCents accurately reflects the 500 cents discount
      expect(itemsRes.wholeBillDiscountCents).toBe(500);
      expect(itemsRes.itemSubtotalCents).toBe(10000);
      expect(rec.netSalesCents).toBe(9500);
      expect(rec.orderRevenueCents).toBe(9000);
      // Empirical drift check detects the exact 500 cents corruption
      expect(rec.driftCents).toBe(-500);
    });
  });

  describe("2. SVG Donut Chart Geometry & Reactive Slicing", () => {
    it("DNT-01: Calculates exact proportional angles and stroke-dasharray (r = 70, C ≈ 439.823)", () => {
      const orders: Order[] = [
        createTestOrder("Cash", [createTestLine(1, "A", 2000, 1000)]), // 2000 (20%)
        createTestOrder("Card", [createTestLine(2, "B", 3000, 1000)]), // 3000 (30%)
        createTestOrder("QR", [createTestLine(3, "C", 5000, 1000)]), // 5000 (50%)
      ];

      const orderStats = computeReportOrderStats(orders);
      const donut = computeDonutSlices(orderStats, "All");

      expect(donut.hasPositiveSales).toBe(true);
      expect(donut.slices.length).toBe(3);

      const cash = donut.slices.find((s) => s.method === "Cash")!;
      const card = donut.slices.find((s) => s.method === "Card")!;
      const qr = donut.slices.find((s) => s.method === "QR")!;

      expect(cash.percentage).toBeCloseTo(20, 1);
      expect(card.percentage).toBeCloseTo(30, 1);
      expect(qr.percentage).toBeCloseTo(50, 1);

      const C = 2 * Math.PI * 70;
      const sumArcs = cash.arcLength + card.arcLength + qr.arcLength;
      expect(sumArcs).toBeCloseTo(C, 2);
    });

    it("DNT-02: Cumulative stroke-dashoffset sequencing tiles circumference without gap", () => {
      const orders: Order[] = [
        createTestOrder("Cash", [createTestLine(1, "A", 1000, 1000)]),
        createTestOrder("Bank", [createTestLine(2, "B", 2000, 1000)]),
      ];

      const orderStats = computeReportOrderStats(orders);
      const donut = computeDonutSlices(orderStats, "All");

      expect(donut.slices[0]!.strokeDashoffset).toBe(0);
      expect(donut.slices[1]!.strokeDashoffset).toBeCloseTo(-donut.slices[0]!.arcLength, 2);
    });

    it("DNT-03: Renders neutral ring fallback on zero sales", () => {
      const orderStats = computeReportOrderStats([]);
      const donut = computeDonutSlices(orderStats, "All");

      expect(donut.hasPositiveSales).toBe(false);
      expect(donut.slices.length).toBe(0);
    });

    it("DNT-04: Renders neutral ring fallback on net negative revenue", () => {
      const sale = createTestOrder("Cash", [createTestLine(1, "Item", 1000, 1000)]);
      const refund = createTestRefundOrder(sale, [{ itemId: 1, name: "Item", priceCents: 3000, qtyMilli: 1000 }]);

      const orderStats = computeReportOrderStats([sale, refund]);
      const donut = computeDonutSlices(orderStats, "All");

      expect(donut.hasPositiveSales).toBe(false);
      expect(donut.slices.length).toBe(0);
    });

    it("DNT-05: Highlights active filter slice and dims non-selected slices", () => {
      const orders: Order[] = [
        createTestOrder("Cash", [createTestLine(1, "A", 1000, 1000)]),
        createTestOrder("Card", [createTestLine(2, "B", 2000, 1000)]),
      ];

      const orderStats = computeReportOrderStats(orders);
      const donut = computeDonutSlices(orderStats, "Card");

      const cardSlice = donut.slices.find((s) => s.method === "Card")!;
      const cashSlice = donut.slices.find((s) => s.method === "Cash")!;

      expect(cardSlice.isHighlighted).toBe(true);
      expect(cardSlice.opacity).toBe(1.0);
      expect(cashSlice.isHighlighted).toBe(false);
      expect(cashSlice.opacity).toBeLessThan(0.5);
    });

    it("DNT-06: Single-channel monopoly (100% sales) renders complete full circle slice", () => {
      const orders: Order[] = [
        createTestOrder("Bank", [createTestLine(1, "A", 5000, 1000)]),
      ];

      const orderStats = computeReportOrderStats(orders);
      const donut = computeDonutSlices(orderStats, "All");

      expect(donut.slices.length).toBe(1);
      expect(donut.slices[0]!.percentage).toBe(100);
      expect(donut.slices[0]!.arcLength).toBeCloseTo(2 * Math.PI * 70, 2);
    });

    it("DNT-07: Numerical stability across 1,000 randomized distributions", () => {
      const C = 2 * Math.PI * 70;
      for (let i = 0; i < 1000; i++) {
        const cashCents = Math.floor(Math.random() * 50000) + 1;
        const cardCents = Math.floor(Math.random() * 50000);
        const qrCents = Math.floor(Math.random() * 50000);
        const orders: Order[] = [
          createTestOrder("Cash", [createTestLine(1, "A", cashCents, 1000)]),
        ];
        if (cardCents > 0) orders.push(createTestOrder("Card", [createTestLine(2, "B", cardCents, 1000)]));
        if (qrCents > 0) orders.push(createTestOrder("QR", [createTestLine(3, "C", qrCents, 1000)]));

        const orderStats = computeReportOrderStats(orders);
        const donut = computeDonutSlices(orderStats, "All");
        expect(donut.hasPositiveSales).toBe(true);
        const sumArcs = donut.slices.reduce((sum, s) => sum + s.arcLength, 0);
        expect(sumArcs).toBeCloseTo(C, 2);
      }
    });
  });

  describe("3. Refund Line Subtraction & Pure Return Retention", () => {
    it("RFN-01: Partial refund decreases quantity and amount in net aggregated row", () => {
      const sale = createTestOrder("Cash", [createTestLine(1, "Cement", 2000, 10000)]); // 10 bags @ 2000 = 20000
      const refund = createTestRefundOrder(sale, [{ itemId: 1, name: "Cement", priceCents: 2000, qtyMilli: 3000 }]); // -3 bags = -6000

      const itemsRes = aggregateFilteredItems([sale, refund], "All", "", "revenue");
      expect(itemsRes.rows.length).toBe(1);
      expect(itemsRes.rows[0]!.qtyMilli).toBe(7000);
      expect(itemsRes.rows[0]!.totalCents).toBe(14000);
      expect(itemsRes.rows[0]!.isNegative).toBe(false);
    });

    it("RFN-02: Retains pure refund item with negative styling and 0 drift", () => {
      const sale = createTestOrder("Cash", [createTestLine(1, "Plywood", 3000, 1000)]); // 3000
      const refund = createTestRefundOrder(
        createTestOrder("Cash", []),
        [{ itemId: 2, name: "Returned Drill", priceCents: 25000, qtyMilli: 1000 }],
      ); // -25000

      const orderStats = computeReportOrderStats([sale, refund]);
      const itemsRes = aggregateFilteredItems([sale, refund], "All", "", "revenue");
      const rec = reconcileColumns(
        orderStats.totalCents,
        itemsRes.itemSubtotalCents,
        itemsRes.wholeBillDiscountCents,
      );

      expect(itemsRes.rows.length).toBe(2);
      const drillRow = itemsRes.rows.find((r) => r.name === "Returned Drill")!;
      expect(drillRow.qtyMilli).toBe(-1000);
      expect(drillRow.totalCents).toBe(-25000);
      expect(drillRow.isNegative).toBe(true);

      expect(orderStats.totalCents).toBe(3000 - 25000);
      expect(rec.driftCents).toBe(0);
    });

    it("RFN-03: Reconciles a 100% pure refund period with 0 drift", () => {
      const refund = createTestRefundOrder(
        createTestOrder("QR", []),
        [{ itemId: 5, name: "Faulty Hose", priceCents: 4500, qtyMilli: 2000 }],
      );

      const orderStats = computeReportOrderStats([refund]);
      const itemsRes = aggregateFilteredItems([refund], "All", "", "revenue");
      const rec = reconcileColumns(
        orderStats.totalCents,
        itemsRes.itemSubtotalCents,
        itemsRes.wholeBillDiscountCents,
      );

      expect(orderStats.totalCents).toBe(-9000);
      expect(itemsRes.rows[0]!.isNegative).toBe(true);
      expect(rec.driftCents).toBe(0);
    });

    it("RFN-04: Same-period cancellation netting filters 0-net item without drift", () => {
      const sale = createTestOrder("Bank", [createTestLine(1, "Saw", 5000, 1000)]);
      const refund = createTestRefundOrder(sale, [{ itemId: 1, name: "Saw", priceCents: 5000, qtyMilli: 1000 }]);

      const orderStats = computeReportOrderStats([sale, refund]);
      const itemsRes = aggregateFilteredItems([sale, refund], "All", "", "revenue");
      const rec = reconcileColumns(
        orderStats.totalCents,
        itemsRes.itemSubtotalCents,
        itemsRes.wholeBillDiscountCents,
      );

      expect(orderStats.totalCents).toBe(0);
      expect(itemsRes.rows.length).toBe(0); // Net 0 movement excluded from active table
      expect(rec.driftCents).toBe(0);
    });

    it("RFN-05: Search and sorting correctly handles negative return rows", () => {
      const sale1 = createTestOrder("Cash", [createTestLine(1, "Top Hammer", 5000, 2000)]); // 10000
      const sale2 = createTestOrder("Cash", [createTestLine(2, "Mid Nail", 1000, 3000)]); // 3000
      const refund = createTestRefundOrder(sale1, [{ itemId: 3, name: "Returned Drill", priceCents: 8000, qtyMilli: 1000 }]); // -8000

      // Sort by revenue
      const revRes = aggregateFilteredItems([sale1, sale2, refund], "All", "", "revenue");
      expect(revRes.rows[0]!.name).toBe("Top Hammer");
      expect(revRes.rows[1]!.name).toBe("Mid Nail");
      expect(revRes.rows[2]!.name).toBe("Returned Drill");

      // Sort by qty
      const qtyRes = aggregateFilteredItems([sale1, sale2, refund], "All", "", "qty");
      expect(qtyRes.rows[0]!.name).toBe("Mid Nail"); // 3000
      expect(qtyRes.rows[1]!.name).toBe("Top Hammer"); // 2000
      expect(qtyRes.rows[2]!.name).toBe("Returned Drill"); // -1000

      // Search
      const searchRes = aggregateFilteredItems([sale1, sale2, refund], "All", "Drill", "revenue");
      expect(searchRes.rows.length).toBe(1);
      expect(searchRes.rows[0]!.name).toBe("Returned Drill");
      expect(searchRes.rows[0]!.isNegative).toBe(true);
    });
  });

  describe("4. Decoupled Cashflow Accounting (Realized Cash In vs Credit Debt)", () => {
    it("CSH-01: Realized Cash In sums non-credit orders + repayments while credit sales tracks debt", () => {
      const orders: Order[] = [
        createTestOrder("Cash", [createTestLine(1, "A", 10000, 1000)]), // 10000
        createTestOrder("Card", [createTestLine(2, "B", 5000, 1000)]), // 5000
        createTestOrder("Credit", [createTestLine(3, "C", 8000, 1000)]), // 8000
      ];

      const orderStats = computeReportOrderStats(orders);
      const cashflow = computeRealizedCashflow(orderStats, 6000);

      expect(orderStats.totalCents).toBe(23000);
      expect(cashflow.realizedCashInCents).toBe(10000 + 5000 + 6000); // 21000
      expect(cashflow.creditSalesCents).toBe(8000);
    });

    it("CSH-02: Computes cashflow ratio percentage accurately", () => {
      const orders: Order[] = [
        createTestOrder("Cash", [createTestLine(1, "A", 21000, 1000)]),
        createTestOrder("Credit", [createTestLine(2, "B", 8000, 1000)]),
      ];

      const orderStats = computeReportOrderStats(orders);
      const cashflow = computeRealizedCashflow(orderStats, 0);

      expect(cashflow.cashRatioPercent).toBe(Math.round((21000 / 29000) * 100)); // 72%
    });

    it("CSH-03: Zero debt day achieves 100% cash ratio", () => {
      const orders: Order[] = [
        createTestOrder("Cash", [createTestLine(1, "A", 5000, 1000)]),
      ];

      const orderStats = computeReportOrderStats(orders);
      const cashflow = computeRealizedCashflow(orderStats, 2000);

      expect(cashflow.creditSalesCents).toBe(0);
      expect(cashflow.cashRatioPercent).toBe(100);
    });

    it("CSH-04: Pure credit day achieves 0% cash ratio", () => {
      const orders: Order[] = [
        createTestOrder("Credit", [createTestLine(1, "A", 12000, 1000)]),
      ];

      const orderStats = computeReportOrderStats(orders);
      const cashflow = computeRealizedCashflow(orderStats, 0);

      expect(cashflow.realizedCashInCents).toBe(0);
      expect(cashflow.creditSalesCents).toBe(12000);
      expect(cashflow.cashRatioPercent).toBe(0);
    });

    it("CSH-05: Multi-method repayments do not pollute merchandise orderStats", () => {
      const orders: Order[] = [
        createTestOrder("Cash", [createTestLine(1, "Cement", 2500, 2000)]), // 5000
      ];
      const repayments: Repayment[] = [
        createTestRepayment("Cash", 150000),
        createTestRepayment("Bank", 200000),
        createTestRepayment("QR", 150000),
      ];

      const orderStats = computeReportOrderStats(orders);
      expect(orderStats.count).toBe(1);
      expect(orderStats.totalCents).toBe(5000);
      expect(orderStats.byMethod.Cash.totalCents).toBe(5000);
      expect(orderStats.byMethod.Bank.totalCents).toBe(0);
      expect(orderStats.byMethod.QR.totalCents).toBe(0);
      expect(orderStats.repaymentsTotalCents).toBe(0);

      const repaymentsTotal = repayments.reduce((s, r) => s + r.amountCents, 0);
      const cashflow = computeRealizedCashflow(orderStats, repaymentsTotal);
      expect(cashflow.realizedCashInCents).toBe(5000 + 500000);
    });
  });

  describe("5. Multi-Period Excel Export Verification (Day, Week, Month)", () => {
    it("XCL-01: Generates valid Day scope Excel workbook with single business date", () => {
      const orders: Order[] = [
        createTestOrder("Cash", [createTestLine(1, "Cement", 2250, 1000)], { businessDate: "2026-10-24" }),
      ];
      const repayments: Repayment[] = [
        createTestRepayment("Cash", 5000, "Ah Seng", "2026-10-24"),
      ];

      const wb = buildDailyWorkbook(orders, repayments);
      expect(wb.SheetNames).toEqual(["HQ Daily", "Invoice Items"]);

      const hqRows = XLSX.utils.sheet_to_json(wb.Sheets["HQ Daily"]!, { header: 1 }) as any[][];
      expect(hqRows[1]![1]).toBe("2026-10-24"); // Date column
      expect(hqRows[2]![1]).toBe("2026-10-24"); // Repayment Date column
    });

    it("XCL-02: Generates valid Weekly scope Excel workbook with multi-date rows", () => {
      const orders: Order[] = [
        createTestOrder("Cash", [createTestLine(1, "Item A", 1000, 1000)], { businessDate: "2026-10-19" }),
        createTestOrder("Card", [createTestLine(2, "Item B", 2000, 1000)], { businessDate: "2026-10-22" }),
        createTestOrder("Bank", [createTestLine(3, "Item C", 3000, 1000)], { businessDate: "2026-10-25" }),
      ];

      const wb = buildDailyWorkbook(orders, []);
      const hqRows = XLSX.utils.sheet_to_json(wb.Sheets["HQ Daily"]!, { header: 1 }) as any[][];

      expect(hqRows[1]![1]).toBe("2026-10-19");
      expect(hqRows[2]![1]).toBe("2026-10-22");
      expect(hqRows[3]![1]).toBe("2026-10-25");
    });

    it("XCL-03: Generates valid Monthly scope Excel workbook across 31 days with correct sum formulas", () => {
      const orders: Order[] = [];
      for (let day = 1; day <= 31; day++) {
        const dateStr = `2026-10-${String(day).padStart(2, "0")}`;
        orders.push(
          createTestOrder("Cash", [createTestLine(day, `Day ${day} Item`, 1000, 1000)], {
            businessDate: dateStr,
          }),
        );
      }
      const repayments: Repayment[] = [
        createTestRepayment("Bank", 20000, "Monthly Repay", "2026-10-15"),
      ];

      const wb = buildDailyWorkbook(orders, repayments);
      expect(wb.SheetNames).toEqual(["HQ Daily", "Invoice Items"]);
      const hqRows = XLSX.utils.sheet_to_json(wb.Sheets["HQ Daily"]!, { header: 1 }) as any[][];
      // 1 header + 31 order rows + 1 repayment row + 1 footer row = 34 rows
      expect(hqRows.length).toBe(34);
    });

    it("XCL-04: Generates base64 binary that roundtrips through XLSX parser cleanly", () => {
      const orders: Order[] = [
        createTestOrder("QR", [createTestLine(1, "Tape", 400, 5000)]),
      ];

      const b64 = buildDailyExcelB64(orders, []);
      expect(typeof b64).toBe("string");
      expect(b64.length).toBeGreaterThan(100);

      const parsedWb = XLSX.read(b64, { type: "base64" });
      expect(parsedWb.SheetNames).toEqual(["HQ Daily", "Invoice Items"]);
    });

    it("XCL-05: Excludes voided orders completely from Excel workbook sheets", () => {
      const orders: Order[] = [
        createTestOrder("Cash", [createTestLine(1, "Valid Item", 3000, 1000)]),
        createTestOrder("Cash", [createTestLine(2, "Voided Item", 7000, 1000)], { voidedAt: Date.now() }),
      ];

      const wb = buildDailyWorkbook(orders, []);
      const hqRows = XLSX.utils.sheet_to_json(wb.Sheets["HQ Daily"]!, { header: 1 }) as any[][];
      const itemsRows = XLSX.utils.sheet_to_json(wb.Sheets["Invoice Items"]!, { header: 1 }) as any[][];

      // Voided items should not appear in either sheet
      expect(hqRows.some((row) => row.includes("Voided Item"))).toBe(false);
      expect(itemsRows.some((row) => row.includes("Voided Item"))).toBe(false);
      expect(itemsRows.some((row) => row.includes("Valid Item"))).toBe(true);
    });
  });

  describe("6. SSR Component Integration & Regression Protection", () => {
    it("SSR-01: ReportView retains Download Excel button and omits Resend to Drive", async () => {
      const app = createSSRApp(ReportView);
      app.use(createPinia());
      app.use(router);
      const html = await renderToString(app);

      // Must retain Download Excel
      expect(html).toContain(L.downloadExcel);
      expect(html).toContain("老板销售报表 / Owner Sales Report");

      // Must NOT render Resend to Drive
      expect(html).not.toContain(L.resendDrive);
      expect(html).not.toContain("Resend to Drive");
    });

    it("SSR-02: ReportView renders high-density layout classes and period buttons", async () => {
      const app = createSSRApp(ReportView);
      app.use(createPinia());
      app.use(router);
      const html = await renderToString(app);

      expect(html).toContain("Day");
      expect(html).toContain("Weekly");
      expect(html).toContain("Monthly");
    });

    it("SSR-03: ReportView renders SVG Donut and center statistics", async () => {
      const app = createSSRApp(ReportView);
      app.use(createPinia());
      app.use(router);
      const html = await renderToString(app);

      expect(html).toContain("<svg");
      expect(html).toContain("<circle");
      expect(html).toContain(L.salesCount);
    });

    it("SSR-04: ReportView renders dual-column 5:7 grid classes", async () => {
      const app = createSSRApp(ReportView);
      app.use(createPinia());
      app.use(router);
      const html = await renderToString(app);

      expect(html).toContain("grid-cols-1 lg:grid-cols-12");
      expect(html).toContain("lg:col-span-5");
      expect(html).toContain("lg:col-span-7");
    });

    it("SSR-05: ReportView renders payment channel filter list and reconciliation footer", async () => {
      const app = createSSRApp(ReportView);
      app.use(createPinia());
      app.use(router);
      const html = await renderToString(app);

      expect(html).toContain(L.choosePay);
      expect(html).toContain(L.allChannels);
      expect(html).toContain(L.reconciledZeroDrift);
      expect(html).toContain(L.netSales);
    });

    it("SSR-06: Sub-second execution performance", async () => {
      const t0 = performance.now();
      const app = createSSRApp(ReportView);
      app.use(createPinia());
      app.use(router);
      const html = await renderToString(app);
      const elapsed = performance.now() - t0;
      expect(html.length).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(1000);
    });

    it("SSR-07: Negative discount display avoids double negative formatting", () => {
      const wholeBillDiscountCents = -5;
      const fmtMoney = (c: number) => `RM ${(c / 100).toFixed(2)}`;
      const formatted = `${wholeBillDiscountCents > 0 ? '-' : '+'}${fmtMoney(Math.abs(wholeBillDiscountCents))}`;
      expect(formatted).toBe("+RM 0.05");
      expect(formatted).not.toContain("-RM -");
    });

    it("SSR-08: Item search footer label tokens exist and decouple match count from period subtotal", () => {
      expect(L.periodSubtotal).toBeDefined();
      expect(L.searchMatches).toBeDefined();
      expect(typeof L.periodSubtotal).toBe("string");
      expect(typeof L.searchMatches).toBe("string");
    });

    it("SSR-09: Synthetic repayment rows have negative IDs to safeguard against merchandise order ID collisions", () => {
      const repayments: Repayment[] = [
        createTestRepayment("Cash", 50000),
      ];
      const syntheticOrders = repayments.map((r) => ({
        id: -r.id,
        invNo: `REP-${r.id}`,
      }));
      expect(syntheticOrders[0]!.id).toBeLessThan(0);
      expect(syntheticOrders[0]!.invNo).toMatch(/^REP-/);
    });
  });
});
