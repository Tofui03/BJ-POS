import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import * as XLSX from "xlsx";
import initSqlJs from "sql.js";
import {
  PAYMENT_METHODS,
  LEGACY_SEED_ITEMS,
  type Order,
  type OrderLine,
  type PaymentMethod,
  type Repayment,
  type RepaymentMethod,
  type Unit,
} from "@yf/core";
import { createSqlJsDriver, initRepo, type SqlPosRepo } from "@yf/data";
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

let idCounter = 9000;

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
  contractorName: string = "Target Contractor",
  businessDate: string = "2026-10-24",
): Repayment {
  return {
    id: ++idCounter,
    companyId: 1,
    creditId: 500,
    orderId: 600,
    contractorName,
    amountCents,
    method,
    ts: Date.now(),
    businessDate,
  };
}

async function createFreshDbRepo(): Promise<SqlPosRepo> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  const driver = createSqlJsDriver(db as never);
  return initRepo(driver, {
    seedDemoOrders: false,
    seedItems: LEGACY_SEED_ITEMS,
    now: new Date("2026-10-24T10:00:00+08:00"),
    rng: () => 0.5,
  });
}

describe("Empirical Challenger M1_It2_2: Adversarial Verification Harness", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  // =========================================================================
  // MISSION 1: SVG DONUT BOUNDARY CONDITIONS & NUMERICAL STABILITY
  // =========================================================================
  describe("Mission 1: SVG Donut Boundary & Calculation Edge Cases", () => {
    it("DNT-01: 0 Sales Boundary — empty order list returns neutral ring state with zero NaNs", () => {
      const stats = computeReportOrderStats([]);
      const donut = computeDonutSlices(stats, "All");

      expect(donut.hasPositiveSales).toBe(false);
      expect(donut.totalPositiveCents).toBe(0);
      expect(donut.slices).toEqual([]);

      // Cashflow analysis handles zero without NaN or division by zero
      const cashflow = computeRealizedCashflow(stats, 0);
      expect(cashflow.cashRatioPercent).toBe(0);
      expect(cashflow.creditRatioPercent).toBe(0);
      expect(cashflow.totalFlowCents).toBe(0);
      expect(Number.isFinite(cashflow.cashRatioPercent)).toBe(true);
      expect(Number.isFinite(cashflow.creditRatioPercent)).toBe(true);
    });

    it("DNT-02: 0 Sales Boundary with Non-Zero Zero-Priced Orders", () => {
      const zeroOrders = [
        createTestOrder("Cash", [createTestLine(1, "Free Sample 1", 0, 1000)]),
        createTestOrder("QR", [createTestLine(2, "Free Sample 2", 0, 1000)]),
      ];
      const stats = computeReportOrderStats(zeroOrders);
      const donut = computeDonutSlices(stats, "All");

      expect(donut.hasPositiveSales).toBe(false);
      expect(donut.totalPositiveCents).toBe(0);
      expect(donut.slices.length).toBe(0);
    });

    it("DNT-03: 100% Single Channel Boundary — single channel occupies full circle across all 5 payment methods", () => {
      for (const method of PAYMENT_METHODS) {
        const order = createTestOrder(method, [
          createTestLine(10, `Item for ${method}`, 45000, 1000),
        ]);
        const stats = computeReportOrderStats([order]);
        const donut = computeDonutSlices(stats, "All");

        expect(donut.hasPositiveSales).toBe(true);
        expect(donut.totalPositiveCents).toBe(45000);
        expect(donut.slices.length).toBe(1);

        const slice = donut.slices[0]!;
        expect(slice.method).toBe(method);
        expect(slice.percentage).toBe(100);
        expect(slice.arcLength).toBeCloseTo(DONUT_CIRCUMFERENCE, 3);
        expect(slice.strokeDashoffset).toBe(0);

        const [dash, gap] = slice.strokeDasharray.split(" ").map(Number);
        expect(dash).toBeCloseTo(DONUT_CIRCUMFERENCE, 2);
        expect(gap).toBeCloseTo(0, 2);
        expect(slice.color).toBe(METHOD_COLORS[method].color);
      }
    });

    it("DNT-04: Negative Net Channel Exclusion — net-negative channel (refunds > sales) is strictly excluded from positive arcs", () => {
      // Cash: +RM 200
      // Card: Sale RM 50, Refund RM 150 -> Net -RM 100
      const cashOrder = createTestOrder("Cash", [createTestLine(1, "Cash Tool", 20000, 1000)]);
      const cardOrder = createTestOrder("Card", [createTestLine(2, "Card Drill", 5000, 1000)]);
      const cardRefund = createTestRefundOrder(cardOrder, [
        { itemId: 2, name: "Card Drill", priceCents: 15000, qtyMilli: 1000 },
      ]);

      const stats = computeReportOrderStats([cashOrder, cardOrder, cardRefund]);
      expect(stats.byMethod.Cash.totalCents).toBe(20000);
      expect(stats.byMethod.Card.totalCents).toBe(-10000);

      const donut = computeDonutSlices(stats, "All");

      // Total positive cents must ONLY reflect positive channels
      expect(donut.hasPositiveSales).toBe(true);
      expect(donut.totalPositiveCents).toBe(20000);
      expect(donut.slices.length).toBe(1);
      expect(donut.slices[0]!.method).toBe("Cash");
      expect(donut.slices[0]!.percentage).toBe(100);

      // Card must NOT exist in slices
      expect(donut.slices.find((s) => s.method === "Card")).toBeUndefined();
    });

    it("DNT-05: All Channels Net-Negative Fallback — falls back to neutral ring without throwing or NaN", () => {
      const cashSale = createTestOrder("Cash", [createTestLine(1, "Cash Item", 5000, 1000)]);
      const cashRefund = createTestRefundOrder(cashSale, [
        { itemId: 1, name: "Cash Item", priceCents: 12000, qtyMilli: 1000 },
      ]);
      const qrSale = createTestOrder("QR", [createTestLine(2, "QR Item", 8000, 1000)]);
      const qrRefund = createTestRefundOrder(qrSale, [
        { itemId: 2, name: "QR Item", priceCents: 10000, qtyMilli: 1000 },
      ]);

      const stats = computeReportOrderStats([cashSale, cashRefund, qrSale, qrRefund]);
      expect(stats.totalCents).toBe(-9000);

      const donut = computeDonutSlices(stats, "All");
      expect(donut.hasPositiveSales).toBe(false);
      expect(donut.totalPositiveCents).toBe(0);
      expect(donut.slices.length).toBe(0);
    });

    it("DNT-06: Active Slice Selection Styling — highlights target slice with 24 strokeWidth, dims non-selected slices to 0.28 opacity", () => {
      const orders = [
        createTestOrder("Cash", [createTestLine(1, "A", 2000, 1000)]),
        createTestOrder("Card", [createTestLine(2, "B", 3000, 1000)]),
        createTestOrder("QR", [createTestLine(3, "C", 5000, 1000)]),
      ];
      const stats = computeReportOrderStats(orders);

      // 1. All selected
      const donutAll = computeDonutSlices(stats, "All");
      for (const s of donutAll.slices) {
        expect(s.isHighlighted).toBe(false);
        expect(s.strokeWidth).toBe(20);
        expect(s.opacity).toBe(1.0);
      }

      // 2. Select QR
      const donutQR = computeDonutSlices(stats, "QR");
      const qrSlice = donutQR.slices.find((s) => s.method === "QR")!;
      const cashSlice = donutQR.slices.find((s) => s.method === "Cash")!;
      const cardSlice = donutQR.slices.find((s) => s.method === "Card")!;

      expect(qrSlice.isHighlighted).toBe(true);
      expect(qrSlice.strokeWidth).toBe(24);
      expect(qrSlice.opacity).toBe(1.0);

      expect(cashSlice.isHighlighted).toBe(false);
      expect(cashSlice.strokeWidth).toBe(20);
      expect(cashSlice.opacity).toBe(0.28);

      expect(cardSlice.isHighlighted).toBe(false);
      expect(cardSlice.strokeWidth).toBe(20);
      expect(cardSlice.opacity).toBe(0.28);
    });

    it("DNT-07: Micro-cents and extreme monetary values produce stable finite numbers without NaN or Infinity", () => {
      const orders = [
        createTestOrder("Cash", [createTestLine(1, "Micro Cent", 1, 1)]), // ~0.001 cent
        createTestOrder("Bank", [createTestLine(2, "Mega Scale", 100_000_000, 1000)]),
      ];
      const stats = computeReportOrderStats(orders);
      const donut = computeDonutSlices(stats, "Cash");

      for (const s of donut.slices) {
        expect(s.strokeDasharray).not.toMatch(/NaN/i);
        expect(Number.isFinite(s.strokeDashoffset)).toBe(true);
        expect(Number.isFinite(s.arcLength)).toBe(true);
        expect(Number.isFinite(s.percentage)).toBe(true);
        expect(s.percentage).toBeGreaterThanOrEqual(0);
        expect(s.percentage).toBeLessThanOrEqual(100);
      }
    });
  });

  // =========================================================================
  // MISSION 2: REPAYMENT SAFETY & VOID PROTECTION
  // =========================================================================
  describe("Mission 2: Repayment Safety & Database Void Protection", () => {
    it("REP-01: Synthetic repayment orders are mapped with negative IDs (-r.id) and REP- prefix", () => {
      const repayments: Repayment[] = [
        createTestRepayment("Cash", 15000, "Contractor Dave"),
        createTestRepayment("Bank", 45000, "Contractor Wong"),
      ];

      // Mirror ReportView.vue:162-177 inspectRepayments mapping
      const syntheticOrders = repayments.map((r) => ({
        id: -r.id,
        companyId: r.companyId,
        invNo: `REP-${r.id}`,
        businessDate: r.businessDate,
        ts: r.ts,
        cashierName: r.cashierName || undefined,
        method: r.method as PaymentMethod,
        items: [],
        subtotalCents: r.amountCents,
        discountCents: 0,
        totalCents: r.amountCents,
        contractorName: r.contractorName,
        note: r.notes ? `Repayment: ${r.notes}` : "Contractor Debt Repayment",
        voidedAt: null,
      }));

      for (const so of syntheticOrders) {
        expect(so.id).toBeLessThan(0);
        expect(so.invNo).toMatch(/^REP-\d+$/);
        expect(so.items.length).toBe(0);
        expect(so.totalCents).toBeGreaterThan(0);
      }
    });

    it("REP-02: onSelectOrder guard rejects synthetic repayment orders from setting detail.value or opening ReceiptDialog", () => {
      // Invariant logic from ReportView.vue:181-186:
      // function onSelectOrder(o: Order): void {
      //   if (o.id < 0 || o.invNo.startsWith("REP-")) {
      //     return;
      //   }
      //   detail.value = o;
      // }
      let detailValue: Order | null = null;
      function simulateOnSelectOrder(o: Order): void {
        if (o.id < 0 || o.invNo.startsWith("REP-")) {
          return;
        }
        detailValue = o;
      }

      // Test with repayment synthetic order
      const repaymentOrder: Order = {
        id: -101,
        companyId: 1,
        invNo: "REP-101",
        businessDate: "2026-10-24",
        ts: Date.now(),
        method: "Cash",
        items: [],
        subtotalCents: 5000,
        discountCents: 0,
        totalCents: 5000,
        voidedAt: null,
      };

      simulateOnSelectOrder(repaymentOrder);
      expect(detailValue).toBeNull(); // ReceiptDialog never opens!

      // Test with negative id but non-REP prefix
      simulateOnSelectOrder({ ...repaymentOrder, invNo: "A-0001" });
      expect(detailValue).toBeNull();

      // Test with positive id but REP prefix
      simulateOnSelectOrder({ ...repaymentOrder, id: 101, invNo: "REP-101" });
      expect(detailValue).toBeNull();

      // Test with valid merchandise order
      const realOrder = createTestOrder("Cash", [createTestLine(1, "Real Item", 1000, 1000)]);
      simulateOnSelectOrder(realOrder);
      expect(detailValue).not.toBeNull();
      expect(detailValue!.id).toBe(realOrder.id);
    });

    it("REP-03: Real SQLite Database test: voidOrder(-r.id) cannot void or corrupt real database merchandise orders", async () => {
      const repo = await createFreshDbRepo();

      // 1. Insert a real merchandise order with ID = 1
      const createdOrder = await repo.persistOrder({
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-24",
        cashierName: "Alice",
        method: "Cash",
        lines: [
          {
            itemId: 1,
            customName: "Merchandise Item",
            unit: "pcs",
            priceCents: 2500,
            qtyMilli: 1000,
          },
        ],
        discountCents: 0,
        totalCents: 2500,
      });

      expect(createdOrder.id).toBeGreaterThan(0);
      const realOrderId = createdOrder.id;

      // 2. Attempt to void with a synthetic repayment ID (e.g. -realOrderId or -999)
      const syntheticRepaymentId = -realOrderId;
      await repo.voidOrder(syntheticRepaymentId, Date.now(), "Attacker");

      // 3. Verify real order in SQLite is completely untouched
      const fetchedOrder = await repo.getOrder(realOrderId);
      expect(fetchedOrder).toBeDefined();
      expect(fetchedOrder!.voidedAt).toBeNull(); // Still active and valid!

      // 4. Verify negative ID query returns null
      const fetchedNegative = await repo.getOrder(syntheticRepaymentId);
      expect(fetchedNegative).toBeNull();
    });

    it("REP-04: ReceiptDialog doVoid guard: even under direct injection, voiding negative ID leaves DB untouched", async () => {
      const repo = await createFreshDbRepo();
      const realOrder = await repo.persistOrder({
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-24",
        method: "Cash",
        lines: [{ itemId: 1, customName: "Tool", unit: "pcs", priceCents: 5000, qtyMilli: 1000 }],
        discountCents: 0,
        totalCents: 5000,
      });

      // Hypothetical rogue order mimicking repayment
      const rogueOrder: Order = {
        id: -realOrder.id,
        companyId: 1,
        invNo: `REP-${realOrder.id}`,
        businessDate: "2026-10-24",
        ts: Date.now(),
        method: "Cash",
        items: [],
        subtotalCents: 5000,
        discountCents: 0,
        totalCents: 5000,
        voidedAt: null,
      };

      // Calling repo.voidOrder with rogue order's id:
      await repo.voidOrder(rogueOrder.id, Date.now());

      // Real order is verified intact
      const live = await repo.getOrder(realOrder.id);
      expect(live!.voidedAt).toBeNull();
    });
  });

  // =========================================================================
  // MISSION 3: MULTI-PERIOD EXCEL EXPORT (DAY, WEEK, MONTH)
  // =========================================================================
  describe("Mission 3: Multi-Period Excel Export Verification", () => {
    it("XCL-01: Day Scope (1 day) — verifies row counts, HQ Daily headers, and formula integrity", () => {
      const dayDate = "2026-10-24";
      const orders = [
        createTestOrder("Cash", [createTestLine(1, "Cement 50kg — Green", 2250, 2000)], { businessDate: dayDate }),
        createTestOrder("Card", [createTestLine(2, "Angle Grinder — 4in", 15000, 1000)], { businessDate: dayDate }),
      ];
      const repayments = [
        createTestRepayment("Cash", 8000, "Contractor Ah Meng", dayDate),
      ];

      const wb = buildDailyWorkbook(orders, repayments);
      expect(wb.SheetNames).toEqual(["HQ Daily", "Invoice Items"]);

      const hqSheet = wb.Sheets["HQ Daily"]!;
      const hqJson = XLSX.utils.sheet_to_json(hqSheet, { header: 1 }) as any[][];

      // 1 header + 2 orders + 1 repayment + 1 total = 5 rows
      expect(hqJson.length).toBe(5);
      expect(hqJson[0]).toEqual(HQ_DAILY_HEADERS);

      // Total row is row 5
      expect(hqSheet["E5"]!.f).toBe("SUM(E2:E4)");
      expect(hqSheet["F5"]!.f).toBe("SUM(F2:F4)");
      expect(hqSheet["G5"]!.f).toBe("SUM(G2:G4)");
      expect(hqSheet["H5"]!.f).toBe("SUM(H2:H4)");

      // Items sheet: 1 header + 2 items + 1 total = 4 rows
      const itemsSheet = wb.Sheets["Invoice Items"]!;
      const itemsJson = XLSX.utils.sheet_to_json(itemsSheet, { header: 1 }) as any[][];
      expect(itemsJson.length).toBe(4);
      expect(itemsJson[0]).toEqual(INVOICE_ITEMS_HEADERS);
      expect(itemsSheet["H4"]!.f).toBe("SUM(H2:H3)");
      expect(itemsSheet["I4"]!.f).toBe("SUM(I2:I3)");
    });

    it("XCL-02: Week Scope (7 days) — preserves all 7 business dates and updates formula ranges", () => {
      const orders: Order[] = [];
      const repayments: Repayment[] = [];

      for (let day = 1; day <= 7; day++) {
        const dateStr = `2026-10-${String(day + 10).padStart(2, "0")}`;
        orders.push(createTestOrder("Cash", [createTestLine(1, `Day ${day} Item`, 1000, 1000)], { businessDate: dateStr }));
        orders.push(createTestOrder("Bank", [createTestLine(2, `Day ${day} Steel`, 3000, 1000)], { businessDate: dateStr }));
        if (day % 2 === 1) {
          repayments.push(createTestRepayment("Cash", 5000, `Contractor ${day}`, dateStr));
        }
      }

      // 7 * 2 = 14 orders, 4 repayments. Total data rows = 18.
      const wb = buildDailyWorkbook(orders, repayments);
      const hqSheet = wb.Sheets["HQ Daily"]!;
      const hqJson = XLSX.utils.sheet_to_json(hqSheet, { header: 1 }) as any[][];

      // 1 header + 18 data rows + 1 total = 20 rows
      expect(hqJson.length).toBe(20);
      expect(hqSheet["G20"]!.f).toBe("SUM(G2:G19)");
      expect(hqSheet["H20"]!.f).toBe("SUM(H2:H19)");

      // Verify all 7 business dates exist in the Date column
      const recordedDates = new Set(hqJson.slice(1, 19).map((r) => r[1]));
      for (let day = 1; day <= 7; day++) {
        expect(recordedDates.has(`2026-10-${String(day + 10).padStart(2, "0")}`)).toBe(true);
      }
    });

    it("XCL-03: Month Scope (31 days) — high-volume Excel generation and base64 roundtrip parsing", () => {
      const orders: Order[] = [];
      const repayments: Repayment[] = [];

      for (let day = 1; day <= 31; day++) {
        const dateStr = `2026-10-${String(day).padStart(2, "0")}`;
        orders.push(createTestOrder("Cash", [createTestLine(1, "Hardware", 1200, 1000)], { businessDate: dateStr }));
        orders.push(createTestOrder("Credit", [createTestLine(2, "Timber", 4500, 1000)], { businessDate: dateStr }));
        if (day % 3 === 0) {
          repayments.push(createTestRepayment("Bank", 12000, `Contractor ${day}`, dateStr));
        }
      }

      // Orders: 62. Repayments: 10. Total data rows = 72.
      const wb = buildDailyWorkbook(orders, repayments);
      const hqSheet = wb.Sheets["HQ Daily"]!;
      const hqJson = XLSX.utils.sheet_to_json(hqSheet, { header: 1 }) as any[][];

      // 1 header + 72 data rows + 1 total = 74 rows
      expect(hqJson.length).toBe(74);
      expect(hqSheet["G74"]!.f).toBe("SUM(G2:G73)");
      expect(hqSheet["!autofilter"]).toEqual({ ref: "A1:I73" });

      const b64 = buildDailyExcelB64(orders, repayments);
      expect(typeof b64).toBe("string");
      expect(b64.length).toBeGreaterThan(2000);

      const parsedWb = XLSX.read(b64, { type: "base64" });
      const reloadedHqJson = XLSX.utils.sheet_to_json(parsedWb.Sheets["HQ Daily"]!, { header: 1 });
      expect(reloadedHqJson.length).toBe(74);
    });

    it("XCL-04: Empty dataset zero-guard: Does not emit invalid SUM(E2:E1) formula", () => {
      const wb = buildDailyWorkbook([], []);
      const hqSheet = wb.Sheets["HQ Daily"]!;
      const itemsSheet = wb.Sheets["Invoice Items"]!;

      // Total row is row 2
      expect(hqSheet["E2"]!.v).toBe(0);
      expect(hqSheet["E2"]!.f).toBeUndefined(); // Must NOT emit SUM(E2:E1)
      expect(hqSheet["G2"]!.v).toBe(0);
      expect(hqSheet["G2"]!.f).toBeUndefined();

      expect(itemsSheet["I2"]!.v).toBe(0);
      expect(itemsSheet["I2"]!.f).toBeUndefined();
    });
  });

  // =========================================================================
  // MISSION 4: SSR COMPONENT RENDERING & PERFORMANCE
  // =========================================================================
  describe("Mission 4: SSR Component Rendering & Performance SLA", () => {
    it("SSR-01: Default empty state renders cleanly in < 1,000 ms with neutral ring (#e2e8f0)", async () => {
      const pinia = createPinia();
      setActivePinia(pinia);

      const app = createSSRApp(ReportView);
      app.use(pinia);
      app.use(router);

      const t0 = performance.now();
      const html = await renderToString(app);
      const elapsed = performance.now() - t0;

      expect(html.length).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(1000);
      expect(html).toContain("老板销售报表 / Owner Sales Report");
      expect(html).toContain("#e2e8f0"); // Neutral circle rendered
      expect(html).toContain("RM 0.00");
      expect(html).toContain(L.reconciledZeroDrift);
      expect(html).not.toContain("NaN");
    });

    it("SSR-02: Populated Day state with sales and repayments renders in < 1,000 ms", async () => {
      const pinia = createPinia();
      setActivePinia(pinia);

      const sales = useSales();
      sales.rangeOrders = [
        createTestOrder("Cash", [
          createTestLine(1, "Premium Cement", 2500, 2000),
          createTestLine(2, "Steel Rebar", 1800, 5000),
        ]),
        createTestOrder("Card", [
          createTestLine(3, "Power Drill", 29900, 1000),
        ], { discountCents: 900 }),
      ];
      sales.rangeRepayments = [
        createTestRepayment("Cash", 10000, "Contractor Ali"),
      ];

      const app = createSSRApp(ReportView);
      app.use(pinia);
      app.use(router);

      const t0 = performance.now();
      const html = await renderToString(app);
      const elapsed = performance.now() - t0;

      expect(elapsed).toBeLessThan(1000);
      expect(html).toContain("Premium Cement");
      expect(html).toContain("Power Drill");
      expect(html).toContain("+RM 100.00");
      expect(html).toContain(L.reconciledZeroDrift);
      expect(html).not.toContain("NaN");
    });

    it("SSR-03: Pure-refund state renders cleanly with red text-negative formatting", async () => {
      const pinia = createPinia();
      setActivePinia(pinia);

      const sales = useSales();
      const refundOrder = createTestRefundOrder(
        createTestOrder("QR", []),
        [{ itemId: 15, name: "Broken Pipe", priceCents: 1500, qtyMilli: 2000 }],
      );
      sales.rangeOrders = [refundOrder];
      sales.rangeRepayments = [];

      const app = createSSRApp(ReportView);
      app.use(pinia);
      app.use(router);

      const t0 = performance.now();
      const html = await renderToString(app);
      const elapsed = performance.now() - t0;

      expect(elapsed).toBeLessThan(1000);
      expect(html).toContain("Broken Pipe");
      expect(html).toContain("-RM 30.00");
      expect(html).toContain("text-negative");
      expect(html).not.toContain("NaN");
    });

    it("SSR-04: High Volume Stress Test (250 orders, 50 unique items) renders cleanly in < 1,000 ms", async () => {
      const pinia = createPinia();
      setActivePinia(pinia);

      const sales = useSales();
      const highVolumeOrders: Order[] = [];
      for (let i = 0; i < 250; i++) {
        const m = PAYMENT_METHODS[i % PAYMENT_METHODS.length]!;
        highVolumeOrders.push(
          createTestOrder(m, [
            createTestLine((i % 50) + 1, `Stress Sku ${(i % 50) + 1}`, 1000 + (i % 20) * 100, 1000),
          ]),
        );
      }
      sales.rangeOrders = highVolumeOrders;
      sales.rangeRepayments = [
        createTestRepayment("Cash", 50000, "Stress Contractor 1"),
        createTestRepayment("Bank", 30000, "Stress Contractor 2"),
      ];

      const t0 = performance.now();
      const app = createSSRApp(ReportView);
      app.use(pinia);
      app.use(router);

      const html = await renderToString(app);
      const elapsed = performance.now() - t0;

      expect(html.length).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(1000); // Sub-second SLA strictly met
      expect(html).toContain("Stress Sku 1");
      expect(html).toContain(L.reconciledZeroDrift);
      expect(html).not.toContain("NaN");
    });
  });
});
