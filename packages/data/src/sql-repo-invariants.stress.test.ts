import { describe, it, expect, beforeEach } from "vitest";
import initSqlJs from "sql.js";
import {
  createOrder,
  localDateStr,
  nextDateStr,
  businessDateFor,
  PosError,
  LEGACY_SEED_ITEMS,
} from "@yf/core";
import { createSqlJsDriver, initRepo, SqlPosRepo } from "./index.js";

async function freshRepo(): Promise<SqlPosRepo> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  const driver = createSqlJsDriver(db as never);
  return initRepo(driver, {
    seedDemoOrders: false,
    seedItems: LEGACY_SEED_ITEMS,
    now: new Date("2026-07-15T10:00:00+08:00"),
    rng: () => 0.5,
  });
}

describe("SqlPosRepo invariants", () => {
  let repo: SqlPosRepo;

  beforeEach(async () => {
    repo = await freshRepo();
  });

  describe("Stock Deduction Invariants (single vs multiple lines)", () => {
    it("deducts stock identically for a single line vs multiple split lines of the same item", async () => {
      // Create two identical items with 10,000 milli stock (10.000 kg)
      const itemSingle = await repo.createItem({
        key: "item_single",
        name: "Item Single Line",
        unit: "kg",
        priceCents: 1000,
        stockMilli: 10000,
      });
      const itemMulti = await repo.createItem({
        key: "item_multi",
        name: "Item Multi Line",
        unit: "kg",
        priceCents: 1000,
        stockMilli: 10000,
      });

      // Single order: 1 line of 7,000 milli
      await createOrder(repo, {
        method: "Cash",
        lines: [{ itemId: itemSingle.id, qtyMilli: 7000 }],
      });

      // Multi order: 3 lines of 2000, 3000, 2000 milli (sum = 7,000 milli)
      await createOrder(repo, {
        method: "Cash",
        lines: [
          { itemId: itemMulti.id, qtyMilli: 2000 },
          { itemId: itemMulti.id, qtyMilli: 3000 },
          { itemId: itemMulti.id, qtyMilli: 2000 },
        ],
      });

      const updatedSingle = (await repo.getItem(itemSingle.id))!;
      const updatedMulti = (await repo.getItem(itemMulti.id))!;

      // Invariant: Both must end up with exactly 3,000 milli
      expect(updatedSingle.stockMilli).toBe(3000);
      expect(updatedMulti.stockMilli).toBe(3000);
      expect(updatedMulti.stockMilli).toBe(updatedSingle.stockMilli);
    });

    it("rejects multi-line order atomically when total cumulative quantity exceeds stock", async () => {
      // Stock is 5,000 milli
      const item = await repo.createItem({
        key: "limited_stock",
        name: "Limited Stock Item",
        unit: "kg",
        priceCents: 1200,
        stockMilli: 5000,
      });

      // Line 1 (3000) is individually within stock, but line 2 (3000) pushes cumulative to 6000 > 5000
      await expect(
        createOrder(repo, {
          method: "Cash",
          lines: [
            { itemId: item.id, qtyMilli: 3000 },
            { itemId: item.id, qtyMilli: 3000 },
          ],
        }),
      ).rejects.toThrow(/not enough stock for Limited Stock Item/);

      // Invariant: Database state remains uncorrupted; stock is untouched at 5000
      const current = (await repo.getItem(item.id))!;
      expect(current.stockMilli).toBe(5000);

      // Invariant: No orphaned order rows created
      const allOrders = await repo.listOrders(0, Date.now() + 86400000);
      expect(allOrders.length).toBe(0);
    });

    it("depletes stock exactly to zero and prevents subsequent purchase", async () => {
      const item = await repo.createItem({
        key: "exact_stock",
        name: "Exact Stock Item",
        unit: "pcs",
        priceCents: 800,
        stockMilli: 4000,
      });

      // Buy exact 4000 milli
      await createOrder(repo, {
        method: "Cash",
        lines: [{ itemId: item.id, qtyMilli: 4000 }],
      });

      const depleted = (await repo.getItem(item.id))!;
      expect(depleted.stockMilli).toBe(0);

      // Next purchase of even 1 milli must fail
      await expect(
        createOrder(repo, {
          method: "Cash",
          lines: [{ itemId: item.id, qtyMilli: 1 }],
        }),
      ).rejects.toThrow(/not enough stock for Exact Stock Item/);
    });

    it("rolls back all item stock deductions atomically if any item in the cart has insufficient stock", async () => {
      const itemGood = await repo.createItem({
        key: "good_stock",
        name: "Good Stock",
        unit: "kg",
        priceCents: 1000,
        stockMilli: 10000,
      });
      const itemLow = await repo.createItem({
        key: "low_stock",
        name: "Low Stock",
        unit: "kg",
        priceCents: 1000,
        stockMilli: 2000,
      });

      await expect(
        createOrder(repo, {
          method: "Cash",
          lines: [
            { itemId: itemGood.id, qtyMilli: 5000 }, // fits
            { itemId: itemLow.id, qtyMilli: 3000 },  // exceeds 2000!
          ],
        }),
      ).rejects.toThrow(/not enough stock for Low Stock/);

      // Invariant: itemGood stock is NOT decremented
      expect((await repo.getItem(itemGood.id))!.stockMilli).toBe(10000);
      expect((await repo.getItem(itemLow.id))!.stockMilli).toBe(2000);
    });

    it("handles complex mixed order with tracked, untracked, and repeated lines", async () => {
      const trackedA = await repo.createItem({
        key: "tracked_a",
        name: "Tracked A",
        unit: "kg",
        priceCents: 2000,
        stockMilli: 10000,
      });
      const trackedB = await repo.createItem({
        key: "tracked_b",
        name: "Tracked B",
        unit: "pcs",
        priceCents: 500,
        stockMilli: 8000,
      });
      const untracked = await repo.createItem({
        key: "untracked_sand",
        name: "Untracked Sand",
        unit: "kg",
        priceCents: 100,
        stockMilli: null, // untracked
      });

      const order = await createOrder(repo, {
        method: "Cash",
        lines: [
          { itemId: trackedA.id, qtyMilli: 4000 },
          { itemId: trackedB.id, qtyMilli: 5000 },
          { itemId: untracked.id, qtyMilli: 99999 },
          { itemId: trackedA.id, qtyMilli: 3000 },
        ],
      });

      expect(order.items.length).toBe(4);

      const afterA = (await repo.getItem(trackedA.id))!;
      const afterB = (await repo.getItem(trackedB.id))!;
      const afterU = (await repo.getItem(untracked.id))!;

      expect(afterA.stockMilli).toBe(3000); // 10000 - 4000 - 3000
      expect(afterB.stockMilli).toBe(3000); // 8000 - 5000
      expect(afterU.stockMilli).toBeNull(); // remains untracked

      // Now void the mixed order and verify restoration
      await repo.voidOrder(order.id, Date.now());

      const restoredA = (await repo.getItem(trackedA.id))!;
      const restoredB = (await repo.getItem(trackedB.id))!;
      const restoredU = (await repo.getItem(untracked.id))!;

      expect(restoredA.stockMilli).toBe(10000);
      expect(restoredB.stockMilli).toBe(8000);
      expect(restoredU.stockMilli).toBeNull();

      // Second void is idempotent (noop) and must NOT double-restore stock
      await repo.voidOrder(order.id, Date.now() + 1000);
      const afterSecondVoidA = (await repo.getItem(trackedA.id))!;
      expect(afterSecondVoidA.stockMilli).toBe(10000);
    });
  });

  describe("voidOrder Guard Invariants on Settled Credit Orders", () => {
    it("allows voiding an unsettled credit order and cleans up credit record and stock", async () => {
      const tracked = await repo.createItem({
        key: "tracked_nail",
        name: "Tracked Nail",
        unit: "kg",
        priceCents: 1000,
        stockMilli: 10000,
      });
      const initialStock = tracked.stockMilli!;

      const order = await createOrder(repo, {
        method: "Credit",
        contractorName: "Ah Kow Contractor",
        lines: [{ itemId: tracked.id, qtyMilli: 2000 }],
      });

      expect((await repo.getItem(tracked.id))!.stockMilli).toBe(initialStock - 2000);
      const openCredits = await repo.listCredits(1, { outstandingOnly: true });
      expect(openCredits.length).toBe(1);

      // Void unsettled order
      await repo.voidOrder(order.id, Date.now());

      const voidedOrder = (await repo.getOrder(order.id))!;
      expect(voidedOrder.voidedAt).toBeGreaterThan(0);

      // Credit record must be deleted
      const creditsAfter = await repo.listCredits(1, { outstandingOnly: true });
      expect(creditsAfter.length).toBe(0);

      // Stock must be restored
      expect((await repo.getItem(tracked.id))!.stockMilli).toBe(initialStock);
    });

    it("restores stock for multiple lines of the same item when voided", async () => {
      const tracked = await repo.createItem({
        key: "tracked_pipes",
        name: "Tracked Pipes",
        unit: "pcs",
        priceCents: 1500,
        stockMilli: 20000,
      });

      const order = await createOrder(repo, {
        method: "Cash",
        lines: [
          { itemId: tracked.id, qtyMilli: 3500 },
          { itemId: tracked.id, qtyMilli: 4500 },
        ],
      });

      expect((await repo.getItem(tracked.id))!.stockMilli).toBe(12000); // 20000 - 8000

      await repo.voidOrder(order.id, Date.now());

      // Entire 8000 milli is restored back
      expect((await repo.getItem(tracked.id))!.stockMilli).toBe(20000);
    });

    it("restores stock even if item was soft-deleted after order was placed", async () => {
      const tracked = await repo.createItem({
        key: "tracked_paint_brush",
        name: "Tracked Paint Brush",
        unit: "pcs",
        priceCents: 750,
        stockMilli: 15000,
      });

      const order = await createOrder(repo, {
        method: "Cash",
        lines: [{ itemId: tracked.id, qtyMilli: 5000 }],
      });

      expect((await repo.getItem(tracked.id))!.stockMilli).toBe(10000);

      // Soft delete the item
      await repo.updateItem(tracked.id, { active: false });

      // Void order
      await repo.voidOrder(order.id, Date.now());

      // Stock is still restored
      const itemAfter = (await repo.getItem(tracked.id))!;
      expect(itemAfter.stockMilli).toBe(15000);
      expect(itemAfter.active).toBe(false);
    });

    it("ignores non-existent order id gracefully", async () => {
      await expect(repo.voidOrder(999999, Date.now())).resolves.not.toThrow();
    });

    it("rejects voiding a credit order settled via recordRepayment", async () => {
      const tracked = await repo.createItem({
        key: "tracked_screw",
        name: "Tracked Screw",
        unit: "kg",
        priceCents: 1500,
        stockMilli: 5000,
      });
      const order = await createOrder(repo, {
        method: "Credit",
        contractorName: "Chong Hardware",
        lines: [{ itemId: tracked.id, qtyMilli: 1000 }],
      });

      const [credit] = await repo.listCredits(1, { outstandingOnly: true });

      // Settle full credit via recordRepayment
      await repo.recordRepayment({
        creditId: credit!.id,
        amountCents: order.totalCents,
        method: "Cash",
        ts: Date.now(),
      });

      // Verify order credit is marked cleared
      const orderSettled = (await repo.getOrder(order.id))!;
      expect(orderSettled.creditClearedAt).toBeGreaterThan(0);

      // Void MUST be rejected with PosError
      await expect(repo.voidOrder(order.id, Date.now())).rejects.toThrow(
        /cannot void a credit order that has already been settled/,
      );

      // Verify state was not touched
      const orderCheck = (await repo.getOrder(order.id))!;
      expect(orderCheck.voidedAt).toBeNull();
      // Stock remains deducted
      expect((await repo.getItem(tracked.id))!.stockMilli).toBe(4000);
    });

    it("rejects voiding a credit order with partial repayment", async () => {
      const tracked = await repo.createItem({
        key: "tracked_paint",
        name: "Tracked Paint",
        unit: "box",
        priceCents: 5000,
        stockMilli: 10000,
      });
      const order = await createOrder(repo, {
        method: "Credit",
        contractorName: "Siti Pembinaan",
        lines: [{ itemId: tracked.id, qtyMilli: 2000 }], // 2 cans @ RM 50 = RM 100 (10000 cents)
      });

      const [credit] = await repo.listCredits(1, { outstandingOnly: true });

      // Partial repayment of RM 30 (3000 cents)
      await repo.recordRepayment({
        creditId: credit!.id,
        amountCents: 3000,
        method: "Bank",
        ts: Date.now(),
      });

      // Void MUST be rejected because a repayment already exists
      await expect(repo.voidOrder(order.id, Date.now())).rejects.toThrow(
        /cannot void a credit order that has already been settled/,
      );

      const orderCheck = (await repo.getOrder(order.id))!;
      expect(orderCheck.voidedAt).toBeNull();
      expect((await repo.getItem(tracked.id))!.stockMilli).toBe(8000);
    });

    it("rejects voiding a credit order settled via clearCreditsByIds", async () => {
      const tracked = await repo.createItem({
        key: "tracked_cement",
        name: "Tracked Cement",
        unit: "bag",
        priceCents: 2000,
        stockMilli: 20000,
      });
      const order = await createOrder(repo, {
        method: "Credit",
        contractorName: "Tan Brother Construction",
        lines: [{ itemId: tracked.id, qtyMilli: 2000 }],
      });

      const [credit] = await repo.listCredits(1, { outstandingOnly: true });
      await repo.clearCreditsByIds([credit!.id], Date.now(), 1, "Cash");

      await expect(repo.voidOrder(order.id, Date.now())).rejects.toThrow(
        /cannot void a credit order that has already been settled/,
      );
    });

    it("allows voiding non-credit orders (Cash, Bank, QR) cleanly", async () => {
      const tracked = await repo.createItem({
        key: "tracked_wire",
        name: "Tracked Wire",
        unit: "meter",
        priceCents: 300,
        stockMilli: 50000,
      });

      const orderCash = await createOrder(repo, {
        method: "Cash",
        lines: [{ itemId: tracked.id, qtyMilli: 1000 }],
      });
      const orderBank = await createOrder(repo, {
        method: "Bank",
        lines: [{ itemId: tracked.id, qtyMilli: 1000 }],
      });
      const orderQr = await createOrder(repo, {
        method: "QR",
        lines: [{ itemId: tracked.id, qtyMilli: 1000 }],
      });

      await expect(repo.voidOrder(orderCash.id, Date.now())).resolves.not.toThrow();
      await expect(repo.voidOrder(orderBank.id, Date.now())).resolves.not.toThrow();
      await expect(repo.voidOrder(orderQr.id, Date.now())).resolves.not.toThrow();

      expect((await repo.getOrder(orderCash.id))!.voidedAt).toBeGreaterThan(0);
      expect((await repo.getOrder(orderBank.id))!.voidedAt).toBeGreaterThan(0);
      expect((await repo.getOrder(orderQr.id))!.voidedAt).toBeGreaterThan(0);

      // All 3000 stock returned
      expect((await repo.getItem(tracked.id))!.stockMilli).toBe(50000);
    });
  });

  describe("CloseDay and ReopenDay Consistency & Invariants", () => {
    it("rejects closing future days or double closing", async () => {
      const now = new Date("2026-07-15T18:00:00+08:00").getTime();
      const wallToday = localDateStr(now); // "2026-07-15"
      const tomorrow = nextDateStr(wallToday); // "2026-07-16"

      // Premature close of tomorrow relative to current timestamp
      await expect(repo.closeDay(tomorrow, { at: now })).rejects.toThrow(
        new RegExp(`cannot close ${tomorrow} before that day arrives`),
      );

      // Close today
      await repo.closeDay(wallToday, { at: now });

      // Double close today
      await expect(repo.closeDay(wallToday, { at: now })).rejects.toThrow(
        new RegExp(`day ${wallToday} is already closed`),
      );
    });

    it("reopenDay accurately restores pushed sales and repayments to the reopened day without affecting real tomorrow records", async () => {
      const tracked = await repo.createItem({
        key: "tracked_tape",
        name: "Tracked Tape",
        unit: "roll",
        priceCents: 450,
        stockMilli: 10000,
      });
      const day1 = "2026-07-15";
      const day2 = "2026-07-16";

      const tsDay1Afternoon = new Date("2026-07-15T15:00:00+08:00").getTime();
      const tsDay1Night = new Date("2026-07-15T21:00:00+08:00").getTime();
      const tsDay2Morning = new Date("2026-07-16T09:00:00+08:00").getTime();

      // 1. Order 1 rung up before closing on Day 1
      const order1 = await createOrder(repo, {
        method: "Cash",
        ts: tsDay1Afternoon,
        businessDate: day1,
        lines: [{ itemId: tracked.id, qtyMilli: 1000 }],
      });
      expect(order1.businessDate).toBe(day1);

      // Check unclosed days before Day 2
      const unclosedBeforeClose = await repo.listUnclosedDays("2026-07-16");
      expect(unclosedBeforeClose).toContain(day1);

      // 2. Day 1 is closed at 20:00
      const tsClose = new Date("2026-07-15T20:00:00+08:00").getTime();
      await repo.closeDay(day1, { at: tsClose });

      // After closing, day1 is no longer in unclosed days
      const unclosedAfterClose = await repo.listUnclosedDays("2026-07-16");
      expect(unclosedAfterClose).not.toContain(day1);

      // 3. Order 2 rung up on Day 1 NIGHT (after close). In POS business logic,
      // businessDateFor(now, todayClosed=true) returns day2 ("2026-07-16").
      const order2Pushed = await createOrder(repo, {
        method: "Credit",
        contractorName: "Night Owl",
        ts: tsDay1Night,
        businessDate: businessDateFor(tsDay1Night, true),
        lines: [{ itemId: tracked.id, qtyMilli: 1000 }],
      });
      expect(order2Pushed.businessDate).toBe(day2);

      // 4. Repayment recorded on Day 1 NIGHT (after close)
      const [credit2] = await repo.listCredits(1, { outstandingOnly: true });
      const rep1Pushed = await repo.recordRepayment({
        creditId: credit2!.id,
        amountCents: 200,
        method: "Cash",
        ts: tsDay1Night,
        businessDate: businessDateFor(tsDay1Night, true),
      });
      expect(rep1Pushed.businessDate).toBe(day2);

      // 5. Next morning: Real Day 2 sales and repayments
      const order3RealDay2 = await createOrder(repo, {
        method: "Cash",
        ts: tsDay2Morning,
        businessDate: day2,
        lines: [{ itemId: tracked.id, qtyMilli: 1000 }],
      });
      expect(order3RealDay2.businessDate).toBe(day2);

      // Get remaining open credit for Night Owl
      const [remainingCredit] = await repo.listCredits(1, { outstandingOnly: true });
      const rep2RealDay2 = await repo.recordRepayment({
        creditId: remainingCredit!.id,
        amountCents: 200,
        method: "Cash",
        ts: tsDay2Morning,
        businessDate: day2,
      });
      expect(rep2RealDay2.businessDate).toBe(day2);

      // Verify before reopening:
      // Orders in Day 1: [order1]
      // Orders in Day 2: [order2Pushed, order3RealDay2]
      const ordersDay1Before = (await repo.listOrders(0, Date.now() + 864000000)).filter((o) => o.businessDate === day1);
      const ordersDay2Before = (await repo.listOrders(0, Date.now() + 864000000)).filter((o) => o.businessDate === day2);
      expect(ordersDay1Before.map((o) => o.id)).toEqual([order1.id]);
      expect(ordersDay2Before.map((o) => o.id).sort()).toEqual([order2Pushed.id, order3RealDay2.id].sort());

      // Repayments before reopening:
      const repsDay2Before = await repo.listRepayments({ businessDate: day2 });
      expect(repsDay2Before.map((r) => r.id).sort()).toEqual([rep1Pushed.id, rep2RealDay2.id].sort());

      // 6. ACTION: Reopen Day 1
      await repo.reopenDay(day1);

      // Invariant 1: Day close record for Day 1 is deleted
      expect(await repo.getDayClose(day1)).toBeNull();

      // Invariant 2: Order 2 (physically created on Day 1) moves back to Day 1
      const order2AfterReopen = (await repo.getOrder(order2Pushed.id))!;
      expect(order2AfterReopen.businessDate).toBe(day1);

      // Invariant 3: Order 3 (physically created on Day 2) stays on Day 2
      const order3AfterReopen = (await repo.getOrder(order3RealDay2.id))!;
      expect(order3AfterReopen.businessDate).toBe(day2);

      // Invariant 4: Repayment 1 moves back to Day 1, Repayment 2 stays on Day 2
      const repsDay1After = await repo.listRepayments({ businessDate: day1 });
      const repsDay2After = await repo.listRepayments({ businessDate: day2 });
      expect(repsDay1After.map((r) => r.id)).toEqual([rep1Pushed.id]);
      expect(repsDay2After.map((r) => r.id)).toEqual([rep2RealDay2.id]);

      // Invariant 5: listUnclosedDays now includes Day 1 again
      const unclosedAfterReopen = await repo.listUnclosedDays("2026-07-16");
      expect(unclosedAfterReopen).toContain(day1);

      // Invariant 6: Day 1 can now be closed again cleanly
      const reClosed = await repo.closeDay(day1, { at: tsClose + 3600_000 });
      expect(reClosed.businessDate).toBe(day1);
      expect(await repo.getDayClose(day1)).not.toBeNull();
    });
  });
});
