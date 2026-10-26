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

let idSeq = 100000;

function createAdvLine(
  itemId: number,
  name: string,
  priceCents: number,
  qtyMilli: number,
  unit: Unit = "pcs",
  overrides: Partial<OrderLine> = {},
): OrderLine {
  const amountCents = lineAmount(priceCents, qtyMilli);
  return {
    id: ++idSeq,
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

function createAdvOrder(
  method: PaymentMethod,
  items: OrderLine[],
  overrides: Partial<Order> = {},
): Order {
  const itemsTotalCents = items.reduce((sum, item) => sum + item.amountCents, 0);
  const discountCents = overrides.discountCents ?? 0;
  const effectiveDiscountCents =
    overrides.totalCents !== undefined
      ? discountCents
      : Math.min(discountCents, itemsTotalCents);
  const totalCents = overrides.totalCents ?? Math.max(0, itemsTotalCents - effectiveDiscountCents);
  return {
    id: ++idSeq,
    companyId: 1,
    ts: Date.now(),
    businessDate: "2026-10-26",
    invNo: method === "Credit" ? `B-${idSeq}` : `A-${idSeq}`,
    method,
    items,
    voidedAt: null,
    ...overrides,
    discountCents: effectiveDiscountCents,
    totalCents,
  };
}

function createAdvRefund(
  originalOrder: Order,
  refundLines: { itemId: number; name: string; priceCents: number; qtyMilli: number; unit?: Unit }[],
  allocatedDiscountCents: number = 0,
): Order {
  const lines: OrderLine[] = refundLines.map((rl) =>
    createAdvLine(rl.itemId, rl.name, rl.priceCents, rl.qtyMilli, rl.unit ?? "pcs"),
  );
  const grossRefundCents = lines.reduce((sum, l) => sum + l.amountCents, 0);
  const netRefundCents = Math.max(0, grossRefundCents - allocatedDiscountCents);
  return {
    id: ++idSeq,
    companyId: originalOrder.companyId,
    ts: Date.now(),
    businessDate: originalOrder.businessDate,
    invNo: originalOrder.method === "Credit" ? `B-${idSeq}` : `A-${idSeq}`,
    method: originalOrder.method,
    refundOfOrderId: originalOrder.id,
    refundOfInvNo: originalOrder.invNo,
    discountCents: allocatedDiscountCents,
    totalCents: -netRefundCents,
    items: lines,
    voidedAt: null,
  };
}

function createAdvRepayment(
  method: RepaymentMethod,
  amountCents: number,
  contractorName: string = "Ah Chai Hardware",
): Repayment {
  return {
    id: ++idSeq,
    companyId: 1,
    creditId: 501,
    orderId: 601,
    contractorName,
    amountCents,
    method,
    ts: Date.now(),
    businessDate: "2026-10-26",
  };
}

describe("Adversarial Challenge: reportLogic Domain Accounting & Invariants", () => {
  describe("ADV-1: Extreme Scale Stress Test (10,000 Orders)", () => {
    it("Processes 10,000 heterogeneous orders with zero cents drift in < 300ms", () => {
      const orders: Order[] = [];
      const methods: PaymentMethod[] = ["Cash", "Card", "QR", "Bank", "Credit"];

      for (let i = 0; i < 10000; i++) {
        const m = methods[i % 5]!;
        const hasDiscount = i % 11 === 0;
        const isVoided = i % 97 === 0;
        const discountCents = hasDiscount ? (i % 50) * 10 : 0;

        const lineCount = 1 + (i % 4);
        const lines: OrderLine[] = [];
        for (let j = 0; j < lineCount; j++) {
          const itemId = 100 + ((i + j) % 50);
          const priceCents = 100 + (i % 200) * 15;
          const qtyMilli = 500 + (j % 5) * 500;
          lines.push(createAdvLine(itemId, `Stress Item ${itemId}`, priceCents, qtyMilli));
        }

        const order = createAdvOrder(m, lines, {
          discountCents,
          voidedAt: isVoided ? Date.now() : null,
        });
        orders.push(order);
      }

      const t0 = performance.now();
      const orderStats = computeReportOrderStats(orders);
      const itemsAll = aggregateFilteredItems(orders, "All", "", "revenue");
      const recAll = reconcileColumns(
        orderStats.totalCents,
        itemsAll.itemSubtotalCents,
        itemsAll.wholeBillDiscountCents,
      );
      const elapsed = performance.now() - t0;

      // Mathematical assertions
      expect(recAll.driftCents).toBe(0);
      expect(recAll.netSalesCents).toBe(orderStats.totalCents);
      expect(orderStats.totalCents).toBe(itemsAll.itemSubtotalCents - itemsAll.wholeBillDiscountCents);
      expect(elapsed).toBeLessThan(300); // High throughput requirement

      // Assert per-payment method isolation under 10k orders
      for (const m of methods) {
        const itemsMethod = aggregateFilteredItems(orders, m, "", "revenue");
        const recMethod = reconcileColumns(
          orderStats.byMethod[m].totalCents,
          itemsMethod.itemSubtotalCents,
          itemsMethod.wholeBillDiscountCents,
        );
        expect(recMethod.driftCents).toBe(0);
        expect(recMethod.orderRevenueCents).toBe(orderStats.byMethod[m].totalCents);
      }
    });
  });

  describe("ADV-2: Fractional Quantities, Micro-Cents, and Line Discounts", () => {
    it("Reconciles fractional weights (e.g. 1 milli, 333 milli, 777 milli) with odd cents", () => {
      const orders: Order[] = [
        createAdvOrder("Cash", [
          createAdvLine(1, "Gold Leaf (1mg)", 99999, 1, "kg"), // 99999 * 1 / 1000 = 100 cents
          createAdvLine(2, "Copper Wire 0.333m", 1173, 333, "meter"), // 1173 * 333 / 1000 = 391 cents
          createAdvLine(3, "Steel Cable 0.777ft", 4567, 777, "ft"), // 4567 * 777 / 1000 = 3549 cents
        ]),
        createAdvOrder("QR", [
          createAdvLine(4, "Fine Sand 0.007kg", 888, 7, "kg"), // 888 * 7 / 1000 = 6 cents
          createAdvLine(5, "Bulk Cement 999.999kg", 35, 999999, "kg"), // 35 * 999999 / 1000 = 35000 cents
        ]),
      ];

      const orderStats = computeReportOrderStats(orders);
      const itemsRes = aggregateFilteredItems(orders, "All", "", "revenue");
      const rec = reconcileColumns(
        orderStats.totalCents,
        itemsRes.itemSubtotalCents,
        itemsRes.wholeBillDiscountCents,
      );

      expect(rec.driftCents).toBe(0);
      expect(rec.netSalesCents).toBe(orderStats.totalCents);
    });

    it("Reconciles large line discounts (effective price reduced from RM 1000 to RM 0.01)", () => {
      const orders: Order[] = [
        createAdvOrder("Card", [
          createAdvLine(10, "Clearance Power Tool", 1, 1000, "pcs", {
            origPriceCents: 100000, // 99.999% line discount
          }),
        ]),
      ];

      const orderStats = computeReportOrderStats(orders);
      const itemsRes = aggregateFilteredItems(orders, "Card", "", "revenue");
      const rec = reconcileColumns(
        orderStats.byMethod.Card.totalCents,
        itemsRes.itemSubtotalCents,
        itemsRes.wholeBillDiscountCents,
      );

      expect(orderStats.totalCents).toBe(1);
      expect(itemsRes.itemSubtotalCents).toBe(1);
      expect(itemsRes.wholeBillDiscountCents).toBe(0);
      expect(rec.driftCents).toBe(0);
    });
  });

  describe("ADV-3: Whole-Bill Discounts, Partial Refunds, and Pure Returns", () => {
    it("Reconciles 100% whole-bill discount (RM 0 total order)", () => {
      const order = createAdvOrder(
        "Cash",
        [createAdvLine(1, "Donation Hammer", 5000, 1000)],
        { discountCents: 5000 }, // 100% discount, total 0
      );

      const orderStats = computeReportOrderStats([order]);
      const itemsRes = aggregateFilteredItems([order], "All", "", "revenue");
      const rec = reconcileColumns(
        orderStats.totalCents,
        itemsRes.itemSubtotalCents,
        itemsRes.wholeBillDiscountCents,
      );

      expect(orderStats.totalCents).toBe(0);
      expect(itemsRes.itemSubtotalCents).toBe(5000);
      expect(itemsRes.wholeBillDiscountCents).toBe(5000);
      expect(rec.driftCents).toBe(0);
      expect(rec.netSalesCents).toBe(0);
    });

    it("Reconciles partial refund on an order with whole-bill discount and allocated clawback", () => {
      // Original: 2 items, gross RM 100 (60 + 40), discount RM 20, net RM 80
      const sale = createAdvOrder(
        "Credit",
        [
          createAdvLine(1, "Plywood Sheet", 6000, 1000), // 6000
          createAdvLine(2, "Timber Batten", 4000, 1000), // 4000
        ],
        { discountCents: 2000, totalCents: 8000 },
      );

      // Refund item 1: gross 6000. Allocated discount: 2000 * 6000 / 10000 = 1200. Net refund: 4800.
      const refund = createAdvRefund(
        sale,
        [{ itemId: 1, name: "Plywood Sheet", priceCents: 6000, qtyMilli: 1000 }],
        1200,
      );

      const orders = [sale, refund];
      const orderStats = computeReportOrderStats(orders);
      const itemsRes = aggregateFilteredItems(orders, "All", "", "revenue");
      const rec = reconcileColumns(
        orderStats.totalCents,
        itemsRes.itemSubtotalCents,
        itemsRes.wholeBillDiscountCents,
      );

      expect(orderStats.totalCents).toBe(8000 - 4800); // 3200
      expect(itemsRes.itemSubtotalCents).toBe(4000); // Plywood netted to 0, Timber remains 4000
      expect(itemsRes.wholeBillDiscountCents).toBe(800); // 2000 - 1200 = 800 remaining discount
      expect(rec.driftCents).toBe(0);
      expect(rec.netSalesCents).toBe(3200);
    });

    it("Reconciles pure return from prior period with negative discount balance and 0 drift", () => {
      // Prior sale not in current period. Customer returns RM 100 item with RM 20 clawback (refunds RM 80).
      const priorSaleDummy: Order = {
        id: 99999,
        companyId: 1,
        ts: Date.now() - 86400000 * 7,
        businessDate: "2026-10-19",
        invNo: "A-99999",
        method: "Cash",
        discountCents: 2000,
        totalCents: 8000,
        items: [createAdvLine(50, "Prior Drill", 10000, 1000)],
        voidedAt: null,
      };

      const refund = createAdvRefund(
        priorSaleDummy,
        [{ itemId: 50, name: "Prior Drill", priceCents: 10000, qtyMilli: 1000 }],
        2000,
      );

      const orders = [refund];
      const orderStats = computeReportOrderStats(orders);
      const itemsRes = aggregateFilteredItems(orders, "All", "", "revenue");
      const rec = reconcileColumns(
        orderStats.totalCents,
        itemsRes.itemSubtotalCents,
        itemsRes.wholeBillDiscountCents,
      );

      expect(orderStats.totalCents).toBe(-8000);
      expect(itemsRes.itemSubtotalCents).toBe(-10000);
      expect(itemsRes.wholeBillDiscountCents).toBe(-2000); // -10000 - (-8000) = -2000
      expect(rec.netSalesCents).toBe(-8000);
      expect(rec.driftCents).toBe(0);
      expect(itemsRes.rows[0]!.isNegative).toBe(true);
    });
  });

  describe("ADV-4: Payment Method Combinations & Donut Geometry Stress", () => {
    it("Reconciles across asymmetric multi-method distribution with 0-sales and net-negative channels", () => {
      const orders: Order[] = [
        createAdvOrder("Cash", [createAdvLine(1, "Cash Sale", 5000, 1000)]), // +5000
        // Card has NO orders (0 sales)
        createAdvOrder("QR", [createAdvLine(2, "QR Sale", 8000, 1000)]), // +8000
        createAdvOrder("Bank", [createAdvLine(3, "Bank Sale", 2000, 1000)]),
        createAdvRefund(
          createAdvOrder("Bank", []),
          [{ itemId: 3, name: "Bank Sale", priceCents: 5000, qtyMilli: 1000 }],
        ), // Bank net: 2000 - 5000 = -3000 (negative!)
        createAdvOrder("Credit", [createAdvLine(4, "Credit Sale", 12000, 1000)]), // +12000
      ];

      const orderStats = computeReportOrderStats(orders);
      expect(orderStats.byMethod.Cash.totalCents).toBe(5000);
      expect(orderStats.byMethod.Card.totalCents).toBe(0);
      expect(orderStats.byMethod.QR.totalCents).toBe(8000);
      expect(orderStats.byMethod.Bank.totalCents).toBe(-3000);
      expect(orderStats.byMethod.Credit.totalCents).toBe(12000);
      expect(orderStats.totalCents).toBe(5000 + 0 + 8000 - 3000 + 12000); // 22000

      // Assert 0 drift on all methods
      for (const m of PAYMENT_METHODS) {
        const items = aggregateFilteredItems(orders, m, "", "revenue");
        const rec = reconcileColumns(
          orderStats.byMethod[m].totalCents,
          items.itemSubtotalCents,
          items.wholeBillDiscountCents,
        );
        expect(rec.driftCents).toBe(0);
      }

      // Assert SVG Donut excludes negative Bank and zero Card, only distributes Cash (5k), QR (8k), Credit (12k) = 25k positive
      const donut = computeDonutSlices(orderStats, "All");
      expect(donut.hasPositiveSales).toBe(true);
      expect(donut.totalPositiveCents).toBe(25000);
      expect(donut.slices.length).toBe(3);
      expect(donut.slices.map((s) => s.method)).toEqual(["Cash", "QR", "Credit"]);

      const sumArcs = donut.slices.reduce((acc, s) => acc + s.arcLength, 0);
      expect(sumArcs).toBeCloseTo(DONUT_CIRCUMFERENCE, 2);
    });
  });

  describe("ADV-5: Mixed Repayments and Same-Day Refunds Isolation", () => {
    it("Strictly isolates debt repayments from orderStats and reconciles cashflow", () => {
      const orders: Order[] = [
        createAdvOrder("Cash", [createAdvLine(1, "Hardware", 10000, 1000)]), // 10000
        createAdvOrder("Credit", [createAdvLine(2, "Contractor Sale", 25000, 1000)]), // 25000
      ];

      // Contractor settles old debt using Cash, Bank, QR on the same day
      const repayments: Repayment[] = [
        createAdvRepayment("Cash", 50000, "Contractor A"),
        createAdvRepayment("Bank", 80000, "Contractor B"),
        createAdvRepayment("QR", 30000, "Contractor C"),
      ];

      const repaymentsTotal = repayments.reduce((s, r) => s + r.amountCents, 0); // 160000

      // Invariant 1: computeReportOrderStats strictly ignores repayments
      const orderStats = computeReportOrderStats(orders);
      expect(orderStats.repaymentsTotalCents).toBe(0);
      expect(orderStats.totalCents).toBe(35000);
      expect(orderStats.byMethod.Cash.totalCents).toBe(10000);
      expect(orderStats.byMethod.Credit.totalCents).toBe(25000);
      expect(orderStats.byMethod.Bank.totalCents).toBe(0);
      expect(orderStats.byMethod.QR.totalCents).toBe(0);

      // Invariant 2: Items table reconciles 100% against orderStats (zero contamination)
      const itemsRes = aggregateFilteredItems(orders, "All", "", "revenue");
      const rec = reconcileColumns(
        orderStats.totalCents,
        itemsRes.itemSubtotalCents,
        itemsRes.wholeBillDiscountCents,
      );
      expect(rec.driftCents).toBe(0);

      // Invariant 3: Realized Cash In combines non-credit orders + repayments without touching merchandise stats
      const cashflow = computeRealizedCashflow(orderStats, repaymentsTotal);
      expect(cashflow.nonCreditOrdersCents).toBe(10000);
      expect(cashflow.repaymentsTotalCents).toBe(160000);
      expect(cashflow.realizedCashInCents).toBe(170000);
      expect(cashflow.creditSalesCents).toBe(25000);
      expect(cashflow.totalFlowCents).toBe(170000 + 25000); // 195000
      expect(cashflow.cashRatioPercent + cashflow.creditRatioPercent).toBe(100);
    });

    it("Correctly handles simultaneous refunds and repayments for the same contractor", () => {
      // Sale to contractor: RM 100
      const sale = createAdvOrder("Credit", [createAdvLine(1, "Cement", 10000, 1000)]);
      // Contractor returns half (RM 50)
      const refund = createAdvRefund(sale, [{ itemId: 1, name: "Cement", priceCents: 10000, qtyMilli: 500 }]);
      // Contractor pays RM 200 repayment for earlier historical credit
      const repayment = createAdvRepayment("Cash", 20000, "Ah Seng");

      const orderStats = computeReportOrderStats([sale, refund]);
      expect(orderStats.byMethod.Credit.totalCents).toBe(5000); // Net 10000 - 5000 = 5000 credit sales
      expect(orderStats.totalCents).toBe(5000);

      const cashflow = computeRealizedCashflow(orderStats, repayment.amountCents);
      expect(cashflow.nonCreditOrdersCents).toBe(0);
      expect(cashflow.realizedCashInCents).toBe(20000); // Repayment collected
      expect(cashflow.creditSalesCents).toBe(5000); // Net credit today
      expect(cashflow.cashRatioPercent).toBe(Math.round((20000 / 25000) * 100)); // 80%
      expect(cashflow.creditRatioPercent).toBe(20);
    });
  });

  describe("ADV-6: Edge Cases & Structural Invariants", () => {
    it("Handles empty order array cleanly with zero drift and neutral donut", () => {
      const orderStats = computeReportOrderStats([]);
      const itemsRes = aggregateFilteredItems([], "All", "", "revenue");
      const rec = reconcileColumns(
        orderStats.totalCents,
        itemsRes.itemSubtotalCents,
        itemsRes.wholeBillDiscountCents,
      );
      const donut = computeDonutSlices(orderStats, "All");
      const cashflow = computeRealizedCashflow(orderStats, 0);

      expect(rec.driftCents).toBe(0);
      expect(rec.netSalesCents).toBe(0);
      expect(itemsRes.rows.length).toBe(0);
      expect(donut.hasPositiveSales).toBe(false);
      expect(donut.slices.length).toBe(0);
      expect(cashflow.cashRatioPercent).toBe(0);
      expect(cashflow.creditRatioPercent).toBe(0);
    });

    it("Differentiates items with identical names but different measurement units", () => {
      const orders: Order[] = [
        createAdvOrder("Cash", [
          createAdvLine(1, "Nylon Rope", 200, 5000, "meter"), // 5m @ RM 2.00/m = RM 10.00
          createAdvLine(2, "Nylon Rope", 1500, 2000, "roll" as any), // 2 rolls @ RM 15.00/roll = RM 30.00
        ]),
      ];

      const itemsRes = aggregateFilteredItems(orders, "All", "", "revenue");
      expect(itemsRes.rows.length).toBe(2);
      expect(itemsRes.rows[0]!.totalCents).toBe(3000);
      expect(itemsRes.rows[1]!.totalCents).toBe(1000);
    });

    it("Differentiates custom Lain-lain items with distinct custom names", () => {
      const orders: Order[] = [
        createAdvOrder("Cash", [
          createAdvLine(999, "Lain-lain", 3000, 1000, "pcs", { customName: "Custom Bracket" }),
          createAdvLine(999, "Lain-lain", 5000, 1000, "pcs", { customName: "Welding Work" }),
        ]),
      ];

      const itemsRes = aggregateFilteredItems(orders, "All", "", "revenue");
      expect(itemsRes.rows.length).toBe(2);
      expect(itemsRes.rows.some((r) => r.name === "Custom Bracket")).toBe(true);
      expect(itemsRes.rows.some((r) => r.name === "Welding Work")).toBe(true);
    });
  });
});
