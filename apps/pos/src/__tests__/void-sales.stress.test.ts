import { describe, it, expect, beforeEach } from "vitest";
import initSqlJs from "sql.js";
import type { Order, OrderLine, Unit } from "@yf/core";
import {
  createOrder,
  PosError,
  LEGACY_SEED_ITEMS,
  assertCanVoidOrder,
  aggregateItemSales,
} from "@yf/core";
import { createSqlJsDriver, initRepo, SqlPosRepo } from "@yf/data";
import { renderDayReportHtml } from "../printing/renderDayReportHtml";

async function freshRepo(): Promise<SqlPosRepo> {
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

function mkOrder(id: number, method: Order["method"], totalCents: number, items: OrderLine[] = []): Order {
  return {
    id,
    companyId: 1,
    ts: 1729764000000 + id * 1000,
    businessDate: "2026-10-24",
    invNo: `A-${String(id).padStart(4, "0")}`,
    method,
    subtotalCents: totalCents,
    discountCents: 0,
    totalCents,
    items,
    voidedAt: null,
    creditClearedAt: null,
    refundOfOrderId: null,
    refundOfInvNo: null,
  };
}

function mkLine(opts: {
  itemId: number;
  name: string;
  unit?: Unit;
  qtyMilli: number;
  amountCents: number;
  priceCents?: number;
  tailCount?: number;
}): OrderLine {
  return {
    id: 1,
    itemId: opts.itemId,
    name: opts.name,
    image: "",
    unit: opts.unit ?? "pieces",
    priceCents: opts.priceCents ?? Math.round((opts.amountCents / opts.qtyMilli) * 1000),
    origPriceCents: null,
    customName: null,
    qtyMilli: opts.qtyMilli,
    amountCents: opts.amountCents,
    tailCount: opts.tailCount ?? 0,
    bulkPrice: false,
  };
}

describe("Void guards and Z-report sales", () => {
  let repo: SqlPosRepo;

  beforeEach(async () => {
    repo = await freshRepo();
  });

  // =========================================================================
  // SECTION 1: Adversarial Challenge — Void Guards on Refund Orders
  // =========================================================================
  describe("Challenge 1: Rejection of Void Operations on Refund Orders", () => {
    it("assertCanVoidOrder rejects refundOfOrderId with PosError across boundary inputs", () => {
      // 1. Standard refundOfOrderId
      expect(() =>
        assertCanVoidOrder({
          voidedAt: null,
          creditClearedAt: null,
          hasClearedCredit: false,
          hasRepayment: false,
          refundOfOrderId: 42,
        }),
      ).toThrow(PosError);

      expect(() =>
        assertCanVoidOrder({
          voidedAt: null,
          creditClearedAt: null,
          hasClearedCredit: false,
          hasRepayment: false,
          refundOfOrderId: 42,
        }),
      ).toThrow("cannot void a refund order");

      // 2. Boundary refundOfOrderId = 0 (falsy number in JS, but 0 != null is true)
      expect(() =>
        assertCanVoidOrder({
          voidedAt: null,
          creditClearedAt: null,
          hasClearedCredit: false,
          hasRepayment: false,
          refundOfOrderId: 0,
        }),
      ).toThrow(PosError);

      // 3. Negative ID
      expect(() =>
        assertCanVoidOrder({
          voidedAt: null,
          creditClearedAt: null,
          hasClearedCredit: false,
          hasRepayment: false,
          refundOfOrderId: -1,
        }),
      ).toThrow(PosError);

      // 4. Non-refund orders (null and undefined) should pass
      expect(
        assertCanVoidOrder({
          voidedAt: null,
          creditClearedAt: null,
          hasClearedCredit: false,
          hasRepayment: false,
          refundOfOrderId: null,
        }),
      ).toBe("ok");

      expect(
        assertCanVoidOrder({
          voidedAt: null,
          creditClearedAt: null,
          hasClearedCredit: false,
          hasRepayment: false,
          refundOfOrderId: undefined,
        }),
      ).toBe("ok");

      // 5. Already voided order returns "noop" without mutating
      expect(
        assertCanVoidOrder({
          voidedAt: 1729764000000,
          creditClearedAt: null,
          hasClearedCredit: false,
          hasRepayment: false,
          refundOfOrderId: 42,
        }),
      ).toBe("noop");
    });

    it("SqlPosRepo.voidOrder blocks voiding a cash refund order and preserves inventory integrity", async () => {
      const item = await repo.createItem({
        key: "test_m2_drill",
        name: "Impact Drill",
        unit: "pieces",
        priceCents: 12000,
        stockMilli: 10000, // 10 units
      });

      // 1. Initial sale of 4 units
      const sale = await createOrder(repo, {
        method: "Cash",
        lines: [{ itemId: item.id, qtyMilli: 4000 }],
      });

      const stockAfterSale = await repo.getItem(item.id);
      expect(stockAfterSale?.stockMilli).toBe(6000); // 10000 - 4000 = 6000

      // 2. Refund 2 units back
      const refund = await repo.createRefundOrder({
        originalOrderId: sale.id,
        lines: [{ itemId: item.id, qtyMilli: 2000 }],
      });

      expect(refund.refundOfOrderId).toBe(sale.id);
      expect(refund.totalCents).toBe(-24000);

      const stockAfterRefund = await repo.getItem(item.id);
      expect(stockAfterRefund?.stockMilli).toBe(8000); // 6000 + 2000 = 8000

      // 3. ADVERSARIAL ATTACK: Attempt to void the refund order
      await expect(
        repo.voidOrder(refund.id, Date.now()),
      ).rejects.toThrowError(/cannot void a refund order/i);

      await expect(
        repo.voidOrder(refund.id, Date.now()),
      ).rejects.toBeInstanceOf(PosError);

      // 4. CRITICAL INVARIANT: Verify stock has NOT been mutated or double-replenished
      const stockAfterFailedVoid = await repo.getItem(item.id);
      expect(stockAfterFailedVoid?.stockMilli).toBe(8000);

      // 5. Verify refund order in DB is still unvoided
      const refundInDb = await repo.getOrder(refund.id);
      expect(refundInDb?.voidedAt).toBeNull();
    });

    it("SqlPosRepo.voidOrder blocks voiding a contractor credit refund order", async () => {
      const contractor = await repo.createContractor({
        name: "Challenger Builders Sdn Bhd",
        phone: "0123456789",
      });

      const item = await repo.createItem({
        key: "test_m2_cement",
        name: "Portland Cement",
        unit: "bag",
        priceCents: 2000,
        stockMilli: 50000,
      });

      const creditSale = await createOrder(repo, {
        method: "Credit",
        contractorId: contractor.id,
        contractorName: contractor.name,
        lines: [{ itemId: item.id, qtyMilli: 5000 }], // 5 bags = RM 100
      });

      const refund = await repo.createRefundOrder({
        originalOrderId: creditSale.id,
        lines: [{ itemId: item.id, qtyMilli: 2000 }], // 2 bags = RM 40 refund
      });

      expect(refund.method).toBe("Credit");
      expect(refund.refundOfOrderId).toBe(creditSale.id);

      // Attempt to void the credit refund order
      await expect(
        repo.voidOrder(refund.id, Date.now()),
      ).rejects.toThrow(PosError);

      await expect(
        repo.voidOrder(refund.id, Date.now()),
      ).rejects.toThrowError(/cannot void a refund order/i);

      // Stock remains exactly 47000 (50000 - 5000 + 2000)
      const cementStock = await repo.getItem(item.id);
      expect(cementStock?.stockMilli).toBe(47000);
    });
  });

  // =========================================================================
  // SECTION 2: Adversarial Challenge — Void Guards on Orders with Active Refunds
  // =========================================================================
  describe("Challenge 2: Rejection of Void Operations on Orders with Active Refunds", () => {
    it("assertCanVoidOrder rejects hasRefunds: true with PosError", () => {
      expect(() =>
        assertCanVoidOrder({
          voidedAt: null,
          creditClearedAt: null,
          hasClearedCredit: false,
          hasRepayment: false,
          hasRefunds: true,
        }),
      ).toThrow(PosError);

      expect(() =>
        assertCanVoidOrder({
          voidedAt: null,
          creditClearedAt: null,
          hasClearedCredit: false,
          hasRepayment: false,
          hasRefunds: true,
        }),
      ).toThrow("cannot void an order with active refunds");

      // hasRefunds: false passes
      expect(
        assertCanVoidOrder({
          voidedAt: null,
          creditClearedAt: null,
          hasClearedCredit: false,
          hasRepayment: false,
          hasRefunds: false,
        }),
      ).toBe("ok");
    });

    it("SqlPosRepo.voidOrder prevents double inventory replenishment when order has partial refund", async () => {
      const item = await repo.createItem({
        key: "test_m2_paint",
        name: "Gloss Enamel Paint 5L",
        unit: "unit",
        priceCents: 6500,
        stockMilli: 20000, // 20 tins
      });

      // 1. Initial sale: 6 tins (Stock -> 14 tins = 14000 milli)
      const originalSale = await createOrder(repo, {
        method: "Cash",
        lines: [{ itemId: item.id, qtyMilli: 6000 }],
      });

      let stock = await repo.getItem(item.id);
      expect(stock?.stockMilli).toBe(14000);

      // 2. Cashier processes partial refund: 2 tins returned (Stock -> 16 tins = 16000 milli)
      const refund = await repo.createRefundOrder({
        originalOrderId: originalSale.id,
        lines: [{ itemId: item.id, qtyMilli: 2000 }],
      });
      expect(refund.id).toBeGreaterThan(0);

      stock = await repo.getItem(item.id);
      expect(stock?.stockMilli).toBe(16000);

      // 3. ADVERSARIAL ATTACK: Attempt to void the original order!
      // If allowed, voidOrder would add back the FULL 6 tins, bringing stock to 16000 + 6000 = 22000 (double replenish!).
      await expect(
        repo.voidOrder(originalSale.id, Date.now()),
      ).rejects.toThrow(PosError);

      await expect(
        repo.voidOrder(originalSale.id, Date.now()),
      ).rejects.toThrowError(/cannot void an order with active refunds/i);

      // 4. CRITICAL INVARIANT: Inventory MUST remain at 16000, NOT 22000
      stock = await repo.getItem(item.id);
      expect(stock?.stockMilli).toBe(16000);

      // 5. Database check: Original order remains active (voidedAt is null)
      const saleInDb = await repo.getOrder(originalSale.id);
      expect(saleInDb?.voidedAt).toBeNull();
    });

    it("SqlPosRepo.voidOrder rejects voiding when multiple partial refunds exist", async () => {
      const itemA = await repo.createItem({
        key: "test_m2_pipe",
        name: "PVC Pipe 1/2 in",
        unit: "meter",
        priceCents: 800,
        stockMilli: 100000,
      });
      const itemB = await repo.createItem({
        key: "test_m2_elbow",
        name: "PVC Elbow 1/2 in",
        unit: "pieces",
        priceCents: 150,
        stockMilli: 50000,
      });

      // Sale of both items
      const originalSale = await createOrder(repo, {
        method: "Cash",
        lines: [
          { itemId: itemA.id, qtyMilli: 10000 },
          { itemId: itemB.id, qtyMilli: 5000 },
        ],
      });

      // Refund 1: Return item A
      await repo.createRefundOrder({
        originalOrderId: originalSale.id,
        lines: [{ itemId: itemA.id, qtyMilli: 3000 }],
      });

      // Refund 2: Return item B
      await repo.createRefundOrder({
        originalOrderId: originalSale.id,
        lines: [{ itemId: itemB.id, qtyMilli: 2000 }],
      });

      // Attempt void on original sale
      await expect(
        repo.voidOrder(originalSale.id, Date.now()),
      ).rejects.toThrowError(/cannot void an order with active refunds/i);

      const stockA = await repo.getItem(itemA.id);
      const stockB = await repo.getItem(itemB.id);
      expect(stockA?.stockMilli).toBe(93000); // 100000 - 10000 + 3000
      expect(stockB?.stockMilli).toBe(47000); // 50000 - 5000 + 2000
    });

    it("SqlPosRepo.voidOrder rejects voiding an order that was 100% fully refunded", async () => {
      const item = await repo.createItem({
        key: "test_m2_tape",
        name: "Teflon Tape",
        unit: "roll",
        priceCents: 100,
        stockMilli: 10000,
      });

      const sale = await createOrder(repo, {
        method: "Cash",
        lines: [{ itemId: item.id, qtyMilli: 5000 }],
      });

      // 100% refund
      await repo.createRefundOrder({
        originalOrderId: sale.id,
        lines: [{ itemId: item.id, qtyMilli: 5000 }],
      });

      const stockAfterFullRefund = await repo.getItem(item.id);
      expect(stockAfterFullRefund?.stockMilli).toBe(10000);

      // Attempt to void the fully refunded sale
      await expect(
        repo.voidOrder(sale.id, Date.now()),
      ).rejects.toThrowError(/cannot void an order with active refunds/i);

      // Stock must NOT become 15000!
      const stockAfterVoidAttempt = await repo.getItem(item.id);
      expect(stockAfterVoidAttempt?.stockMilli).toBe(10000);
    });

    it("SqlPosRepo.voidOrder rejects voiding decimal (kg/ft) order with active refund", async () => {
      const wire = await repo.createItem({
        key: "test_m2_wire",
        name: "Copper Wire 2.5mm",
        unit: "meter",
        priceCents: 250, // RM 2.50 / m
        stockMilli: 500000, // 500.000 m
      });

      const sale = await createOrder(repo, {
        method: "Cash",
        lines: [{ itemId: wire.id, qtyMilli: 15750 }], // 15.750 m
      });

      await repo.createRefundOrder({
        originalOrderId: sale.id,
        lines: [{ itemId: wire.id, qtyMilli: 3250 }], // return 3.250 m
      });

      await expect(
        repo.voidOrder(sale.id, Date.now()),
      ).rejects.toThrowError(/cannot void an order with active refunds/i);

      // 500000 - 15750 + 3250 = 487500
      const stock = await repo.getItem(wire.id);
      expect(stock?.stockMilli).toBe(487500);
    });
  });

  // =========================================================================
  // SECTION 3: Adversarial Challenge — aggregateItemSales with Returns
  // =========================================================================
  describe("Challenge 3: Verification of aggregateItemSales with Sales and Refund Orders", () => {
    it("deducts returned item quantities and amounts cleanly in partial refunds", () => {
      const saleOrder = mkOrder(1, "Cash", 10000, [
        mkLine({ itemId: 101, name: "Cordless Drill", unit: "pieces", qtyMilli: 5000, amountCents: 10000 }),
      ]);
      const refundOrder: Order = {
        ...mkOrder(2, "Cash", -4000, [
          mkLine({ itemId: 101, name: "Cordless Drill", unit: "pieces", qtyMilli: 2000, amountCents: 4000 }),
        ]),
        refundOfOrderId: 1,
      };

      const result = aggregateItemSales([saleOrder, refundOrder]);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        itemId: 101,
        name: "Cordless Drill",
        unit: "pieces",
        qtyMilli: 3000, // 5000 - 2000
        tailCount: 0,
        amountCents: 6000, // 10000 - 4000
        lines: 2,
      });
    });

    it("filters out completely refunded items (net qty and amount zero or negative)", () => {
      const saleOrder = mkOrder(1, "Cash", 15000, [
        mkLine({ itemId: 101, name: "Drill", unit: "pieces", qtyMilli: 2000, amountCents: 10000 }),
        mkLine({ itemId: 102, name: "Hammer", unit: "pieces", qtyMilli: 1000, amountCents: 5000 }),
      ]);

      // Drill is 100% refunded
      const refundOrder: Order = {
        ...mkOrder(2, "Cash", -10000, [
          mkLine({ itemId: 101, name: "Drill", unit: "pieces", qtyMilli: 2000, amountCents: 10000 }),
        ]),
        refundOfOrderId: 1,
      };

      const result = aggregateItemSales([saleOrder, refundOrder]);
      expect(result).toHaveLength(1);
      expect(result[0]!.itemId).toBe(102);
      expect(result[0]!.name).toBe("Hammer");
      expect(result[0]!.qtyMilli).toBe(1000);
      expect(result[0]!.amountCents).toBe(5000);
    });

    it("handles multiple sales and multiple refunds across the day with correct sorting", () => {
      // Morning sale
      const o1 = mkOrder(1, "Cash", 8000, [
        mkLine({ itemId: 201, name: "Screws 1in", unit: "box", qtyMilli: 4000, amountCents: 4000 }),
        mkLine({ itemId: 202, name: "Nails 2in", unit: "kg", qtyMilli: 2000, amountCents: 4000 }),
      ]);
      // Noon sale
      const o2 = mkOrder(2, "Cash", 9000, [
        mkLine({ itemId: 201, name: "Screws 1in", unit: "box", qtyMilli: 3000, amountCents: 3000 }),
        mkLine({ itemId: 203, name: "Hinges", unit: "pieces", qtyMilli: 6000, amountCents: 6000 }),
      ]);
      // Afternoon refund of o1
      const r1: Order = {
        ...mkOrder(3, "Cash", -2000, [
          mkLine({ itemId: 201, name: "Screws 1in", unit: "box", qtyMilli: 2000, amountCents: 2000 }),
        ]),
        refundOfOrderId: 1,
      };
      // Afternoon refund of o2
      const r2: Order = {
        ...mkOrder(4, "Cash", -4000, [
          mkLine({ itemId: 203, name: "Hinges", unit: "pieces", qtyMilli: 4000, amountCents: 4000 }),
        ]),
        refundOfOrderId: 2,
      };

      const sales = aggregateItemSales([o1, o2, r1, r2]);

      // Expected net:
      // Screws 201: (4000 + 3000) - 2000 = 5000 milli, RM 50.00 (5000 cents)
      // Hinges 203: 6000 - 4000 = 2000 milli, RM 20.00 (2000 cents)
      // Nails 202: 2000 milli, RM 40.00 (4000 cents)
      // Sort by qtyMilli descending: 201 (5000), then 203 (2000) or 202 (2000)
      expect(sales).toHaveLength(3);
      expect(sales[0]).toMatchObject({ itemId: 201, qtyMilli: 5000, amountCents: 5000 });

      const item202 = sales.find((s) => s.itemId === 202);
      const item203 = sales.find((s) => s.itemId === 203);
      expect(item202).toMatchObject({ itemId: 202, qtyMilli: 2000, amountCents: 4000 });
      expect(item203).toMatchObject({ itemId: 203, qtyMilli: 2000, amountCents: 2000 });
    });

    it("properly negates tailCount for livestock / tail-tracked items", () => {
      const sale = mkOrder(1, "Cash", 30000, [
        mkLine({ itemId: 301, name: "Tilapia", unit: "pieces", qtyMilli: 10000, amountCents: 30000, tailCount: 10 }),
      ]);
      const refund: Order = {
        ...mkOrder(2, "Cash", -9000, [
          mkLine({ itemId: 301, name: "Tilapia", unit: "pieces", qtyMilli: 3000, amountCents: 9000, tailCount: 3 }),
        ]),
        refundOfOrderId: 1,
      };

      const sales = aggregateItemSales([sale, refund]);
      expect(sales).toHaveLength(1);
      expect(sales[0]).toMatchObject({
        itemId: 301,
        qtyMilli: 7000,
        amountCents: 21000,
        tailCount: 7, // 10 - 3 = 7
      });
    });

    it("ignores voided sales and does not corrupt refund subtractions", () => {
      const activeSale = mkOrder(1, "Cash", 5000, [
        mkLine({ itemId: 401, name: "Angle Grinder", unit: "pieces", qtyMilli: 2000, amountCents: 5000 }),
      ]);
      const voidedSale: Order = {
        ...mkOrder(2, "Cash", 5000, [
          mkLine({ itemId: 401, name: "Angle Grinder", unit: "pieces", qtyMilli: 2000, amountCents: 5000 }),
        ]),
        voidedAt: 1729765000000,
      };
      const partialRefund: Order = {
        ...mkOrder(3, "Cash", -2500, [
          mkLine({ itemId: 401, name: "Angle Grinder", unit: "pieces", qtyMilli: 1000, amountCents: 2500 }),
        ]),
        refundOfOrderId: 1,
      };

      const sales = aggregateItemSales([activeSale, voidedSale, partialRefund]);
      expect(sales).toHaveLength(1);
      // Only activeSale (2000) - partialRefund (1000) = 1000
      expect(sales[0]).toMatchObject({
        itemId: 401,
        qtyMilli: 1000,
        amountCents: 2500,
      });
    });

    it("integrates seamlessly into thermal Z-report HTML rendering (renderDayReportHtml)", () => {
      const sale = mkOrder(1, "Cash", 10000, [
        mkLine({ itemId: 501, name: "Dulux Weathershield 5L", unit: "unit", qtyMilli: 2000, amountCents: 10000 }),
      ]);
      const refund: Order = {
        ...mkOrder(2, "Cash", -5000, [
          mkLine({ itemId: 501, name: "Dulux Weathershield 5L", unit: "unit", qtyMilli: 1000, amountCents: 5000 }),
        ]),
        refundOfOrderId: 1,
      };

      const html = renderDayReportHtml({
        storeName: "Yun Fook Trading",
        businessDate: "2026-10-24",
        orders: [sale, refund],
        repayments: [],
      });

      // Z-Report BY ITEM must display 1 unit (1000 milli) sold, NOT 3 units (3000 milli)!
      expect(html).toContain("Dulux Weathershield 5L");
      expect(html).toContain("1 unit"); // 2 - 1 = 1
      expect(html).toContain("50.00"); // 100 - 50 = RM 50.00
      expect(html).not.toContain("3 unit"); // Must NOT be inflated!

      // And Refunds section appears in BY PAYMENT
      expect(html).toContain("Refunds (1 order(s))");
      expect(html).toContain("-50.00");
    });

    it("correctly aggregates multi-line orders with identical itemId and distinct unit prices when one line is returned", () => {
      // Order with two lines of itemId 601:
      // Line 1: 2 units @ RM 10.00 = RM 20.00 (2000 milli, 2000 cents)
      // Line 2: 3 units @ RM 15.00 = RM 45.00 (3000 milli, 4500 cents)
      const sale = mkOrder(1, "Cash", 6500, [
        mkLine({ itemId: 601, name: "Special Screw", unit: "pieces", qtyMilli: 2000, amountCents: 2000, priceCents: 1000 }),
        mkLine({ itemId: 601, name: "Special Screw", unit: "pieces", qtyMilli: 3000, amountCents: 4500, priceCents: 1500 }),
      ]);

      // Refund line 2: 1 unit returned at RM 15.00
      const refund: Order = {
        ...mkOrder(2, "Cash", -1500, [
          mkLine({ itemId: 601, name: "Special Screw", unit: "pieces", qtyMilli: 1000, amountCents: 1500, priceCents: 1500 }),
        ]),
        refundOfOrderId: 1,
      };

      const sales = aggregateItemSales([sale, refund]);
      expect(sales).toHaveLength(1);
      // Net quantity: (2000 + 3000) - 1000 = 4000 milli
      // Net amount: (2000 + 4500) - 1500 = 5000 cents
      expect(sales[0]).toMatchObject({
        itemId: 601,
        qtyMilli: 4000,
        amountCents: 5000,
        lines: 3,
      });
    });

    it("correctly aggregates and negates ad-hoc custom items (itemId: 0)", () => {
      const sale = mkOrder(1, "Cash", 8000, [
        mkLine({ itemId: 0, name: "Lain-lain", unit: "pieces", qtyMilli: 1000, amountCents: 3000 }),
        mkLine({ itemId: 0, name: "Lain-lain", unit: "pieces", qtyMilli: 1000, amountCents: 5000 }),
      ]);
      const refund: Order = {
        ...mkOrder(2, "Cash", -3000, [
          mkLine({ itemId: 0, name: "Lain-lain", unit: "pieces", qtyMilli: 1000, amountCents: 3000 }),
        ]),
        refundOfOrderId: 1,
      };

      const sales = aggregateItemSales([sale, refund]);
      expect(sales).toHaveLength(1);
      // Net quantity: (1000 + 1000) - 1000 = 1000 milli
      // Net amount: (3000 + 5000) - 3000 = 5000 cents
      expect(sales[0]).toMatchObject({
        itemId: 0,
        qtyMilli: 1000,
        amountCents: 5000,
      });
    });

    it("filters out items returned from prior days when net daily sold is zero or negative", () => {
      // Only a refund order exists today for an item sold yesterday
      const crossDayRefund: Order = {
        ...mkOrder(1, "Cash", -5000, [
          mkLine({ itemId: 701, name: "Yesterday Drill", unit: "pieces", qtyMilli: 1000, amountCents: 5000 }),
        ]),
        refundOfOrderId: 999, // prior day order
      };

      const sales = aggregateItemSales([crossDayRefund]);
      // Because net quantity is -1000 and amount is -5000, it must be cleanly filtered out
      expect(sales).toHaveLength(0);
    });
  });
});
