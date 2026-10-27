import { beforeEach, describe, expect, it } from "vitest";
import initSqlJs from "sql.js";
import {
  assertValidRestockQuantity,
  compareStockAscending,
  createOrder,
  filterStockItems,
  formatStockQty,
  getStockStatus,
  isLowStock,
  isStockTracked,
  LEGACY_SEED_ITEMS,
  PosError,
  type PricedItem,
  type Unit,
} from "@yf/core";
import { createSqlJsDriver, initRepo, type SqlPosRepo } from "./index.js";

async function freshRepo(): Promise<SqlPosRepo> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  const driver = createSqlJsDriver(db as never);
  return initRepo(driver, {
    seedItems: LEGACY_SEED_ITEMS,
    now: new Date(2026, 9, 25),
    rng: () => 0.5,
  });
}

describe("Concurrent restock and stock validation", () => {
  let repo: SqlPosRepo;

  beforeEach(async () => {
    repo = await freshRepo();
  });

  const createTrackedItem = (key: string, name: string, stockMilli: number, unit: Unit = "pcs") =>
    repo.createItem({
      key,
      name,
      unit,
      priceCents: 1500,
      stockMilli,
    });

  const createUntrackedItem = (key: string, name: string, unit: Unit = "pcs") =>
    repo.createItem({
      key,
      name,
      unit,
      priceCents: 2000,
      stockMilli: null,
    });

  // =========================================================================
  // 1. HIGH CONCURRENCY STRESS
  // =========================================================================
  describe("1. High Concurrency Restock Stress", () => {
    it("dispatches 20 parallel restockItem calls to a tracked item and asserts exact sum accumulation", async () => {
      const item = await createTrackedItem("stress-cup-20", "Stress Cup 20", 5000);
      const increments = [
        500, 1000, 1500, 2000, 2500,
        3000, 3500, 4000, 4500, 5000,
        5500, 6000, 6500, 7000, 7500,
        8000, 8500, 9000, 9500, 10000,
      ];
      const sumIncrements = increments.reduce((acc, n) => acc + n, 0); // 105,000
      const expectedTotal = 5000 + sumIncrements; // 110,000

      // Dispatch all 20 calls simultaneously
      const results = await Promise.all(
        increments.map((qty) => repo.restockItem(item.id, qty, `Batch +${qty}`)),
      );

      // Verify each call returned a valid updated item
      expect(results).toHaveLength(20);
      for (const r of results) {
        expect(r.id).toBe(item.id);
        expect(typeof r.stockMilli).toBe("number");
        expect(r.stockMilli!).toBeGreaterThanOrEqual(5500);
        expect(r.stockMilli!).toBeLessThanOrEqual(expectedTotal);
      }

      // Final persistent state in database must match expected total exactly
      const reloaded = await repo.getItem(item.id);
      expect(reloaded).not.toBeNull();
      expect(reloaded!.stockMilli).toBe(expectedTotal);
    });

    it("dispatches 20 parallel restockItem calls to an UNTRACKED item (stock_milli == null) simultaneously", async () => {
      const item = await createUntrackedItem("stress-untracked-20", "Untracked River Sand", "bag");
      expect(item.stockMilli).toBeNull();

      const increments = [
        1000, 2000, 3000, 4000, 5000,
        1000, 2000, 3000, 4000, 5000,
        1000, 2000, 3000, 4000, 5000,
        1000, 2000, 3000, 4000, 5000,
      ];
      const expectedTotal = increments.reduce((acc, n) => acc + n, 0); // 60,000

      // Dispatch 20 parallel calls simultaneously
      const results = await Promise.all(
        increments.map((qty) => repo.restockItem(item.id, qty)),
      );

      expect(results).toHaveLength(20);
      const reloaded = await repo.getItem(item.id);
      expect(reloaded).not.toBeNull();
      // Must have transitioned from null to exactly 60,000 without lost updates or NULL poisoning
      expect(reloaded!.stockMilli).toBe(expectedTotal);
      expect(isStockTracked(reloaded!)).toBe(true);
    });

    it("handles multi-item mass concurrency: 5 distinct items x 10 concurrent operations (50 promises)", async () => {
      const items: PricedItem[] = [];
      for (let i = 1; i <= 5; i++) {
        items.push(await createTrackedItem(`multi-item-${i}`, `Multi Item ${i}`, i * 1000));
      }

      const operations: Promise<PricedItem>[] = [];
      const expectedFinals: Record<number, number> = {};

      for (const itm of items) {
        let expected = itm.stockMilli!;
        for (let op = 1; op <= 10; op++) {
          const qty = op * 500;
          expected += qty;
          operations.push(repo.restockItem(itm.id, qty));
        }
        expectedFinals[itm.id] = expected;
      }

      expect(operations).toHaveLength(50);
      await Promise.all(operations);

      for (const itm of items) {
        const reloaded = await repo.getItem(itm.id);
        expect(reloaded!.stockMilli).toBe(expectedFinals[itm.id]);
      }
    });

    it("verifies concurrent restock operation and till order deduction on tracked item", async () => {
      // Cup initial stock: 20,000 milli
      const item = await createTrackedItem("interleaved-cup", "Interleaved Stock Cup", 20000);

      // Launch 1 restock (+5000) and 1 cash sale (-2000) concurrently
      // Expected: 20,000 + 5000 - 2000 = 23,000 milli
      const p1 = repo.restockItem(item.id, 5000);
      const p2 = createOrder(repo, {
        method: "Cash",
        ts: Date.now(),
        lines: [{ itemId: item.id, qtyMilli: 2000 }],
      });

      await Promise.all([p1, p2]);

      const reloaded = await repo.getItem(item.id);
      expect(reloaded!.stockMilli).toBe(23000);
    });
  });

  // =========================================================================
  // 2. PROGRESSIVE ONBOARDING & LIFECYCLE
  // =========================================================================
  describe("2. Progressive Onboarding & Lifecycle", () => {
    it("transitions untracked item from null to tracked with exact quantity and preserves status", async () => {
      const fish = (await repo.getItemByKey("tilapia"))!;
      expect(fish.stockMilli).toBeNull();
      expect(isStockTracked(fish)).toBe(false);
      expect(getStockStatus(fish)).toBe("untracked");
      expect(isLowStock(fish)).toBe(false);
      expect(formatStockQty(fish.stockMilli)).toBe("—");

      // 3.500 kg (3500 milli) is under the 5000 milli low-stock threshold.
      const step1 = await repo.restockItem(fish.id, 3500, "First wholesale delivery");
      expect(step1.stockMilli).toBe(3500);
      expect(isStockTracked(step1)).toBe(true);
      expect(getStockStatus(step1)).toBe("low_stock");
      expect(isLowStock(step1)).toBe(true);
      expect(formatStockQty(step1.stockMilli)).toBe("3.5");

      // Another 4.000 kg brings the line to 7500 milli, above the threshold.
      const step2 = await repo.restockItem(fish.id, 4000, "Second delivery");
      expect(step2.stockMilli).toBe(7500);
      expect(getStockStatus(step2)).toBe("in_stock");
      expect(isLowStock(step2)).toBe(false);
      expect(formatStockQty(step2.stockMilli)).toBe("7.5");

      // Editing the item must not clear stock.
      await repo.updateItem(fish.id, {
        name: "Ikan Tilapia Merah Segar",
        priceCents: 2800,
        active: true,
      });

      const reloaded = await repo.getItem(fish.id);
      expect(reloaded!.name).toBe("Ikan Tilapia Merah Segar");
      expect(reloaded!.priceCents).toBe(2800);
      expect(reloaded!.stockMilli).toBe(7500); // INVARIANT: stock preserved!
    });

    it("verifies progressive onboarding behavior with filterStockItems", async () => {
      const untracked = await createUntrackedItem("gravel-coarse", "Coarse Gravel", "bag");
      const tracked = await createTrackedItem("cement-portland", "Portland Cement", 2000, "bag");

      let allItems = await repo.listItems();
      let untrackedInList = allItems.find((i) => i.id === untracked.id)!;
      let trackedInList = allItems.find((i) => i.id === tracked.id)!;

      // Filter: trackedOnly
      let trackedOnly = filterStockItems(allItems, { trackedOnly: true });
      expect(trackedOnly.some((i) => i.id === untrackedInList.id)).toBe(false);
      expect(trackedOnly.some((i) => i.id === trackedInList.id)).toBe(true);

      // Now restock untracked item
      await repo.restockItem(untracked.id, 10000);

      allItems = await repo.listItems();
      untrackedInList = allItems.find((i) => i.id === untracked.id)!;
      expect(untrackedInList.stockMilli).toBe(10000);

      // Filter: trackedOnly should now include it
      trackedOnly = filterStockItems(allItems, { trackedOnly: true });
      expect(trackedOnly.some((i) => i.id === untrackedInList.id)).toBe(true);

      // Filter: lowStockOnly (<= 5000) should include tracked (2000) but exclude untracked (10000)
      const lowStockOnly = filterStockItems(allItems, { lowStockOnly: true });
      expect(lowStockOnly.some((i) => i.id === trackedInList.id)).toBe(true);
      expect(lowStockOnly.some((i) => i.id === untrackedInList.id)).toBe(false);
    });
  });

  // =========================================================================
  // 3. VALIDATION EDGE CASES & HOSTILE INPUTS
  // =========================================================================
  describe("3. Validation Edge Cases & Hostile Inputs", () => {
    it("rejects restock with 0 quantity and preserves stock", async () => {
      const item = await createTrackedItem("zero-test", "Zero Restock Test", 8000);
      await expect(repo.restockItem(item.id, 0)).rejects.toThrow(PosError);
      expect((await repo.getItem(item.id))!.stockMilli).toBe(8000);
    });

    it("rejects negative restock quantities (-1, -500, -10000) and preserves stock", async () => {
      const item = await createTrackedItem("negative-test", "Negative Restock Test", 8000);
      await expect(repo.restockItem(item.id, -1)).rejects.toThrow(PosError);
      await expect(repo.restockItem(item.id, -500)).rejects.toThrow(PosError);
      await expect(repo.restockItem(item.id, -10000)).rejects.toThrow(PosError);
      expect((await repo.getItem(item.id))!.stockMilli).toBe(8000);
    });

    it("rejects non-integer milli values (floating point numbers) and preserves stock", async () => {
      const item = await createTrackedItem("float-test", "Float Restock Test", 8000);
      await expect(repo.restockItem(item.id, 1000.5)).rejects.toThrow(PosError);
      await expect(repo.restockItem(item.id, 0.1)).rejects.toThrow(PosError);
      await expect(repo.restockItem(item.id, 2500.999)).rejects.toThrow(PosError);
      expect((await repo.getItem(item.id))!.stockMilli).toBe(8000);
    });

    it("rejects non-finite values (NaN, Infinity, -Infinity)", async () => {
      const item = await createTrackedItem("nonfinite-test", "Non-finite Test", 5000);
      await expect(repo.restockItem(item.id, Number.NaN)).rejects.toThrow(PosError);
      await expect(repo.restockItem(item.id, Number.POSITIVE_INFINITY)).rejects.toThrow(PosError);
      await expect(repo.restockItem(item.id, Number.NEGATIVE_INFINITY)).rejects.toThrow(PosError);
      expect((await repo.getItem(item.id))!.stockMilli).toBe(5000);
    });

    it("rejects non-existent item IDs and throws descriptive PosError", async () => {
      await expect(repo.restockItem(9999999, 5000)).rejects.toThrow(/item #9999999 not found/i);
    });

    it("validates input before database lookup (fails fast on invalid quantity for non-existent item)", async () => {
      await expect(repo.restockItem(9999999, -500)).rejects.toThrow(
        /restock quantity must be a positive integer milli-unit/,
      );
    });

    it("supports large inbound quantities (1,000,000 units = 1,000,000,000 milli) without overflow", async () => {
      const item = await createTrackedItem("large-scale", "Large Scale Stock", 0);
      const largeAddition = 1_000_000_000; // 1 billion milli = 1 million units
      const res = await repo.restockItem(item.id, largeAddition);
      expect(res.stockMilli).toBe(largeAddition);

      const reloaded = await repo.getItem(item.id);
      expect(reloaded!.stockMilli).toBe(largeAddition);
      expect(formatStockQty(reloaded!.stockMilli)).toBe("1,000,000");
    });
  });

  // =========================================================================
  // 4. DOMAIN SORTING, CLASSIFICATION & FORMATTING INVARIANTS
  // =========================================================================
  describe("4. Domain Sorting & Classification Invariants", () => {
    it("compareStockAscending strictly places tracked items (ascending) before untracked items at the end", () => {
      const items: Array<{ id: number; name: string; stockMilli: number | null }> = [
        { id: 1, name: "Zebra Untracked", stockMilli: null },
        { id: 2, name: "Apple Untracked", stockMilli: null },
        { id: 3, name: "Plaster Sand", stockMilli: 8000 },
        { id: 4, name: "Overdrawn Item", stockMilli: -500 },
        { id: 5, name: "Sold Out Item", stockMilli: 0 },
        { id: 6, name: "Low Nails", stockMilli: 2500 },
      ];

      const sorted = [...items].sort(compareStockAscending);

      // Tracked items first in ascending order: -500 -> 0 -> 2500 -> 8000
      expect(sorted[0]!.id).toBe(4); // -500
      expect(sorted[1]!.id).toBe(5); // 0
      expect(sorted[2]!.id).toBe(6); // 2500
      expect(sorted[3]!.id).toBe(3); // 8000

      // Untracked items at end, sorted by name: Apple -> Zebra
      expect(sorted[4]!.id).toBe(2); // Apple Untracked
      expect(sorted[5]!.id).toBe(1); // Zebra Untracked
    });

    it("compareStockAscending breaks ties deterministically by name, then by id", () => {
      const items = [
        { id: 10, name: "B Nails", stockMilli: 5000 },
        { id: 5, name: "A Nails", stockMilli: 5000 },
        { id: 20, name: "A Nails", stockMilli: 5000 },
      ];

      const sorted = [...items].sort(compareStockAscending);
      // Same stock (5000): "A Nails" with id 5, then "A Nails" with id 20, then "B Nails" with id 10
      expect(sorted[0]!.id).toBe(5);
      expect(sorted[1]!.id).toBe(20);
      expect(sorted[2]!.id).toBe(10);
    });

    it("formatStockQty formats integer and decimal numbers cleanly", () => {
      expect(formatStockQty(null)).toBe("—");
      expect(formatStockQty(0)).toBe("0");
      expect(formatStockQty(1000)).toBe("1");
      expect(formatStockQty(1250)).toBe("1.25");
      expect(formatStockQty(1005)).toBe("1.005");
      expect(formatStockQty(50000)).toBe("50");
      expect(formatStockQty(123456789)).toBe("123456.789");
    });

    it("assertValidRestockQuantity throws on all invalid values", () => {
      expect(() => assertValidRestockQuantity(0)).toThrow(PosError);
      expect(() => assertValidRestockQuantity(-1)).toThrow(PosError);
      expect(() => assertValidRestockQuantity(1.5)).toThrow(PosError);
      expect(() => assertValidRestockQuantity(NaN)).toThrow(PosError);
      expect(() => assertValidRestockQuantity(Infinity)).toThrow(PosError);
      expect(() => assertValidRestockQuantity(1000)).not.toThrow();
    });
  });
});
