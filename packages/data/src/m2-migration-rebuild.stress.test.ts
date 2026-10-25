import { describe, expect, it } from "vitest";
import initSqlJs from "sql.js";
import { createSqlJsDriver } from "./sqljs.js";
import { initRepo } from "./init.js";
import { createOrder, planPartialRefund } from "@yf/core";

describe("Milestone 2 Challenger Stress Suite: SQLite Table Rebuild & Migration Integrity", () => {
  it("rebuilds orders table from strict CHECK (total_cents >= 0) to relaxed CHECK, preserving data and enforcing constraints", async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    const driver = createSqlJsDriver(db as never);

    // 1. Setup legacy schema simulating pre-M2 database with strict CHECK (total_cents >= 0)
    await driver.run(`
      CREATE TABLE contractors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL DEFAULT 1,
        name TEXT NOT NULL COLLATE NOCASE,
        phone TEXT NOT NULL DEFAULT '',
        tin TEXT NOT NULL DEFAULT '',
        address TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1,
        UNIQUE (company_id, name)
      )
    `);
    await driver.run("INSERT INTO contractors (id, name, phone, tin, address) VALUES (1, 'Ah Kow Construction', '0123456789', 'TIN-001', 'Tawau')");

    await driver.run(`
      CREATE TABLE orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL DEFAULT 1,
        ts INTEGER NOT NULL,
        business_date TEXT,
        inv_no TEXT,
        customer_type TEXT DEFAULT 'contractor',
        contractor_id INTEGER REFERENCES contractors(id),
        contractor_name TEXT,
        discount_cents INTEGER NOT NULL DEFAULT 0,
        total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
        method TEXT NOT NULL CHECK (method IN ('Cash','Card','QR','Bank','Credit')),
        cashier_name TEXT,
        voided_at INTEGER,
        credit_cleared_at INTEGER
      )
    `);

    // Insert historical legacy orders before migration
    await driver.run(`
      INSERT INTO orders (id, company_id, ts, business_date, inv_no, contractor_id, contractor_name, total_cents, method, cashier_name)
      VALUES (1, 1, 1729780000000, '2026-10-24', 'B-0001', 1, 'Ah Kow Construction', 15000, 'Credit', 'Siti')
    `);
    await driver.run(`
      INSERT INTO orders (id, company_id, ts, business_date, inv_no, total_cents, method, cashier_name)
      VALUES (2, 1, 1729780010000, '2026-10-24', 'A-0001', 5000, 'Cash', 'Ali')
    `);

    await driver.run(`
      CREATE TABLE order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL REFERENCES orders(id),
        item_id INTEGER NOT NULL,
        unit TEXT,
        price_cents INTEGER NOT NULL,
        orig_price_cents INTEGER,
        custom_name TEXT,
        qty_milli INTEGER NOT NULL,
        tail_count INTEGER NOT NULL DEFAULT 0
      )
    `);
    await driver.run(`
      INSERT INTO order_items (order_id, item_id, unit, price_cents, qty_milli)
      VALUES (1, 10, 'bag', 1500, 10000)
    `);
    await driver.run(`
      INSERT INTO order_items (order_id, item_id, unit, price_cents, qty_milli)
      VALUES (2, 20, 'pc', 2500, 2000)
    `);

    await driver.run(`
      CREATE TABLE items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL DEFAULT 1,
        key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        image TEXT NOT NULL DEFAULT '',
        unit TEXT NOT NULL DEFAULT 'each',
        tint TEXT NOT NULL DEFAULT '#eee',
        price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
        active INTEGER NOT NULL DEFAULT 1,
        stock_milli INTEGER
      )
    `);
    await driver.run("INSERT INTO items (id, key, name, unit, price_cents, stock_milli) VALUES (10, 'cement', 'Cement Bag', 'bag', 1500, 50000)");
    await driver.run("INSERT INTO items (id, key, name, unit, price_cents, stock_milli) VALUES (20, 'plywood', 'Plywood', 'pc', 2500, 20000)");

    await driver.run(`
      CREATE TABLE credits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL DEFAULT 1,
        order_id INTEGER NOT NULL REFERENCES orders(id),
        name TEXT NOT NULL,
        contractor_id INTEGER REFERENCES contractors(id),
        amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
        date INTEGER NOT NULL DEFAULT 1729780000000,
        is_clear INTEGER
      )
    `);
    await driver.run("INSERT INTO credits (id, company_id, order_id, name, contractor_id, amount_cents) VALUES (1, 1, 1, 'Ah Kow Construction', 1, 15000)");

    // 2. Execute migration via initRepo
    const repo = await initRepo(driver);

    // 3. Verify schema definition in sqlite_master
    const [ordersMaster] = await driver.all("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'");
    const sql = String(ordersMaster?.sql ?? "");
    expect(sql).toContain("total_cents");
    expect(sql).toContain("total_cents >= 0 OR refund_of_order_id IS NOT NULL");

    // 4. Verify pre-existing data is 100% intact
    const legacyB = await repo.getOrder(1);
    expect(legacyB).not.toBeNull();
    expect(legacyB!.invNo).toBe("B-0001");
    expect(legacyB!.contractorName).toBe("Ah Kow Construction");
    expect(legacyB!.totalCents).toBe(15000);
    expect(legacyB!.cashierName).toBe("Siti");
    expect(legacyB!.items).toHaveLength(1);
    expect(legacyB!.items[0]!.priceCents).toBe(1500);

    const legacyA = await repo.getOrder(2);
    expect(legacyA).not.toBeNull();
    expect(legacyA!.invNo).toBe("A-0001");
    expect(legacyA!.totalCents).toBe(5000);
    expect(legacyA!.cashierName).toBe("Ali");

    // 5. Adversarial Check Constraint Validation:
    // Case A: Inserting negative total WITHOUT refund_of_order_id MUST FAIL
    await expect(
      driver.run(`
        INSERT INTO orders (company_id, ts, total_cents, method)
        VALUES (1, ${Date.now()}, -5000, 'Cash')
      `),
    ).rejects.toThrow();

    // Case B: Inserting negative total WITH refund_of_order_id MUST SUCCEED
    await driver.run(`
      INSERT INTO orders (company_id, ts, total_cents, method, refund_of_order_id)
      VALUES (1, ${Date.now()}, -5000, 'Cash', 2)
    `);
    const [insertedRefund] = await driver.all("SELECT id, total_cents, refund_of_order_id FROM orders WHERE total_cents = -5000");
    expect(insertedRefund).toBeDefined();
    expect((insertedRefund as any)!.total_cents).toBe(-5000);
    expect((insertedRefund as any)!.refund_of_order_id).toBe(2);

    // 6. Test idempotent migration: calling initRepo again must succeed with zero data corruption
    const repo2 = await initRepo(driver);
    const orderCheck = await repo2.getOrder(1);
    expect(orderCheck!.totalCents).toBe(15000);
  });

  describe("createRefundOrder Domain & Transaction Stress Testing", () => {
    it("handles multi-line return, partial stock replenishment, and credit balance reduction", async () => {
      const SQL = await initSqlJs();
      const db = new SQL.Database();
      const driver = createSqlJsDriver(db as never);
      const repo = await initRepo(driver);

      // Create item 1 (tracked stock) and item 2 (untracked stock, stock_milli is null)
      await driver.run("INSERT INTO items (key, name, unit, price_cents, stock_milli) VALUES ('t1', 'Tracked', 'pc', 1000, 10000)");
      await driver.run("INSERT INTO items (key, name, unit, price_cents, stock_milli) VALUES ('u1', 'Untracked', 'pc', 2000, NULL)");

      const t1 = (await repo.getItemByKey("t1"))!;
      const u1 = (await repo.getItemByKey("u1"))!;

      // Create contractor
      const contractor = await repo.createContractor({ name: "Guan Seng" });

      // Create original credit order: 5x Tracked (RM 50) + 2x Untracked (RM 40) = RM 90
      const order = await createOrder(repo, {
        method: "Credit",
        contractorId: contractor.id,
        contractorName: contractor.name,
        lines: [
          { itemId: t1.id, qtyMilli: 5000 },
          { itemId: u1.id, qtyMilli: 2000 },
        ],
      });

      expect(order.totalCents).toBe(9000);
      // Tracked stock should have decremented from 10000 to 5000
      let t1Db = (await repo.getItemByKey("t1"))!;
      expect(t1Db.stockMilli).toBe(5000);

      // Refund 2x Tracked (RM 20)
      const refundPlan1 = planPartialRefund(
        order,
        [],
        [{ itemId: t1.id, qtyMilli: 2000 }],
        [{ id: t1.id, stockMilli: 5000 }, { id: u1.id, stockMilli: null }],
      );
      const refund1 = await repo.createRefundOrder(refundPlan1);
      expect(refund1.totalCents).toBe(-2000);
      expect(refund1.refundOfOrderId).toBe(order.id);
      expect(refund1.refundOfInvNo).toBe(order.invNo);

      // Verify stock replenishment: t1 should have increased from 5000 to 7000
      t1Db = (await repo.getItemByKey("t1"))!;
      expect(t1Db.stockMilli).toBe(7000);

      // Verify credit balance reduction: original debt was 9000, now 7000
      const [creditRow] = await driver.all("SELECT * FROM credits WHERE order_id = ?", [order.id]);
      expect((creditRow as any)!.amount_cents).toBe(7000);
      expect((creditRow as any)!.is_clear).toBeNull();

      // Refund remaining 3x Tracked (RM 30) and 2x Untracked (RM 40) = RM 70
      const refundPlan2 = planPartialRefund(
        order,
        [refund1],
        [
          { itemId: t1.id, qtyMilli: 3000 },
          { itemId: u1.id, qtyMilli: 2000 },
        ],
        [{ id: t1.id, stockMilli: 7000 }, { id: u1.id, stockMilli: null }],
      );
      const refund2 = await repo.createRefundOrder(refundPlan2);
      expect(refund2.totalCents).toBe(-7000);

      // Tracked stock should now be fully restored to 10000
      t1Db = (await repo.getItemByKey("t1"))!;
      expect(t1Db.stockMilli).toBe(10000);

      // Untracked stock remains null
      const u1Db = (await repo.getItemByKey("u1"))!;
      expect(u1Db.stockMilli).toBeNull();

      // Credit balance is now 0 and marked is_clear
      const [creditRow2] = await driver.all("SELECT * FROM credits WHERE order_id = ?", [order.id]);
      expect((creditRow2 as any)!.amount_cents).toBe(0);
      expect((creditRow2 as any)!.is_clear).not.toBeNull();

      // Original order creditClearedAt is stamped
      const updatedOrig = (await repo.getOrder(order.id))!;
      expect(updatedOrig.creditClearedAt).not.toBeNull();

      // Attempting any further refund on fully refunded lines must fail
      expect(() =>
        planPartialRefund(
          order,
          [refund1, refund2],
          [{ itemId: t1.id, qtyMilli: 1000 }],
        ),
      ).toThrow("exceeds remaining returnable quantity");
    });
  });
});
