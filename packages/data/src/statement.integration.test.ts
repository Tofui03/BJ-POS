import { describe, it, expect, beforeEach } from "vitest";
import initSqlJs from "sql.js";
import {
  createOrder,
  LEGACY_SEED_ITEMS,
  type Contractor,
} from "@yf/core";
import { createSqlJsDriver, initRepo, SqlPosRepo } from "./index.js";

async function freshRepo(): Promise<SqlPosRepo> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  const driver = createSqlJsDriver(db as never);
  return initRepo(driver, {
    seedDemoOrders: false,
    seedItems: LEGACY_SEED_ITEMS,
    now: new Date(2026, 9, 25),
    rng: () => 0.5,
  });
}

describe("Order Note & Contractor Statement Integration Tests", () => {
  let repo: SqlPosRepo;

  beforeEach(async () => {
    repo = await freshRepo();
  });

  describe("Order Note Persistence & Retrieval", () => {
    it("persists order note in SQLite and retrieves it across getOrder and listOrders", async () => {
      const items = await repo.listItems();
      const firstItem = items[0]!;

      const order = await createOrder(repo, {
        method: "Cash",
        businessDate: "2026-10-25",
        note: "Delivery to workshop gate 3",
        lines: [{ itemId: firstItem.id, qtyMilli: 1000 }],
      });

      expect(order.note).toBe("Delivery to workshop gate 3");

      // Retrieve by ID
      const fetched = await repo.getOrder(order.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.note).toBe("Delivery to workshop gate 3");

      // Retrieve via listOrdersByBusinessDate
      const dayOrders = await repo.listOrdersByBusinessDate("2026-10-25", "2026-10-25");
      const found = dayOrders.find((o) => o.id === order.id);
      expect(found).toBeDefined();
      expect(found?.note).toBe("Delivery to workshop gate 3");
    });
  });

  describe("Contractor Monthly Statement", () => {
    it("correctly aggregates multi-month credit orders, refunds, and repayments", async () => {
      const items = await repo.listItems();
      const cement = items[0]!;

      // 1. Create contractor
      const contractor: Contractor = await repo.createContractor({
        companyId: 1,
        name: "Wong Engineering",
        phone: "019-8877665",
        tin: "C9988776655",
        address: "Jalan Masak, Keningau",
      });

      // 2. Prior month activity: 2026-08 (August)
      // Credit order in August: RM 300.00
      await createOrder(repo, {
        method: "Credit",
        companyId: 1,
        contractorId: contractor.id,
        contractorName: contractor.name,
        businessDate: "2026-08-10",
        lines: [{ itemId: cement.id, qtyMilli: 1000, unitPriceCents: 30000 }],
      });

      // Partial repayment in August: RM 100.00
      const augustCredits = await repo.listCredits(1, { outstandingOnly: true });
      expect(augustCredits.length).toBeGreaterThan(0);
      await repo.recordRepayment({
        companyId: 1,
        contractorId: contractor.id,
        creditId: augustCredits[0]!.id,
        amountCents: 10000,
        method: "Bank",
        businessDate: "2026-08-20",
        notes: "August partial clearance",
      });

      // 3. Current month activity: 2026-09 (September)
      // Credit order 1 in September: RM 500.00 (5 bags @ RM 100)
      const sepOrder1 = await createOrder(repo, {
        method: "Credit",
        companyId: 1,
        contractorId: contractor.id,
        contractorName: contractor.name,
        businessDate: "2026-09-05",
        note: "Site Foundation Batch 1",
        lines: [{ itemId: cement.id, qtyMilli: 5000, unitPriceCents: 10000 }],
      });

      // Credit order 2 in September: RM 250.00
      await createOrder(repo, {
        method: "Credit",
        companyId: 1,
        contractorId: contractor.id,
        contractorName: contractor.name,
        businessDate: "2026-09-12",
        lines: [{ itemId: cement.id, qtyMilli: 1000, unitPriceCents: 25000 }],
      });

      // Credit return / refund for sepOrder1 in September: return 1 bag (-RM 100.00)
      await repo.createRefundOrder({
        originalOrderId: sepOrder1.id,
        businessDate: "2026-09-18",
        lines: [{ itemId: cement.id, qtyMilli: 1000 }],
        note: "Damaged cement returned",
      });

      // Repayment in September: RM 400.00
      const sepCredits = await repo.listCredits(1, { outstandingOnly: true });
      const targetCredit = sepCredits.find((c) => c.orderId === sepOrder1.id);
      expect(targetCredit).toBeDefined();
      await repo.recordRepayment({
        companyId: 1,
        contractorId: contractor.id,
        creditId: targetCredit!.id,
        amountCents: 40000,
        method: "Cash",
        businessDate: "2026-09-22",
        cashierName: "Ahmad",
      });

      // 4. Query Monthly Statement for September 2026
      const statement = await repo.getContractorMonthlyStatement(contractor.id, "2026-09", 1);

      // Verify opening balance (August brought forward): RM 300 - RM 100 = RM 200.00 (20,000 cents)
      expect(statement.broughtForwardCents).toBe(20000);

      // Verify current month charges: RM 500 + RM 250 - RM 100 (refund) = RM 650.00 (65,000 cents)
      expect(statement.monthCreditsCents).toBe(65000);
      expect(statement.creditLines).toHaveLength(3);
      expect(statement.creditLines[0]!.description).toContain("Site Foundation Batch 1");
      expect(statement.creditLines[2]!.amountCents).toBe(-10000);
      expect(statement.creditLines[2]!.description).toContain("[REFUND / 退货]");

      // Verify current month repayments: RM 400.00 (40,000 cents)
      expect(statement.monthRepaymentsCents).toBe(40000);
      expect(statement.repaymentLines).toHaveLength(1);
      expect(statement.repaymentLines[0]!.cashierName).toBe("Ahmad");

      // Verify net movement: RM 650 - RM 400 = RM 250.00 (25,000 cents)
      expect(statement.monthNetCents).toBe(25000);

      // Verify closing debt: RM 200 + RM 250 = RM 450.00 (45,000 cents)
      expect(statement.closingDebtCents).toBe(45000);

      // Query by contractor name string as well
      const statementByName = await repo.getContractorMonthlyStatement("Wong Engineering", "2026-09", 1);
      expect(statementByName.closingDebtCents).toBe(45000);
    });
  });
});
