import { describe, it, expect, beforeEach } from "vitest";
import initSqlJs from "sql.js";
import {
  createOrder,
  LEGACY_SEED_ITEMS,
  PosError,
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

describe("SQLite contractor statement math", () => {
  let repo: SqlPosRepo;

  beforeEach(async () => {
    repo = await freshRepo();
  });

  it("Scenario 1: Overpayment / credit balance created via refund on cleared credit order rolls forward cleanly", async () => {
    const items = await repo.listItems();
    const item = items[0]!;

    const contractor: Contractor = await repo.createContractor({
      companyId: 1,
      name: "Toh Brother Builders",
      phone: "013-8889999",
      tin: "C123456789",
      address: "Industrial Road, Keningau",
    });

    // 1. Credit order for 2 bags @ RM 100.00 = RM 200.00 (20,000 cents) in 2026-10
    const order = await createOrder(repo, {
      method: "Credit",
      companyId: 1,
      contractorId: contractor.id,
      contractorName: contractor.name,
      businessDate: "2026-10-05",
      lines: [{ itemId: item.id, qtyMilli: 2000, unitPriceCents: 10000 }],
    });

    // 2. Contractor pays full RM 200.00 on 2026-10-08
    const credits = await repo.listCredits(1, { outstandingOnly: true });
    const targetCredit = credits.find((c) => c.orderId === order.id);
    expect(targetCredit).toBeDefined();

    await repo.recordRepayment({
      companyId: 1,
      contractorId: contractor.id,
      creditId: targetCredit!.id,
      amountCents: 20000, // Full RM 200.00
      method: "Bank",
      businessDate: "2026-10-08",
      notes: "Full clearance",
      cashierName: "Ahmad",
    });

    // 3. Contractor later returns 1 bag (-RM 100.00) on 2026-10-15
    await repo.createRefundOrder({
      originalOrderId: order.id,
      businessDate: "2026-10-15",
      lines: [{ itemId: item.id, qtyMilli: 1000 }],
      note: "Unused bag returned for credit",
    });

    // 4. October Statement:
    // Net month credits = 20000 - 10000 = 10000
    // Repayments = 20000
    // Net = 10000 - 20000 = -10000 (Store owes contractor RM 100.00 credit balance)
    const stmtOct = await repo.getContractorMonthlyStatement(contractor.id, "2026-10", 1);
    expect(stmtOct.broughtForwardCents).toBe(0);
    expect(stmtOct.monthCreditsCents).toBe(10000);
    expect(stmtOct.monthRepaymentsCents).toBe(20000);
    expect(stmtOct.monthNetCents).toBe(-10000);
    expect(stmtOct.closingDebtCents).toBe(-10000);

    // 5. November: New credit purchase of RM 150.00 (15,000 cents)
    await createOrder(repo, {
      method: "Credit",
      companyId: 1,
      contractorId: contractor.id,
      contractorName: contractor.name,
      businessDate: "2026-11-02",
      lines: [{ itemId: item.id, qtyMilli: 1500, unitPriceCents: 10000 }],
    });

    // 6. November Statement:
    // Brought forward = -10000 (credit balance rollforward)
    // Month credits = 15000
    // Closing debt = -10000 + 15000 = 5000 (Contractor now owes RM 50.00)
    const stmtNov = await repo.getContractorMonthlyStatement(contractor.id, "2026-11", 1);
    expect(stmtNov.broughtForwardCents).toBe(-10000);
    expect(stmtNov.broughtForwardCents).toBe(stmtOct.closingDebtCents);
    expect(stmtNov.monthCreditsCents).toBe(15000);
    expect(stmtNov.closingDebtCents).toBe(5000);
  });

  it("Scenario 2: Cross-month partial refund accurately updates SQLite statement rollforward", async () => {
    const items = await repo.listItems();
    const item = items[0]!;

    const contractor: Contractor = await repo.createContractor({
      companyId: 1,
      name: "Lee Jaya Construction",
      phone: "017-7776666",
    });

    // August 2026: 5 bags @ RM 100.00 = RM 500.00 (50,000 cents)
    const augOrder = await createOrder(repo, {
      method: "Credit",
      companyId: 1,
      contractorId: contractor.id,
      contractorName: contractor.name,
      businessDate: "2026-08-10",
      lines: [{ itemId: item.id, qtyMilli: 5000, unitPriceCents: 10000 }],
    });

    // September 2026: Return 2 bags (-RM 200.00)
    await repo.createRefundOrder({
      originalOrderId: augOrder.id,
      businessDate: "2026-09-08",
      lines: [{ itemId: item.id, qtyMilli: 2000 }],
      note: "Faulty batch return",
    });

    // August statement: Closing = 50,000 cents
    const stmtAug = await repo.getContractorMonthlyStatement(contractor.id, "2026-08", 1);
    expect(stmtAug.closingDebtCents).toBe(50000);

    // September statement:
    // Brought forward = 50,000 cents
    // Month credits = -20,000 cents
    // Closing debt = 30,000 cents
    const stmtSep = await repo.getContractorMonthlyStatement(contractor.id, "2026-09", 1);
    expect(stmtSep.broughtForwardCents).toBe(50000);
    expect(stmtSep.broughtForwardCents).toBe(stmtAug.closingDebtCents);
    expect(stmtSep.monthCreditsCents).toBe(-20000);
    expect(stmtSep.closingDebtCents).toBe(30000);
    expect(stmtSep.creditLines[0]!.description).toContain("[REFUND / 退货]");

    // October statement:
    // Brought forward = 30,000 cents
    const stmtOct = await repo.getContractorMonthlyStatement(contractor.id, "2026-10", 1);
    expect(stmtOct.broughtForwardCents).toBe(30000);
    expect(stmtOct.broughtForwardCents).toBe(stmtSep.closingDebtCents);
  });

  it("Scenario 3: Cross-year SQLite query boundary (2026-12 to 2027-01)", async () => {
    const items = await repo.listItems();
    const item = items[0]!;

    const contractor: Contractor = await repo.createContractor({
      companyId: 1,
      name: "Sabah Maju Builders",
      phone: "014-4443333",
    });

    // 2026-12: RM 600.00 purchase
    await createOrder(repo, {
      method: "Credit",
      companyId: 1,
      contractorId: contractor.id,
      contractorName: contractor.name,
      businessDate: "2026-12-20",
      lines: [{ itemId: item.id, qtyMilli: 6000, unitPriceCents: 10000 }],
    });

    // 2027-01: RM 300.00 purchase, RM 250.00 payment
    await createOrder(repo, {
      method: "Credit",
      companyId: 1,
      contractorId: contractor.id,
      contractorName: contractor.name,
      businessDate: "2027-01-08",
      lines: [{ itemId: item.id, qtyMilli: 3000, unitPriceCents: 10000 }],
    });

    const openCredits = await repo.listCredits(1, { outstandingOnly: true });
    expect(openCredits.length).toBeGreaterThan(0);
    await repo.recordRepayment({
      companyId: 1,
      contractorId: contractor.id,
      creditId: openCredits[0]!.id,
      amountCents: 25000,
      method: "Cash",
      businessDate: "2027-01-15",
    });

    // Query 2026-12: Must not leak 2027 data
    const stmtDec = await repo.getContractorMonthlyStatement(contractor.id, "2026-12", 1);
    expect(stmtDec.broughtForwardCents).toBe(0);
    expect(stmtDec.monthCreditsCents).toBe(60000);
    expect(stmtDec.monthRepaymentsCents).toBe(0);
    expect(stmtDec.closingDebtCents).toBe(60000);

    // Query 2027-01: Must roll forward cleanly
    const stmtJan = await repo.getContractorMonthlyStatement(contractor.id, "2027-01", 1);
    expect(stmtJan.broughtForwardCents).toBe(60000);
    expect(stmtJan.broughtForwardCents).toBe(stmtDec.closingDebtCents);
    expect(stmtJan.monthCreditsCents).toBe(30000);
    expect(stmtJan.monthRepaymentsCents).toBe(25000);
    expect(stmtJan.monthNetCents).toBe(5000);
    expect(stmtJan.closingDebtCents).toBe(65000);
  });

  it("Scenario 4: Non-credit contractor orders and voided credit orders are strictly ignored in SQLite", async () => {
    const items = await repo.listItems();
    const item = items[0]!;

    const contractor: Contractor = await repo.createContractor({
      companyId: 1,
      name: "Borneo Timber Co",
    });

    // 1. Cash order by contractor
    await createOrder(repo, {
      method: "Cash",
      customerType: "contractor",
      companyId: 1,
      contractorId: contractor.id,
      contractorName: contractor.name,
      businessDate: "2026-10-02",
      lines: [{ itemId: item.id, qtyMilli: 1000, unitPriceCents: 10000 }],
    });

    // 2. Bank order by contractor
    await createOrder(repo, {
      method: "Bank",
      customerType: "contractor",
      companyId: 1,
      contractorId: contractor.id,
      contractorName: contractor.name,
      businessDate: "2026-10-04",
      lines: [{ itemId: item.id, qtyMilli: 1000, unitPriceCents: 15000 }],
    });

    // 3. Valid Credit order by contractor
    await createOrder(repo, {
      method: "Credit",
      customerType: "contractor",
      companyId: 1,
      contractorId: contractor.id,
      contractorName: contractor.name,
      businessDate: "2026-10-06",
      lines: [{ itemId: item.id, qtyMilli: 1000, unitPriceCents: 22000 }],
    });

    // 4. Credit order that gets voided
    const orderToVoid = await createOrder(repo, {
      method: "Credit",
      customerType: "contractor",
      companyId: 1,
      contractorId: contractor.id,
      contractorName: contractor.name,
      businessDate: "2026-10-08",
      lines: [{ itemId: item.id, qtyMilli: 1000, unitPriceCents: 99000 }],
    });
    await repo.voidOrder(orderToVoid.id, Date.now(), "Manager");

    // 5. Walk-in credit order with different customer
    await createOrder(repo, {
      method: "Credit",
      customerType: "walkin",
      contractorName: "Ad-hoc Walkin Person",
      companyId: 1,
      businessDate: "2026-10-10",
      lines: [{ itemId: item.id, qtyMilli: 1000, unitPriceCents: 50000 }],
    });

    const stmt = await repo.getContractorMonthlyStatement(contractor.id, "2026-10", 1);
    expect(stmt.creditLines).toHaveLength(1);
    expect(stmt.creditLines[0]!.amountCents).toBe(22000);
    expect(stmt.monthCreditsCents).toBe(22000);
    expect(stmt.closingDebtCents).toBe(22000);
  });

  it("Scenario 5: Direct single credit overpayment invariant is enforced by recordRepayment", async () => {
    const items = await repo.listItems();
    const item = items[0]!;

    const contractor: Contractor = await repo.createContractor({
      companyId: 1,
      name: "Guarded Contractor",
    });

    const order = await createOrder(repo, {
      method: "Credit",
      companyId: 1,
      contractorId: contractor.id,
      contractorName: contractor.name,
      businessDate: "2026-10-05",
      lines: [{ itemId: item.id, qtyMilli: 1000, unitPriceCents: 5000 }],
    });

    const credits = await repo.listCredits(1, { outstandingOnly: true });
    const credit = credits.find((c) => c.orderId === order.id)!;

    // Overpayment against single credit row is rejected
    await expect(
      repo.recordRepayment({
        companyId: 1,
        contractorId: contractor.id,
        creditId: credit.id,
        amountCents: 6000, // > 5000
        method: "Cash",
      }),
    ).rejects.toThrow(PosError);
  });
});
