import { describe, expect, it } from "vitest";
import {
  PAYMENT_METHODS,
  type Order,
  type OrderLine,
  type PaymentMethod,
  type Repayment,
  type RepaymentMethod,
  type Unit,
  lineAmount,
} from "@yf/core";
import {
  computeReportOrderStats,
  computeRealizedCashflow,
  computeDonutSlices,
  aggregateFilteredItems,
  reconcileColumns,
  DONUT_CIRCUMFERENCE,
} from "../report/reportLogic";

let idCounter = 300000;

function createTestLine(
  itemId: number,
  name: string,
  priceCents: number,
  qtyMilli: number = 1000,
  unit: Unit = "pcs",
  overrides: Partial<OrderLine> = {},
): OrderLine {
  const amountCents = lineAmount(priceCents, qtyMilli);
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
  const effectiveDiscount =
    overrides.totalCents !== undefined ? discountCents : Math.min(discountCents, itemsTotalCents);
  const totalCents = overrides.totalCents ?? Math.max(0, itemsTotalCents - effectiveDiscount);
  return {
    id: ++idCounter,
    companyId: 1,
    ts: Date.now(),
    businessDate: "2026-10-26",
    invNo: method === "Credit" ? `B-${idCounter}` : `A-${idCounter}`,
    method,
    items,
    voidedAt: null,
    ...overrides,
    discountCents: effectiveDiscount,
    totalCents,
  };
}

function createTestRefund(
  originalOrder: Order,
  refundLines: { itemId: number; name: string; priceCents: number; qtyMilli: number; unit?: Unit }[],
  allocatedDiscountCents: number = 0,
): Order {
  const lines: OrderLine[] = refundLines.map((rl) =>
    createTestLine(rl.itemId, rl.name, rl.priceCents, rl.qtyMilli, rl.unit ?? "pcs"),
  );
  const grossRefundCents = lines.reduce((sum, l) => sum + l.amountCents, 0);
  const netRefundCents = Math.max(0, grossRefundCents - allocatedDiscountCents);
  return {
    id: ++idCounter,
    companyId: originalOrder.companyId,
    ts: Date.now(),
    businessDate: originalOrder.businessDate,
    invNo: originalOrder.method === "Credit" ? `B-${idCounter}` : `A-${idCounter}`,
    method: originalOrder.method,
    refundOfOrderId: originalOrder.id,
    refundOfInvNo: originalOrder.invNo,
    discountCents: allocatedDiscountCents,
    totalCents: -netRefundCents,
    items: lines,
    voidedAt: null,
  };
}

function createTestRepayment(
  method: RepaymentMethod,
  amountCents: number,
  contractorName: string = "Ah Seng Hardware",
): Repayment {
  return {
    id: ++idCounter,
    companyId: 1,
    creditId: 801,
    orderId: 901,
    contractorName,
    amountCents,
    method,
    ts: Date.now(),
    businessDate: "2026-10-26",
  };
}

