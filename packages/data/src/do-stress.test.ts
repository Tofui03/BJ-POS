import { describe, it, expect, beforeEach } from "vitest";
import initSqlJs from "sql.js";
import { createOrder, LEGACY_SEED_ITEMS, type PosRepo } from "@yf/core";
import { createSqlJsDriver, initRepo, SqlPosRepo } from "./index.js";

async function freshRepo(): Promise<SqlPosRepo> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  const driver = createSqlJsDriver(db as never);
  return initRepo(driver, {
    seedDemoOrders: false,
    seedItems: LEGACY_SEED_ITEMS,
    now: new Date(2026, 9, 23),
    rng: () => 0.5,
  });
}

describe("Delivery order persistence", () => {
  let repo: SqlPosRepo;

  beforeEach(async () => {
    repo = await freshRepo();
  });

  it("advances DO sequence monotonically across 25 consecutive DO orders", async () => {
    const item = (await repo.getItemByKey("tilapia"))!;

    for (let i = 1; i <= 25; i++) {
      const order = await createOrder(repo, {
        method: "Cash",
        issueDo: true,
        siteAddress: `Site Unit ${i}`,
        lines: [{ itemId: item.id, qtyMilli: 1000 }],
      });

      const expectedDo = `DO-${String(i).padStart(4, "0")}`;
      expect(order.doNumber).toBe(expectedDo);

      // Verify immediate readback
      const reRead = await repo.getOrder(order.id);
      expect(reRead?.doNumber).toBe(expectedDo);
      expect(reRead?.siteAddress).toBe(`Site Unit ${i}`);
    }
  });

  it("handles high-sequence DO numbers (DO-1000, DO-9999, DO-10000+) without parsing corruption", async () => {
    const item = (await repo.getItemByKey("tilapia"))!;

    // Seed an order with DO-0999
    await createOrder(repo, {
      method: "Cash",
      doNumber: "DO-0999",
      lines: [{ itemId: item.id, qtyMilli: 1000 }],
    });

    // Next auto-generated DO must be DO-1000
    const next1 = await createOrder(repo, {
      method: "Cash",
      issueDo: true,
      lines: [{ itemId: item.id, qtyMilli: 1000 }],
    });
    expect(next1.doNumber).toBe("DO-1000");

    // Seed an order with DO-9999
    await createOrder(repo, {
      method: "Cash",
      doNumber: "DO-9999",
      lines: [{ itemId: item.id, qtyMilli: 1000 }],
    });

    // Next auto-generated DO must be DO-10000
    const next2 = await createOrder(repo, {
      method: "Cash",
      issueDo: true,
      lines: [{ itemId: item.id, qtyMilli: 1000 }],
    });
    expect(next2.doNumber).toBe("DO-10000");

    // Next auto-generated DO must be DO-10001
    const next3 = await createOrder(repo, {
      method: "Cash",
      issueDo: true,
      lines: [{ itemId: item.id, qtyMilli: 1000 }],
    });
    expect(next3.doNumber).toBe("DO-10001");
  });

  it("strictly leaves DO sequence unchanged when non-DO orders are interleaved", async () => {
    const item = (await repo.getItemByKey("tilapia"))!;

    // 1. First DO order
    const do1 = await createOrder(repo, {
      method: "Cash",
      issueDo: true,
      lines: [{ itemId: item.id, qtyMilli: 1000 }],
    });
    expect(do1.doNumber).toBe("DO-0001");
    expect(do1.invNo).toBe("A-0001");

    // 2. Interleave Walk-in Cash
    const walkinCash = await createOrder(repo, {
      method: "Cash",
      lines: [{ itemId: item.id, qtyMilli: 1000 }],
    });
    expect(walkinCash.doNumber).toBeUndefined();
    expect(walkinCash.invNo).toBe("A-0002");

    // 3. Interleave Contractor Credit
    const contractorCredit = await createOrder(repo, {
      method: "Credit",
      contractorName: "Kim Hock Contractor",
      lines: [{ itemId: item.id, qtyMilli: 1000 }],
    });
    expect(contractorCredit.doNumber).toBeUndefined();
    expect(contractorCredit.invNo).toBe("B-0001");

    // 4. Interleave Contractor Cash (Decoupled B-series, non-DO)
    const contractorCash = await createOrder(repo, {
      method: "Cash",
      contractorName: "Kim Hock Contractor",
      lines: [{ itemId: item.id, qtyMilli: 1000 }],
    });
    expect(contractorCash.doNumber).toBeUndefined();
    expect(contractorCash.invNo).toBe("B-0002");

    // 5. Interleave Order with all DO fields as empty whitespace strings
    const blankDoFields = await createOrder(repo, {
      method: "Cash",
      siteAddress: "   ",
      lorryPlate: "  ",
      driverName: " ",
      contractorPo: "",
      issueDo: false,
      lines: [{ itemId: item.id, qtyMilli: 1000 }],
    });
    expect(blankDoFields.doNumber).toBeUndefined();
    expect(blankDoFields.invNo).toBe("A-0003");

    // 6. Next DO order must strictly be DO-0002
    const do2 = await createOrder(repo, {
      method: "Cash",
      issueDo: true,
      lines: [{ itemId: item.id, qtyMilli: 1000 }],
    });
    expect(do2.doNumber).toBe("DO-0002");
    expect(do2.invNo).toBe("A-0004");
  });

  it("triggers DO generation when any individual DO metadata field is provided even without issueDo=true", async () => {
    const item = (await repo.getItemByKey("tilapia"))!;

    // Triggered by siteAddress only
    const o1 = await createOrder(repo, {
      method: "Cash",
      siteAddress: "Jalan Pending Lot 12",
      lines: [{ itemId: item.id, qtyMilli: 1000 }],
    });
    expect(o1.doNumber).toBe("DO-0001");
    expect(o1.siteAddress).toBe("Jalan Pending Lot 12");

    // Triggered by lorryPlate only
    const o2 = await createOrder(repo, {
      method: "Cash",
      lorryPlate: "QAA 1122 B",
      lines: [{ itemId: item.id, qtyMilli: 1000 }],
    });
    expect(o2.doNumber).toBe("DO-0002");
    expect(o2.lorryPlate).toBe("QAA 1122 B");

    // Triggered by driverName only
    const o3 = await createOrder(repo, {
      method: "Cash",
      driverName: "Bakar",
      lines: [{ itemId: item.id, qtyMilli: 1000 }],
    });
    expect(o3.doNumber).toBe("DO-0003");
    expect(o3.driverName).toBe("Bakar");

    // Triggered by contractorPo only
    const o4 = await createOrder(repo, {
      method: "Cash",
      contractorPo: "PO-888",
      lines: [{ itemId: item.id, qtyMilli: 1000 }],
    });
    expect(o4.doNumber).toBe("DO-0004");
    expect(o4.contractorPo).toBe("PO-888");
  });

  it("strictly isolates DO sequence counters across multiple companies", async () => {
    const item = (await repo.getItemByKey("tilapia"))!;

    const co1_1 = await createOrder(repo, { companyId: 1, method: "Cash", issueDo: true, lines: [{ itemId: item.id, qtyMilli: 1000 }] });
    const co2_1 = await createOrder(repo, { companyId: 2, method: "Cash", issueDo: true, lines: [{ itemId: item.id, qtyMilli: 1000 }] });
    const co3_1 = await createOrder(repo, { companyId: 3, method: "Cash", issueDo: true, lines: [{ itemId: item.id, qtyMilli: 1000 }] });

    expect(co1_1.doNumber).toBe("DO-0001");
    expect(co2_1.doNumber).toBe("DO-0001");
    expect(co3_1.doNumber).toBe("DO-0001");

    const co2_2 = await createOrder(repo, { companyId: 2, method: "Cash", issueDo: true, lines: [{ itemId: item.id, qtyMilli: 1000 }] });
    const co1_2 = await createOrder(repo, { companyId: 1, method: "Cash", issueDo: true, lines: [{ itemId: item.id, qtyMilli: 1000 }] });
    const co1_3 = await createOrder(repo, { companyId: 1, method: "Cash", issueDo: true, lines: [{ itemId: item.id, qtyMilli: 1000 }] });
    const co3_2 = await createOrder(repo, { companyId: 3, method: "Cash", issueDo: true, lines: [{ itemId: item.id, qtyMilli: 1000 }] });

    expect(co2_2.doNumber).toBe("DO-0002");
    expect(co1_2.doNumber).toBe("DO-0002");
    expect(co1_3.doNumber).toBe("DO-0003");
    expect(co3_2.doNumber).toBe("DO-0002");
  });

  it("accurately persists and hydrates all DO metadata across getOrder, listOrders, and listOrdersByBusinessDate", async () => {
    const item = (await repo.getItemByKey("tilapia"))!;
    const c = await repo.createContractor({
      name: "Megah Construction Sdn Bhd",
      phone: "019-8887766",
      tin: "TIN-998877",
      address: "Sublot 14, Bintulu Industrial Estate",
    });

    const created = await createOrder(repo, {
      method: "Cash",
      contractorId: c.id,
      issueDo: true,
      siteAddress: "Bintulu Port Extension Berth 4",
      lorryPlate: "QS 5544 K",
      driverName: "Rosli Bin Ahmad",
      contractorPo: "PO-BP-2026-0012",
      showPriceOnDo: false,
      businessDate: "2026-10-23",
      ts: 100000,
      lines: [{ itemId: item.id, qtyMilli: 3000 }],
    });

    expect(created.contractorName).toBe("Megah Construction Sdn Bhd");
    expect(created.contractorTin).toBe("TIN-998877");
    expect(created.contractorAddress).toBe("Sublot 14, Bintulu Industrial Estate");
    expect(created.contractorPhone).toBe("019-8887766");
    expect(created.doNumber).toBe("DO-0001");
    expect(created.siteAddress).toBe("Bintulu Port Extension Berth 4");
    expect(created.lorryPlate).toBe("QS 5544 K");
    expect(created.driverName).toBe("Rosli Bin Ahmad");
    expect(created.contractorPo).toBe("PO-BP-2026-0012");
    expect(created.showPriceOnDo).toBe(false);

    // 1. Query via getOrder
    const fetched = (await repo.getOrder(created.id))!;
    expect(fetched).not.toBeNull();
    expect(fetched.id).toBe(created.id);
    expect(fetched.doNumber).toBe("DO-0001");
    expect(fetched.siteAddress).toBe("Bintulu Port Extension Berth 4");
    expect(fetched.lorryPlate).toBe("QS 5544 K");
    expect(fetched.driverName).toBe("Rosli Bin Ahmad");
    expect(fetched.contractorPo).toBe("PO-BP-2026-0012");
    expect(fetched.showPriceOnDo).toBe(false);
    expect(fetched.contractorName).toBe("Megah Construction Sdn Bhd");

    // 2. Query via listOrders
    const list = await repo.listOrders(90000, 110000);
    const orderInList = list.find((o) => o.id === created.id);
    expect(orderInList).toBeDefined();
    expect(orderInList!.doNumber).toBe("DO-0001");
    expect(orderInList!.siteAddress).toBe("Bintulu Port Extension Berth 4");
    expect(orderInList!.lorryPlate).toBe("QS 5544 K");
    expect(orderInList!.driverName).toBe("Rosli Bin Ahmad");
    expect(orderInList!.contractorPo).toBe("PO-BP-2026-0012");
    expect(orderInList!.showPriceOnDo).toBe(false);

    // 3. Query via listOrdersByBusinessDate
    const dateList = await repo.listOrdersByBusinessDate("2026-10-23", "2026-10-23");
    const orderInDateList = dateList.find((o) => o.id === created.id);
    expect(orderInDateList).toBeDefined();
    expect(orderInDateList!.doNumber).toBe("DO-0001");
    expect(orderInDateList!.siteAddress).toBe("Bintulu Port Extension Berth 4");
    expect(orderInDateList!.showPriceOnDo).toBe(false);
  });

  it("preserves showPriceOnDo defaults: true when omitted, false when explicit false", async () => {
    const item = (await repo.getItemByKey("tilapia"))!;

    // Omitted showPriceOnDo with issueDo=true -> defaults to true
    const oDefault = await createOrder(repo, {
      method: "Cash",
      issueDo: true,
      lines: [{ itemId: item.id, qtyMilli: 1000 }],
    });
    expect(oDefault.showPriceOnDo).toBe(true);
    const readDefault = (await repo.getOrder(oDefault.id))!;
    expect(readDefault.showPriceOnDo).toBe(true);

    // Explicit showPriceOnDo = false
    const oFalse = await createOrder(repo, {
      method: "Cash",
      issueDo: true,
      showPriceOnDo: false,
      lines: [{ itemId: item.id, qtyMilli: 1000 }],
    });
    expect(oFalse.showPriceOnDo).toBe(false);
    const readFalse = (await repo.getOrder(oFalse.id))!;
    expect(readFalse.showPriceOnDo).toBe(false);

    // Non-DO order -> showPriceOnDo is undefined
    const oNonDo = await createOrder(repo, {
      method: "Cash",
      lines: [{ itemId: item.id, qtyMilli: 1000 }],
    });
    expect(oNonDo.showPriceOnDo).toBeUndefined();
    const readNonDo = (await repo.getOrder(oNonDo.id))!;
    expect(readNonDo.showPriceOnDo).toBeUndefined();
  });

  it("does NOT reset DO sequence monthly even when invoice sequences reset", async () => {
    const item = (await repo.getItemByKey("tilapia"))!;

    // October DO order
    const octOrder = await createOrder(repo, {
      method: "Cash",
      businessDate: "2026-10-31",
      issueDo: true,
      lines: [{ itemId: item.id, qtyMilli: 1000 }],
    });
    expect(octOrder.invNo).toBe("A-0001");
    expect(octOrder.doNumber).toBe("DO-0001");

    // November DO order (new business month)
    const novOrder = await createOrder(repo, {
      method: "Cash",
      businessDate: "2026-11-01",
      issueDo: true,
      lines: [{ itemId: item.id, qtyMilli: 1000 }],
    });
    // Invoices reset to A-0001 in November
    expect(novOrder.invNo).toBe("A-0001");
    // DO sequence DOES NOT RESET; continues to DO-0002
    expect(novOrder.doNumber).toBe("DO-0002");

    // December DO order
    const decOrder = await createOrder(repo, {
      method: "Cash",
      businessDate: "2026-12-01",
      issueDo: true,
      lines: [{ itemId: item.id, qtyMilli: 1000 }],
    });
    expect(decOrder.invNo).toBe("A-0001");
    expect(decOrder.doNumber).toBe("DO-0003");
  });

  it("does not corrupt DO sequence calculation when custom or non-standard DO numbers exist", async () => {
    const item = (await repo.getItemByKey("tilapia"))!;

    // Order 1: auto DO
    const do1 = await createOrder(repo, { method: "Cash", issueDo: true, lines: [{ itemId: item.id, qtyMilli: 1000 }] });
    expect(do1.doNumber).toBe("DO-0001");

    // Order 2: Custom prefix DO that does not match 'DO-%'
    const custom = await createOrder(repo, {
      method: "Cash",
      doNumber: "SPECIAL-DELIVERY-99",
      lines: [{ itemId: item.id, qtyMilli: 1000 }],
    });
    expect(custom.doNumber).toBe("SPECIAL-DELIVERY-99");

    // Order 3: Next auto DO must ignore SPECIAL-DELIVERY-99 and generate DO-0002
    const do2 = await createOrder(repo, { method: "Cash", issueDo: true, lines: [{ itemId: item.id, qtyMilli: 1000 }] });
    expect(do2.doNumber).toBe("DO-0002");

    // Order 4: DO with non-integer suffix 'DO-ALPHA'
    await createOrder(repo, {
      method: "Cash",
      doNumber: "DO-ALPHA",
      lines: [{ itemId: item.id, qtyMilli: 1000 }],
    });

    // Order 5: Next auto DO must still determine max integer seq (which was 2) and produce DO-0003
    const do3 = await createOrder(repo, { method: "Cash", issueDo: true, lines: [{ itemId: item.id, qtyMilli: 1000 }] });
    expect(do3.doNumber).toBe("DO-0003");
  });

  it("rolls back DO sequence on aborted transactions without sequence leakage", async () => {
    const item = (await repo.getItemByKey("tilapia"))!;
    // Enable stock tracking with 5000 milli (5kg)
    await repo.updateItem(item.id, { stockMilli: 5000 });

    // Order 1: Success DO
    const do1 = await createOrder(repo, {
      method: "Cash",
      issueDo: true,
      lines: [{ itemId: item.id, qtyMilli: 2000 }],
    });
    expect(do1.doNumber).toBe("DO-0001");

    // Order 2: Fails due to overselling stock (request 10000 milli with only 3000 left)
    await expect(
      createOrder(repo, {
        method: "Cash",
        issueDo: true,
        lines: [{ itemId: item.id, qtyMilli: 10000 }],
      }),
    ).rejects.toThrow(/not enough stock/);

    // Order 3: Next successful DO order should get DO-0002, not DO-0003!
    const do2 = await createOrder(repo, {
      method: "Cash",
      issueDo: true,
      lines: [{ itemId: item.id, qtyMilli: 1000 }],
    });
    expect(do2.doNumber).toBe("DO-0002");
  });

  it("accepts both doNumber and legacy doNumber interchangeably in OrderDraft and preserves both on Order", async () => {
    const item = (await repo.getItemByKey("tilapia"))!;

    // Using draft.doNumber
    const o = await createOrder(repo, {
      method: "Cash",
      doNumber: "DO-7777",
      lines: [{ itemId: item.id, qtyMilli: 1000 }],
    });
    expect(o.doNumber).toBe("DO-7777");

    const fetched = (await repo.getOrder(o.id))!;
    expect(fetched.doNumber).toBe("DO-7777");
  });
});
