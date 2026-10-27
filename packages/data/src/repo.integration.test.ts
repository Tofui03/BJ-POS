import { describe, it, expect, beforeEach } from "vitest";
import initSqlJs from "sql.js";
import { createOrder, computeStats, periodRange, planPartialRefund, LEGACY_SEED_ITEMS, type Order, type PaymentMethod } from "@yf/core";
import { createSqlJsDriver, initRepo, SqlPosRepo, migrateRepaymentsMethod } from "./index.js";

// End-to-end through real SQLite (sql.js in node): schema, seed, tiers, orders.

async function freshRepo(seedDemo = false): Promise<SqlPosRepo> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  const driver = createSqlJsDriver(db as never);
  return initRepo(driver, {
    seedDemoOrders: seedDemo,
    seedItems: LEGACY_SEED_ITEMS,
    now: new Date(2026, 5, 19),
    rng: () => 0.5,
  });
}

describe("SqlPosRepo over sql.js", () => {
  let repo: SqlPosRepo;
  beforeEach(async () => {
    repo = await freshRepo();
  });

  it("backfills tracks_tail when the column is first added to an existing DB", async () => {
    // Simulate a pre-tracks_tail database: an items table without the column,
    // already populated, so the seed block won't run on init.
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    const driver = createSqlJsDriver(db as never);
    await driver.run(
      `CREATE TABLE items (
        id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL DEFAULT 1,
        key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, image TEXT NOT NULL DEFAULT '',
        unit TEXT NOT NULL DEFAULT 'each', tint TEXT NOT NULL DEFAULT '#eee',
        price_cents INTEGER NOT NULL CHECK (price_cents >= 0), active INTEGER NOT NULL DEFAULT 1)`,
    );
    await driver.run("INSERT INTO items (key, name, unit, price_cents) VALUES ('tilapia','Ikan Tilapia','kg',2500)");
    await driver.run("INSERT INTO items (key, name, unit, price_cents) VALUES ('fresh_milk_1l','Fresh Milk 1 L','bottle',680)");

    const r = await initRepo(driver);
    expect((await r.getItemByKey("tilapia"))!.tracksTail).toBe(true);
    expect((await r.getItemByKey("fresh_milk_1l"))!.tracksTail).toBe(false);
  });

  it("widens the orders.method CHECK so Credit works on a pre-Credit DB", async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    const driver = createSqlJsDriver(db as never);
    // Old orders table: CHECK without 'Credit'. CREATE TABLE IF NOT EXISTS in init
    // won't replace it, so the migration must rebuild it.
    await driver.run(
      `CREATE TABLE orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL DEFAULT 1,
        ts INTEGER NOT NULL, total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
        method TEXT NOT NULL CHECK (method IN ('Cash','Bank','QR')))`,
    );
    const r = await initRepo(driver, { seedItems: LEGACY_SEED_ITEMS });
    const fish = (await r.getItemByKey("tilapia"))!;
    const order = await createOrder(r, {
      method: "Credit", contractorName: "Pak Abu", lines: [{ itemId: fish.id, qtyMilli: 1000, tailCount: 1 }],
    });
    expect(order.method).toBe("Credit");
    expect(await r.listCredits(1, { outstandingOnly: true })).toHaveLength(1);
  });

  it("seeds the catalogue with tiers", async () => {
    const items = await repo.listItems();
    expect(items.length).toBe(10);
    const fish = items.find((i) => i.key === "tilapia")!;
    expect(fish.tiers).toHaveLength(1);
    expect(fish.tiers[0]).toMatchObject({ minQtyMilli: 10000, priceCents: 2300 });
  });

  it("prices an order with the tier discount and persists snapshots", async () => {
    const fish = (await repo.getItemByKey("tilapia"))!;
    const order = await createOrder(repo, {
      method: "Cash",
      ts: 1000,
      lines: [{ itemId: fish.id, qtyMilli: 30000 }],
    });
    expect(order.totalCents).toBe(69000); // 30kg @ RM23 (>=10kg tier)
    expect(order.items[0]).toMatchObject({
      priceCents: 2300,
      qtyMilli: 30000,
      amountCents: 69000,
      bulkPrice: true,
      bulkMinQtyMilli: 10000,
    });

    // snapshot survives a later price change
    await repo.updateItem(fish.id, { priceCents: 9999 });
    const again = (await repo.getOrder(order.id))!;
    expect(again.items[0]!.priceCents).toBe(2300);
  });

  it("seeds tracksTail and round-trips a tail count, independent of qty", async () => {
    const fish = (await repo.getItemByKey("tilapia"))!;
    expect(fish.tracksTail).toBe(true); // fish/chicken are seeded as tail-tracking
    const milk = (await repo.getItemByKey("fresh_milk_1l"))!;
    expect(milk.tracksTail).toBe(false);

    const order = await createOrder(repo, {
      method: "Cash",
      ts: 1000,
      lines: [
        { itemId: fish.id, qtyMilli: 12000, tailCount: 38 },
        { itemId: milk.id, qtyMilli: 2000, tailCount: 99 }, // ignored: not tracksTail
      ],
    });
    const stored = (await repo.getOrder(order.id))!;
    const fishLine = stored.items.find((l) => l.itemId === fish.id)!;
    const milkLine = stored.items.find((l) => l.itemId === milk.id)!;
    expect(fishLine).toMatchObject({ qtyMilli: 12000, tailCount: 38 });
    expect(milkLine.tailCount).toBe(0); // non-tracking item never stores a tail
  });

  it("records, lists and clears credits for a pay-later sale", async () => {
    const fish = (await repo.getItemByKey("tilapia"))!;
    const o1 = await createOrder(repo, {
      method: "Credit", ts: 1000, contractorName: "Pak Abu",
      lines: [{ itemId: fish.id, qtyMilli: 2000, tailCount: 2 }],
    });
    const o2 = await createOrder(repo, {
      method: "Credit", ts: 2000, contractorName: "Pak Abu",
      lines: [{ itemId: fish.id, qtyMilli: 1000, tailCount: 1 }],
    });
    // A Cash sale never produces a credit.
    await createOrder(repo, { method: "Cash", ts: 3000, lines: [{ itemId: fish.id, qtyMilli: 1000, tailCount: 1 }] });

    // Credit orders carry the creditor name; cash orders don't.
    expect(o1.contractorName).toBe("Pak Abu");
    expect((await repo.getOrder(o1.id))!.contractorName).toBe("Pak Abu");
    const listed = await repo.listOrders(0, 9999, 1);
    expect(listed.find((o) => o.method === "Cash")!.contractorName).toBeUndefined();

    const open = await repo.listCredits(1, { outstandingOnly: true });
    expect(open).toHaveLength(2);
    expect(open.map((c) => c.orderId).sort()).toEqual([o1.id, o2.id].sort());
    expect(open.every((c) => c.name === "Pak Abu" && c.clearedAt === null)).toBe(true);
    expect(open.find((c) => c.orderId === o1.id)!.amountCents).toBe(o1.totalCents);

    await repo.clearCreditsByName("Pak Abu", 9999, 1);
    expect(await repo.listCredits(1, { outstandingOnly: true })).toHaveLength(0);
    const all = await repo.listCredits(1);
    expect(all).toHaveLength(2);
    expect(all.every((c) => c.clearedAt === 9999)).toBe(true);
  });

  it("base price applies below the tier threshold", async () => {
    const fish = (await repo.getItemByKey("tilapia"))!;
    const order = await createOrder(repo, {
      method: "QR",
      lines: [{ itemId: fish.id, qtyMilli: 2000 }],
    });
    expect(order.items[0]!.priceCents).toBe(2500); // RM25 base (below 10kg)
    expect(order.items[0]!.bulkPrice).toBe(false);
  });

  it("CRUD + soft delete hides items from the till", async () => {
    const created = await repo.createItem({ key: "lime", name: "Lime", priceCents: 300 });
    expect((await repo.listItems()).some((i) => i.key === "lime")).toBe(true);
    await repo.setItemActive(created.id, false);
    expect((await repo.listItems()).some((i) => i.key === "lime")).toBe(false);
    expect((await repo.listItems(true)).some((i) => i.key === "lime")).toBe(true);
  });

  it("setItemOrder reorders the catalogue, and new items land last", async () => {
    const a = await repo.createItem({ key: "order-a", name: "A", priceCents: 100 });
    const b = await repo.createItem({ key: "order-b", name: "B", priceCents: 100 });
    const c = await repo.createItem({ key: "order-c", name: "C", priceCents: 100 });

    await repo.setItemOrder([c.id, b.id, a.id]);
    const reordered = (await repo.listItems()).filter((i) => [a.id, b.id, c.id].includes(i.id));
    expect(reordered.map((i) => i.id)).toEqual([c.id, b.id, a.id]);

    const d = await repo.createItem({ key: "order-d", name: "D", priceCents: 100 });
    const withD = (await repo.listItems()).filter((i) => [a.id, b.id, c.id, d.id].includes(i.id));
    expect(withD.map((i) => i.id)).toEqual([c.id, b.id, a.id, d.id]);
  });

  it("editing tiers replaces the whole set", async () => {
    const fish = (await repo.getItemByKey("tilapia"))!;
    await repo.setTiers(fish.id, [
      { minQtyMilli: 10000, priceCents: 1700 },
      { minQtyMilli: 50000, priceCents: 1200 },
    ]);
    const updated = (await repo.getItem(fish.id))!;
    expect(updated.tiers).toHaveLength(2);
    expect(updated.tiers.map((t) => t.priceCents)).toEqual([1700, 1200]);
  });

  it("rejects negative prices before persistence", async () => {
    const fish = (await repo.getItemByKey("tilapia"))!;
    await expect(
      repo.createItem({ key: "bad-price", name: "Bad Price", priceCents: -1 }),
    ).rejects.toThrow("priceCents");
    await expect(repo.updateItem(fish.id, { priceCents: -1 })).rejects.toThrow("priceCents");
    await expect(
      repo.setTiers(fish.id, [{ minQtyMilli: 10000, priceCents: -1 }]),
    ).rejects.toThrow("tier priceCents");
  });

  it("computes period stats from persisted orders", async () => {
    const fish = (await repo.getItemByKey("tilapia"))!;
    const now = new Date(2026, 5, 19, 12).getTime();
    await createOrder(repo, { method: "Cash", ts: now, lines: [{ itemId: fish.id, qtyMilli: 1000 }] });
    await createOrder(repo, { method: "QR", ts: now, lines: [{ itemId: fish.id, qtyMilli: 1000 }] });
    const [s, e] = periodRange("today", new Date(2026, 5, 19, 15));
    const orders = await repo.listOrders(s, e);
    const stats = computeStats(orders, "today");
    expect(stats.count).toBe(2);
    expect(stats.totalCents).toBe(5000); // 2 x RM25
    expect(stats.byMethod.Cash.count).toBe(1);
    expect(stats.byMethod.QR.count).toBe(1);
  });
});