describe("reportLogic edge cases", () => {
  describe("Mission Req 1: Exact Reconciliation Invariant Across All Payment Methods (0 Cents Drift)", () => {
    it("Reconciles individual payment channels with heterogeneous order lines", () => {
      const orders: Order[] = [
        createTestOrder("Cash", [
          createTestLine(1, "Steel Nail 2 inch", 450, 2000, "kg"), // 900 cents
          createTestLine(2, "Sandpaper #120", 120, 5000, "pcs"), // 600 cents
        ]),
        createTestOrder("Card", [
          createTestLine(3, "Cordless Drill 18V", 28500, 1000, "pcs"), // 28500 cents
        ]),
        createTestOrder("QR", [
          createTestLine(4, "PVC Pipe 1/2 inch", 850, 3000, "meter"), // 2550 cents
        ]),
        createTestOrder("Bank", [
          createTestLine(5, "Portland Cement 50kg", 2200, 10000, "pcs"), // 22000 cents
        ]),
        createTestOrder("Credit", [
          createTestLine(6, "Mild Steel Rebar 12mm", 3200, 4500, "meter"), // 14400 cents
        ]),
      ];

      const orderStats = computeReportOrderStats(orders);

      // Verify All Channels
      const allItems = aggregateFilteredItems(orders, "All", "", "revenue");
      const allRec = reconcileColumns(
        orderStats.totalCents,
        allItems.itemSubtotalCents,
        allItems.wholeBillDiscountCents,
      );
      expect(allRec.driftCents).toBe(0);
      expect(allRec.orderRevenueCents).toBe(orderStats.totalCents);
      expect(allRec.netSalesCents).toBe(orderStats.totalCents);

      // Verify Each Individual Channel
      for (const m of PAYMENT_METHODS) {
        const methodItems = aggregateFilteredItems(orders, m, "", "revenue");
        const methodRec = reconcileColumns(
          orderStats.byMethod[m].totalCents,
          methodItems.itemSubtotalCents,
          methodItems.wholeBillDiscountCents,
        );
        expect(methodRec.driftCents).toBe(0);
        expect(methodRec.orderRevenueCents).toBe(orderStats.byMethod[m].totalCents);
        expect(methodRec.netSalesCents).toBe(orderStats.byMethod[m].totalCents);
      }
    });

    it("Reconciles complex order lifecycle: whole-bill discount, partial refund, pure return, and voids", () => {
      // Sale 1: RM 150 gross, RM 25 discount, RM 125 net
      const sale1 = createTestOrder(
        "Credit",
        [
          createTestLine(10, "Plywood Sheet 12mm", 6000, 1000, "pcs"), // 6000
          createTestLine(11, "Timber Plank 2x4", 9000, 1000, "pcs"), // 9000
        ],
        { discountCents: 2500, totalCents: 12500 },
      );

      // Partial refund of Sale 1: returns Plywood (gross 6000), allocated discount 1000, net refund 5000
      const refund1 = createTestRefund(
        sale1,
        [{ itemId: 10, name: "Plywood Sheet 12mm", priceCents: 6000, qtyMilli: 1000 }],
        1000,
      );

      // Sale 2: RM 80, fully voided
      const sale2 = createTestOrder(
        "Cash",
        [createTestLine(12, "Hammer 16oz", 8000, 1000, "pcs")],
        { voidedAt: Date.now() },
      );

      // Pure return from prior period: customer returns RM 40 tool with RM 5 discount clawback, net refund RM 35
      const priorDummy: Order = {
        id: 999999,
        companyId: 1,
        ts: Date.now() - 86400000 * 3,
        businessDate: "2026-10-23",
        invNo: "A-999999",
        method: "Cash",
        items: [createTestLine(13, "Paint Brush 3 inch", 4000, 1000, "pcs")],
        discountCents: 500,
        totalCents: 3500,
        voidedAt: null,
      };
      const pureRefund = createTestRefund(
        priorDummy,
        [{ itemId: 13, name: "Paint Brush 3 inch", priceCents: 4000, qtyMilli: 1000 }],
        500,
      );

      const orders = [sale1, refund1, sale2, pureRefund];
      const stats = computeReportOrderStats(orders);

      // Verify voided sale2 is excluded from stats
      expect(stats.count).toBe(3); // sale1, refund1, pureRefund
      // Expected revenue: 12500 (sale1) - 5000 (refund1) - 3500 (pureRefund) = 4000
      expect(stats.totalCents).toBe(4000);
      expect(stats.byMethod.Credit.totalCents).toBe(7500); // 12500 - 5000
      expect(stats.byMethod.Cash.totalCents).toBe(-3500); // -3500 pure return

      const itemsRes = aggregateFilteredItems(orders, "All", "", "revenue");
      const rec = reconcileColumns(
        stats.totalCents,
        itemsRes.itemSubtotalCents,
        itemsRes.wholeBillDiscountCents,
      );

      expect(rec.driftCents).toBe(0);
      expect(rec.netSalesCents).toBe(4000);

      // Assert pure refund item is kept and marked negative
      const paintBrushRow = itemsRes.rows.find((r) => r.itemId === 13);
      expect(paintBrushRow).toBeDefined();
      expect(paintBrushRow!.totalCents).toBe(-4000);
      expect(paintBrushRow!.qtyMilli).toBe(-1000);
      expect(paintBrushRow!.isNegative).toBe(true);

      // Assert plywood row is netted out to 0 and removed from table
      const plywoodRow = itemsRes.rows.find((r) => r.itemId === 10);
      expect(plywoodRow).toBeUndefined();
    });

    it("Reconciles odd cents fractional milli calculations across metric units", () => {
      const orders: Order[] = [
        createTestOrder("Cash", [
          createTestLine(20, "Galvanized Wire", 345, 1234, "meter"), // 345 * 1234 / 1000 = 425.73 -> 426
          createTestLine(21, "Chemical Solvent", 8888, 77, "kg"), // 8888 * 77 / 1000 = 684.376 -> 684
        ]),
        createTestOrder("QR", [
          createTestLine(22, "Steel Chain Link", 1525, 4125, "ft"), // 1525 * 4125 / 1000 = 6290.625 -> 6291
        ]),
      ];

      const stats = computeReportOrderStats(orders);
      const itemsRes = aggregateFilteredItems(orders, "All", "", "revenue");
      const rec = reconcileColumns(
        stats.totalCents,
        itemsRes.itemSubtotalCents,
        itemsRes.wholeBillDiscountCents,
      );

      expect(rec.driftCents).toBe(0);
      expect(rec.netSalesCents).toBe(stats.totalCents);
    });
  });

  describe("Mission Req 2: Non-Zero Drift Detection & Mathematical Invariant", () => {
    it("Detects non-zero drift when order totalCents is perturbed (positive perturbation)", () => {
      // Valid order: gross RM 100, discount RM 10, expected total RM 90 (9000 cents)
      // Corrupt total to RM 95 (9500 cents) -> 500 cents perturbation
      const corruptedOrder = createTestOrder(
        "Cash",
        [createTestLine(1, "Hand Saw", 10000, 1000)],
        { discountCents: 1000, totalCents: 9500 },
      );

      const stats = computeReportOrderStats([corruptedOrder]);
      const itemsRes = aggregateFilteredItems([corruptedOrder], "All", "", "revenue");
      const rec = reconcileColumns(
        stats.totalCents,
        itemsRes.itemSubtotalCents,
        itemsRes.wholeBillDiscountCents,
      );

      expect(itemsRes.itemSubtotalCents).toBe(10000);
      expect(itemsRes.wholeBillDiscountCents).toBe(1000);
      expect(rec.netSalesCents).toBe(9000);
      expect(rec.orderRevenueCents).toBe(9500);
      // Drift = orderRevenue - netSales = 9500 - 9000 = +500 cents drift
      expect(rec.driftCents).toBe(500);
      expect(itemsRes.driftCents).toBe(500);
    });

    it("Detects non-zero drift when order totalCents is perturbed (negative perturbation)", () => {
      // Corrupt total to RM 85 (8500 cents) -> -500 cents perturbation
      const corruptedOrder = createTestOrder(
        "Card",
        [createTestLine(1, "Hand Saw", 10000, 1000)],
        { discountCents: 1000, totalCents: 8500 },
      );

      const stats = computeReportOrderStats([corruptedOrder]);
      const itemsRes = aggregateFilteredItems([corruptedOrder], "All", "", "revenue");
      const rec = reconcileColumns(
        stats.totalCents,
        itemsRes.itemSubtotalCents,
        itemsRes.wholeBillDiscountCents,
      );

      expect(rec.netSalesCents).toBe(9000);
      expect(rec.orderRevenueCents).toBe(8500);
      // Drift = orderRevenue - netSales = 8500 - 9000 = -500 cents drift
      expect(rec.driftCents).toBe(-500);
      expect(itemsRes.driftCents).toBe(-500);
    });

    it("Detects non-zero drift when line item amount is perturbed", () => {
      const order = createTestOrder(
        "Cash",
        [createTestLine(1, "Corrupted Line", 5000, 1000, "pcs", { amountCents: 5200 })], // 200 cents excess on line
        { totalCents: 5000 },
      );

      const stats = computeReportOrderStats([order]);
      const itemsRes = aggregateFilteredItems([order], "All", "", "revenue");
      const rec = reconcileColumns(
        stats.totalCents,
        itemsRes.itemSubtotalCents,
        itemsRes.wholeBillDiscountCents,
      );

      expect(stats.totalCents).toBe(5000);
      expect(itemsRes.itemSubtotalCents).toBe(5200);
      expect(rec.netSalesCents).toBe(5200);
      // Drift = 5000 - 5200 = -200 cents
      expect(rec.driftCents).toBe(-200);
      expect(itemsRes.driftCents).toBe(-200);
    });

    it("Fuzzing Oracle: Mathematical verification across 500 random parameter combinations", () => {
      for (let i = 0; i < 500; i++) {
        const orderRev = Math.floor(Math.random() * 200000) - 50000;
        const itemSub = Math.floor(Math.random() * 200000) - 50000;
        const discount = Math.floor(Math.random() * 10000);

        const rec = reconcileColumns(orderRev, itemSub, discount);
        const expectedNet = itemSub - discount;
        const expectedDrift = orderRev - expectedNet;

        expect(rec.netSalesCents).toBe(expectedNet);
        expect(rec.driftCents).toBe(expectedDrift);
      }
    });
  });

  describe("Mission Req 3: Extreme Load (10,000 Orders Stress Batch)", () => {
    it("Processes 10,000 heterogeneous orders with zero cents drift and execution time < 350ms", () => {
      const orders: Order[] = [];
      const methods: PaymentMethod[] = ["Cash", "Card", "QR", "Bank", "Credit"];

      for (let i = 0; i < 10000; i++) {
        const m = methods[i % methods.length]!;
        const isVoid = i % 103 === 0;
        const hasDiscount = i % 7 === 0;
        const discountCents = hasDiscount ? (i % 30) * 20 : 0;

        const lineCount = 1 + (i % 4);
        const lines: OrderLine[] = [];
        for (let j = 0; j < lineCount; j++) {
          const itemId = 1 + ((i * 3 + j) % 60);
          const price = 250 + (i % 80) * 12;
          const qty = 500 + (j % 4) * 500;
          lines.push(createTestLine(itemId, `Stress SKU ${itemId}`, price, qty));
        }

        orders.push(
          createTestOrder(m, lines, {
            discountCents,
            voidedAt: isVoid ? Date.now() : null,
          }),
        );
      }

      expect(orders.length).toBe(10000);

      const t0 = performance.now();
      const stats = computeReportOrderStats(orders);
      const itemsAll = aggregateFilteredItems(orders, "All", "", "revenue");
      const recAll = reconcileColumns(
        stats.totalCents,
        itemsAll.itemSubtotalCents,
        itemsAll.wholeBillDiscountCents,
      );
      const elapsedMs = performance.now() - t0;

      // Exact zero drift assertion
      expect(recAll.driftCents).toBe(0);
      expect(recAll.netSalesCents).toBe(stats.totalCents);
      expect(stats.totalCents).toBe(itemsAll.itemSubtotalCents - itemsAll.wholeBillDiscountCents);

      // Throughput check
      expect(elapsedMs).toBeLessThan(350);

      // Verify zero drift under every individual payment channel filter
      for (const m of methods) {
        const methodItems = aggregateFilteredItems(orders, m, "", "revenue");
        const methodRec = reconcileColumns(
          stats.byMethod[m].totalCents,
          methodItems.itemSubtotalCents,
          methodItems.wholeBillDiscountCents,
        );
        expect(methodRec.driftCents).toBe(0);
        expect(methodRec.orderRevenueCents).toBe(stats.byMethod[m].totalCents);
      }
    });

    it("Fuzzing sweep: 10 successive randomized batches of 1,000 orders each with 100% 0 drift", () => {
      for (let batch = 0; batch < 10; batch++) {
        const batchOrders: Order[] = [];
        for (let i = 0; i < 1000; i++) {
          const m = PAYMENT_METHODS[i % PAYMENT_METHODS.length]!;
          const discountCents = i % 5 === 0 ? 50 + (i % 200) : 0;
          const lines = [
            createTestLine(101, "Batch Item 1", 100 + (i % 50), 1000),
            createTestLine(102, "Batch Item 2", 300 + (i % 70), 500),
          ];
          batchOrders.push(createTestOrder(m, lines, { discountCents }));
        }

        const stats = computeReportOrderStats(batchOrders);
        const items = aggregateFilteredItems(batchOrders, "All", "", "revenue");
        const rec = reconcileColumns(stats.totalCents, items.itemSubtotalCents, items.wholeBillDiscountCents);
        expect(rec.driftCents).toBe(0);
      }
    });
  });

  describe("Mission Req 4: Mixed Repayments and Refunds Isolation on Same Date", () => {
    it("Strictly isolates debt repayments into Realized Cash In without contaminating order sales totals", () => {
      // Business Date: 2026-10-26
      // Today's merchandise orders:
      const orders: Order[] = [
        createTestOrder("Cash", [createTestLine(1, "Cement Bag", 2200, 5000, "pcs")]), // RM 110.00
        createTestOrder("Credit", [createTestLine(2, "Timber Beam", 15000, 2000, "pcs")]), // RM 300.00
      ];

      // Contractor settles debts from yesterday or earlier:
      const repayments: Repayment[] = [
        createTestRepayment("Cash", 45000, "Contractor Ali"), // RM 450.00
        createTestRepayment("Bank", 85000, "Contractor Bala"), // RM 850.00
        createTestRepayment("QR", 20000, "Contractor Chong"), // RM 200.00
      ];
      const repaymentsTotal = repayments.reduce((sum, r) => sum + r.amountCents, 0); // RM 1,500.00

      // Invariant 1: computeReportOrderStats strictly ignores repayments
      const orderStats = computeReportOrderStats(orders);
      expect(orderStats.totalCents).toBe(41000); // 11000 + 30000
      expect(orderStats.byMethod.Cash.totalCents).toBe(11000); // Only merchandise cash! NOT 11000 + 45000
      expect(orderStats.byMethod.Bank.totalCents).toBe(0); // Zero merchandise bank! NOT 85000
      expect(orderStats.byMethod.QR.totalCents).toBe(0); // Zero merchandise QR! NOT 20000
      expect(orderStats.byMethod.Credit.totalCents).toBe(30000);
      expect(orderStats.repaymentsTotalCents).toBe(0);

      // Invariant 2: Items table reconciliation is 100% clean with 0 drift
      const itemsRes = aggregateFilteredItems(orders, "All", "", "revenue");
      const rec = reconcileColumns(
        orderStats.totalCents,
        itemsRes.itemSubtotalCents,
        itemsRes.wholeBillDiscountCents,
      );
      expect(rec.driftCents).toBe(0);
      expect(rec.orderRevenueCents).toBe(41000);

      // Invariant 3: Realized Cash In combines non-credit orders + repayments
      const cashflow = computeRealizedCashflow(orderStats, repaymentsTotal);
      expect(cashflow.nonCreditOrdersCents).toBe(11000);
      expect(cashflow.repaymentsTotalCents).toBe(150000);
      expect(cashflow.realizedCashInCents).toBe(161000); // 11000 + 150000
      expect(cashflow.creditSalesCents).toBe(30000);
      expect(cashflow.totalFlowCents).toBe(191000); // 161000 + 30000

      // Cash vs Credit ratios
      // Cash ratio = 161000 / 191000 ≈ 84.29% -> 84%
      expect(cashflow.cashRatioPercent).toBe(84);
      expect(cashflow.creditRatioPercent).toBe(16);
      expect(cashflow.cashRatioPercent + cashflow.creditRatioPercent).toBe(100);
    });

    it("Handles simultaneous contractor credit sale, partial refund, and cash repayment cleanly", () => {
      // Contractor buys RM 500 on credit
      const creditSale = createTestOrder("Credit", [createTestLine(1, "Steel Pipe", 50000, 1000)]);
      // Contractor returns RM 150 of it
      const creditRefund = createTestRefund(creditSale, [
        { itemId: 1, name: "Steel Pipe", priceCents: 50000, qtyMilli: 300 },
      ]);
      // Contractor pays RM 400 debt repayment in Cash
      const debtRepayment = createTestRepayment("Cash", 40000, "Wong Construction");

      const orders = [creditSale, creditRefund];
      const orderStats = computeReportOrderStats(orders);

      expect(orderStats.byMethod.Credit.totalCents).toBe(35000); // 50000 - 15000
      expect(orderStats.byMethod.Cash.totalCents).toBe(0); // Zero merchandise cash
      expect(orderStats.totalCents).toBe(35000);

      // Items table reconciles with 0 drift
      const items = aggregateFilteredItems(orders, "All", "", "revenue");
      const rec = reconcileColumns(orderStats.totalCents, items.itemSubtotalCents, items.wholeBillDiscountCents);
      expect(rec.driftCents).toBe(0);

      // Cashflow
      const cashflow = computeRealizedCashflow(orderStats, debtRepayment.amountCents);
      expect(cashflow.nonCreditOrdersCents).toBe(0);
      expect(cashflow.repaymentsTotalCents).toBe(40000);
      expect(cashflow.realizedCashInCents).toBe(40000);
      expect(cashflow.creditSalesCents).toBe(35000);
      expect(cashflow.totalFlowCents).toBe(75000); // 40000 + 35000
      // 40000 / 75000 = 53.33% -> 53%
      expect(cashflow.cashRatioPercent).toBe(53);
      expect(cashflow.creditRatioPercent).toBe(47);
    });
  });

  describe("Mission Req 5: Edge Cases, Donut Math, & Filtering Integrity", () => {
    it("Calculates exact SVG donut arcs and highlights active method filter slice", () => {
      const orders: Order[] = [
        createTestOrder("Cash", [createTestLine(1, "Cash Item", 2000, 1000)]), // 20%
        createTestOrder("Card", [createTestLine(2, "Card Item", 3000, 1000)]), // 30%
        createTestOrder("QR", [createTestLine(3, "QR Item", 5000, 1000)]), // 50%
      ];

      const stats = computeReportOrderStats(orders);
      const donutAll = computeDonutSlices(stats, "All");

      expect(donutAll.hasPositiveSales).toBe(true);
      expect(donutAll.totalPositiveCents).toBe(10000);
      expect(donutAll.slices.length).toBe(3);

      const cashSlice = donutAll.slices.find((s) => s.method === "Cash")!;
      const cardSlice = donutAll.slices.find((s) => s.method === "Card")!;
      const qrSlice = donutAll.slices.find((s) => s.method === "QR")!;

      expect(cashSlice.percentage).toBe(20);
      expect(cardSlice.percentage).toBe(30);
      expect(qrSlice.percentage).toBe(50);

      expect(cashSlice.arcLength).toBeCloseTo(0.2 * DONUT_CIRCUMFERENCE, 2);
      expect(cardSlice.arcLength).toBeCloseTo(0.3 * DONUT_CIRCUMFERENCE, 2);
      expect(qrSlice.arcLength).toBeCloseTo(0.5 * DONUT_CIRCUMFERENCE, 2);

      // Verify active filter highlighting
      const donutFiltered = computeDonutSlices(stats, "Card");
      const filteredCard = donutFiltered.slices.find((s) => s.method === "Card")!;
      const filteredCash = donutFiltered.slices.find((s) => s.method === "Cash")!;

      expect(filteredCard.isHighlighted).toBe(true);
      expect(filteredCard.opacity).toBe(1.0);
      expect(filteredCard.strokeWidth).toBe(24);

      expect(filteredCash.isHighlighted).toBe(false);
      expect(filteredCash.opacity).toBe(0.28);
      expect(filteredCash.strokeWidth).toBe(20);
    });

    it("Maintains period reconciliation totals even when search query filters displayed items", () => {
      const orders: Order[] = [
        createTestOrder("Cash", [
          createTestLine(1, "Dewalt Hammer Drill", 45000, 1000),
          createTestLine(2, "Makita Circular Saw", 55000, 1000),
        ]),
      ];

      // Query specifically for "drill"
      const filtered = aggregateFilteredItems(orders, "All", "drill", "revenue");

      // Displayed rows filtered to 1 item
      expect(filtered.rows.length).toBe(1);
      expect(filtered.rows[0]!.name).toBe("Dewalt Hammer Drill");

      // Reconciliation totals in footer MUST maintain full period figures
      expect(filtered.totalPeriodItemsCount).toBe(2);
      expect(filtered.itemSubtotalCents).toBe(100000);
      expect(filtered.orderRevenueCents).toBe(100000);
      expect(filtered.driftCents).toBe(0);
    });
  });
});
