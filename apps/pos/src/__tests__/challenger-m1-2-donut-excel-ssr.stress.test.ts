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
  DONUT_RADIUS,
  DONUT_CIRCUMFERENCE,
  computeReportOrderStats,
  computeRealizedCashflow,
  computeDonutSlices,
  aggregateFilteredItems,
  reconcileColumns,
  METHOD_COLORS,
} from "../report/reportLogic";
import {
  buildDailyWorkbook,
  buildDailyExcelB64,
  HQ_DAILY_HEADERS,
  INVOICE_ITEMS_HEADERS,
} from "../report/daily";
import { useSales } from "../stores/sales";
import { L } from "../labels";

let idSeq = 8000;

function createMockLine(
  itemId: number,
  name: string,
  priceCents: number,
  qtyMilli: number = 1000,
  unit: Unit = "pcs",
  overrides: Partial<OrderLine> = {},
): OrderLine {
  const amountCents = Math.round((priceCents * qtyMilli) / 1000);
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

function createMockOrder(
  method: PaymentMethod,
  items: OrderLine[],
  overrides: Partial<Order> = {},
): Order {
  const itemsTotalCents = items.reduce((sum, item) => sum + item.amountCents, 0);
  const discountCents = overrides.discountCents ?? 0;
  const totalCents = overrides.totalCents ?? itemsTotalCents - discountCents;
  return {
    id: ++idSeq,
    companyId: 1,
    ts: Date.now(),
    businessDate: "2026-10-24",
    invNo: method === "Credit" ? `B-${idSeq}` : `A-${idSeq}`,
    method,
    discountCents,
    totalCents,
    items,
    voidedAt: null,
    ...overrides,
  };
}

function createMockRefundOrder(
  originalOrder: Order,
  refundLines: { itemId: number; name: string; priceCents: number; qtyMilli: number; unit?: Unit }[],
  overrides: Partial<Order> = {},
): Order {
  const lines: OrderLine[] = refundLines.map((rl) =>
    createMockLine(rl.itemId, rl.name, rl.priceCents, rl.qtyMilli, rl.unit ?? "pcs"),
  );
  const refundAmountCents = lines.reduce((sum, l) => sum + l.amountCents, 0);
  return {
    id: ++idSeq,
    companyId: originalOrder.companyId,
    ts: Date.now(),
    businessDate: originalOrder.businessDate,
    invNo: originalOrder.method === "Credit" ? `B-${idSeq}` : `A-${idSeq}`,
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

function createMockRepayment(
  method: RepaymentMethod,
  amountCents: number,
  contractorName: string = "Target Contractor",
  businessDate: string = "2026-10-24",
): Repayment {
  return {
    id: ++idSeq,
    companyId: 1,
    creditId: 300,
    orderId: 400,
    contractorName,
    amountCents,
    method,
    ts: Date.now(),
    businessDate,
  };
}

describe("Empirical Challenger M1_2: SVG Donut, Multi-Period Excel & SSR Harness", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe("1. SVG Donut Boundary & Calculation Edge Cases", () => {
    it("CHG-DNT-01: Boundary 1: All channels zero sales (total positive revenue = 0)", () => {
      // Empty orders list
      const orderStatsEmpty = computeReportOrderStats([]);
      const donutEmpty = computeDonutSlices(orderStatsEmpty, "All");

      expect(donutEmpty.hasPositiveSales).toBe(false);
      expect(donutEmpty.totalPositiveCents).toBe(0);
      expect(donutEmpty.slices).toEqual([]);

      // Non-empty orders but total cents = 0
      const zeroOrder = createMockOrder("Cash", [createMockLine(1, "Zero Item", 0, 1000)]);
      const orderStatsZero = computeReportOrderStats([zeroOrder]);
      const donutZero = computeDonutSlices(orderStatsZero, "All");

      expect(donutZero.hasPositiveSales).toBe(false);
      expect(donutZero.totalPositiveCents).toBe(0);
      expect(donutZero.slices.length).toBe(0);

      // Verify no NaNs or undefined
      for (const slice of donutZero.slices) {
        expect(slice.strokeDasharray).not.toContain("NaN");
        expect(slice.strokeDashoffset).not.toBeNaN();
      }
    });

    it("CHG-DNT-02: Boundary 2: Only 1 channel active (100% of sales) forms a complete 360 circle", () => {
      for (const method of PAYMENT_METHODS) {
        const order = createMockOrder(method, [createMockLine(1, "Exclusive Channel Item", 15000, 1000)]);
        const stats = computeReportOrderStats([order]);
        const donut = computeDonutSlices(stats, "All");

        expect(donut.hasPositiveSales).toBe(true);
        expect(donut.slices.length).toBe(1);
        const slice = donut.slices[0]!;

        expect(slice.method).toBe(method);
        expect(slice.percentage).toBe(100);
        expect(slice.totalCents).toBe(15000);
        expect(slice.arcLength).toBeCloseTo(DONUT_CIRCUMFERENCE, 3);

        // strokeDasharray should be `${DONUT_CIRCUMFERENCE.toFixed(3)} 0.000`
        const [dash, gap] = slice.strokeDasharray.split(" ").map(Number);
        expect(dash).toBeCloseTo(DONUT_CIRCUMFERENCE, 2);
        expect(gap).toBeCloseTo(0, 2);

        // strokeDashoffset must be 0 for the first/only slice
        expect(slice.strokeDashoffset).toBe(0);

        // Color matches expected palette
        expect(slice.color).toBe(METHOD_COLORS[method].color);
      }
    });

    it("CHG-DNT-03: Boundary 3: Negative net revenue channels excluded from positive donut arcs", () => {
      // Card has 1 sale $50 and 1 refund $120 -> net -$70
      // Cash has 1 sale $200 -> net +$200
      const cashSale = createMockOrder("Cash", [createMockLine(1, "Cash Good", 20000, 1000)]);
      const cardSale = createMockOrder("Card", [createMockLine(2, "Card Good", 5000, 1000)]);
      const cardRefund = createMockRefundOrder(cardSale, [
        { itemId: 2, name: "Card Good", priceCents: 12000, qtyMilli: 1000 },
      ]);

      const stats = computeReportOrderStats([cashSale, cardSale, cardRefund]);
      expect(stats.byMethod.Card.totalCents).toBe(-7000);
      expect(stats.byMethod.Cash.totalCents).toBe(20000);

      const donut = computeDonutSlices(stats, "All");

      // Card must be strictly EXCLUDED from slices
      expect(donut.hasPositiveSales).toBe(true);
      expect(donut.slices.length).toBe(1);
      expect(donut.slices[0]!.method).toBe("Cash");
      expect(donut.slices.find((s) => s.method === "Card")).toBeUndefined();
      expect(donut.totalPositiveCents).toBe(20000);
      expect(donut.slices[0]!.percentage).toBe(100);

      // What if ALL channels are net negative?
      const cashRefund = createMockRefundOrder(cashSale, [
        { itemId: 1, name: "Cash Good", priceCents: 25000, qtyMilli: 1000 },
      ]);
      const allNegativeStats = computeReportOrderStats([cashSale, cashRefund, cardSale, cardRefund]);
      const allNegativeDonut = computeDonutSlices(allNegativeStats, "All");

      expect(allNegativeDonut.hasPositiveSales).toBe(false);
      expect(allNegativeDonut.slices.length).toBe(0);
      expect(allNegativeDonut.totalPositiveCents).toBe(0);
    });

    it("CHG-DNT-04: Boundary 4: Active filter selection highlights slice, adjusts stroke-width and dims others", () => {
      const orders = [
        createMockOrder("Cash", [createMockLine(1, "A", 2000, 1000)]),
        createMockOrder("Card", [createMockLine(2, "B", 3000, 1000)]),
        createMockOrder("QR", [createMockLine(3, "C", 5000, 1000)]),
      ];

      const stats = computeReportOrderStats(orders);

      // 1. When filter is "All": all slices have normal strokeWidth (20) and full opacity (1.0)
      const allView = computeDonutSlices(stats, "All");
      for (const s of allView.slices) {
        expect(s.isHighlighted).toBe(false);
        expect(s.strokeWidth).toBe(20);
        expect(s.opacity).toBe(1.0);
      }

      // 2. When filter is "Card":
      const cardView = computeDonutSlices(stats, "Card");
      const cardSlice = cardView.slices.find((s) => s.method === "Card")!;
      const cashSlice = cardView.slices.find((s) => s.method === "Cash")!;
      const qrSlice = cardView.slices.find((s) => s.method === "QR")!;

      expect(cardSlice.isHighlighted).toBe(true);
      expect(cardSlice.strokeWidth).toBe(24);
      expect(cardSlice.opacity).toBe(1.0);

      expect(cashSlice.isHighlighted).toBe(false);
      expect(cashSlice.strokeWidth).toBe(20);
      expect(cashSlice.opacity).toBe(0.28);

      expect(qrSlice.isHighlighted).toBe(false);
      expect(qrSlice.strokeWidth).toBe(20);
      expect(qrSlice.opacity).toBe(0.28);

      // 3. Toggling off (back to "All") restores all slices
      const resetView = computeDonutSlices(stats, "All");
      for (const s of resetView.slices) {
        expect(s.isHighlighted).toBe(false);
        expect(s.strokeWidth).toBe(20);
        expect(s.opacity).toBe(1.0);
      }
    });

    it("CHG-DNT-05: Numerical check: No NaN in strokeDasharray or strokeDashoffset under micro-cents or extreme values", () => {
      const extremeOrders = [
        createMockOrder("Cash", [createMockLine(1, "Tiny", 1, 1)]), // 0 or 1 cent
        createMockOrder("Bank", [createMockLine(2, "Huge", 99999999, 5000)]), // massive total
      ];

      const stats = computeReportOrderStats(extremeOrders);
      const donut = computeDonutSlices(stats, "Cash");

      for (const s of donut.slices) {
        expect(s.strokeDasharray).not.toMatch(/NaN/);
        expect(Number.isFinite(s.strokeDashoffset)).toBe(true);
        expect(Number.isFinite(s.arcLength)).toBe(true);
        expect(Number.isFinite(s.percentage)).toBe(true);
      }
    });
  });

  describe("2. Excel Multi-Period Workbook Generation (Day, Week, Month)", () => {
    it("CHG-XCL-01: Day scope (1 day) - structure, row count, and Excel formula integrity", () => {
      const dayDate = "2026-10-24";
      const orders = [
        createMockOrder("Cash", [
          createMockLine(1, "Cement 50kg — Green", 2250, 2000),
          createMockLine(2, "Nails 2in", 800, 1000, "kg"),
        ], { businessDate: dayDate }),
        createMockOrder("Card", [
          createMockLine(3, "Drill Machine — 12V", 19900, 1000),
        ], { businessDate: dayDate, discountCents: 900 }),
      ];
      const repayments = [
        createMockRepayment("Cash", 10000, "Contractor Ali", dayDate),
        createMockRepayment("Bank", 25000, "Contractor Tan", dayDate),
      ];

      const wb = buildDailyWorkbook(orders, repayments);

      // Sheet names verification
      expect(wb.SheetNames).toEqual(["HQ Daily", "Invoice Items"]);

      const hqSheet = wb.Sheets["HQ Daily"]!;
      const itemsSheet = wb.Sheets["Invoice Items"]!;

      // HQ Daily: 1 header + 2 orders + 2 repayments + 1 total = 6 rows
      const hqJson = XLSX.utils.sheet_to_json(hqSheet, { header: 1 }) as any[][];
      expect(hqJson.length).toBe(6);
      expect(hqJson[0]).toEqual(HQ_DAILY_HEADERS);

      // Formula verification for HQ Daily total row (Row 6)
      expect(hqSheet["E6"]).toBeDefined();
      expect(hqSheet["E6"]!.f).toBe("SUM(E2:E5)");
      expect(hqSheet["F6"]!.f).toBe("SUM(F2:F5)");
      expect(hqSheet["G6"]!.f).toBe("SUM(G2:G5)");
      expect(hqSheet["H6"]!.f).toBe("SUM(H2:H5)");

      // Invoice Items: 1 header + 3 item lines + 1 total = 5 rows
      const itemsJson = XLSX.utils.sheet_to_json(itemsSheet, { header: 1 }) as any[][];
      expect(itemsJson.length).toBe(5);
      expect(itemsJson[0]).toEqual(INVOICE_ITEMS_HEADERS);

      // Formula verification for Invoice Items total row (Row 5)
      expect(itemsSheet["H5"]!.f).toBe("SUM(H2:H4)");
      expect(itemsSheet["I5"]!.f).toBe("SUM(I2:I4)");

      // Name & spec splitting verified
      expect(itemsJson[1]![1]).toBe("Cement 50kg");
      expect(itemsJson[1]![2]).toBe("Green");
      expect(itemsJson[3]![1]).toBe("Drill Machine");
      expect(itemsJson[3]![2]).toBe("12V");
    });

    it("CHG-XCL-02: Week scope (7 days) - multi-date continuity, formula ranges, and row counts", () => {
      const orders: Order[] = [];
      const repayments: Repayment[] = [];
      const baseDate = "2026-10-19";

      // 7 distinct dates
      for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        const dateStr = `2026-10-${String(19 + dayOffset).padStart(2, "0")}`;
        // 2 orders per day
        orders.push(
          createMockOrder("Cash", [createMockLine(100 + dayOffset, `Item Day ${dayOffset}`, 1500, 1000)], {
            businessDate: dateStr,
          }),
        );
        orders.push(
          createMockOrder("QR", [createMockLine(200 + dayOffset, `QR Item Day ${dayOffset}`, 2500, 1000)], {
            businessDate: dateStr,
          }),
        );

        // Repayment every 2 days
        if (dayOffset % 2 === 0) {
          repayments.push(createMockRepayment("Bank", 5000 + dayOffset * 1000, `Contractor ${dayOffset}`, dateStr));
        }
      }

      // Total orders = 14, total repayments = 4
      expect(orders.length).toBe(14);
      expect(repayments.length).toBe(4);

      const wb = buildDailyWorkbook(orders, repayments);
      const hqSheet = wb.Sheets["HQ Daily"]!;
      const itemsSheet = wb.Sheets["Invoice Items"]!;

      const hqJson = XLSX.utils.sheet_to_json(hqSheet, { header: 1 }) as any[][];
      // 1 header + 14 orders + 4 repayments + 1 total = 20 rows
      expect(hqJson.length).toBe(20);

      // Total row is row 20
      expect(hqSheet["E20"]!.f).toBe("SUM(E2:E19)");
      expect(hqSheet["F20"]!.f).toBe("SUM(F2:F19)");
      expect(hqSheet["G20"]!.f).toBe("SUM(G2:G19)");
      expect(hqSheet["H20"]!.f).toBe("SUM(H2:H19)");

      // Invoice Items: 1 header + 14 lines + 1 total = 16 rows
      const itemsJson = XLSX.utils.sheet_to_json(itemsSheet, { header: 1 }) as any[][];
      expect(itemsJson.length).toBe(16);
      expect(itemsSheet["I16"]!.f).toBe("SUM(I2:I15)");

      // Verify all 7 business dates are present in column 1 of HQ Daily
      const datesInSheet = new Set(hqJson.slice(1, 15).map((row) => row[1]));
      for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        expect(datesInSheet.has(`2026-10-${String(19 + dayOffset).padStart(2, "0")}`)).toBe(true);
      }
    });

    it("CHG-XCL-03: Month scope (31 days) - high row volume, multi-period integrity, and base64 parsing", () => {
      const orders: Order[] = [];
      const repayments: Repayment[] = [];

      for (let day = 1; day <= 31; day++) {
        const dateStr = `2026-10-${String(day).padStart(2, "0")}`;
        // 3 orders per day (1 cash, 1 card, 1 credit)
        orders.push(createMockOrder("Cash", [createMockLine(1, "Daily Supply", 1200, 2000)], { businessDate: dateStr }));
        orders.push(createMockOrder("Card", [createMockLine(2, "Tool", 4500, 1000)], { businessDate: dateStr }));
        orders.push(createMockOrder("Credit", [createMockLine(3, "Steel", 8000, 1000)], { businessDate: dateStr }));

        if (day % 3 === 0) {
          repayments.push(createMockRepayment("Cash", 10000, `Contractor Month ${day}`, dateStr));
        }
      }

      // Orders: 31 * 3 = 93 orders. Repayments: floor(31 / 3) = 10 repayments.
      expect(orders.length).toBe(93);
      expect(repayments.length).toBe(10);

      const wb = buildDailyWorkbook(orders, repayments);
      const hqSheet = wb.Sheets["HQ Daily"]!;

      const hqJson = XLSX.utils.sheet_to_json(hqSheet, { header: 1 }) as any[][];
      // 1 header + 93 orders + 10 repayments + 1 total = 105 rows
      expect(hqJson.length).toBe(105);

      // Verify formula on total row (Row 105)
      expect(hqSheet["E105"]!.f).toBe("SUM(E2:E104)");
      expect(hqSheet["G105"]!.f).toBe("SUM(G2:G104)");
      expect(hqSheet["H105"]!.f).toBe("SUM(H2:H104)");

      // Autofilter covers all 105 rows
      expect(hqSheet["!autofilter"]).toEqual({ ref: "A1:I104" });

      // Roundtrip through buildDailyExcelB64
      const b64 = buildDailyExcelB64(orders, repayments);
      expect(typeof b64).toBe("string");
      expect(b64.length).toBeGreaterThan(1000);

      const reloadedWb = XLSX.read(b64, { type: "base64" });
      expect(reloadedWb.SheetNames).toEqual(["HQ Daily", "Invoice Items"]);
      const reloadedHqJson = XLSX.utils.sheet_to_json(reloadedWb.Sheets["HQ Daily"]!, { header: 1 });
      expect(reloadedHqJson.length).toBe(105);
    });

    it("CHG-XCL-04: Empty dataset zero-guard: Does not emit invalid SUM(E2:E1) formula", () => {
      const wb = buildDailyWorkbook([], []);
      const hqSheet = wb.Sheets["HQ Daily"]!;
      const itemsSheet = wb.Sheets["Invoice Items"]!;

      // Total row is row 2
      expect(hqSheet["E2"]!.v).toBe(0);
      expect(hqSheet["E2"]!.f).toBeUndefined(); // Must NOT have invalid formula SUM(E2:E1)
      expect(hqSheet["G2"]!.v).toBe(0);
      expect(hqSheet["G2"]!.f).toBeUndefined();

      expect(itemsSheet["I2"]!.v).toBe(0);
      expect(itemsSheet["I2"]!.f).toBeUndefined();
    });
  });

  describe("3. SSR Component Rendering (ReportView.vue)", () => {
    it("CHG-SSR-01: Renders cleanly in default empty state without runtime errors", async () => {
      const pinia = createPinia();
      setActivePinia(pinia);

      const app = createSSRApp(ReportView);
      app.use(pinia);
      app.use(router);

      const html = await renderToString(app);

      expect(html).toContain("老板销售报表 / Owner Sales Report");
      expect(html).toContain(L.downloadExcel);
      expect(html).toContain("#e2e8f0"); // Neutral circle rendered
      expect(html).toContain("RM 0.00");
      expect(html).toContain(L.reconciledZeroDrift);
      expect(html).not.toContain("NaN");
    });

    it("CHG-SSR-02: Renders populated Day state with orders and repayments", async () => {
      const pinia = createPinia();
      setActivePinia(pinia);

      const sales = useSales();
      sales.rangeOrders = [
        createMockOrder("Cash", [
          createMockLine(1, "Cement 50kg", 2250, 2000),
          createMockLine(2, "Wire Mesh", 1500, 1000),
        ]),
        createMockOrder("Card", [
          createMockLine(3, "Cordless Saw", 35000, 1000),
        ]),
      ];
      sales.rangeRepayments = [
        createMockRepayment("Cash", 10000, "Ah Seng"),
      ];

      const app = createSSRApp(ReportView);
      app.use(pinia);
      app.use(router);

      const html = await renderToString(app);

      // Verify header, tabs, and items
      expect(html).toContain("Cement 50kg");
      expect(html).toContain("Cordless Saw");
      expect(html).toContain("RM 410.00"); // 45.00 + 15.00 + 350.00 = 410.00
      expect(html).toContain("+RM 100.00"); // Repayment card summary
      expect(html).toContain("1 records");
      expect(html).toContain(L.repaymentsCollected);
      expect(html).toContain(L.reconciledZeroDrift);
    });

    it("CHG-SSR-03: Renders pure-refund state with negative values and text-negative class", async () => {
      const pinia = createPinia();
      setActivePinia(pinia);

      const sales = useSales();
      const refundOrder = createMockRefundOrder(
        createMockOrder("QR", []),
        [{ itemId: 10, name: "Defective Drill", priceCents: 18000, qtyMilli: 1000 }],
      );
      sales.rangeOrders = [refundOrder];
      sales.rangeRepayments = [];

      const app = createSSRApp(ReportView);
      app.use(pinia);
      app.use(router);

      const html = await renderToString(app);

      expect(html).toContain("Defective Drill");
      expect(html).toContain("-RM 180.00");
      expect(html).toContain("text-negative");
      expect(html).not.toContain("NaN");
    });

    it("CHG-SSR-04: Renders pure-credit debt state without division-by-zero crash in cashflow bar", async () => {
      const pinia = createPinia();
      setActivePinia(pinia);

      const sales = useSales();
      sales.rangeOrders = [
        createMockOrder("Credit", [createMockLine(20, "Contractor Timber", 50000, 1000)]),
      ];
      sales.rangeRepayments = [];

      const app = createSSRApp(ReportView);
      app.use(pinia);
      app.use(router);

      const html = await renderToString(app);

      expect(html).toContain("Credit Sales");
      expect(html).toContain("RM 500.00");
      expect(html).not.toContain("NaN");
    });

    it("CHG-SSR-05: Renders gracefully with voided orders excluded", async () => {
      const pinia = createPinia();
      setActivePinia(pinia);

      const sales = useSales();
      sales.rangeOrders = [
        createMockOrder("Cash", [createMockLine(1, "Live Item", 5000, 1000)]),
        createMockOrder("Cash", [createMockLine(2, "Dead Voided Item", 99000, 1000)], { voidedAt: Date.now() }),
      ];
      sales.rangeRepayments = [];

      const app = createSSRApp(ReportView);
      app.use(pinia);
      app.use(router);

      const html = await renderToString(app);

      expect(html).toContain("Live Item");
      expect(html).not.toContain("Dead Voided Item");
      expect(html).toContain("RM 50.00");
      expect(html).not.toContain("RM 990.00");
    });

    it("CHG-SSR-06: High volume stress state (200 orders across 31 days) renders within 200ms", async () => {
      const pinia = createPinia();
      setActivePinia(pinia);

      const sales = useSales();
      const highVolumeOrders: Order[] = [];
      for (let i = 0; i < 200; i++) {
        const m = PAYMENT_METHODS[i % PAYMENT_METHODS.length]!;
        highVolumeOrders.push(
          createMockOrder(m, [
            createMockLine((i % 25) + 1, `Stress Item ${(i % 25) + 1}`, 1000 + (i % 10) * 100, 1000),
          ]),
        );
      }
      sales.rangeOrders = highVolumeOrders;
      sales.rangeRepayments = [createMockRepayment("Cash", 50000)];

      const t0 = performance.now();
      const app = createSSRApp(ReportView);
      app.use(pinia);
      app.use(router);

      const html = await renderToString(app);
      const elapsed = performance.now() - t0;

      expect(html).toContain("Stress Item 1");
      expect(html).toContain(L.reconciledZeroDrift);
      expect(elapsed).toBeLessThan(300); // Fast SSR execution
    });
  });
});