describe("demo seeding", () => {
  it("produces orders for the Sales report", async () => {
    const repo = await freshRepo(true);
    const orders = await repo.listOrders(0, Number.MAX_SAFE_INTEGER);
    expect(orders.length).toBeGreaterThan(0);
  });
});

describe("slim-schema migration", () => {
  it("rebuilds legacy items/order_items tables and re-links snapshot lines by name", async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    const driver = createSqlJsDriver(db as never);
    // A populated pre-slim DB: items with company_id/tint, order_items with the
    // per-line snapshots, no tail_count yet, and one line whose item link was
    // lost (NULL item_id) but whose name still matches the catalogue.
    await driver.run(
      `CREATE TABLE items (
        id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL DEFAULT 1,
        key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, image TEXT NOT NULL DEFAULT '',
        unit TEXT NOT NULL DEFAULT 'each', tint TEXT NOT NULL DEFAULT '#eee',
        price_cents INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
        tracks_tail INTEGER NOT NULL DEFAULT 0)`,
    );
    await driver.run(
      "INSERT INTO items (key, name, unit, price_cents, tracks_tail) VALUES ('tilapia','Ikan Tilapia','kg',2500,1)",
    );
    await driver.run(
      `CREATE TABLE order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL,
        item_id INTEGER, name TEXT NOT NULL, image TEXT NOT NULL DEFAULT '',
        unit TEXT NOT NULL DEFAULT 'each', tint TEXT NOT NULL DEFAULT '#eee',
        price_cents INTEGER NOT NULL, qty_milli INTEGER NOT NULL,
        bulk_price INTEGER NOT NULL DEFAULT 0, bulk_min_qty_milli INTEGER)`,
    );
    await driver.run(
      "INSERT INTO order_items (order_id, item_id, name, price_cents, qty_milli) VALUES (1, 1, 'Ikan Tilapia', 2500, 2000)",
    );
    await driver.run(
      "INSERT INTO order_items (order_id, item_id, name, price_cents, qty_milli) VALUES (1, NULL, 'Ikan Tilapia', 2300, 11000)",
    );

    await initRepo(driver);

    const itemCols = (await driver.all("PRAGMA table_info(items)")).map((c) => String(c.name));
    expect(itemCols).not.toContain("tint");
    expect(itemCols).not.toContain("company_id");
    const lineCols = (await driver.all("PRAGMA table_info(order_items)")).map((c) => String(c.name));
    expect(lineCols).toEqual([
      "id",
      "order_id",
      "item_id",
      "price_cents",
      "qty_milli",
      "tail_count",
      "orig_price_cents",
      "custom_name",
      "unit",
    ]);
    const lines = await driver.all("SELECT item_id, tail_count FROM order_items ORDER BY id");
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => Number(l.item_id) === 1 && Number(l.tail_count) === 0)).toBe(true);
  });
});

describe("bulk-tier annotation (derived at read time)", () => {
  it("marks a line bulk when its price matches a tier whose threshold the qty met", async () => {
    const repo = await freshRepo();
    const fish = (await repo.getItemByKey("tilapia"))!; // tier: >=10kg -> RM23
    const order = await createOrder(repo, {
      method: "QR", ts: 1000, lines: [{ itemId: fish.id, qtyMilli: 11000 }],
    });
    expect((await repo.getOrder(order.id))!.items[0]).toMatchObject({
      bulkPrice: true,
      bulkMinQtyMilli: 10000,
    });
  });

  it("leaves below-threshold (base-price) lines unannotated", async () => {
    const repo = await freshRepo();
    const fish = (await repo.getItemByKey("tilapia"))!;
    const order = await createOrder(repo, {
      method: "Cash", ts: 1000, lines: [{ itemId: fish.id, qtyMilli: 2000 }],
    });
    const line = (await repo.getOrder(order.id))!.items[0]!;
    expect(line.bulkPrice).toBe(false);
    expect(line.bulkMinQtyMilli).toBeUndefined();
  });
});

describe("invoice numbers", () => {
  let repo: SqlPosRepo;
  beforeEach(async () => {
    repo = await freshRepo();
  });

  async function sell(
    businessDate: string,
    ts: number,
    method: PaymentMethod = "Cash",
    contractorName?: string,
  ): Promise<Order> {
    const fish = (await repo.getItemByKey("tilapia"))!;
    return createOrder(repo, {
      method,
      contractorName,
      ts,
      businessDate,
      lines: [{ itemId: fish.id, qtyMilli: 1000, tailCount: 1 }],
    });
  }

  it("runs distinct A-0001 and B-0001 sequences within a business month and restarts the next month", async () => {
    // Walk-in / Cash / Non-credit: A-0001, A-0002...
    expect((await sell("2026-08-10", 1000, "Cash")).invNo).toBe("A-0001");
    expect((await sell("2026-08-10", 2000, "Bank")).invNo).toBe("A-0002");

    // Contractor / Credit: B-0001, B-0002...
    expect((await sell("2026-08-10", 2500, "Credit", "Pak Abu")).invNo).toBe("B-0001");
    expect((await sell("2026-08-11", 2600, "Credit", "Ah Meng")).invNo).toBe("B-0002");

    expect((await sell("2026-08-31", 3000, "QR")).invNo).toBe("A-0003");

    // September: both sequences reset to 0001
    expect((await sell("2026-09-01", 4000, "Cash")).invNo).toBe("A-0001");
    expect((await sell("2026-09-01", 4500, "Credit", "Pak Abu")).invNo).toBe("B-0001");
    expect((await sell("2026-09-02", 5000, "Bank")).invNo).toBe("A-0002");
    expect((await sell("2026-09-02", 5500, "Credit", "Ah Meng")).invNo).toBe("B-0002");

    // Late August sales carry on where August left off
    expect((await sell("2026-08-12", 6000, "Cash")).invNo).toBe("A-0004");
    expect((await sell("2026-08-12", 6500, "Credit", "Pak Abu")).invNo).toBe("B-0003");

    // Year-crossing transition: December 31, 2026 -> January 1, 2027 resets to 0001
    expect((await sell("2026-12-31", 7000, "Cash")).invNo).toBe("A-0001");
    expect((await sell("2026-12-31", 7500, "Credit", "Pak Abu")).invNo).toBe("B-0001");
    expect((await sell("2027-01-01", 8000, "Cash")).invNo).toBe("A-0001");
    expect((await sell("2027-01-01", 8500, "Credit", "Pak Abu")).invNo).toBe("B-0001");
  });

  it("isolates A and B sequences across companies within the same business month", async () => {
    const fish = (await repo.getItemByKey("tilapia"))!;
    const c1o1 = await createOrder(repo, {
      companyId: 1,
      businessDate: "2026-10-01",
      method: "Cash",
      lines: [{ itemId: fish.id, qtyMilli: 1000 }],
    });
    expect(c1o1.invNo).toBe("A-0001");

    // Company 2 starts its own sequence at A-0001
    const c2o1 = await createOrder(repo, {
      companyId: 2,
      businessDate: "2026-10-01",
      method: "Cash",
      lines: [{ itemId: fish.id, qtyMilli: 1000 }],
    });
    expect(c2o1.invNo).toBe("A-0001");

    // Company 2 credit sale starts at B-0001
    const c2credit = await createOrder(repo, {
      companyId: 2,
      businessDate: "2026-10-01",
      method: "Credit",
      contractorName: "Contractor Ali",
      lines: [{ itemId: fish.id, qtyMilli: 1000 }],
    });
    expect(c2credit.invNo).toBe("B-0001");
  });

  it("stamps the number once — reads, and a void, never change it", async () => {
    const order = await sell("2026-08-10", 1000);
    expect((await repo.getOrder(order.id))!.invNo).toBe("A-0001");

    const voided = await sell("2026-08-10", 2000);
    expect(voided.invNo).toBe("A-0002");
    await repo.voidOrder(voided.id, Date.now());
    expect((await repo.getOrder(voided.id))!.invNo).toBe("A-0002");

    // The cancelled number is spent: the next sale takes max + 1, leaving a gap.
    expect((await sell("2026-08-10", 3000)).invNo).toBe("A-0003");
  });

  it("puts the credited order's number on its credit row", async () => {
    const fish = (await repo.getItemByKey("tilapia"))!;
    const order = await createOrder(repo, {
      method: "Credit",
      contractorName: "Pak Abu",
      ts: 1000,
      businessDate: "2026-08-10",
      lines: [{ itemId: fish.id, qtyMilli: 1000, tailCount: 1 }],
    });
    const [credit] = await repo.listCredits(1, { outstandingOnly: true });
    expect(credit).toMatchObject({ orderId: order.id, invNo: order.invNo });
  });

  it("leaves pre-existing orders unnumbered — MM-1000 starts with the first new sale", async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    const driver = createSqlJsDriver(db as never);
    // A pre-inv_no database: business dates already stamped and the current
    // method CHECK, so nothing rebuilds the table before inv_no is added.
    await driver.run(
      `CREATE TABLE orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL DEFAULT 1,
        ts INTEGER NOT NULL, business_date TEXT,
        total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
        method TEXT NOT NULL CHECK (method IN ('Cash','Bank','QR','Credit')),
        voided_at INTEGER)`,
    );
    const existing = ["2026-08-09", "2026-09-02", "2026-08-10"];
    for (const [index, businessDate] of existing.entries()) {
      await driver.run(
        "INSERT INTO orders (ts, business_date, total_cents, method) VALUES (?, ?, ?, 'Cash')",
        [1000 + index, businessDate, 2500],
      );
    }

    const repo = await initRepo(driver, { seedItems: LEGACY_SEED_ITEMS });

    // Sales from before the update are never renumbered (receipts were already
    // printed with the order id) — they display the id and stay NULL in the DB.
    const rows = await driver.all("SELECT inv_no FROM orders ORDER BY id");
    expect(rows.map((r) => r.inv_no)).toEqual([null, null, null]);
    expect((await repo.getOrder(1))!.invNo).toBe("1");

    // The first sale after the update still opens its month at 1000; legacy
    // NULL rows in the same month don't disturb the sequence.
    const fish = (await repo.getItemByKey("tilapia"))!;
    const order = await createOrder(repo, {
      method: "Cash",
      ts: 9000,
      businessDate: "2026-08-11",
      lines: [{ itemId: fish.id, qtyMilli: 1000, tailCount: 1 }],
    });
    expect(order.invNo).toBe("A-0001");
  });
});

