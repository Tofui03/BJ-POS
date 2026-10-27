import { describe, expect, it, beforeEach } from "vitest";
import initSqlJs from "sql.js";
import { createSqlJsDriver } from "./sqljs.js";
import { initRepo } from "./init.js";
import {
  createOrder,
  LEGACY_SEED_ITEMS,
  type Contractor,
  type Order,
} from "@yf/core";
import { PosError } from "@yf/core";

describe("Schema migration and order notes", () => {
  describe("Scenario A: Schema Backward Compatibility & Idempotency", () => {
    it("migrates a legacy database lacking 'note' column without data loss and preserves idempotency", async () => {
      const SQL = await initSqlJs();
      const db = new SQL.Database();
      const driver = createSqlJsDriver(db as never);

      // 1. Create legacy schema simulating pre-M3 database (orders table has NO note column)
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
      await driver.run(`
        INSERT INTO contractors (id, name, phone, tin, address, active)
        VALUES (1, 'Legacy Contractor Corp', '012-3456789', 'TIN-LEGACY-001', 'Old Street 12', 1)
      `);

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
          customer_tin TEXT,
          customer_address TEXT,
          customer_phone TEXT,
          do_no TEXT,
          site_address TEXT,
          lorry_plate TEXT,
          driver_name TEXT,
          contractor_po TEXT,
          show_price_on_do INTEGER DEFAULT 1,
          discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
          total_cents INTEGER NOT NULL CHECK (total_cents >= 0 OR refund_of_order_id IS NOT NULL),
          refund_of_order_id INTEGER REFERENCES orders(id),
          method TEXT NOT NULL CHECK (method IN ('Cash','Card','QR','Bank','Credit')),
          cashier_name TEXT,
          voided_at INTEGER,
          voided_by TEXT,
          credit_cleared_at INTEGER
        )
      `);

      // Insert pre-existing orders before migration
      await driver.run(`
        INSERT INTO orders (
          id, company_id, ts, business_date, inv_no, customer_type, contractor_id, contractor_name,
          discount_cents, total_cents, method, cashier_name
        ) VALUES (
          101, 1, 1729780000000, '2026-10-24', 'B-0001', 'contractor', 1, 'Legacy Contractor Corp',
          0, 25000, 'Credit', 'Siti'
        )
      `);

      await driver.run(`
        INSERT INTO orders (
          id, company_id, ts, business_date, inv_no, customer_type, contractor_id, contractor_name,
          discount_cents, total_cents, method, cashier_name
        ) VALUES (
          102, 1, 1729780050000, '2026-10-24', 'A-0001', 'walkin', NULL, NULL,
          500, 4500, 'Cash', 'Ali'
        )
      `);

      await driver.run(`
        CREATE TABLE order_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_id INTEGER NOT NULL REFERENCES orders(id),
          item_id INTEGER NOT NULL,
          unit TEXT,
          price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
          orig_price_cents INTEGER,
          custom_name TEXT,
          qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
          tail_count INTEGER NOT NULL DEFAULT 0
        )
      `);
      await driver.run(`
        INSERT INTO order_items (order_id, item_id, unit, price_cents, qty_milli)
        VALUES (101, 1, 'bag', 25000, 1000)
      `);
      await driver.run(`
        INSERT INTO order_items (order_id, item_id, unit, price_cents, qty_milli)
        VALUES (102, 2, 'pc', 5000, 1000)
      `);

      await driver.run(`
        CREATE TABLE credits (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company_id INTEGER NOT NULL DEFAULT 1,
          order_id INTEGER NOT NULL REFERENCES orders(id),
          name TEXT NOT NULL,
          amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
          date INTEGER NOT NULL,
          is_clear INTEGER,
          cleared_method TEXT
        )
      `);
      await driver.run(`
        INSERT INTO credits (id, company_id, order_id, name, amount_cents, date, is_clear)
        VALUES (1, 1, 101, 'Legacy Contractor Corp', 25000, 1729780000000, NULL)
      `);

      // Verify that 'note' column is NOT in orders before migration
      const colsBefore = await driver.all("PRAGMA table_info(orders)");
      expect(colsBefore.some((c) => c.name === "note")).toBe(false);

      // 2. Run initRepo to trigger ensureColumn and schema migration
      const repo = await initRepo(driver, {
        seedDemoOrders: false,
        seedItems: LEGACY_SEED_ITEMS,
        now: new Date(2026, 9, 25),
      });

      // 3. Verify 'note' column now exists in orders
      const colsAfter = await driver.all("PRAGMA table_info(orders)");
      const noteCol = colsAfter.find((c) => c.name === "note");
      expect(noteCol).toBeDefined();
      expect(String(noteCol?.type).toUpperCase()).toBe("TEXT");

      // 4. Verify historical orders are intact and have note as undefined/null
      const legacyOrder101 = await repo.getOrder(101);
      expect(legacyOrder101).not.toBeNull();
      expect(legacyOrder101?.invNo).toBe("B-0001");
      expect(legacyOrder101?.totalCents).toBe(25000);
      expect(legacyOrder101?.contractorName).toBe("Legacy Contractor Corp");
      expect(legacyOrder101?.note).toBeUndefined();

      const legacyOrder102 = await repo.getOrder(102);
      expect(legacyOrder102).not.toBeNull();
      expect(legacyOrder102?.invNo).toBe("A-0001");
      expect(legacyOrder102?.totalCents).toBe(4500);
      expect(legacyOrder102?.note).toBeUndefined();

      // 5. Insert new order with note after migration
      const items = await repo.listItems();
      const item = items[0]!;
      const postMigrationOrder = await createOrder(repo, {
        method: "Cash",
        businessDate: "2026-10-25",
        note: "Post-migration order note verification",
        lines: [{ itemId: item.id, qtyMilli: 1000 }],
      });
      expect(postMigrationOrder.note).toBe("Post-migration order note verification");

      const fetchedNewOrder = await repo.getOrder(postMigrationOrder.id);
      expect(fetchedNewOrder?.note).toBe("Post-migration order note verification");

      // 6. Test IDEMPOTENCY: Run initRepo a second time on the same DB
      const repoSecondRun = await initRepo(driver, {
        seedDemoOrders: false,
        seedItems: LEGACY_SEED_ITEMS,
        now: new Date(2026, 9, 25),
      });

      // Ensure no duplication of columns, no corruption of existing or new data
      const colsSecondRun = await driver.all("PRAGMA table_info(orders)");
      const noteCols = colsSecondRun.filter((c) => c.name === "note");
      expect(noteCols).toHaveLength(1);

      const rechecked101 = await repoSecondRun.getOrder(101);
      expect(rechecked101?.totalCents).toBe(25000);
      expect(rechecked101?.note).toBeUndefined();

      const recheckedNew = await repoSecondRun.getOrder(postMigrationOrder.id);
      expect(recheckedNew?.note).toBe("Post-migration order note verification");
    });
  });

  describe("Scenario B: Order Note Persistence Extremes & Normalization", () => {
    let repo: any;

    const setupFreshRepo = async () => {
      const SQL = await initSqlJs();
      const db = new SQL.Database();
      const driver = createSqlJsDriver(db as never);
      return initRepo(driver, {
        seedDemoOrders: false,
        seedItems: LEGACY_SEED_ITEMS,
        now: new Date(2026, 9, 25),
      });
    };

    it("persists 1000-character and 2000-character long note strings without truncation", async () => {
      repo = await setupFreshRepo();
      const items = await repo.listItems();
      const item = items[0]!;

      // 1000-character string
      const longNote1000 = "A".repeat(1000);
      const order1000 = await createOrder(repo, {
        method: "Cash",
        businessDate: "2026-10-25",
        note: longNote1000,
        lines: [{ itemId: item.id, qtyMilli: 1000 }],
      });

      expect(order1000.note).toBe(longNote1000);
      expect(order1000.note?.length).toBe(1000);

      const fetched1000 = await repo.getOrder(order1000.id);
      expect(fetched1000?.note).toBe(longNote1000);
      expect(fetched1000?.note?.length).toBe(1000);

      // 2000-character multiline string
      const multiline2000 = "Line of note text for testing.\n".repeat(60) + "Final 2000 tail.";
      const order2000 = await createOrder(repo, {
        method: "Cash",
        businessDate: "2026-10-25",
        note: multiline2000,
        lines: [{ itemId: item.id, qtyMilli: 1000 }],
      });
      const fetched2000 = await repo.getOrder(order2000.id);
      expect(fetched2000?.note).toBe(multiline2000);
    });

    it("persists special characters, SQL injection strings, HTML/XML tags, and Unicode", async () => {
      repo = await setupFreshRepo();
      const items = await repo.listItems();
      const item = items[0]!;

      const specialNotes = [
        "Special chars: & < > \" ' ` / \\ \n \r \t",
        "SQL injection attempt: '); DROP TABLE orders; DROP TABLE items; --",
        "XSS string: <script>alert('pwned')</script><img src=\"x\" onerror=\"eval(atob('...'))\" />",
        "Unicode & Emojis: 施工现场 ⚠️ 需备重型吊车 🚚🏗️ RM 1,250.00 谢谢合作！",
        "CRLF sequence:\r\nFirst line\r\nSecond line\r\nThird line\r\n",
      ];

      for (const [idx, noteStr] of specialNotes.entries()) {
        const order = await createOrder(repo, {
          method: "Cash",
          businessDate: "2026-10-25",
          note: noteStr,
          lines: [{ itemId: item.id, qtyMilli: 1000 }],
        });

        // Expected to be trimmed at boundaries but internal newlines/special chars preserved
        expect(order.note).toBe(noteStr.trim());

        const fetched = await repo.getOrder(order.id);
        expect(fetched?.note).toBe(noteStr.trim());

        // Verify across listOrdersByBusinessDate
        const list = await repo.listOrdersByBusinessDate("2026-10-25", "2026-10-25");
        const found = list.find((o: Order) => o.id === order.id);
        expect(found?.note).toBe(noteStr.trim());
      }
    });

    it("normalizes empty strings and whitespace-only strings to null/undefined", async () => {
      repo = await setupFreshRepo();
      const items = await repo.listItems();
      const item = items[0]!;

      const whitespaceInputs = [
        "",
        "   ",
        "\t\t",
        "\n\n\r\n",
        "  \t \n  \r\n  ",
      ];

      for (const emptyInput of whitespaceInputs) {
        const order = await createOrder(repo, {
          method: "Cash",
          businessDate: "2026-10-25",
          note: emptyInput,
          lines: [{ itemId: item.id, qtyMilli: 1000 }],
        });

        expect(order.note).toBeUndefined();

        const fetched = await repo.getOrder(order.id);
        expect(fetched?.note).toBeUndefined();
      }

      // Trimming behavior for strings with leading/trailing whitespace
      const trimmedOrder = await createOrder(repo, {
        method: "Cash",
        businessDate: "2026-10-25",
        note: "   Padang Jawa Site Office   \n",
        lines: [{ itemId: item.id, qtyMilli: 1000 }],
      });
      expect(trimmedOrder.note).toBe("Padang Jawa Site Office");
      const fetchedTrimmed = await repo.getOrder(trimmedOrder.id);
      expect(fetchedTrimmed?.note).toBe("Padang Jawa Site Office");
    });

    it("persists notes on refund orders and DO orders", async () => {
      repo = await setupFreshRepo();
      const items = await repo.listItems();
      const item = items[0]!;

      // 1. Order with DO and note
      const doOrder = await createOrder(repo, {
        method: "Cash",
        businessDate: "2026-10-25",
        note: "Deliver only during lunch hour 12pm-2pm",
        issueDo: true,
        siteAddress: "Plot 44 Industrial Park",
        lines: [{ itemId: item.id, qtyMilli: 2000 }],
      });
      expect(doOrder.note).toBe("Deliver only during lunch hour 12pm-2pm");
      expect(doOrder.issueDo).toBe(true);

      const fetchedDo = await repo.getOrder(doOrder.id);
      expect(fetchedDo?.note).toBe("Deliver only during lunch hour 12pm-2pm");

      // 2. Partial refund with dedicated refund note
      const refundOrder = await repo.createRefundOrder({
        originalOrderId: doOrder.id,
        businessDate: "2026-10-25",
        lines: [{ itemId: item.id, qtyMilli: 1000 }],
        note: "Item damaged during transport, returning 1 unit",
      });
      expect(refundOrder.note).toBe("Item damaged during transport, returning 1 unit");
      expect(refundOrder.refundOfOrderId).toBe(doOrder.id);

      const fetchedRefund = await repo.getOrder(refundOrder.id);
      expect(fetchedRefund?.note).toBe("Item damaged during transport, returning 1 unit");
    });
  });

  describe("Scenario C: getContractorMonthlyStatement Query Resolution Diversity", () => {
    let repo: any;
    let contractor: Contractor;

    beforeEach(async () => {
      const SQL = await initSqlJs();
      const db = new SQL.Database();
      const driver = createSqlJsDriver(db as never);
      repo = await initRepo(driver, {
        seedDemoOrders: false,
        seedItems: LEGACY_SEED_ITEMS,
        now: new Date(2026, 9, 25),
      });

      contractor = await repo.createContractor({
        companyId: 1,
        name: "Lian Seng Construction",
        phone: "017-1234567",
        tin: "TIN-LS-8899",
        address: "Lorong Industri 3, Sandakan",
      });

      const items = await repo.listItems();
      const steel = items[0]!;

      // Prior month (August 2026) credit: RM 800.00
      await createOrder(repo, {
        method: "Credit",
        companyId: 1,
        contractorId: contractor.id,
        contractorName: contractor.name,
        businessDate: "2026-08-15",
        lines: [{ itemId: steel.id, qtyMilli: 1000, unitPriceCents: 80000 }],
      });

      // Prior month partial repayment: RM 300.00
      const augCredits = await repo.listCredits(1, { outstandingOnly: true });
      await repo.recordRepayment({
        companyId: 1,
        contractorId: contractor.id,
        creditId: augCredits[0]!.id,
        amountCents: 30000,
        method: "Bank",
        businessDate: "2026-08-25",
      });

      // Current month (September 2026) credit: RM 1,200.00
      await createOrder(repo, {
        method: "Credit",
        companyId: 1,
        contractorId: contractor.id,
        contractorName: contractor.name,
        businessDate: "2026-09-10",
        note: "Phase 2 reinforcement bars",
        lines: [{ itemId: steel.id, qtyMilli: 1000, unitPriceCents: 120000 }],
      });

      // Current month repayment: RM 500.00
      const sepCredits = await repo.listCredits(1, { outstandingOnly: true });
      const target = sepCredits.find((c: any) => c.amountCents === 120000);
      await repo.recordRepayment({
        companyId: 1,
        contractorId: contractor.id,
        creditId: target!.id,
        amountCents: 50000,
        method: "Cash",
        businessDate: "2026-09-20",
      });
    });

    it("resolves identically across contractorId (number), exact name, untrimmed name, lowercase, uppercase, and string numeric ID", async () => {
      // 1. By ID (number)
      const stById = await repo.getContractorMonthlyStatement(contractor.id, "2026-09", 1);

      // 2. By Exact Name (string)
      const stByExactName = await repo.getContractorMonthlyStatement("Lian Seng Construction", "2026-09", 1);

      // 3. By Untrimmed Name (leading & trailing spaces)
      const stByUntrimmed = await repo.getContractorMonthlyStatement("   Lian Seng Construction   ", "2026-09", 1);

      // 4. By Lowercase Name
      const stByLower = await repo.getContractorMonthlyStatement("lian seng construction", "2026-09", 1);

      // 5. By Uppercase Name
      const stByUpper = await repo.getContractorMonthlyStatement("LIAN SENG CONSTRUCTION", "2026-09", 1);

      // 6. By String Numeric ID
      const stByStringId = await repo.getContractorMonthlyStatement(String(contractor.id), "2026-09", 1);

      const allStatements = [stById, stByExactName, stByUntrimmed, stByLower, stByUpper, stByStringId];

      for (const st of allStatements) {
        expect(st.contractor.id).toBe(contractor.id);
        expect(st.contractor.name).toBe("Lian Seng Construction");
        expect(st.yearMonth).toBe("2026-09");

        // Opening balance from August: 80,000 - 30,000 = 50,000 cents (RM 500.00)
        expect(st.broughtForwardCents).toBe(50000);

        // September purchases: 120,000 cents (RM 1,200.00)
        expect(st.monthCreditsCents).toBe(120000);
        expect(st.creditLines).toHaveLength(1);
        expect(st.creditLines[0]!.description).toContain("Phase 2 reinforcement bars");

        // September repayments: 50,000 cents (RM 500.00)
        expect(st.monthRepaymentsCents).toBe(50000);
        expect(st.repaymentLines).toHaveLength(1);

        // Net movement: 120,000 - 50,000 = 70,000 cents (RM 700.00)
        expect(st.monthNetCents).toBe(70000);

        // Closing debt: 50,000 + 70,000 = 120,000 cents (RM 1,200.00)
        expect(st.closingDebtCents).toBe(120000);
      }
    });

    it("throws PosError when contractor cannot be found by string name or non-existent ID", async () => {
      await expect(
        repo.getContractorMonthlyStatement("Ghost Contractor Enterprise", "2026-09", 1),
      ).rejects.toThrow(PosError);

      await expect(
        repo.getContractorMonthlyStatement(999999, "2026-09", 1),
      ).rejects.toThrow(PosError);

      await expect(
        repo.getContractorMonthlyStatement("999999", "2026-09", 1),
      ).rejects.toThrow(PosError);
    });
  });

  describe("Scenario D: Historical Credit Orders Lacking contractor_id Resolution", () => {
    it("correctly includes historical credit orders matching contractor_name or credits.name without contractor_id", async () => {
      const SQL = await initSqlJs();
      const db = new SQL.Database();
      const driver = createSqlJsDriver(db as never);

      // Create pre-existing database with contractor and legacy credit records
      const repo = await initRepo(driver, {
        seedDemoOrders: false,
        seedItems: LEGACY_SEED_ITEMS,
        now: new Date(2026, 9, 25),
      });

      // 1. Create registered contractor
      const contractor = await repo.createContractor({
        companyId: 1,
        name: "Ah Kow Builder",
        phone: "013-9998888",
        tin: "TIN-AKB-1234",
        address: "Tawau Old Town",
      });

      // 2. Manually inject historical orders simulating older versions:
      // Order 201: Prior month (2026-07) with contractor_id = NULL, contractor_name = 'Ah Kow Builder'
      await driver.run(`
        INSERT INTO orders (
          id, company_id, ts, business_date, inv_no, customer_type, contractor_id, contractor_name,
          discount_cents, total_cents, method, cashier_name, note
        ) VALUES (
          201, 1, 1721000000000, '2026-07-10', 'B-0010', 'contractor', NULL, 'Ah Kow Builder',
          0, 30000, 'Credit', 'OldCashier', 'Legacy order with contractor_name but no id'
        )
      `);
      await driver.run(`
        INSERT INTO order_items (order_id, item_id, unit, price_cents, qty_milli)
        VALUES (201, 1, 'bag', 30000, 1000)
      `);
      await driver.run(`
        INSERT INTO credits (id, company_id, order_id, name, amount_cents, date, is_clear)
        VALUES (201, 1, 201, 'Ah Kow Builder', 30000, 1721000000000, NULL)
      `);

      // Order 202: Historical order (2026-07) with contractor_id = NULL, contractor_name = NULL,
      // but credits.name = 'Ah Kow Builder'
      await driver.run(`
        INSERT INTO orders (
          id, company_id, ts, business_date, inv_no, customer_type, contractor_id, contractor_name,
          discount_cents, total_cents, method, cashier_name
        ) VALUES (
          202, 1, 1721100000000, '2026-07-15', 'B-0011', 'contractor', NULL, NULL,
          0, 20000, 'Credit', 'OldCashier'
        )
      `);
      await driver.run(`
        INSERT INTO order_items (order_id, item_id, unit, price_cents, qty_milli)
        VALUES (202, 1, 'bag', 20000, 1000)
      `);
      await driver.run(`
        INSERT INTO credits (id, company_id, order_id, name, amount_cents, date, is_clear)
        VALUES (202, 1, 202, 'ah kow builder', 20000, 1721100000000, NULL)
      `);

      // Repayment 301 in 2026-07 with contractor_id = NULL, credit_id = 201 (links to credits.name)
      await driver.run(`
        INSERT INTO repayments (
          id, company_id, credit_id, order_id, contractor_id, amount_cents, method, ts, business_date, notes
        ) VALUES (
          301, 1, 201, 201, NULL, 15000, 'Bank', 1721200000000, '2026-07-20', 'Historical partial payment'
        )
      `);

      // Order 203: Current target month (2026-08) with contractor_id = NULL, but contractor_name = 'Ah Kow Builder'
      await driver.run(`
        INSERT INTO orders (
          id, company_id, ts, business_date, inv_no, customer_type, contractor_id, contractor_name,
          discount_cents, total_cents, method, cashier_name, note
        ) VALUES (
          203, 1, 1723000000000, '2026-08-05', 'B-0020', 'contractor', NULL, 'Ah Kow Builder',
          0, 40000, 'Credit', 'ModernCashier', 'Site expansion batch'
        )
      `);
      await driver.run(`
        INSERT INTO order_items (order_id, item_id, unit, price_cents, qty_milli)
        VALUES (203, 1, 'bag', 40000, 1000)
      `);
      await driver.run(`
        INSERT INTO credits (id, company_id, order_id, name, amount_cents, date, is_clear)
        VALUES (203, 1, 203, 'Ah Kow Builder', 40000, 1723000000000, NULL)
      `);

      // Order 204: Current target month (2026-08) created with proper contractor_id
      const modernOrder = await createOrder(repo, {
        method: "Credit",
        companyId: 1,
        contractorId: contractor.id,
        contractorName: contractor.name,
        businessDate: "2026-08-18",
        note: "Modern credit order with FK",
        lines: [{ itemId: 1, qtyMilli: 1000, unitPriceCents: 10000 }],
      });

      // 3. Test listCreditOrdersForContractor directly
      const creditOrders = await repo.listCreditOrdersForContractor(contractor.id, 1, { upToYearMonth: "2026-08" });
      const orderIds = creditOrders.map((o: Order) => o.id);

      // Must find historical 201 (matched via contractor_name)
      expect(orderIds).toContain(201);
      // Must find historical 202 (matched via credits.name)
      expect(orderIds).toContain(202);
      // Must find historical 203 (matched via contractor_name)
      expect(orderIds).toContain(203);
      // Must find modern 204 (matched via contractor_id)
      expect(orderIds).toContain(modernOrder.id);

      // 4. Test listRepaymentsForContractor directly
      const repayments = await repo.listRepaymentsForContractor(contractor.id, 1, { upToYearMonth: "2026-08" });
      const repaymentIds = repayments.map((r: any) => r.id);
      expect(repaymentIds).toContain(301);

      // 5. Query monthly statement for 2026-08
      const statement = await repo.getContractorMonthlyStatement(contractor.id, "2026-08", 1);

      // Opening balance brought forward from 2026-07:
      // Orders: 201 (30,000) + 202 (20,000) = 50,000 cents
      // Repayments: 301 (-15,000)
      // Opening debt: 50,000 - 15,000 = 35,000 cents (RM 350.00)
      expect(statement.broughtForwardCents).toBe(35000);

      // Current month (August 2026) charges:
      // Orders: 203 (40,000) + modernOrder (10,000) = 50,000 cents (RM 500.00)
      expect(statement.monthCreditsCents).toBe(50000);
      expect(statement.creditLines).toHaveLength(2);

      // Month repayments: 0 cents
      expect(statement.monthRepaymentsCents).toBe(0);

      // Net movement: +50,000 cents
      expect(statement.monthNetCents).toBe(50000);

      // Closing debt: 35,000 + 50,000 = 85,000 cents (RM 850.00)
      expect(statement.closingDebtCents).toBe(85000);
    });
  });
});
