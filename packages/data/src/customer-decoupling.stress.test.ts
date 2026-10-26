import { describe, it, expect, beforeEach } from "vitest";
import initSqlJs from "sql.js";
import {
  createOrder,
  computeStats,
  LEGACY_SEED_ITEMS,
  type Order,
  type PaymentMethod,
} from "@yf/core";
import { createSqlJsDriver, initRepo, SqlPosRepo } from "./index.js";
import type { SqlDriver } from "./driver.js";

/**
 * Empirical Stress Harness for Customer Decoupling in @yf/data.
 *
 * Verifies that:
 * 1. Contractors paying Cash, Bank, QR generate B-xxxx invoice sequences without inserting rows into credits table.
 * 2. Walk-ins paying Cash generate A-xxxx invoice sequences without inserting rows into credits table.
 * 3. Contractors paying Credit generate B-xxxx invoice sequences AND insert open credit rows into credits table.
 * 4. DO metadata and monthly resets function correctly under decoupled customer flows.
 */

describe("Empirical Stress Harness: Customer Decoupling & Credit Prevention", () => {
  let rawDb: any;
  let driver: SqlDriver;
  let repo: SqlPosRepo;

  beforeEach(async () => {
    const SQL = await initSqlJs();
    rawDb = new SQL.Database();
    driver = createSqlJsDriver(rawDb as never);
    repo = await initRepo(driver, {
      seedDemoOrders: false,
      seedItems: LEGACY_SEED_ITEMS,
      now: new Date(2026, 9, 23), // October 2026
      rng: () => 0.5,
    });
  });

  async function getCreditsCount(): Promise<number> {
    const rows = await driver.all("SELECT COUNT(*) AS cnt FROM credits");
    return Number(rows[0]?.cnt ?? 0);
  }

  it("stress-tests customer decoupling: 10 Cash + 10 Bank + 10 QR contractor orders producing B-series without credits insertion, 5 Walk-in Cash producing A-series, 5 Contractor Credit producing B-series with credits", async () => {
    const fish = (await repo.getItemByKey("tilapia"))!;
    expect(fish).toBeDefined();

    // Create a registered partner contractor
    const contractor = await repo.createContractor({
      name: "Syarikat Pembinaan Megah Sdn Bhd",
      phone: "019-8765432",
      tin: "C1234567890",
      address: "Lot 99, Kawasan Perindustrian Pending, Kuching",
    });
    expect(contractor.id).toBeDefined();

    // Initial check: credits table must be completely empty
    expect(await getCreditsCount()).toBe(0);

    const contractorCashOrders: Order[] = [];
    const contractorBankOrders: Order[] = [];
    const contractorQrOrders: Order[] = [];

    // --- Phase 1: 10 Contractor orders with Cash ---
    for (let i = 1; i <= 10; i++) {
      const order = await createOrder(repo, {
        businessDate: "2026-10-23",
        customerType: "contractor",
        contractorId: contractor.id,
        contractorName: contractor.name,
        contractorTin: contractor.tin,
        contractorAddress: contractor.address,
        contractorPhone: contractor.phone,
        method: "Cash",
        lines: [{ itemId: fish.id, qtyMilli: 1000 }],
      });
      contractorCashOrders.push(order);
    }

    // --- Phase 2: 10 Contractor orders with Bank ---
    for (let i = 1; i <= 10; i++) {
      const order = await createOrder(repo, {
        businessDate: "2026-10-23",
        customerType: "contractor",
        contractorId: contractor.id,
        contractorName: contractor.name,
        contractorTin: contractor.tin,
        contractorAddress: contractor.address,
        contractorPhone: contractor.phone,
        method: "Bank",
        lines: [{ itemId: fish.id, qtyMilli: 1000 }],
      });
      contractorBankOrders.push(order);
    }

    // --- Phase 3: 10 Contractor orders with QR ---
    for (let i = 1; i <= 10; i++) {
      const order = await createOrder(repo, {
        businessDate: "2026-10-23",
        customerType: "contractor",
        contractorId: contractor.id,
        contractorName: contractor.name,
        contractorTin: contractor.tin,
        contractorAddress: contractor.address,
        contractorPhone: contractor.phone,
        method: "QR",
        lines: [{ itemId: fish.id, qtyMilli: 1000 }],
      });
      contractorQrOrders.push(order);
    }

    // Verify all 30 contractor orders
    const all30Orders = [...contractorCashOrders, ...contractorBankOrders, ...contractorQrOrders];
    expect(all30Orders).toHaveLength(30);

    // 1. Assert all 30 orders receive B-xxxx invoice numbers monotonically from B-0001 to B-0030
    for (let i = 0; i < 30; i++) {
      const expectedSeq = String(i + 1).padStart(4, "0");
      expect(all30Orders[i]!.invNo).toBe(`B-${expectedSeq}`);
      expect(all30Orders[i]!.contractorName).toBe("Syarikat Pembinaan Megah Sdn Bhd");
      expect(all30Orders[i]!.contractorTin).toBe("C1234567890");
      expect(all30Orders[i]!.contractorAddress).toBe("Lot 99, Kawasan Perindustrian Pending, Kuching");
    }

    // Specific slice checks
    expect(contractorCashOrders[0]!.invNo).toBe("B-0001");
    expect(contractorCashOrders[9]!.invNo).toBe("B-0010");
    expect(contractorBankOrders[0]!.invNo).toBe("B-0011");
    expect(contractorBankOrders[9]!.invNo).toBe("B-0020");
    expect(contractorQrOrders[0]!.invNo).toBe("B-0021");
    expect(contractorQrOrders[9]!.invNo).toBe("B-0030");

    // 2. CRITICAL ASSERTION: Assert SELECT COUNT(*) FROM credits returns 0
    const creditsCountAfter30 = await getCreditsCount();
    expect(creditsCountAfter30).toBe(0);

    const creditsList = await repo.listCredits(1);
    expect(creditsList).toHaveLength(0);

    // --- Phase 4: Create 5 walk-in orders with Cash ---
    const walkInOrders: Order[] = [];
    for (let i = 1; i <= 5; i++) {
      const order = await createOrder(repo, {
        businessDate: "2026-10-23",
        customerType: "walkin",
        method: "Cash",
        lines: [{ itemId: fish.id, qtyMilli: 1000 }],
      });
      walkInOrders.push(order);
    }

    // Assert all 5 walk-in orders receive A-xxxx invoice numbers from A-0001 to A-0005
    expect(walkInOrders).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      const expectedSeq = String(i + 1).padStart(4, "0");
      expect(walkInOrders[i]!.invNo).toBe(`A-${expectedSeq}`);
      expect(walkInOrders[i]!.contractorName).toBeUndefined();
      expect(walkInOrders[i]!.contractorId).toBeUndefined();
    }

    // Credits count must still be 0!
    expect(await getCreditsCount()).toBe(0);

    // --- Phase 5: Create 5 contractor orders with Credit ---
    const creditOrders: Order[] = [];
    for (let i = 1; i <= 5; i++) {
      const order = await createOrder(repo, {
        businessDate: "2026-10-23",
        customerType: "contractor",
        contractorId: contractor.id,
        contractorName: contractor.name,
        method: "Credit",
        lines: [{ itemId: fish.id, qtyMilli: 2000 }],
      });
      creditOrders.push(order);
    }

    // Assert all 5 credit orders continue the B-xxxx sequence from B-0031 to B-0035
    expect(creditOrders).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      const expectedSeq = String(30 + i + 1).padStart(4, "0");
      expect(creditOrders[i]!.invNo).toBe(`B-${expectedSeq}`);
      expect(creditOrders[i]!.contractorName).toBe("Syarikat Pembinaan Megah Sdn Bhd");
    }

    // 3. CRITICAL ASSERTION: credits table has EXACTLY 5 open credit rows
    const creditsCountAfterCredit = await getCreditsCount();
    expect(creditsCountAfterCredit).toBe(5);

    const openCredits = await repo.listCredits(1, { outstandingOnly: true });
    expect(openCredits).toHaveLength(5);
    // Sort openCredits by orderId ascending to compare with creditOrders
    const sortedOpenCredits = [...openCredits].sort((a, b) => a.orderId - b.orderId);
    for (let i = 0; i < 5; i++) {
      expect(sortedOpenCredits[i]!.orderId).toBe(creditOrders[i]!.id);
      expect(sortedOpenCredits[i]!.invNo).toBe(creditOrders[i]!.invNo);
      expect(sortedOpenCredits[i]!.name).toBe("Syarikat Pembinaan Megah Sdn Bhd");
      expect(sortedOpenCredits[i]!.amountCents).toBe(creditOrders[i]!.totalCents);
      expect(sortedOpenCredits[i]!.clearedAt).toBeNull();
    }

    // Verify raw SQL row examination in credits table
    const creditRows = await driver.all("SELECT id, order_id, name, amount_cents, is_clear FROM credits");
    expect(creditRows).toHaveLength(5);
    const creditedOrderIds = new Set(creditRows.map((r) => r.order_id));
    for (const co of creditOrders) {
      expect(creditedOrderIds.has(co.id)).toBe(true);
    }
    for (const nonCreditOrder of [...all30Orders, ...walkInOrders]) {
      expect(creditedOrderIds.has(nonCreditOrder.id)).toBe(false);
    }

    // Verify sales reporting and aggregates
    const allPersistedOrders = await repo.listOrders(0, Date.now() + 100000);
    const stats = computeStats(allPersistedOrders, "today");
    expect(stats.byMethod.Cash.count).toBe(15); // 10 contractor + 5 walk-in
    expect(stats.byMethod.Bank.count).toBe(10); // 10 contractor
    expect(stats.byMethod.QR.count).toBe(10);   // 10 contractor
    expect(stats.byMethod.Credit.count).toBe(5); // 5 contractor credit
  });

  it("stress-tests varied contractor input shapes without credit table insertion", async () => {
    const fish = (await repo.getItemByKey("tilapia"))!;
    const c = await repo.createContractor({
      name: "Kian Kok Engineering",
      phone: "016-9998888",
      tin: "C999888111",
      address: "Bintulu Port Area",
    });

    // Case 1: Contractor identified by contractorId only (no customerType, no contractorName in draft)
    const o1 = await createOrder(repo, {
      businessDate: "2026-10-23",
      contractorId: c.id,
      method: "Cash",
      lines: [{ itemId: fish.id, qtyMilli: 1000 }],
    });
    expect(o1.invNo).toBe("B-0001");
    expect(o1.contractorName).toBe("Kian Kok Engineering");
    expect(o1.contractorTin).toBe("C999888111");
    expect(o1.contractorAddress).toBe("Bintulu Port Area");

    // Case 2: Ad-hoc contractor identified by contractorName only (no contractorId)
    const o2 = await createOrder(repo, {
      businessDate: "2026-10-23",
      contractorName: "Adhoc Plumber Bro",
      method: "Bank",
      lines: [{ itemId: fish.id, qtyMilli: 1000 }],
    });
    expect(o2.invNo).toBe("B-0002");
    expect(o2.contractorName).toBe("Adhoc Plumber Bro");
    expect(o2.contractorId).toBeUndefined();

    // Case 3: Customer marked customerType: 'contractor' without name or id
    const o3 = await createOrder(repo, {
      businessDate: "2026-10-23",
      customerType: "contractor",
      method: "QR",
      lines: [{ itemId: fish.id, qtyMilli: 1000 }],
    });
    expect(o3.invNo).toBe("B-0003");
    expect(o3.customerType).toBe("contractor");

    // Case 4: Walk-in with default implicit customerType
    const o4 = await createOrder(repo, {
      businessDate: "2026-10-23",
      method: "Cash",
      lines: [{ itemId: fish.id, qtyMilli: 1000 }],
    });
    expect(o4.invNo).toBe("A-0001");

    // Credits table must remain strictly 0
    expect(await getCreditsCount()).toBe(0);
  });

  it("stress-tests DO metadata attached to decoupled contractor sales with Cash/Bank/QR", async () => {
    const fish = (await repo.getItemByKey("tilapia"))!;

    // 1. Contractor Cash + Issue DO
    const doCash = await createOrder(repo, {
      businessDate: "2026-10-23",
      customerType: "contractor",
      contractorName: "Kim Hin Construction",
      method: "Cash",
      issueDo: true,
      siteAddress: "Site Alpha",
      lorryPlate: "QAB 1234",
      driverName: "Ali",
      contractorPo: "PO-KH-01",
      showPriceOnDo: false,
      lines: [{ itemId: fish.id, qtyMilli: 5000 }],
    });
    expect(doCash.invNo).toBe("B-0001");
    expect(doCash.doNumber).toBe("DO-0001");
    expect(doCash.showPriceOnDo).toBe(false);

    // 2. Contractor Bank + Issue DO
    const doBank = await createOrder(repo, {
      businessDate: "2026-10-23",
      customerType: "contractor",
      contractorName: "Kim Hin Construction",
      method: "Bank",
      issueDo: true,
      siteAddress: "Site Beta",
      lorryPlate: "QAB 5678",
      driverName: "Budi",
      contractorPo: "PO-KH-02",
      showPriceOnDo: true,
      lines: [{ itemId: fish.id, qtyMilli: 5000 }],
    });
    expect(doBank.invNo).toBe("B-0002");
    expect(doBank.doNumber).toBe("DO-0002");
    expect(doBank.showPriceOnDo).toBe(true);

    // 3. Walk-in Cash + Issue DO
    const doWalkin = await createOrder(repo, {
      businessDate: "2026-10-23",
      customerType: "walkin",
      method: "Cash",
      issueDo: true,
      siteAddress: "Residential House 12",
      lorryPlate: "QAA 9999",
      driverName: "Charlie",
      lines: [{ itemId: fish.id, qtyMilli: 2000 }],
    });
    expect(doWalkin.invNo).toBe("A-0001");
    expect(doWalkin.doNumber).toBe("DO-0003");

    // Credits table must remain strictly 0
    expect(await getCreditsCount()).toBe(0);

    // Hydration check
    const fetchedCash = (await repo.getOrder(doCash.id))!;
    expect(fetchedCash.invNo).toBe("B-0001");
    expect(fetchedCash.doNumber).toBe("DO-0001");
    expect(fetchedCash.showPriceOnDo).toBe(false);
    expect(fetchedCash.contractorName).toBe("Kim Hin Construction");

    const fetchedWalkin = (await repo.getOrder(doWalkin.id))!;
    expect(fetchedWalkin.invNo).toBe("A-0001");
    expect(fetchedWalkin.doNumber).toBe("DO-0003");
  });

  it("stress-tests monthly sequence resetting for decoupled contractor sales", async () => {
    const fish = (await repo.getItemByKey("tilapia"))!;

    // October 2026
    const o1 = await createOrder(repo, {
      businessDate: "2026-10-23",
      customerType: "contractor",
      contractorName: "Pan Borneo Builders",
      method: "Cash",
      lines: [{ itemId: fish.id, qtyMilli: 1000 }],
    });
    expect(o1.invNo).toBe("B-0001");

    const o2 = await createOrder(repo, {
      businessDate: "2026-10-23",
      customerType: "walkin",
      method: "Cash",
      lines: [{ itemId: fish.id, qtyMilli: 1000 }],
    });
    expect(o2.invNo).toBe("A-0001");

    // November 2026 (next month)
    const o3 = await createOrder(repo, {
      businessDate: "2026-11-01",
      customerType: "contractor",
      contractorName: "Pan Borneo Builders",
      method: "Bank",
      lines: [{ itemId: fish.id, qtyMilli: 1000 }],
    });
    // B- sequence resets to B-0001!
    expect(o3.invNo).toBe("B-0001");

    const o4 = await createOrder(repo, {
      businessDate: "2026-11-01",
      customerType: "walkin",
      method: "Cash",
      lines: [{ itemId: fish.id, qtyMilli: 1000 }],
    });
    // A- sequence resets to A-0001!
    expect(o4.invNo).toBe("A-0001");

    // Credits table must remain strictly 0
    expect(await getCreditsCount()).toBe(0);
  });

  it("stress-tests voiding decoupled contractor sales without impacting credits table", async () => {
    const fish = (await repo.getItemByKey("tilapia"))!;

    const order = await createOrder(repo, {
      businessDate: "2026-10-23",
      customerType: "contractor",
      contractorName: "Highway Maintenance Co",
      method: "Cash",
      lines: [{ itemId: fish.id, qtyMilli: 1000 }],
    });
    expect(order.invNo).toBe("B-0001");
    expect(await getCreditsCount()).toBe(0);

    // Void the contractor cash order
    await repo.voidOrder(order.id, Date.now());

    const voided = (await repo.getOrder(order.id))!;
    expect(voided.voidedAt).toBeDefined();
    expect(voided.invNo).toBe("B-0001"); // invNo never changes

    // Credits table must still be 0
    expect(await getCreditsCount()).toBe(0);
  });
});