describe("Close Day, void, settings, outbox", () => {
  let repo: SqlPosRepo;
  beforeEach(async () => {
    repo = await freshRepo();
  });

  async function sell(businessDate: string, ts: number): Promise<number> {
    const fish = (await repo.getItemByKey("tilapia"))!;
    const o = await createOrder(repo, {
      method: "Cash",
      ts,
      businessDate,
      companyId: 1,
      lines: [{ itemId: fish.id, qtyMilli: 1000, tailCount: 1 }],
    });
    return o.id;
  }

  it("stamps business_date on orders (default: ts's local day)", async () => {
    const fish = (await repo.getItemByKey("tilapia"))!;
    const ts = new Date(2026, 6, 13, 9, 0).getTime();
    const o = await createOrder(repo, {
      method: "Cash",
      ts,
      lines: [{ itemId: fish.id, qtyMilli: 1000, tailCount: 1 }],
    });
    expect(o.businessDate).toBe("2026-07-13");
    expect(o.voidedAt).toBeNull();
  });

  it("closes a day once and refuses a second close", async () => {
    const c = await repo.closeDay("2026-07-13", { companyId: 1, at: new Date(2026, 6, 13, 21).getTime() });
    expect(c.businessDate).toBe("2026-07-13");
    expect(c.auto).toBe(false);
    await expect(repo.closeDay("2026-07-13", { companyId: 1 })).rejects.toThrow(/already closed/);
  });

  it("reopenDay pulls same-calendar-day pushed sales back", async () => {
    const dayTs = new Date(2026, 6, 13, 12, 0).getTime();
    await sell("2026-07-13", dayTs);
    await repo.closeDay("2026-07-13", { companyId: 1 });
    // Sale after close, same calendar day -> stamped to the 14th.
    const lateTs = new Date(2026, 6, 13, 17, 0).getTime();
    const pushedId = await sell("2026-07-14", lateTs);
    // A genuine next-day sale must NOT be pulled back on reopen.
    const nextDayId = await sell("2026-07-14", new Date(2026, 6, 14, 9, 0).getTime());

    await repo.reopenDay("2026-07-13", 1);
    expect(await repo.getDayClose("2026-07-13", 1)).toBeNull();
    expect((await repo.getOrder(pushedId))!.businessDate).toBe("2026-07-13");
    expect((await repo.getOrder(nextDayId))!.businessDate).toBe("2026-07-14");
  });

  it("lists unclosed past days with orders", async () => {
    await sell("2026-07-11", new Date(2026, 6, 11, 10, 0).getTime());
    await sell("2026-07-12", new Date(2026, 6, 12, 10, 0).getTime());
    await repo.closeDay("2026-07-11", { companyId: 1 });
    expect(await repo.listUnclosedDays("2026-07-13", 1)).toEqual(["2026-07-12"]);
  });

  it("voidOrder excludes the sale from stats and drops its credit", async () => {
    const fish = (await repo.getItemByKey("tilapia"))!;
    const o = await createOrder(repo, {
      method: "Credit",
      contractorName: "Ah Seng",
      ts: new Date(2026, 6, 13, 10, 0).getTime(),
      businessDate: "2026-07-13",
      lines: [{ itemId: fish.id, qtyMilli: 2000, tailCount: 2 }],
    });
    expect((await repo.listCredits(1, { outstandingOnly: true })).length).toBe(1);

    await repo.voidOrder(o.id, Date.now());
    const voided = (await repo.getOrder(o.id))!;
    expect(voided.voidedAt).not.toBeNull();
    expect((await repo.listCredits(1, { outstandingOnly: true })).length).toBe(0);

    const day = await repo.listOrdersByBusinessDate("2026-07-13", "2026-07-13", 1);
    expect(day.length).toBe(1); // still listed (marked void) ...
    expect(computeStats(day, "today").totalCents).toBe(0); // ... but earns nothing
  });

  it("settings upsert and outbox queue round-trip", async () => {
    expect(await repo.getSetting("pin")).toBeNull();
    await repo.setSetting("pin", "1234");
    await repo.setSetting("pin", "9999");
    expect(await repo.getSetting("pin")).toBe("9999");

    const id = await repo.queueEmail({
      businessDate: "2026-07-13",
      subject: "Daily sales",
      body: "hello",
      attachmentName: "sales.xlsx",
      attachmentB64: "AAAA",
      channel: "drive",
    });
    const rows = await repo.listOutbox("2026-07-13");
    expect(rows[0]!.id).toBe(id);
    expect(rows[0]!.channel).toBe("drive");
    expect(rows[0]!.sentAt).toBeNull();

    // Re-queueing the same businessDate + attachmentName updates the existing row in place.
    const id2 = await repo.queueEmail({
      businessDate: "2026-07-13",
      subject: "Daily sales updated",
      body: "updated body",
      attachmentName: "sales.xlsx",
      attachmentB64: "BBBB",
      channel: "drive",
    });
    expect(id2).toBe(id);
    const updatedRows = await repo.listOutbox("2026-07-13");
    expect(updatedRows).toHaveLength(1);
    expect(updatedRows[0]!.subject).toBe("Daily sales updated");
  });

  it("persists line discounts, custom Lain-lain names, and whole-bill discounts", async () => {
    const fish = (await repo.getItemByKey("tilapia"))!;
    const order = await createOrder(repo, {
      method: "Cash",
      businessDate: "2026-07-13",
      discountCents: 300,
      lines: [
        { itemId: fish.id, qtyMilli: 2000, unitPriceCents: 2200 },
        { key: "hw_lain_lain", qtyMilli: 1000, unitPriceCents: 800, customName: "Lain-lain — Skru" },
      ],
    });
    // 2 * 2200 = 4400, + 800 = 5200 subtotal; - 300 discount = 4900 total
    expect(order.subtotalCents).toBe(5200);
    expect(order.discountCents).toBe(300);
    expect(order.totalCents).toBe(4900);
    expect(order.items[0]).toMatchObject({
      priceCents: 2200,
      origPriceCents: 2500,
      amountCents: 4400,
    });
    expect(order.items[1]).toMatchObject({
      name: "Lain-lain — Skru",
      customName: "Lain-lain — Skru",
      priceCents: 800,
      amountCents: 800,
    });
  });
});

describe("stock tracking", () => {
  let repo: SqlPosRepo;
  beforeEach(async () => {
    repo = await freshRepo();
  });

  const stockedItem = () =>
    repo.createItem({ key: "cup-drink", name: "Cup Drink", unit: "cup", priceCents: 500, stockMilli: 5000 });

  it("deducts stock when a sale is made, but only for tracked items", async () => {
    const cup = await stockedItem();
    const fish = (await repo.getItemByKey("tilapia"))!; // no stock set — untracked

    await createOrder(repo, {
      method: "Cash",
      ts: 1000,
      lines: [
        { itemId: cup.id, qtyMilli: 2000 },
        { itemId: fish.id, qtyMilli: 3000, tailCount: 1 },
      ],
    });
    expect((await repo.getItem(cup.id))!.stockMilli).toBe(3000);
    expect((await repo.getItem(fish.id))!.stockMilli).toBeNull();
  });

  it("rejects a sale that oversells the remaining stock", async () => {
    const cup = await stockedItem();
    await expect(
      createOrder(repo, { method: "Cash", ts: 1000, lines: [{ itemId: cup.id, qtyMilli: 6000 }] }),
    ).rejects.toThrow(/stock/);
    // The whole order rolled back: nothing sold, nothing deducted.
    expect((await repo.getItem(cup.id))!.stockMilli).toBe(5000);
    expect((await repo.listOrders(0, Number.MAX_SAFE_INTEGER)).length).toBe(0);
  });

  it("restores stock when a sale is voided — once, even on a double void", async () => {
    const cup = await stockedItem();
    const order = await createOrder(repo, {
      method: "Cash",
      ts: 1000,
      lines: [{ itemId: cup.id, qtyMilli: 2000 }],
    });
    expect((await repo.getItem(cup.id))!.stockMilli).toBe(3000);

    await repo.voidOrder(order.id, 2000);
    expect((await repo.getItem(cup.id))!.stockMilli).toBe(5000);
    await repo.voidOrder(order.id, 3000); // double void must not restore again
    expect((await repo.getItem(cup.id))!.stockMilli).toBe(5000);
  });

  it("updateItem can set, change and clear the stock count", async () => {
    const cup = await stockedItem();
    await repo.updateItem(cup.id, { stockMilli: 9000 });
    expect((await repo.getItem(cup.id))!.stockMilli).toBe(9000);
    // Absent key keeps the current stock; explicit null stops tracking.
    await repo.updateItem(cup.id, { name: "Cup Drink XL" });
    expect((await repo.getItem(cup.id))!.stockMilli).toBe(9000);
    await repo.updateItem(cup.id, { stockMilli: null });
    expect((await repo.getItem(cup.id))!.stockMilli).toBeNull();
  });

  describe("atomic stock inbound (restockItem)", () => {
    it("atomically increments stock on an existing tracked item", async () => {
      const cup = await stockedItem();
      const res = await repo.restockItem(cup.id, 10000);
      expect(res.stockMilli).toBe(15000);
      const reloaded = await repo.getItem(cup.id);
      expect(reloaded!.stockMilli).toBe(15000);
    });

    it("progressively onboards untracked items (null -> addQtyMilli)", async () => {
      const fish = (await repo.getItemByKey("tilapia"))!;
      expect(fish.stockMilli).toBeNull();

      const res = await repo.restockItem(fish.id, 25000, "Initial batch delivery");
      expect(res.stockMilli).toBe(25000);

      const reloaded = await repo.getItem(fish.id);
      expect(reloaded!.stockMilli).toBe(25000);
    });

    it("atomically handles concurrent restock operations without lost updates", async () => {
      const cup = await stockedItem(); // initial stock: 5000
      const additions = [1000, 2000, 3000, 4000, 5000, 10000];
      const expectedTotal = 5000 + additions.reduce((a, b) => a + b, 0); // 30000

      await Promise.all(additions.map((qty) => repo.restockItem(cup.id, qty)));

      const reloaded = await repo.getItem(cup.id);
      expect(reloaded!.stockMilli).toBe(expectedTotal);
    });

    it("rejects non-positive, float, or invalid restock quantities", async () => {
      const cup = await stockedItem();
      await expect(repo.restockItem(cup.id, 0)).rejects.toThrow();
      await expect(repo.restockItem(cup.id, -1000)).rejects.toThrow();
      await expect(repo.restockItem(cup.id, 1500.5)).rejects.toThrow();
      // Stock should remain unmodified
      expect((await repo.getItem(cup.id))!.stockMilli).toBe(5000);
    });

    it("throws PosError if item does not exist", async () => {
      await expect(repo.restockItem(999999, 5000)).rejects.toThrow(/not found/i);
    });
  });
});


