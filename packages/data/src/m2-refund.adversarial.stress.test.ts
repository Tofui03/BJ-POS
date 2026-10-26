import { describe, it, expect, beforeEach } from "vitest";
import initSqlJs from "sql.js";
import {
  createOrder,
  computeStats,
  planPartialRefund,
  PosError,
  lineAmount,
  LEGACY_SEED_ITEMS,
  type Order,
  type OrderLine,
} from "@yf/core";
import { createSqlJsDriver, initRepo, SqlPosRepo } from "./index.js";

async function freshRepo(): Promise<SqlPosRepo> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  const driver = createSqlJsDriver(db as never);
  return initRepo(driver, {
    seedDemoOrders: false,
    seedItems: LEGACY_SEED_ITEMS,
    now: new Date(2026, 9, 24),
    rng: () => 0.5,
  });
}

describe("Milestone 2 (M2) Adversarial Challenger Stress Suite", () => {
  let repo: SqlPosRepo;

  beforeEach(async () => {
    repo = await freshRepo();
  });

  // =========================================================================
  // 1. Stress test planPartialRefund: over-refunds, negative qty, floats, consecutive
  // =========================================================================
  describe("1. planPartialRefund Domain Stress Invariants", () => {
    const mockOrder: Order = {
      id: 501,
      companyId: 1,
      invNo: "A-0005",
      ts: 1700000000000,
      businessDate: "2026-10-24",
      customerType: "walkin",
      method: "Cash",
      discountCents: 0,
      subtotalCents: 5000,
      totalCents: 5000,
      cashierName: "Alice",
      voidedAt: null,
      items: [
        {
          id: 1,
          itemId: 10,
          name: "Item 10",
          image: "",
          unit: "pcs",
          priceCents: 1000,
          origPriceCents: 1000,
          qtyMilli: 5000, // bought 5 pcs
          amountCents: 5000,
          tailCount: 0,
          bulkPrice: false,
        },
        {
          id: 2,
          itemId: 20,
          name: "Item 20",
          image: "",
          unit: "kg",
          priceCents: 2000,
          origPriceCents: 2000,
          qtyMilli: 2500, // bought 2.5 kg
          amountCents: 5000,
          tailCount: 0,
          bulkPrice: false,
        },
      ],
    };

    it("rejects over-refunding when single line exceeds purchased quantity", () => {
      expect(() =>
        planPartialRefund(mockOrder, [], [{ itemId: 10, qtyMilli: 5001 }]),
      ).toThrowError(/exceeds remaining returnable quantity/i);
    });

    it("rejects multi-line circumvention attempting over-refund across duplicate itemId entries", () => {
      // Bought 5000. Attacker splits 3000 + 3000 = 6000 into return lines.
      expect(() =>
        planPartialRefund(mockOrder, [], [
          { itemId: 10, qtyMilli: 3000 },
          { itemId: 10, qtyMilli: 3000 },
        ]),
      ).toThrowError(/exceeds remaining returnable quantity/i);
    });

    it("rejects negative quantities in returnLines", () => {
      expect(() =>
        planPartialRefund(mockOrder, [], [{ itemId: 10, qtyMilli: -1 }]),
      ).toThrowError(/return quantity must be a non-negative integer milli-unit/i);

      expect(() =>
        planPartialRefund(mockOrder, [], [{ itemId: 10, qtyMilli: -5000 }]),
      ).toThrowError(/return quantity must be a non-negative integer milli-unit/i);
    });

    it("rejects non-integer float decimals in returnLines", () => {
      // Millis must be integers
      expect(() =>
        planPartialRefund(mockOrder, [], [{ itemId: 10, qtyMilli: 1000.5 }]),
      ).toThrowError(/return quantity must be a non-negative integer milli-unit/i);

      expect(() =>
        planPartialRefund(mockOrder, [], [{ itemId: 10, qtyMilli: 0.1 }]),
      ).toThrowError(/return quantity must be a non-negative integer milli-unit/i);

      expect(() =>
        planPartialRefund(mockOrder, [], [{ itemId: 10, qtyMilli: NaN as any }]),
      ).toThrowError(/return quantity must be a non-negative integer milli-unit/i);

      expect(() =>
        planPartialRefund(mockOrder, [], [{ itemId: 10, qtyMilli: Infinity as any }]),
      ).toThrowError(/return quantity must be a non-negative integer milli-unit/i);
    });

    it("rejects request when all return lines are zero or empty", () => {
      expect(() => planPartialRefund(mockOrder, [], [])).toThrowError(
        /at least one line must have return quantity > 0/i,
      );

      expect(() =>
        planPartialRefund(mockOrder, [], [
          { itemId: 10, qtyMilli: 0 },
          { itemId: 20, qtyMilli: 0 },
        ]),
      ).toThrowError(/at least one line must have return quantity > 0/i);
    });

    it("handles multiple consecutive partial returns up to exact quota and blocks subsequent requests", () => {
      // Bought 5000 milli of Item 10.
      // 1st partial return: 2000 milli
      const plan1 = planPartialRefund(mockOrder, [], [{ itemId: 10, qtyMilli: 2000 }]);
      expect(plan1.totalCents).toBe(-2000);

      const refOrder1: Order = {
        ...mockOrder,
        id: 601,
        refundOfOrderId: mockOrder.id,
        totalCents: plan1.totalCents,
        items: [
          {
            ...mockOrder.items[0]!,
            id: 11,
            qtyMilli: 2000,
            amountCents: 2000,
          },
        ],
      };

      // 2nd partial return: 1500 milli
      const plan2 = planPartialRefund(mockOrder, [refOrder1], [{ itemId: 10, qtyMilli: 1500 }]);
      expect(plan2.totalCents).toBe(-1500);

      const refOrder2: Order = {
        ...mockOrder,
        id: 602,
        refundOfOrderId: mockOrder.id,
        totalCents: plan2.totalCents,
        items: [
          {
            ...mockOrder.items[0]!,
            id: 12,
            qtyMilli: 1500,
            amountCents: 1500,
          },
        ],
      };

      // Prior refunds total = 2000 + 1500 = 3500. Remaining = 1500.
      // Attempting 1501 milli must fail
      expect(() =>
        planPartialRefund(mockOrder, [refOrder1, refOrder2], [{ itemId: 10, qtyMilli: 1501 }]),
      ).toThrowError(/exceeds remaining returnable quantity/i);

      // Returning exact remainder (1500) must succeed
      const plan3 = planPartialRefund(mockOrder, [refOrder1, refOrder2], [{ itemId: 10, qtyMilli: 1500 }]);
      expect(plan3.totalCents).toBe(-1500);

      const refOrder3: Order = {
        ...mockOrder,
        id: 603,
        refundOfOrderId: mockOrder.id,
        totalCents: plan3.totalCents,
        items: [
          {
            ...mockOrder.items[0]!,
            id: 13,
            qtyMilli: 1500,
            amountCents: 1500,
          },
        ],
      };

      // Remaining is now 0. Any further return must fail
      expect(() =>
        planPartialRefund(mockOrder, [refOrder1, refOrder2, refOrder3], [{ itemId: 10, qtyMilli: 1 }]),
      ).toThrowError(/exceeds remaining returnable quantity/i);
    });

    it("restores return quota if a prior refund was voided", () => {
      // If refOrder2 was voided, its 1500 quota is not consumed.
      const refOrder1: Order = {
        ...mockOrder,
        id: 601,
        refundOfOrderId: mockOrder.id,
        totalCents: -2000,
        items: [{ ...mockOrder.items[0]!, id: 11, qtyMilli: 2000, amountCents: 2000 }],
      };
      const voidedRefOrder2: Order = {
        ...mockOrder,
        id: 602,
        refundOfOrderId: mockOrder.id,
        voidedAt: 1700000050000,
        totalCents: -1500,
        items: [{ ...mockOrder.items[0]!, id: 12, qtyMilli: 1500, amountCents: 1500 }],
      };

      // Purchased 5000, valid ref1 = 2000 -> remaining should be 3000 (not 1500)
      const plan = planPartialRefund(mockOrder, [refOrder1, voidedRefOrder2], [{ itemId: 10, qtyMilli: 3000 }]);
      expect(plan.totalCents).toBe(-3000);
    });

    it("refuses to refund an order that is voided or is itself a refund", () => {
      const voidedOrder = { ...mockOrder, voidedAt: 1700000099999 };
      expect(() => planPartialRefund(voidedOrder, [], [{ itemId: 10, qtyMilli: 1000 }])).toThrowError(
        /cannot refund a voided order/i,
      );

      const refundOrder = { ...mockOrder, refundOfOrderId: 400 };
      expect(() => planPartialRefund(refundOrder, [], [{ itemId: 10, qtyMilli: 1000 }])).toThrowError(
        /cannot refund a refund order/i,
      );
    });
  });

  // =========================================================================
  // 2. Verify price calculation fidelity against catalog changes
  // =========================================================================
  describe("2. Price Calculation Fidelity against Catalog Drift", () => {
    it("strictly preserves transacted unit price even if catalog price triples", async () => {
      // 1. Create item with price RM 10.00 (1000 cents)
      const cement = await repo.createItem({
        key: "test-cement-drift",
        name: "Test Cement",
        unit: "bag",
        priceCents: 1000,
        stockMilli: 50000, // 50 bags
      });

      // 2. Buy 5 bags at discounted unit price RM 8.00 (800 cents)
      const order = await createOrder(repo, {
        method: "Cash",
        lines: [{ itemId: cement.id, qtyMilli: 5000, unitPriceCents: 800 }],
      });
      expect(order.totalCents).toBe(4000); // 5 * 800 = 4000
      expect(order.items[0]!.priceCents).toBe(800);
      expect(order.items[0]!.origPriceCents).toBe(1000);

      // 3. Catalog price triples to RM 30.00 (3000 cents)
      await repo.updateItem(cement.id, { priceCents: 3000 });
      const updatedItem = (await repo.getItem(cement.id))!;
      expect(updatedItem.priceCents).toBe(3000);

      // 4. Refund 2 bags
      const refundOrder = await repo.createRefundOrder({
        originalOrderId: order.id,
        lines: [{ itemId: cement.id, qtyMilli: 2000 }],
      });

      // Assert refund uses original transacted price 800 cents, NOT 3000 or 1000!
      // 2 bags * 800 cents = 1600 cents
      expect(refundOrder.totalCents).toBe(-1600);
      expect(refundOrder.items[0]!.priceCents).toBe(800);
      expect(refundOrder.items[0]!.amountCents).toBe(1600);
    });

    it("guarantees zero float drift for fractional measured units", async () => {
      const fish = (await repo.getItemByKey("tilapia"))!; // 2500 cents/kg
      const order = await createOrder(repo, {
        method: "Cash",
        lines: [{ itemId: fish.id, qtyMilli: 3250 }], // 3.250 kg = 8125 cents
      });
      expect(order.totalCents).toBe(8125);

      // Refund 1.333 kg @ 2500 cents/kg:
      // lineAmount(2500, 1333) = Math.round(2500 * 1333 / 1000) = 3333 cents (RM 33.33)
      const refund = await repo.createRefundOrder({
        originalOrderId: order.id,
        lines: [{ itemId: fish.id, qtyMilli: 1333 }],
      });

      expect(refund.totalCents).toBe(-3333);
      expect(refund.items[0]!.qtyMilli).toBe(1333);
      expect(refund.items[0]!.amountCents).toBe(3333);
    });
  });

  // =========================================================================
  // 3. Verify persistence: negative total_cents, stockMilli increment, credit row reduction
  // =========================================================================
  describe("3. Persistence & Transactional Invariants", () => {
    it("persists negative total_cents, links refundOfOrderId, and preserves payment method", async () => {
      const pipe = await repo.createItem({
        key: "test-pvc-pipe",
        name: "PVC Pipe 1/2 inch",
        unit: "batang",
        priceCents: 1500,
      });

      const order = await createOrder(repo, {
        method: "Bank",
        lines: [{ itemId: pipe.id, qtyMilli: 4000 }],
      });

      const refund = await repo.createRefundOrder({
        originalOrderId: order.id,
        lines: [{ itemId: pipe.id, qtyMilli: 2000 }],
        cashierName: "Bob",
      });

      expect(refund.refundOfOrderId).toBe(order.id);
      expect(refund.refundOfInvNo).toBe(order.invNo);
      expect(refund.totalCents).toBe(-3000);
      expect(refund.method).toBe("Bank"); // matched payment method
      expect(refund.cashierName).toBe("Bob");

      // Verify retrieval through getOrder and listOrders
      const reFetched = (await repo.getOrder(refund.id))!;
      expect(reFetched.totalCents).toBe(-3000);
      expect(reFetched.refundOfOrderId).toBe(order.id);
      expect(reFetched.refundOfInvNo).toBe(order.invNo);
      expect(reFetched.method).toBe("Bank");
    });

    it("atomically increments stockMilli for tracked items and leaves untracked items null", async () => {
      const trackedItem = await repo.createItem({
        key: "tracked-paint",
        name: "Emulsion Paint 5L",
        unit: "unit",
        priceCents: 6500,
        stockMilli: 10000, // 10 cans
      });

      const untrackedItem = await repo.createItem({
        key: "untracked-screws",
        name: "Wood Screws 1 inch",
        unit: "box",
        priceCents: 500,
        stockMilli: null, // Untracked
      });

      // Purchase 4 cans of paint and 2 boxes of screws
      const order = await createOrder(repo, {
        method: "Cash",
        lines: [
          { itemId: trackedItem.id, qtyMilli: 4000 },
          { itemId: untrackedItem.id, qtyMilli: 2000 },
        ],
      });

      // Verify post-sale inventory
      expect((await repo.getItem(trackedItem.id))!.stockMilli).toBe(6000); // 10 - 4 = 6 cans
      expect((await repo.getItem(untrackedItem.id))!.stockMilli).toBeNull();

      // Return 2 cans of paint and 1 box of screws
      await repo.createRefundOrder({
        originalOrderId: order.id,
        lines: [
          { itemId: trackedItem.id, qtyMilli: 2000 },
          { itemId: untrackedItem.id, qtyMilli: 1000 },
        ],
      });

      // Verify replenishment: tracked item incremented by 2000 milli -> 8000 milli
      expect((await repo.getItem(trackedItem.id))!.stockMilli).toBe(8000);
      // Untracked item remains null
      expect((await repo.getItem(untrackedItem.id))!.stockMilli).toBeNull();
    });

    it("correctly reduces open credit rows and clears credit when fully refunded", async () => {
      const brick = await repo.createItem({
        key: "test-red-brick",
        name: "Red Brick",
        unit: "pcs",
        priceCents: 50,
      });

      // Contractor credit order of 200 bricks = RM 100.00 (10000 cents)
      const order = await createOrder(repo, {
        method: "Credit",
        contractorName: "Mega Construction",
        lines: [{ itemId: brick.id, qtyMilli: 200000 }],
      });
      expect(order.totalCents).toBe(10000);

      // Verify initial open credit
      const initialCredits = await repo.listCredits(1, { outstandingOnly: true });
      const cred = initialCredits.find((c) => c.orderId === order.id)!;
      expect(cred).toBeDefined();
      expect(cred.amountCents).toBe(10000);
      expect(cred.clearedAt).toBeNull();

      // Partial refund of 60 bricks = RM 30.00 (3000 cents)
      await repo.createRefundOrder({
        originalOrderId: order.id,
        lines: [{ itemId: brick.id, qtyMilli: 60000 }],
      });

      const creditsAfter1 = await repo.listCredits(1);
      const cred1 = creditsAfter1.find((c) => c.orderId === order.id)!;
      expect(cred1.amountCents).toBe(7000); // 10000 - 3000 = 7000
      expect(cred1.clearedAt).toBeNull();

      // Second partial refund of remaining 140 bricks = RM 70.00 (7000 cents)
      await repo.createRefundOrder({
        originalOrderId: order.id,
        lines: [{ itemId: brick.id, qtyMilli: 140000 }],
      });

      const creditsAfter2 = await repo.listCredits(1);
      const cred2 = creditsAfter2.find((c) => c.orderId === order.id)!;
      expect(cred2.amountCents).toBe(0);
      expect(cred2.clearedAt).not.toBeNull();

      // Ensure no outstanding credits remain for this order
      const outstanding = await repo.listCredits(1, { outstandingOnly: true });
      expect(outstanding.find((c) => c.orderId === order.id)).toBeUndefined();

      // Ensure original order creditClearedAt is stamped
      const updatedOrder = (await repo.getOrder(order.id))!;
      expect(updatedOrder.creditClearedAt).not.toBeNull();
    });

    it("correctly handles partial refund after partial credit repayment", async () => {
      const tile = await repo.createItem({
        key: "test-floor-tile",
        name: "Floor Tile 60x60",
        unit: "box",
        priceCents: 2000,
      });

      // Contractor credit order: 5 boxes = RM 100.00 (10000 cents)
      const order = await createOrder(repo, {
        method: "Credit",
        contractorName: "Chong Renovation",
        lines: [{ itemId: tile.id, qtyMilli: 5000 }],
      });

      const credsInitial = await repo.listCredits(1);
      const credRow = credsInitial.find((c) => c.orderId === order.id)!;
      expect(credRow.amountCents).toBe(10000);

      // Contractor makes partial cash repayment of RM 40.00 (4000 cents)
      await repo.recordRepayment({
        creditId: credRow.id,
        amountCents: 4000,
        method: "Cash",
        cashierName: "Alice",
      });

      const credsAfterRepayment = await repo.listCredits(1);
      const credRowAfterRepay = credsAfterRepayment.find((c) => c.orderId === order.id)!;
      expect(credRowAfterRepay.amountCents).toBe(6000); // 10000 - 4000 = 6000 remaining open debt

      // Customer returns 2 boxes (2 * RM 20 = RM 40 = 4000 cents)
      await repo.createRefundOrder({
        originalOrderId: order.id,
        lines: [{ itemId: tile.id, qtyMilli: 2000 }],
      });

      const credsAfterRefund = await repo.listCredits(1);
      const credRow2 = credsAfterRefund.find((c) => c.orderId === order.id)!;
      expect(credRow2.amountCents).toBe(2000); // 6000 - 4000 = 2000 remaining debt

      // Customer returns 1 more box (RM 20 = 2000 cents) -> debt drops to 0 and clears!
      await repo.createRefundOrder({
        originalOrderId: order.id,
        lines: [{ itemId: tile.id, qtyMilli: 1000 }],
      });

      const openCreds = await repo.listCredits(1, { outstandingOnly: true });
      expect(openCreds.find((c) => c.orderId === order.id)).toBeUndefined();

      const orderCleared = (await repo.getOrder(order.id))!;
      expect(orderCleared.creditClearedAt).not.toBeNull();
    });

    it("enforces remaining return quota across consecutive sequential refund requests", async () => {
      const nail = await repo.createItem({
        key: "test-seq-nail",
        name: "Test Sequential Nail",
        unit: "box",
        priceCents: 1000,
      });

      // Buy 2 boxes (2000 milli)
      const order = await createOrder(repo, {
        method: "Cash",
        lines: [{ itemId: nail.id, qtyMilli: 2000 }],
      });

      // First sequential refund of 1500 milli
      const ref1 = await repo.createRefundOrder({
        originalOrderId: order.id,
        lines: [{ itemId: nail.id, qtyMilli: 1500 }],
      });
      expect(ref1.totalCents).toBe(-1500);

      // Attempting second sequential refund of 1000 milli (only 500 remaining) must throw!
      await expect(
        repo.createRefundOrder({
          originalOrderId: order.id,
          lines: [{ itemId: nail.id, qtyMilli: 1000 }],
        }),
      ).rejects.toThrow(/exceeds remaining returnable quantity/i);

      // Refunding exact remainder (500 milli) succeeds
      const ref2 = await repo.createRefundOrder({
        originalOrderId: order.id,
        lines: [{ itemId: nail.id, qtyMilli: 500 }],
      });
      expect(ref2.totalCents).toBe(-500);

      // Third refund on fully refunded order must throw
      await expect(
        repo.createRefundOrder({
          originalOrderId: order.id,
          lines: [{ itemId: nail.id, qtyMilli: 1 }],
        }),
      ).rejects.toThrow(/exceeds remaining returnable quantity/i);
    });

    it("integrates refunds into computeStats for daily reporting", async () => {
      const item = await repo.createItem({
        key: "test-stat-item",
        name: "Stat Item",
        unit: "unit",
        priceCents: 2000,
      });

      const bDate = "2026-10-24";
      const o1 = await createOrder(repo, {
        method: "Cash",
        businessDate: bDate,
        lines: [{ itemId: item.id, qtyMilli: 2000 }], // 4000 cents
      });

      const ref = await repo.createRefundOrder({
        originalOrderId: o1.id,
        businessDate: bDate,
        lines: [{ itemId: item.id, qtyMilli: 1000 }], // -2000 cents
      });

      const dayOrders = await repo.listOrdersByBusinessDate(bDate, bDate, 1);
      expect(dayOrders).toHaveLength(2);

      const stats = computeStats(dayOrders, "today");
      // Original: 4000, Refund: -2000 -> net totalCents = 2000
      expect(stats.totalCents).toBe(2000);
      expect(stats.refundsCount).toBe(1);
      expect(stats.refundsTotalCents).toBe(2000);
    });
  });
});
