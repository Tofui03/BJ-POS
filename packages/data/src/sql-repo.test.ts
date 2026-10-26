import { describe, it, expect, beforeEach } from "vitest";
import initSqlJs from "sql.js";
import {
  createOrder,
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
    now: new Date("2026-10-24T10:00:00+08:00"),
    rng: () => 0.5,
  });
}

describe("SqlPosRepo Void Guards & Invariants", () => {
  let repo: SqlPosRepo;

  beforeEach(async () => {
    repo = await freshRepo();
  });

  it("rejects voiding a refund order with PosError", async () => {
    const item = await repo.createItem({
      key: "test_drill",
      name: "Power Drill",
      unit: "pieces",
      priceCents: 15000,
      stockMilli: 10000,
    });

    const originalOrder = await createOrder(repo, {
      method: "Cash",
      lines: [{ itemId: item.id, qtyMilli: 2000 }],
    });

    // Create a partial refund order
    const refundOrder = await repo.createRefundOrder({
      originalOrderId: originalOrder.id,
      lines: [{ itemId: item.id, qtyMilli: 1000 }],
    });

    expect(refundOrder.refundOfOrderId).toBe(originalOrder.id);
    expect(refundOrder.totalCents).toBeLessThan(0);

    // Attempting to void the refund order must be rejected with PosError
    await expect(
      repo.voidOrder(refundOrder.id, Date.now()),
    ).rejects.toThrowError(/cannot void a refund order/i);

    // And verify the error is specifically a PosError
    await expect(
      repo.voidOrder(refundOrder.id, Date.now()),
    ).rejects.toBeInstanceOf(PosError);
  });

  it("rejects voiding an original order that has active refunds with PosError", async () => {
    const item = await repo.createItem({
      key: "test_hammer",
      name: "Steel Hammer",
      unit: "pieces",
      priceCents: 3500,
      stockMilli: 5000,
    });

    const originalOrder = await createOrder(repo, {
      method: "Cash",
      lines: [{ itemId: item.id, qtyMilli: 2000 }],
    });

    // Create a refund order for 1 piece
    await repo.createRefundOrder({
      originalOrderId: originalOrder.id,
      lines: [{ itemId: item.id, qtyMilli: 1000 }],
    });

    // Attempting to void the original order that has an active refund must be rejected
    await expect(
      repo.voidOrder(originalOrder.id, Date.now()),
    ).rejects.toThrowError(/cannot void an order with active refunds/i);

    await expect(
      repo.voidOrder(originalOrder.id, Date.now()),
    ).rejects.toBeInstanceOf(PosError);
  });

  it("allows voiding a standard order with no refunds", async () => {
    const item = await repo.createItem({
      key: "test_saw",
      name: "Hand Saw",
      unit: "pieces",
      priceCents: 2000,
      stockMilli: 5000,
    });

    const originalOrder = await createOrder(repo, {
      method: "Cash",
      lines: [{ itemId: item.id, qtyMilli: 1000 }],
    });

    // Stock was deducted by 1000 -> 4000
    const stockAfterSale = await repo.getItem(item.id);
    expect(stockAfterSale?.stockMilli).toBe(4000);

    // Voiding succeeds
    const voided = await repo.voidOrder(originalOrder.id, Date.now());
    expect(voided.voidedAt).not.toBeNull();

    // Stock is restored to 5000
    const stockAfterVoid = await repo.getItem(item.id);
    expect(stockAfterVoid?.stockMilli).toBe(5000);
  });

  it("upgrades pre-existing databases with stale hardware catalog names, units, and sort_order in place", async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    const driver = createSqlJsDriver(db as never);
    // Initial boot with default hardware catalog
    await initRepo(driver, { seedDemoOrders: false });
    // Simulate pre-cleanup database state
    await driver.run("UPDATE items SET name = ?, unit = ? WHERE key = ?", [
      "Black Pipe — 2 1/2'' (A)",
      "pcs",
      "hw_148",
    ]);
    await driver.run("UPDATE items SET unit = ? WHERE key = ?", ["pcs", "hw_83"]);

    // Reboot repo against existing DB
    const upgradedRepo = await initRepo(driver, { seedDemoOrders: false });
    const items = await upgradedRepo.listItems();
    expect(items).toHaveLength(253);
    expect(items.find((i) => i.key === "hw_148")?.name).toBe("Black Pipe — 2 1/2'' (AA)");
    expect(items.find((i) => i.key === "hw_83")?.unit).toBe("batang");
  });
});