describe("close-day future guard", () => {
  it("refuses to close a business day before it arrives on the wall clock", async () => {
    const repo = await freshRepo();
    const at = new Date(2026, 6, 13, 21).getTime(); // local 2026-07-13, 9pm
    await repo.closeDay("2026-07-13", { at }); // today: fine
    // Sales after the close carry into 2026-07-14 — but that day can't be
    // closed until the clock reaches it.
    await expect(repo.closeDay("2026-07-14", { at })).rejects.toThrow(/before that day arrives/);
    const nextDay = new Date(2026, 6, 14, 8).getTime();
    await expect(repo.closeDay("2026-07-14", { at: nextDay })).resolves.toBeTruthy();
  });

  it("seeds the default Borneo Jasa hardware catalogue (253 items)", async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    const driver = createSqlJsDriver(db as never);
    const repo = await initRepo(driver);
    const companies = await repo.listCompanies();
    expect(companies[0]?.name).toBe("Borneo Jasa Sdn. Bhd.");
    const items = await repo.listItems();
    expect(items.length).toBe(253);
    const cement = await repo.getItemByKey("hw_1");
    expect(cement).toMatchObject({ name: "Cement — 50 kg", unit: "bag", priceCents: 2400 });
    const chromePipeFt = await repo.getItemByKey("hw_158_ft");
    expect(chromePipeFt).toMatchObject({ name: "Chrome Pipe — 3/4'' (per ft)", unit: "ft", priceCents: 350 });
  });

  describe("contractors, credit repayments & data migration", () => {
    it("migrates historical distinct creditor names into contractors directory on init without data loss", async () => {
      const SQL = await initSqlJs();
      const db = new SQL.Database();
      const driver = createSqlJsDriver(db as never);

      // Simulate historical database with orders and credits table containing distinct names
      await driver.run(`
        CREATE TABLE orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL DEFAULT 1,
          ts INTEGER NOT NULL, total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
          method TEXT NOT NULL
        )
      `);
      await driver.run(`
        CREATE TABLE credits (
          id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL DEFAULT 1,
          order_id INTEGER NOT NULL, name TEXT NOT NULL,
          amount_cents INTEGER NOT NULL, date INTEGER NOT NULL, is_clear INTEGER
        )
      `);
      await driver.run("INSERT INTO orders (id, ts, total_cents, method) VALUES (1, 1000, 5000, 'Credit')");
      await driver.run("INSERT INTO orders (id, ts, total_cents, method) VALUES (2, 2000, 8000, 'Credit')");
      await driver.run("INSERT INTO orders (id, ts, total_cents, method) VALUES (3, 3000, 3000, 'Credit')");
      await driver.run("INSERT INTO credits (id, order_id, name, amount_cents, date) VALUES (1, 1, 'Ah Meng', 5000, 1000)");
      await driver.run("INSERT INTO credits (id, order_id, name, amount_cents, date) VALUES (2, 2, 'Pak Abu', 8000, 2000)");
      await driver.run("INSERT INTO credits (id, order_id, name, amount_cents, date) VALUES (3, 3, 'Ah Meng', 3000, 3000)");

      const r = await initRepo(driver, { seedItems: LEGACY_SEED_ITEMS });
      const contractorsList = await r.listContractors();
      expect(contractorsList.length).toBe(2);
      expect(contractorsList.map((c) => c.name).sort()).toEqual(["Ah Meng", "Pak Abu"]);
      expect(contractorsList.every((c) => c.active)).toBe(true);

      // Verify no data loss in historical credits
      const openCredits = await r.listCredits(1);
      expect(openCredits.length).toBe(3);
    });

    it("supports contractor CRUD and deactivation filtering", async () => {
      const r = await freshRepo();
      const created = await r.createContractor({
        name: "Chong Construction",
        phone: "013-1234567",
        tin: "C2837492019",
        address: "Lot 5, Commercial Centre",
      });
      expect(created.id).toBeGreaterThan(0);
      expect(created.name).toBe("Chong Construction");
      expect(created.phone).toBe("013-1234567");
      expect(created.tin).toBe("C2837492019");
      expect(created.address).toBe("Lot 5, Commercial Centre");
      expect(created.active).toBe(true);

      // Rejects duplicate name
      await expect(r.createContractor({ name: "  chong construction  " })).rejects.toThrow(/already exists/);

      // Update contractor
      const updated = await r.updateContractor(created.id, {
        phone: "013-9999999",
        tin: "C9999999999",
        address: "Lot 8, Industrial Estate",
      });
      expect(updated.phone).toBe("013-9999999");
      expect(updated.tin).toBe("C9999999999");
      expect(updated.address).toBe("Lot 8, Industrial Estate");

      // Deactivate contractor
      await r.setContractorActive(created.id, false);
      expect((await r.getContractor(created.id))!.active).toBe(false);

      // Active only filter excludes deactivated contractor
      const activeList = await r.listContractors(1, { activeOnly: true });
      expect(activeList.find((c) => c.id === created.id)).toBeUndefined();

      // All list includes deactivated contractor
      const allList = await r.listContractors(1);
      expect(allList.find((c) => c.id === created.id)).toBeDefined();
    });

    it("settles debts atomically, updating credit clearance, linking payment method and timestamp, and updating order credit state", async () => {
      const r = await freshRepo();
      const fish = (await r.getItemByKey("tilapia"))!;
      const order = await createOrder(r, {
        method: "Credit",
        contractorName: "Ah Meng",
        ts: 1000,
        businessDate: "2026-08-10",
        lines: [{ itemId: fish.id, qtyMilli: 2000, tailCount: 2 }],
      });

      const [openCredit] = await r.listCredits(1, { outstandingOnly: true });
      expect(openCredit).toBeDefined();
      expect(openCredit!.clearedAt).toBeNull();
      expect(openCredit!.clearedMethod).toBeNull();

      const orderBefore = (await r.getOrder(order.id))!;
      expect(orderBefore.creditClearedAt).toBeNull();

      // Settle repayment with Bank at ts 5000 on businessDate 2026-08-15
      const repayment = await r.recordRepayment({
        creditId: openCredit!.id,
        method: "Bank",
        ts: 5000,
        businessDate: "2026-08-15",
        notes: "Online transfer ref #123",
      });

      expect(repayment.creditId).toBe(openCredit!.id);
      expect(repayment.orderId).toBe(order.id);
      expect(repayment.method).toBe("Bank");
      expect(repayment.amountCents).toBe(order.totalCents);
      expect(repayment.businessDate).toBe("2026-08-15");

      // Credit is marked cleared with method and timestamp
      const allCredits = await r.listCredits(1);
      const settledCredit = allCredits.find((c) => c.id === openCredit!.id)!;
      expect(settledCredit.clearedAt).toBe(5000);
      expect(settledCredit.clearedMethod).toBe("Bank");

      // Order credit clearance state is updated atomically
      const orderAfter = (await r.getOrder(order.id))!;
      expect(orderAfter.creditClearedAt).toBe(5000);
      // Order method remains Credit (not mutated to Bank)
      expect(orderAfter.method).toBe("Credit");

      // Cannot settle already cleared credit
      await expect(
        r.recordRepayment({ creditId: openCredit!.id, method: "Cash" }),
      ).rejects.toThrow(/already cleared/);
    });

    it("clearCreditsByName clears multiple credits atomically and links payment method", async () => {
      const r = await freshRepo();
      const fish = (await r.getItemByKey("tilapia"))!;
      const o1 = await createOrder(r, {
        method: "Credit",
        contractorName: "Pak Abu",
        ts: 1000,
        lines: [{ itemId: fish.id, qtyMilli: 1000 }],
      });
      const o2 = await createOrder(r, {
        method: "Credit",
        contractorName: "Pak Abu",
        ts: 2000,
        lines: [{ itemId: fish.id, qtyMilli: 1000 }],
      });

      expect((await r.listCredits(1, { outstandingOnly: true })).length).toBe(2);

      await r.clearCreditsByName("Pak Abu", 9000, 1, "Bank");

      expect((await r.listCredits(1, { outstandingOnly: true })).length).toBe(0);
      const all = await r.listCredits(1);
      expect(all.every((c) => c.clearedAt === 9000 && c.clearedMethod === "Bank")).toBe(true);

      expect((await r.getOrder(o1.id))!.creditClearedAt).toBe(9000);
      expect((await r.getOrder(o2.id))!.creditClearedAt).toBe(9000);

      const repayments = await r.listRepayments({ companyId: 1 });
      expect(repayments.length).toBe(2);
      expect(repayments.every((rp) => rp.method === "Bank" && rp.ts === 9000)).toBe(true);
    });

    it("records repayments with method QR end-to-end, clears credits, and passes database check constraints", async () => {
      const r = await freshRepo();
      const fish = (await r.getItemByKey("tilapia"))!;
      const o1 = await createOrder(r, {
        method: "Credit",
        contractorName: "Ah Meng",
        ts: 1000,
        lines: [{ itemId: fish.id, qtyMilli: 1000 }],
      });
      const o2 = await createOrder(r, {
        method: "Credit",
        contractorName: "Ah Meng",
        ts: 2000,
        lines: [{ itemId: fish.id, qtyMilli: 2000 }],
      });

      expect((await r.listCredits(1, { outstandingOnly: true })).length).toBe(2);

      // Settle via QR method
      const settledTotal = await r.clearCreditsByName("Ah Meng", 9500, 1, "QR", "QR Pay Settlement");
      expect(settledTotal).toBe(7500); // 2500 + 5000

      // All credits cleared with clearedMethod QR
      const openCredits = await r.listCredits(1, { outstandingOnly: true });
      expect(openCredits.length).toBe(0);

      const allCredits = await r.listCredits(1);
      expect(allCredits.every((c) => c.clearedAt === 9500 && c.clearedMethod === "QR")).toBe(true);

      // Orders have creditClearedAt updated
      expect((await r.getOrder(o1.id))!.creditClearedAt).toBe(9500);
      expect((await r.getOrder(o2.id))!.creditClearedAt).toBe(9500);

      // Repayments table contains method QR
      const repayments = await r.listRepayments({ companyId: 1 });
      expect(repayments.length).toBe(2);
      expect(repayments.every((rp) => rp.method === "QR" && rp.ts === 9500)).toBe(true);
      expect(repayments[0]?.notes).toBe("QR Pay Settlement");
    });

    it("migrates legacy repayments table with CHECK (method IN ('Cash','Bank')) to support QR without data loss", async () => {
      const SQL = await initSqlJs();
      const db = new SQL.Database();
      const driver = createSqlJsDriver(db as never);

      // Initial schema setup with legacy repayments CHECK constraint
      await driver.run("CREATE TABLE companies (id INTEGER PRIMARY KEY, name TEXT)");
      await driver.run("CREATE TABLE orders (id INTEGER PRIMARY KEY, ts INTEGER, total_cents INTEGER, method TEXT)");
      await driver.run("CREATE TABLE credits (id INTEGER PRIMARY KEY, company_id INTEGER, order_id INTEGER, name TEXT, amount_cents INTEGER, date INTEGER, is_clear INTEGER, cleared_method TEXT)");
      await driver.run("CREATE TABLE contractors (id INTEGER PRIMARY KEY, name TEXT)");
      await driver.run(`
        CREATE TABLE repayments (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          company_id    INTEGER NOT NULL DEFAULT 1,
          credit_id     INTEGER NOT NULL,
          order_id      INTEGER NOT NULL,
          contractor_id INTEGER,
          amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
          method        TEXT    NOT NULL CHECK (method IN ('Cash','Bank')),
          ts            INTEGER NOT NULL,
          business_date TEXT    NOT NULL,
          notes         TEXT
        )
      `);
      await driver.run("INSERT INTO companies VALUES (1, 'Test')");
      await driver.run("INSERT INTO orders VALUES (1, 1000, 5000, 'Credit')");
      await driver.run("INSERT INTO credits VALUES (1, 1, 1, 'Contractor 1', 5000, 1000, NULL, NULL)");
      await driver.run(`
        INSERT INTO repayments (company_id, credit_id, order_id, amount_cents, method, ts, business_date, notes)
        VALUES (1, 1, 1, 3000, 'Cash', 1500, '2026-08-10', 'Historical cash repayment')
      `);

      // Verify inserting 'QR' fails under legacy schema
      await expect(
        driver.run(`
          INSERT INTO repayments (company_id, credit_id, order_id, amount_cents, method, ts, business_date)
          VALUES (1, 1, 1, 2000, 'QR', 2000, '2026-08-10')
        `),
      ).rejects.toThrow();

      // Run migration
      await migrateRepaymentsMethod(driver);

      // Verify historical row preserved
      const historical = await driver.all("SELECT * FROM repayments WHERE id = 1");
      expect(historical.length).toBe(1);
      expect(historical[0]?.method).toBe("Cash");
      expect(historical[0]?.amount_cents).toBe(3000);

      // Verify inserting 'QR' succeeds after migration
      await driver.run(`
        INSERT INTO repayments (company_id, credit_id, order_id, amount_cents, method, ts, business_date, notes)
        VALUES (1, 1, 1, 2000, 'QR', 2000, '2026-08-10', 'QR repayment after migration')
      `);
      const allRepayments = await driver.all("SELECT * FROM repayments ORDER BY id ASC");
      expect(allRepayments.length).toBe(2);
      expect(allRepayments[1]?.method).toBe("QR");
      expect(allRepayments[1]?.amount_cents).toBe(2000);

      // Verify idempotent (second run does not error or duplicate)
      await migrateRepaymentsMethod(driver);
      const postIdempotent = await driver.all("SELECT * FROM repayments ORDER BY id ASC");
      expect(postIdempotent.length).toBe(2);
    });

    it("reflects repayment amounts in daily sales aggregates without corrupting existing historical sales totals", async () => {
      const r = await freshRepo();
      const fish = (await r.getItemByKey("tilapia"))!;

      // Day 1 (2026-08-10): Customer buys on Credit for RM 50 (5000 cents)
      const day1Order = await createOrder(r, {
        method: "Credit",
        contractorName: "Ah Meng",
        ts: new Date("2026-08-10T10:00:00+08:00").getTime(),
        businessDate: "2026-08-10",
        lines: [{ itemId: fish.id, qtyMilli: 2000 }], // 2kg @ RM25 = 5000
      });

      // Day 1 sales before repayment
      const day1Orders = await r.listOrdersByBusinessDate("2026-08-10", "2026-08-10", 1);
      const day1RepaymentsInitial = await r.listRepaymentsByBusinessDate("2026-08-10", "2026-08-10", 1);
      const day1StatsInitial = computeStats(day1Orders, "today", day1RepaymentsInitial);

      expect(day1StatsInitial.count).toBe(1);
      expect(day1StatsInitial.totalCents).toBe(5000);
      expect(day1StatsInitial.byMethod.Credit.totalCents).toBe(5000);
      expect(day1StatsInitial.byMethod.Cash.totalCents).toBe(0);

      // Day 2 (2026-08-15): Cashier records repayment of RM 50 in Cash on current business day
      const [credit] = await r.listCredits(1, { outstandingOnly: true });
      await r.recordRepayment({
        creditId: credit!.id,
        method: "Cash",
        ts: new Date("2026-08-15T14:00:00+08:00").getTime(),
        businessDate: "2026-08-15",
      });

      // Query Day 2 (current business day)
      const day2Orders = await r.listOrdersByBusinessDate("2026-08-15", "2026-08-15", 1);
      const day2Repayments = await r.listRepaymentsByBusinessDate("2026-08-15", "2026-08-15", 1);
      const day2Stats = computeStats(day2Orders, "today", day2Repayments);

      // Day 2 collected funds reflect the Cash repayment of RM 50
      expect(day2Orders.length).toBe(0); // No new orders rung up today yet
      expect(day2Repayments.length).toBe(1);
      expect(day2Stats.totalCents).toBe(5000);
      expect(day2Stats.repaymentsTotalCents).toBe(5000);
      expect(day2Stats.byMethod.Cash.totalCents).toBe(5000);

      // Re-verify Day 1 (historical business day): UNCORRUPTED
      const day1OrdersAfter = await r.listOrdersByBusinessDate("2026-08-10", "2026-08-10", 1);
      const day1RepaymentsAfter = await r.listRepaymentsByBusinessDate("2026-08-10", "2026-08-10", 1);
      const day1StatsAfter = computeStats(day1OrdersAfter, "today", day1RepaymentsAfter);

      expect(day1OrdersAfter.length).toBe(1);
      expect(day1OrdersAfter[0]!.method).toBe("Credit"); // Still Credit!
      expect(day1OrdersAfter[0]!.totalCents).toBe(5000);
      expect(day1RepaymentsAfter.length).toBe(0); // Repayment belongs to 2026-08-15, not 2026-08-10!
      expect(day1StatsAfter.totalCents).toBe(5000);
      expect(day1StatsAfter.byMethod.Credit.totalCents).toBe(5000);
      expect(day1StatsAfter.byMethod.Cash.totalCents).toBe(0);
    });

    it("deduplicates case-insensitive creditor names from historical credits during migration", async () => {
      const SQL = await initSqlJs();
      const db = new SQL.Database();
      const driver = createSqlJsDriver(db as never);

      await driver.run(`
        CREATE TABLE orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL DEFAULT 1,
          ts INTEGER NOT NULL, total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
          method TEXT NOT NULL
        )
      `);
      await driver.run(`
        CREATE TABLE credits (
          id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL DEFAULT 1,
          order_id INTEGER NOT NULL, name TEXT NOT NULL,
          amount_cents INTEGER NOT NULL, date INTEGER NOT NULL, is_clear INTEGER
        )
      `);
      await driver.run("INSERT INTO orders (id, ts, total_cents, method) VALUES (1, 1000, 5000, 'Credit')");
      await driver.run("INSERT INTO orders (id, ts, total_cents, method) VALUES (2, 2000, 8000, 'Credit')");
      await driver.run("INSERT INTO orders (id, ts, total_cents, method) VALUES (3, 3000, 3000, 'Credit')");
      // Distinct case variants of 'Ah Meng'
      await driver.run("INSERT INTO credits (id, order_id, name, amount_cents, date) VALUES (1, 1, 'Ah Meng', 5000, 1000)");
      await driver.run("INSERT INTO credits (id, order_id, name, amount_cents, date) VALUES (2, 2, 'ah meng', 8000, 2000)");
      await driver.run("INSERT INTO credits (id, order_id, name, amount_cents, date) VALUES (3, 3, 'AH MENG ', 3000, 3000)");

      const r = await initRepo(driver, { seedItems: LEGACY_SEED_ITEMS });
      const contractorsList = await r.listContractors();
      // Should collapse to a single contractor rather than 3 duplicates
      expect(contractorsList.length).toBe(1);
      expect(contractorsList[0]!.name.toLowerCase()).toBe("ah meng");
    });

    it("handles partial repayments by splitting credit and preserving outstanding balance", async () => {
      const r = await freshRepo();
      const fish = (await r.getItemByKey("tilapia"))!;
      const order = await createOrder(r, {
        method: "Credit",
        contractorName: "Ah Meng",
        ts: 1000,
        businessDate: "2026-08-10",
        lines: [{ itemId: fish.id, qtyMilli: 4000 }], // 4kg @ RM25 = RM 100 (10000 cents)
      });

      const [initialCredit] = await r.listCredits(1, { outstandingOnly: true });
      expect(initialCredit!.amountCents).toBe(10000);

      // Rejects overpayment (> 10000)
      await expect(
        r.recordRepayment({
          creditId: initialCredit!.id,
          amountCents: 15000,
          method: "Cash",
          ts: 2000,
        }),
      ).rejects.toThrow(/cannot exceed credit balance/);

      // Partial repayment 1: Pay RM 40 (4000 cents)
      const rep1 = await r.recordRepayment({
        creditId: initialCredit!.id,
        amountCents: 4000,
        method: "Cash",
        ts: 2000,
        businessDate: "2026-08-11",
      });

      expect(rep1.amountCents).toBe(4000);

      // Order should NOT be marked cleared yet because RM 60 is still owed
      const orderMid = (await r.getOrder(order.id))!;
      expect(orderMid.creditClearedAt).toBeNull();

      // Guard: Attempting to void a partially settled credit order must ALSO be rejected
      await expect(r.voidOrder(order.id, 2500)).rejects.toThrow(
        /cannot void a credit order that has already been settled/,
      );

      // Open credits should now show 1 credit of RM 60 (6000 cents)
      const openCreditsMid = await r.listCredits(1, { outstandingOnly: true });
      expect(openCreditsMid.length).toBe(1);
      expect(openCreditsMid[0]!.amountCents).toBe(6000);
      expect(openCreditsMid[0]!.clearedAt).toBeNull();

      // Settled credits should show the partial RM 40
      const allCreditsMid = await r.listCredits(1);
      const clearedPart = allCreditsMid.find((c) => c.clearedAt != null)!;
      expect(clearedPart.amountCents).toBe(4000);
      expect(clearedPart.clearedMethod).toBe("Cash");

      // Partial repayment 2: Pay remainder RM 60 (6000 cents) with Bank
      const rep2 = await r.recordRepayment({
        creditId: openCreditsMid[0]!.id,
        amountCents: 6000,
        method: "Bank",
        ts: 3000,
        businessDate: "2026-08-12",
      });

      expect(rep2.amountCents).toBe(6000);

      // Now all credits for this order are cleared
      const openCreditsFinal = await r.listCredits(1, { outstandingOnly: true });
      expect(openCreditsFinal.length).toBe(0);

      // Order credit clearance state is finally stamped
      const orderFinal = (await r.getOrder(order.id))!;
      expect(orderFinal.creditClearedAt).toBe(3000);

      // Attempting to void the settled credit order must be rejected
      await expect(r.voidOrder(order.id, 4000)).rejects.toThrow(
        /cannot void a credit order that has already been settled/,
      );
    });

    it("rejects repayment against voided orders and cross-company credits", async () => {
      const r = await freshRepo();
      const fish = (await r.getItemByKey("tilapia"))!;
      const order = await createOrder(r, {
        method: "Credit",
        contractorName: "Ah Meng",
        ts: 1000,
        lines: [{ itemId: fish.id, qtyMilli: 1000 }],
      });
      const [credit] = await r.listCredits(1, { outstandingOnly: true });

      // Cross-company repayment rejected
      await expect(
        r.recordRepayment({
          companyId: 99,
          creditId: credit!.id,
          method: "Cash",
        }),
      ).rejects.toThrow(/not found/);

      // Void the unsettled order
      await r.voidOrder(order.id, 2000);

      // Repayment on credit for voided order rejected
      await expect(
        r.recordRepayment({
          creditId: credit!.id,
          method: "Cash",
        }),
      ).rejects.toThrow(/not found/);
    });

    it("settles selected credits atomically via clearCreditsByIds", async () => {
      const r = await freshRepo();
      const fish = (await r.getItemByKey("tilapia"))!;
      await createOrder(r, {
        method: "Credit",
        contractorName: "Ah Meng",
        ts: 1000,
        lines: [{ itemId: fish.id, qtyMilli: 1000 }], // 2500
      });
      await createOrder(r, {
        method: "Credit",
        contractorName: "Ah Meng",
        ts: 2000,
        lines: [{ itemId: fish.id, qtyMilli: 2000 }], // 5000
      });

      const open = await r.listCredits(1, { outstandingOnly: true });
      expect(open.length).toBe(2);

      // Settle only the first credit by ID
      const settled = await r.clearCreditsByIds([open[0]!.id], 3000, 1, "Bank", "Paid first invoice");
      expect(settled).toBe(open[0]!.amountCents);

      const remaining = await r.listCredits(1, { outstandingOnly: true });
      expect(remaining.length).toBe(1);
      expect(remaining[0]!.id).toBe(open[1]!.id);

      const reps = await r.listRepayments();
      expect(reps.length).toBe(1);
      expect(reps[0]!.notes).toBe("Paid first invoice");
      expect(reps[0]!.method).toBe("Bank");
    });

    it("reopenDay pulls pushed repayments back to reopened business day", async () => {
      const r = await freshRepo();
      const fish = (await r.getItemByKey("tilapia"))!;
      await createOrder(r, {
        method: "Credit",
        contractorName: "Ah Meng",
        ts: 1000,
        businessDate: "2026-08-10",
        lines: [{ itemId: fish.id, qtyMilli: 2000 }],
      });
      const [credit] = await r.listCredits(1, { outstandingOnly: true });

      // Close day 2026-08-10
      await r.closeDay("2026-08-10", { at: new Date("2026-08-10T21:00:00+08:00").getTime() });

      // Record repayment after close (assigned to next day 2026-08-11, but timestamp on 2026-08-10)
      const postCloseTs = new Date("2026-08-10T22:30:00+08:00").getTime();
      await r.recordRepayment({
        creditId: credit!.id,
        method: "Cash",
        ts: postCloseTs,
        businessDate: "2026-08-11",
      });

      // Initially repayment is on 2026-08-11
      const repBefore = await r.listRepaymentsByBusinessDate("2026-08-11", "2026-08-11");
      expect(repBefore.length).toBe(1);

      // Reopen day 2026-08-10
      await r.reopenDay("2026-08-10");

      // Repayment must be pulled back to 2026-08-10
      const repAfterToday = await r.listRepaymentsByBusinessDate("2026-08-10", "2026-08-10");
      expect(repAfterToday.length).toBe(1);
      expect(repAfterToday[0]!.businessDate).toBe("2026-08-10");

      const repAfterTomorrow = await r.listRepaymentsByBusinessDate("2026-08-11", "2026-08-11");
      expect(repAfterTomorrow.length).toBe(0);
    });

    it("listUnclosedDays detects days with repayments but zero sales orders", async () => {
      const r = await freshRepo();
      const fish = (await r.getItemByKey("tilapia"))!;

      // Credit order on Day 1 (closed)
      await createOrder(r, {
        method: "Credit",
        contractorName: "Ah Meng",
        ts: 1000,
        businessDate: "2026-08-10",
        lines: [{ itemId: fish.id, qtyMilli: 2000 }],
      });
      const [credit] = await r.listCredits(1, { outstandingOnly: true });
      await r.closeDay("2026-08-10", { at: new Date("2026-08-10T21:00:00+08:00").getTime() });

      // Day 2 (2026-08-11): NO sales orders, but customer pays RM 50 repayment
      await r.recordRepayment({
        creditId: credit!.id,
        method: "Cash",
        ts: new Date("2026-08-11T12:00:00+08:00").getTime(),
        businessDate: "2026-08-11",
      });

      // listUnclosedDays before 2026-08-12 must return 2026-08-11
      const unclosed = await r.listUnclosedDays("2026-08-12", 1);
      expect(unclosed).toContain("2026-08-11");
    });

    it("updateContractor cascades name rename to associated credits without breaking balances", async () => {
      const r = await freshRepo();
      const fish = (await r.getItemByKey("tilapia"))!;
      const c = await r.createContractor({ name: "Ah Meng", phone: "012-3456789" });
      await createOrder(r, {
        method: "Credit",
        contractorName: "Ah Meng",
        ts: 1000,
        lines: [{ itemId: fish.id, qtyMilli: 2000 }], // RM 50 (5000 cents)
      });

      const creditsBefore = await r.listCredits(1, { outstandingOnly: true });
      expect(creditsBefore.length).toBe(1);
      expect(creditsBefore[0]!.name).toBe("Ah Meng");

      // Rename contractor
      await r.updateContractor(c.id, { name: "Meng Enterprise" });

      const creditsAfter = await r.listCredits(1, { outstandingOnly: true });
      expect(creditsAfter.length).toBe(1);
      expect(creditsAfter[0]!.name).toBe("Meng Enterprise");

      // Can settle under the new name
      const settled = await r.clearCreditsByName("Meng Enterprise", 2000, 1, "Bank");
      expect(settled).toBe(5000);

      const remaining = await r.listCredits(1, { outstandingOnly: true });
      expect(remaining.length).toBe(0);
    });

    it("clearCreditsByIds rejects non-existent and already cleared credits atomically", async () => {
      const r = await freshRepo();
      const fish = (await r.getItemByKey("tilapia"))!;
      await createOrder(r, {
        method: "Credit",
        contractorName: "Ah Meng",
        ts: 1000,
        lines: [{ itemId: fish.id, qtyMilli: 1000 }],
      });
      const [credit] = await r.listCredits(1, { outstandingOnly: true });

      // Non-existent credit ID rejected
      await expect(
        r.clearCreditsByIds([99999], 2000, 1, "Cash"),
      ).rejects.toThrow(/not found/);

      // Settle credit
      await r.clearCreditsByIds([credit!.id], 2000, 1, "Cash");

      // Attempting to clear already cleared credit ID rejected
      await expect(
        r.clearCreditsByIds([credit!.id], 3000, 1, "Cash"),
      ).rejects.toThrow(/already cleared/);
    });

    it("initRepo backfill does not mark orders with remaining open credit as creditClearedAt", async () => {
      const SQL = await initSqlJs();
      const rawDb = new SQL.Database();
      const driver = createSqlJsDriver(rawDb as never);
      await driver.run(
        "CREATE TABLE orders (id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL DEFAULT 1, ts INTEGER NOT NULL, total_cents INTEGER NOT NULL, method TEXT NOT NULL)",
      );
      await driver.run(
        "CREATE TABLE credits (id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL DEFAULT 1, order_id INTEGER, name TEXT, amount_cents INTEGER, is_clear INTEGER, date INTEGER)",
      );
      await driver.run("INSERT INTO orders (id, ts, total_cents, method) VALUES (1, 1000, 10000, 'Credit')");
      // Credit 1 cleared, Credit 2 open
      await driver.run("INSERT INTO credits (id, company_id, order_id, name, amount_cents, is_clear, date) VALUES (1, 1, 1, 'Ah Meng', 4000, 2000, 1000)");
      await driver.run("INSERT INTO credits (id, company_id, order_id, name, amount_cents, is_clear, date) VALUES (2, 1, 1, 'Ah Meng', 6000, NULL, 1000)");

      const r = await initRepo(driver, { seedItems: LEGACY_SEED_ITEMS });
      const order = await r.getOrder(1);
      expect(order).not.toBeNull();
      // Partial credit remains -> must not be marked cleared
      expect(order!.creditClearedAt).toBeNull();
    });
  });

  describe("customer decoupling & delivery orders (DO)", () => {
    it("contractor paying Cash generates B-xxxx, preserves contractor details, and creates 0 credit rows", async () => {
      const r = await freshRepo();
      const fish = (await r.getItemByKey("tilapia"))!;
      const c = await r.createContractor({
        name: "Bina Jaya Construction",
        phone: "019-8881234",
        tin: "C2938472901",
        address: "Lot 44, Industrial Estate, Kuching",
      });

      const order = await createOrder(r, {
        method: "Cash",
        customerType: "contractor",
        contractorId: c.id,
        contractorName: "Bina Jaya Construction",
        lines: [{ itemId: fish.id, qtyMilli: 2000 }],
      });

      // B- prefix for contractor
      expect(order.invNo).toBe("B-0001");
      expect(order.method).toBe("Cash");
      expect(order.contractorName).toBe("Bina Jaya Construction");
      expect(order.contractorId).toBe(c.id);
      expect(order.contractorTin).toBe("C2938472901");
      expect(order.contractorAddress).toBe("Lot 44, Industrial Estate, Kuching");
      expect(order.contractorPhone).toBe("019-8881234");

      // Zero credit rows created!
      const credits = await r.listCredits(1, { outstandingOnly: true });
      expect(credits).toHaveLength(0);

      // Re-fetching the order yields identical metadata
      const fetched = await r.getOrder(order.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.invNo).toBe("B-0001");
      expect(fetched!.contractorName).toBe("Bina Jaya Construction");
      expect(fetched!.contractorTin).toBe("C2938472901");

      // Stats account for sale under Cash
      const orders = await r.listOrders(0, order.ts + 1000);
      const stats = computeStats(orders, "today");
      expect(stats.byMethod.Cash.count).toBe(1);
      expect(stats.byMethod.Credit.count).toBe(0);
    });

    it("contractor paying Bank or QR generates B-xxxx and creates 0 credit rows", async () => {
      const r = await freshRepo();
      const fish = (await r.getItemByKey("tilapia"))!;

      const oBank = await createOrder(r, {
        method: "Bank",
        customerType: "contractor",
        contractorName: "Syarikat Pembinaan Maju",
        lines: [{ itemId: fish.id, qtyMilli: 1000 }],
      });
      expect(oBank.invNo).toBe("B-0001");
      expect(oBank.contractorName).toBe("Syarikat Pembinaan Maju");

      const oQR = await createOrder(r, {
        method: "QR",
        contractorName: "Syarikat Pembinaan Maju",
        lines: [{ itemId: fish.id, qtyMilli: 1000 }],
      });
      expect(oQR.invNo).toBe("B-0002");
      expect(oQR.contractorName).toBe("Syarikat Pembinaan Maju");

      // Ensure no credits written
      expect(await r.listCredits(1)).toHaveLength(0);
    });

    it("walk-in paying Cash generates A-xxxx and creates 0 credit rows", async () => {
      const r = await freshRepo();
      const fish = (await r.getItemByKey("tilapia"))!;

      const order = await createOrder(r, {
        method: "Cash",
        lines: [{ itemId: fish.id, qtyMilli: 1000 }],
      });

      expect(order.invNo).toBe("A-0001");
      expect(order.contractorName).toBeUndefined();
      expect(await r.listCredits(1)).toHaveLength(0);
    });

    it("contractor paying Credit generates B-xxxx and creates 1 open credit row", async () => {
      const r = await freshRepo();
      const fish = (await r.getItemByKey("tilapia"))!;
      const c = await r.createContractor({ name: "Mega Builders", phone: "013-1112233" });

      const order = await createOrder(r, {
        method: "Credit",
        contractorId: c.id,
        contractorName: "Mega Builders",
        lines: [{ itemId: fish.id, qtyMilli: 2000 }],
      });

      expect(order.invNo).toBe("B-0001");
      expect(order.contractorName).toBe("Mega Builders");

      const credits = await r.listCredits(1, { outstandingOnly: true });
      expect(credits).toHaveLength(1);
      expect(credits[0]!.name).toBe("Mega Builders");
      expect(credits[0]!.amountCents).toBe(order.totalCents);
      expect(credits[0]!.invNo).toBe("B-0001");
      expect(credits[0]!.clearedAt).toBeNull();
    });

    it("order with DO metadata generates DO-0001 and persists all DO fields", async () => {
      const r = await freshRepo();
      const fish = (await r.getItemByKey("tilapia"))!;

      const order = await createOrder(r, {
        method: "Cash",
        issueDo: true,
        siteAddress: "Tapak Projek Lot 108, Demak Laut, Kuching",
        lorryPlate: "QAA 8821 X",
        driverName: "Pak Samad",
        contractorPo: "PO-2026-099",
        showPriceOnDo: false,
        lines: [{ itemId: fish.id, qtyMilli: 3000 }],
      });

      expect(order.invNo).toBe("A-0001");
      expect(order.doNumber).toBe("DO-0001");
      expect(order.siteAddress).toBe("Tapak Projek Lot 108, Demak Laut, Kuching");
      expect(order.lorryPlate).toBe("QAA 8821 X");
      expect(order.driverName).toBe("Pak Samad");
      expect(order.contractorPo).toBe("PO-2026-099");
      expect(order.showPriceOnDo).toBe(false);

      // Re-read via getOrder
      const fetched = (await r.getOrder(order.id))!;
      expect(fetched.doNumber).toBe("DO-0001");
      expect(fetched.siteAddress).toBe("Tapak Projek Lot 108, Demak Laut, Kuching");
      expect(fetched.lorryPlate).toBe("QAA 8821 X");
      expect(fetched.driverName).toBe("Pak Samad");
      expect(fetched.contractorPo).toBe("PO-2026-099");
      expect(fetched.showPriceOnDo).toBe(false);
    });

    it("DO sequence increments continuously across DO orders while non-DO orders do not consume sequence", async () => {
      const r = await freshRepo();
      const fish = (await r.getItemByKey("tilapia"))!;

      // Order 1: DO
      const do1 = await createOrder(r, {
        method: "Cash",
        issueDo: true,
        lines: [{ itemId: fish.id, qtyMilli: 1000 }],
      });
      expect(do1.doNumber).toBe("DO-0001");

      // Order 2: DO
      const do2 = await createOrder(r, {
        method: "Cash",
        siteAddress: "Site B",
        lines: [{ itemId: fish.id, qtyMilli: 1000 }],
      });
      expect(do2.doNumber).toBe("DO-0002");

      // Order 3: Normal walk-in sale without DO
      const normal = await createOrder(r, {
        method: "Cash",
        lines: [{ itemId: fish.id, qtyMilli: 1000 }],
      });
      expect(normal.doNumber).toBeUndefined();

      // Order 4: DO
      const do3 = await createOrder(r, {
        method: "Cash",
        issueDo: true,
        lines: [{ itemId: fish.id, qtyMilli: 1000 }],
      });
      expect(do3.doNumber).toBe("DO-0003");
    });

    it("isolates DO sequences across companies", async () => {
      const r = await freshRepo();
      const fish = (await r.getItemByKey("tilapia"))!;

      const co1 = await createOrder(r, {
        companyId: 1,
        method: "Cash",
        issueDo: true,
        lines: [{ itemId: fish.id, qtyMilli: 1000 }],
      });
      expect(co1.doNumber).toBe("DO-0001");

      const co2 = await createOrder(r, {
        companyId: 2,
        method: "Cash",
        issueDo: true,
        lines: [{ itemId: fish.id, qtyMilli: 1000 }],
      });
      expect(co2.doNumber).toBe("DO-0001");

      const co1Next = await createOrder(r, {
        companyId: 1,
        method: "Cash",
        issueDo: true,
        lines: [{ itemId: fish.id, qtyMilli: 1000 }],
      });
      expect(co1Next.doNumber).toBe("DO-0002");
    });

    it("hydrates contractor and DO fields across listOrders and listOrdersByBusinessDate", async () => {
      const r = await freshRepo();
      const fish = (await r.getItemByKey("tilapia"))!;
      const c = await r.createContractor({
        name: "Borneo Infrastructure",
        phone: "082-123456",
        tin: "C11223344",
        address: "Jalan Tun Jugah",
      });

      const o = await createOrder(r, {
        method: "Cash",
        contractorId: c.id,
        contractorName: "Borneo Infrastructure",
        contractorTin: "C11223344",
        contractorAddress: "Jalan Tun Jugah",
        contractorPhone: "082-123456",
        issueDo: true,
        siteAddress: "Flyover Project Phase 2",
        lorryPlate: "QAB 9911 Y",
        driverName: "Abang Ali",
        contractorPo: "PO-INFRA-77",
        showPriceOnDo: true,
        ts: 5000,
        businessDate: "2026-10-23",
        lines: [{ itemId: fish.id, qtyMilli: 5000 }],
      });

      const byRange = await r.listOrders(0, 10000);
      const foundRange = byRange.find((item) => item.id === o.id);
      expect(foundRange).toBeDefined();
      expect(foundRange!.contractorName).toBe("Borneo Infrastructure");
      expect(foundRange!.contractorTin).toBe("C11223344");
      expect(foundRange!.doNumber).toBe("DO-0001");
      expect(foundRange!.siteAddress).toBe("Flyover Project Phase 2");
      expect(foundRange!.lorryPlate).toBe("QAB 9911 Y");
      expect(foundRange!.driverName).toBe("Abang Ali");
      expect(foundRange!.contractorPo).toBe("PO-INFRA-77");
      expect(foundRange!.showPriceOnDo).toBe(true);

      const byDate = await r.listOrdersByBusinessDate("2026-10-20", "2026-10-25");
      const foundDate = byDate.find((item) => item.id === o.id);
      expect(foundDate).toBeDefined();
      expect(foundDate!.contractorName).toBe("Borneo Infrastructure");
      expect(foundDate!.doNumber).toBe("DO-0001");
    });

    it("migrates existing database non-destructively and backfills contractor_name on legacy credit orders", async () => {
      const SQL = await initSqlJs();
      const rawDb = new SQL.Database();
      const driver = createSqlJsDriver(rawDb as never);

      // Old schema without contractor_id, contractor_name, do_number, etc.
      await driver.run(`
        CREATE TABLE orders (
          id INTEGER PRIMARY KEY,
          company_id INTEGER NOT NULL DEFAULT 1,
          ts INTEGER NOT NULL,
          business_date TEXT,
          inv_no TEXT,
          discount_cents INTEGER NOT NULL DEFAULT 0,
          total_cents INTEGER NOT NULL,
          method TEXT NOT NULL CHECK (method IN ('Cash','Bank','QR','Credit'))
        )
      `);
      await driver.run(`
        CREATE TABLE credits (
          id INTEGER PRIMARY KEY,
          company_id INTEGER NOT NULL DEFAULT 1,
          order_id INTEGER,
          name TEXT,
          amount_cents INTEGER,
          is_clear INTEGER,
          date INTEGER
        )
      `);
      await driver.run("INSERT INTO orders (id, ts, total_cents, method) VALUES (1, 1000, 5000, 'Credit')");
      await driver.run("INSERT INTO credits (id, company_id, order_id, name, amount_cents, date) VALUES (1, 1, 1, 'Legacy Contractor Sdn Bhd', 5000, 1000)");

      // Run migration
      const r = await initRepo(driver, { seedItems: LEGACY_SEED_ITEMS });

      // Verify legacy order has contractor_name backfilled
      const legacyOrder = await r.getOrder(1);
      expect(legacyOrder).not.toBeNull();
      expect(legacyOrder!.contractorName).toBe("Legacy Contractor Sdn Bhd");

      // Verify PRAGMA table_info confirms new columns exist
      const cols = await driver.all("PRAGMA table_info(orders)");
      const colNames = cols.map((c) => String(c.name));
      expect(colNames).toContain("contractor_id");
      expect(colNames).toContain("contractor_name");
      expect(colNames).toContain("do_number");
      expect(colNames).toContain("site_address");
      expect(colNames).toContain("lorry_plate");
      expect(colNames).toContain("driver_name");
      expect(colNames).toContain("contractor_po");
      expect(colNames).toContain("show_price_on_do");

      // Verify creating a new DO order on the migrated DB succeeds seamlessly
      const fish = (await r.getItemByKey("tilapia"))!;
      const newOrder = await createOrder(r, {
        method: "Cash",
        issueDo: true,
        siteAddress: "Migrated Site",
        lorryPlate: "QAX 1234",
        lines: [{ itemId: fish.id, qtyMilli: 1000 }],
      });
      expect(newOrder.doNumber).toBe("DO-0001");
      expect(newOrder.siteAddress).toBe("Migrated Site");
    });
  });

  describe("cashier name on orders", () => {
    it("persists and hydrates cashierName across orders", async () => {
      const repo = await freshRepo();
      const fish = (await repo.getItemByKey("tilapia"))!;

      const order = await createOrder(repo, {
        method: "Cash",
        cashierName: "Ah Ming",
        lines: [{ itemId: fish.id, qtyMilli: 2000 }],
      });

      expect(order.cashierName).toBe("Ah Ming");

      const fetched = await repo.getOrder(order.id);
      expect(fetched?.cashierName).toBe("Ah Ming");

      const list = await repo.listOrders(0, Number.MAX_SAFE_INTEGER);
      const found = list.find((o) => o.id === order.id);
      expect(found?.cashierName).toBe("Ah Ming");

      const byDate = await repo.listOrdersByBusinessDate(order.businessDate, order.businessDate);
      const foundByDate = byDate.find((o) => o.id === order.id);
      expect(foundByDate?.cashierName).toBe("Ah Ming");
    });

    it("persists voidedBy when voidOrder is executed with cashier name", async () => {
      const repo = await freshRepo();
      const fish = (await repo.getItemByKey("tilapia"))!;

      const order = await createOrder(repo, {
        method: "Cash",
        cashierName: "Cashier Tan",
        lines: [{ itemId: fish.id, qtyMilli: 1000 }],
      });

      const voidTimestamp = Date.now();
      const voided = await repo.voidOrder(order.id, voidTimestamp, "Supervisor Siti");

      expect(voided.voidedAt).toBe(voidTimestamp);
      expect(voided.voidedBy).toBe("Supervisor Siti");
      expect(voided.cashierName).toBe("Cashier Tan");

      const fetched = await repo.getOrder(order.id);
      expect(fetched?.voidedAt).toBe(voidTimestamp);
      expect(fetched?.voidedBy).toBe("Supervisor Siti");
      expect(fetched?.cashierName).toBe("Cashier Tan");
    });

    it("persists cashierName on repayments and forwarded credit clearance", async () => {
      const repo = await freshRepo();
      const fish = (await repo.getItemByKey("tilapia"))!;

      // 1. Single repayment with cashierName
      const order1 = await createOrder(repo, {
        method: "Credit",
        contractorName: "Ah Teck Contractor",
        cashierName: "Cashier Tan",
        lines: [{ itemId: fish.id, qtyMilli: 1000 }],
      });

      const credits = await repo.listCredits(1, { outstandingOnly: true });
      const cred1 = credits.find((c) => c.orderId === order1.id)!;

      const repayment = await repo.recordRepayment({
        creditId: cred1.id,
        method: "QR",
        cashierName: "Ah Ming",
      });

      expect(repayment.cashierName).toBe("Ah Ming");
      const repList = await repo.listRepayments();
      const foundRep = repList.find((r) => r.id === repayment.id);
      expect(foundRep?.cashierName).toBe("Ah Ming");

      // 2. clearCredit with cashierName
      const order2 = await createOrder(repo, {
        method: "Credit",
        contractorName: "Ah Teck Contractor",
        lines: [{ itemId: fish.id, qtyMilli: 1000 }],
      });
      const cred2 = (await repo.listCredits(1, { outstandingOnly: true })).find(
        (c) => c.orderId === order2.id,
      )!;
      await repo.clearCredit(cred2.id, Date.now(), "Cash", undefined, "Supervisor Siti");
      const repList2 = await repo.listRepayments();
      const foundRep2 = repList2.find((r) => r.creditId === cred2.id);
      expect(foundRep2?.cashierName).toBe("Supervisor Siti");

      // 3. clearCreditsByIds with cashierName
      const order3 = await createOrder(repo, {
        method: "Credit",
        contractorName: "Ah Teck Contractor",
        lines: [{ itemId: fish.id, qtyMilli: 1000 }],
      });
      const cred3 = (await repo.listCredits(1, { outstandingOnly: true })).find(
        (c) => c.orderId === order3.id,
      )!;
      await repo.clearCreditsByIds([cred3.id], Date.now(), 1, "Bank", "Paid via transfer", undefined, "Auditor Lee");
      const repList3 = await repo.listRepayments();
      const foundRep3 = repList3.find((r) => r.creditId === cred3.id);
      expect(foundRep3?.cashierName).toBe("Auditor Lee");
    });

    it("persists closedBy on DayClose", async () => {
      const repo = await freshRepo();
      const now = new Date(2026, 6, 13, 20).getTime(); // 2026-07-13 8pm
      const dayClose = await repo.closeDay("2026-07-13", {
        at: now,
        closedBy: "Manager Wong",
      });

      expect(dayClose.closedBy).toBe("Manager Wong");

      const fetched = await repo.getDayClose("2026-07-13");
      expect(fetched?.closedBy).toBe("Manager Wong");
    });

    it("confirms audit columns in sqlite schema via PRAGMA table_info", async () => {
      const SQL = await initSqlJs();
      const db = new SQL.Database();
      const driver = createSqlJsDriver(db as never);
      await initRepo(driver);

      const orderCols = (await driver.all("PRAGMA table_info(orders)")).map((c) => String(c.name));
      expect(orderCols).toContain("cashier_name");
      expect(orderCols).toContain("voided_by");

      const repaymentCols = (await driver.all("PRAGMA table_info(repayments)")).map((c) => String(c.name));
      expect(repaymentCols).toContain("cashier_name");

      const dayCloseCols = (await driver.all("PRAGMA table_info(day_closes)")).map((c) => String(c.name));
      expect(dayCloseCols).toContain("closed_by");
    });
  });

  describe("partial returns and refunds (M2)", () => {
    let repo: SqlPosRepo;
    beforeEach(async () => {
      repo = await freshRepo();
    });

    it("creates a partial refund order, links to original order, replenishes tracked inventory, and hydrates refundOfInvNo", async () => {
      const item = await repo.createItem({
        key: "test-m2-item",
        name: "Test M2 Item",
        unit: "pack",
        priceCents: 1500,
        stockMilli: 10000,
      });

      const order = await createOrder(repo, {
        method: "Cash",
        lines: [{ itemId: item.id, qtyMilli: 4000 }],
        cashierName: "Cashier May",
      });

      expect(order.totalCents).toBe(6000);
      expect((await repo.getItem(item.id))!.stockMilli).toBe(6000);

      const priorRefunds = await repo.getRefundsForOrder(order.id);
      expect(priorRefunds).toHaveLength(0);

      const stockRows = [{ itemId: item.id, currentStockMilli: (await repo.getItem(item.id))!.stockMilli }];
      const plan = planPartialRefund(
        order,
        priorRefunds,
        [{ orderItemId: order.items[0]!.id, itemId: item.id, qtyMilli: 1000, reason: "Wrong item" }],
        stockRows,
      );

      const refundOrder = await repo.createRefundOrder(plan);

      expect(refundOrder.refundOfOrderId).toBe(order.id);
      expect(refundOrder.refundOfInvNo).toBe(order.invNo);
      expect(refundOrder.totalCents).toBe(-1500);
      expect(refundOrder.method).toBe("Cash");
      expect(refundOrder.items).toHaveLength(1);
      expect(refundOrder.items[0]!.qtyMilli).toBe(1000);
      expect(refundOrder.items[0]!.amountCents).toBe(1500);

      // Verify inventory replenishment
      expect((await repo.getItem(item.id))!.stockMilli).toBe(7000);

      // Verify retrieval through getOrder and listOrders
      const fetched = (await repo.getOrder(refundOrder.id))!;
      expect(fetched.refundOfOrderId).toBe(order.id);
      expect(fetched.refundOfInvNo).toBe(order.invNo);

      const list = await repo.listOrders(0, Number.MAX_SAFE_INTEGER);
      const foundInList = list.find((o) => o.id === refundOrder.id);
      expect(foundInList?.refundOfOrderId).toBe(order.id);
      expect(foundInList?.refundOfInvNo).toBe(order.invNo);

      // Verify getRefundsForOrder
      const refunds = await repo.getRefundsForOrder(order.id);
      expect(refunds).toHaveLength(1);
      expect(refunds[0]!.id).toBe(refundOrder.id);
    });

    it("handles credit sale refund by deducting open balance and marking credit cleared when fully refunded", async () => {
      const item = await repo.createItem({
        key: "test-m2-credit-item",
        name: "Test Credit Item",
        unit: "unit",
        priceCents: 2000,
      });

      const order = await createOrder(repo, {
        method: "Credit",
        contractorName: "Pak Abu Builder",
        lines: [{ itemId: item.id, qtyMilli: 2000 }],
      });
      expect(order.totalCents).toBe(4000);

      const creditsInitial = await repo.listCredits(1, { outstandingOnly: true });
      const cred = creditsInitial.find((c) => c.orderId === order.id)!;
      expect(cred).toBeDefined();
      expect(cred.amountCents).toBe(4000);
      expect(cred.clearedAt).toBeNull();

      // First partial refund of 1 unit (-RM20)
      const plan1 = planPartialRefund(order, [], [{ orderItemId: order.items[0]!.id, itemId: item.id, qtyMilli: 1000 }]);
      await repo.createRefundOrder(plan1);

      const creditsAfterPart1 = await repo.listCredits(1);
      const credPart1 = creditsAfterPart1.find((c) => c.orderId === order.id)!;
      expect(credPart1.amountCents).toBe(2000);
      expect(credPart1.clearedAt).toBeNull();

      // Second partial refund of remaining 1 unit (-RM20)
      const priorRefunds = await repo.getRefundsForOrder(order.id);
      const plan2 = planPartialRefund(order, priorRefunds, [{ orderItemId: order.items[0]!.id, itemId: item.id, qtyMilli: 1000 }]);
      await repo.createRefundOrder(plan2);

      const creditsAfterPart2 = await repo.listCredits(1);
      const credPart2 = creditsAfterPart2.find((c) => c.orderId === order.id)!;
      expect(credPart2.amountCents).toBe(0);
      expect(credPart2.clearedAt).toBeTruthy();
    });

    it("prevents over-refunding across multiple consecutive refund requests", async () => {
      const fish = (await repo.getItemByKey("tilapia"))!;
      const order = await createOrder(repo, {
        method: "Cash",
        lines: [{ itemId: fish.id, qtyMilli: 2000 }],
      });

      const plan1 = planPartialRefund(order, [], [{ orderItemId: order.items[0]!.id, itemId: fish.id, qtyMilli: 1500 }]);
      const ref1 = await repo.createRefundOrder(plan1);

      const priorRefunds = await repo.getRefundsForOrder(order.id);
      expect(priorRefunds).toHaveLength(1);
      expect(priorRefunds[0]!.id).toBe(ref1.id);

      // Attempting to refund 1000milli when only 500milli remains must fail
      expect(() =>
        planPartialRefund(order, priorRefunds, [{ orderItemId: order.items[0]!.id, itemId: fish.id, qtyMilli: 1000 }]),
      ).toThrow(/exceeds remaining/i);
    });

    it("migrates existing orders table with total_cents >= 0 check to allow negative refunds", async () => {
      const SQL = await initSqlJs();
      const db = new SQL.Database();
      const driver = createSqlJsDriver(db as never);

      // Simulate older DB schema where orders had CHECK (total_cents >= 0)
      await driver.run(
        `CREATE TABLE orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL DEFAULT 1,
          ts INTEGER NOT NULL, total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
          method TEXT NOT NULL CHECK (method IN ('Cash','Bank','QR','Card','Credit')))`,
      );
      await driver.run(
        `CREATE TABLE items (
          id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL DEFAULT 1,
          key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, image TEXT NOT NULL DEFAULT '',
          unit TEXT NOT NULL DEFAULT 'each', tint TEXT NOT NULL DEFAULT '#eee',
          price_cents INTEGER NOT NULL CHECK (price_cents >= 0), active INTEGER NOT NULL DEFAULT 1)`,
      );
      await driver.run("INSERT INTO items (key, name, unit, price_cents) VALUES ('bread','Roti','pcs',300)");

      // initRepo triggers migrateOrdersRefundCheck
      const r = await initRepo(driver);
      const bread = (await r.getItemByKey("bread"))!;
      const order = await createOrder(r, {
        method: "Cash",
        lines: [{ itemId: bread.id, qtyMilli: 2000 }],
      });

      const plan = planPartialRefund(order, [], [{ orderItemId: order.items[0]!.id, itemId: bread.id, qtyMilli: 1000 }]);
      const refund = await r.createRefundOrder(plan);
      expect(refund.totalCents).toBe(-300);
      expect(refund.refundOfOrderId).toBe(order.id);
    });
  });
});

