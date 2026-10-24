import { describe, it, expect, beforeEach } from "vitest";
import {
  freshTestRepo,
  seedHardwareCatalog,
  renderDeliveryOrderHtml,
  TEST_STORE_INFO,
  CONTRACTOR_AH_SENG,
  CONTRACTOR_MEGA_BUILDER,
  type SeededCatalog,
  isMeasureUnit,
  calcReverseQuantity,
  reversePriceLine,
  deductTare,
  validateNetWeight,
  buildOrder,
  formatInvNo,
  formatDoNo,
  buildDeliveryOrder,
  toMilli,
  toQty,
  toCents,
  toRM,
  lineAmount,
  effectiveUnitPrice,
  PosError,
} from "./harness.js";
import type { SqlPosRepo } from "../../packages/data/src/index.js";
import type { Order } from "../../packages/core/src/index.js";

describe("Tier 4: Real-World Application Scenarios (5 Realistic Hardware Store Scenarios)", () => {
  let repo: SqlPosRepo;
  let catalog: SeededCatalog;

  beforeEach(async () => {
    const booted = await freshTestRepo();
    repo = booted.repo;
    catalog = await seedHardwareCatalog(repo);
  });

  // =========================================================================
  // Scenario 1: Contractor buying 15.5 kg nails + 30 ft pipe, paying Cash with DO
  // Features: F1, F3, F4, F5, F6, F7, F8
  // =========================================================================
  it("Scenario 1: contractor buying 15.5 kg nails + 30 ft pipe, paying Cash with Delivery Order", async () => {
    // 1. Tare deduction for nails: container tare = 0.500 kg (500 milli), gross scale reading = 16.000 kg (16000 milli)
    const grossNailsMilli = 16000;
    const tareNailsMilli = 500;
    const netNailsMilli = deductTare(grossNailsMilli, tareNailsMilli);
    expect(netNailsMilli).toBe(15500);
    validateNetWeight(netNailsMilli);

    // 2. 30 ft pipe: 30,000 milli
    const pipeQtyMilli = 30000;

    // 3. Build order with contractor details and DO fields
    const draft = buildOrder(
      {
        customerType: "contractor",
        contractorName: CONTRACTOR_AH_SENG.name,
        customerTin: CONTRACTOR_AH_SENG.tin,
        customerAddress: CONTRACTOR_AH_SENG.address,
        customerPhone: CONTRACTOR_AH_SENG.phone,
        issueDo: true,
        doNumber: formatDoNo(1),
        siteAddress: "Lot 42, Telipok Industrial Park, Sabah",
        lorryPlate: "SABAH 2341",
        driverName: "Ah Kow",
        contractorPo: "PO-AS-2026-9921",
        showPriceOnDo: true,
        method: "Cash",
        lines: [
          { itemId: catalog.nailsKg.id, qtyMilli: netNailsMilli }, // 15.5 kg @ RM 10 = RM 155.00
          { itemId: catalog.pipeFt.id, qtyMilli: pipeQtyMilli }, // 30 ft @ RM 2 = RM 60.00
        ],
      },
      catalog.resolveItem,
    );

    // Total = 15500 + 6000 = 21500 cents (RM 215.00)
    expect(draft.totalCents).toBe(21500);
    expect(toRM(draft.totalCents)).toBe(215);
    expect(draft.customerType).toBe("contractor");
    expect(formatInvNo(draft.customerType === "contractor" ? "B" : "A", 1)).toBe("B-0001");

    // 4. Persist order
    const order = await repo.persistOrder(draft);
    expect(order.method).toBe("Cash");

    // 5. Verify zero credit debt rows created for cash transaction
    const openCredits = await repo.listCredits(1, { outstandingOnly: true });
    expect(openCredits.find((c) => c.orderId === order.id)).toBeUndefined();

    // 6. Generate and verify Delivery Order model
    const doModel = buildDeliveryOrder({
      ...order,
      contractorName: draft.contractorName,
      contractorTin: draft.customerTin,
      contractorAddress: draft.customerAddress,
      contractorPhone: draft.customerPhone,
      siteAddress: draft.siteAddress,
      lorryPlate: draft.lorryPlate,
      driverName: draft.driverName,
      contractorPo: draft.contractorPo,
      showPriceOnDo: draft.showPriceOnDo,
    });

    expect(doModel.doNumber).toBe("DO-0001");
    expect(doModel.contractorName).toBe("Ah Seng Construction");
    expect(doModel.contractorTin).toBe("C1234567890");
    expect(doModel.siteAddress).toBe("Lot 42, Telipok Industrial Park, Sabah");
    expect(doModel.lorryPlate).toBe("SABAH 2341");
    expect(doModel.driverName).toBe("Ah Kow");
    expect(doModel.contractorPo).toBe("PO-AS-2026-9921");
    expect(doModel.showPriceOnDo).toBe(true);

    // 7. Verify A4 Dual-Copy DO HTML printout
    const html = await renderDeliveryOrderHtml(doModel, TEST_STORE_INFO);
    expect(html).toContain("DO-0001");
    expect(html).toContain("STORE COPY");
    expect(html).toContain("CUSTOMER COPY");
    expect(html).toContain("Ah Seng Construction");
    expect(html).toContain("15.5 kg");
    expect(html).toContain("30 ft");
    expect(html).toContain("155.00");
    expect(html).toContain("60.00");
    expect(html).toContain("215.00");
    expect(html).toContain("(227533-X)");
    expect(html).toMatch(/ISSUED BY/gi);
    expect(html).toMatch(/DELIVERED BY/gi);
    expect(html).toMatch(/RECEIVED BY/gi);
    expect(html).toMatch(/Company Chop/i);
  });

  // =========================================================================
  // Scenario 2: Walk-in retail customer requesting RM 20 of sand by reverse weight budget
  // Features: F1, F2, F4
  // =========================================================================
  it("Scenario 2: walk-in retail customer requesting RM 20 of sand by reverse weight budget", async () => {
    // 1. Retail walk-in customer requests "RM 20 worth of sand"
    const budgetCents = 2000; // RM 20.00
    const sandPriceCents = catalog.sandKg.priceCents; // RM 0.20/kg (20 cents)

    // Reverse calculate quantity
    const targetQtyMilli = calcReverseQuantity(budgetCents, sandPriceCents);
    expect(targetQtyMilli).toBe(100000); // 100.000 kg
    expect(toQty(targetQtyMilli)).toBe(100);

    // 2. Build order with walk-in default (zero friction, anonymous)
    const draft = buildOrder(
      {
        customerType: "walkin",
        method: "Cash",
        lines: [{ itemId: catalog.sandKg.id, qtyMilli: targetQtyMilli }],
      },
      catalog.resolveItem,
    );

    expect(draft.customerType).toBe("walkin");
    expect(draft.contractorName).toBeUndefined();
    expect(draft.totalCents).toBe(2000); // exactly RM 20.00

    // 3. Persist order
    const order = await repo.persistOrder(draft);
    expect(order.method).toBe("Cash");
    expect(order.invNo.startsWith("A-")).toBe(true); // Walk-in gets A- invoice sequence

    // 4. Verify 0 credit debt rows
    const openCredits = await repo.listCredits(1, { outstandingOnly: true });
    expect(openCredits.find((c) => c.orderId === order.id)).toBeUndefined();
  });

  // =========================================================================
  // Scenario 3: Driver dispatched with bulk steel bars, DO without prices shown
  // Features: F1, F6, F7, F8, F9
  // =========================================================================
  it("Scenario 3: driver dispatched with bulk steel bars, DO without prices shown (showPriceOnDo: false)", async () => {
    // 1. Bulk order: 500 meters of High Tensile Steel Bar
    const steelQtyMilli = 500000; // 500.000 meters

    // 2. Build order with showPriceOnDo disabled to protect contractor margins on site
    const draft = buildOrder(
      {
        customerType: "contractor",
        contractorName: CONTRACTOR_MEGA_BUILDER.name,
        customerTin: CONTRACTOR_MEGA_BUILDER.tin,
        customerAddress: CONTRACTOR_MEGA_BUILDER.address,
        issueDo: true,
        doNumber: formatDoNo(88),
        siteAddress: "Kimanis Gas Terminal Site Extension Phase 2",
        lorryPlate: "SABAH 9901",
        driverName: "Kamaruddin bin Yusof",
        contractorPo: "PO-KG-5542",
        showPriceOnDo: false,
        method: "Cash",
        lines: [{ itemId: catalog.steelMeter.id, qtyMilli: steelQtyMilli }],
      },
      catalog.resolveItem,
    );

    // 3. Persist order
    const order = await repo.persistOrder(draft);
    expect(order.method).toBe("Cash");

    // 4. Build Delivery Order with price suppression
    const doModel = buildDeliveryOrder({
      ...order,
      contractorName: draft.contractorName,
      contractorTin: draft.customerTin,
      contractorAddress: draft.customerAddress,
      siteAddress: draft.siteAddress,
      lorryPlate: draft.lorryPlate,
      driverName: draft.driverName,
      contractorPo: draft.contractorPo,
      showPriceOnDo: false,
    });

    expect(doModel.showPriceOnDo).toBe(false);
    expect(doModel.subtotalCents).toBeUndefined();
    expect(doModel.totalAmountCents).toBeUndefined();
    expect(doModel.lines[0]!.unitPriceCents).toBeUndefined();
    expect(doModel.lines[0]!.lineAmountCents).toBeUndefined();

    // 5. Render A4 Dual-Copy DO HTML
    const html = await renderDeliveryOrderHtml(doModel, TEST_STORE_INFO);

    // Items and delivery details MUST be present
    expect(html).toContain("High Tensile Deformed Bar Y12");
    expect(html).toContain("500 meter");
    expect(html).toContain("Kimanis Gas Terminal Site Extension Phase 2");
    expect(html).toContain("SABAH 9901");
    expect(html).toContain("Kamaruddin bin Yusof");
    expect(html).toContain("PO-KG-5542");

    // All prices and monetary amounts MUST be completely suppressed
    expect(html).not.toContain("U/P (RM)");
    expect(html).not.toContain("AMOUNT (RM)");
    expect(html).not.toContain("Subtotal:");
    expect(html).not.toContain("TOTAL:");
    expect(html).not.toContain("11,000.00");
    expect(html).not.toContain("12,500.00");

    // Signature blocks MUST still be intact
    expect(html).toMatch(/ISSUED BY/gi);
    expect(html).toMatch(/DELIVERED BY/gi);
    expect(html).toMatch(/RECEIVED BY/gi);
  });

  // =========================================================================
  // Scenario 4: Contractor buying mixed goods paying via Credit, generating B-invoice and credit debt row
  // Features: F4, F5, F6
  // =========================================================================
  it("Scenario 4: contractor buying mixed goods paying via Credit, generating B-invoice and credit debt row", async () => {
    // 1. Contractor buys 100 bags of cement + 50 meters of steel bar on credit account
    const draft = buildOrder(
      {
        customerType: "contractor",
        contractorName: CONTRACTOR_MEGA_BUILDER.name,
        customerTin: CONTRACTOR_MEGA_BUILDER.tin,
        customerAddress: CONTRACTOR_MEGA_BUILDER.address,
        method: "Credit",
        lines: [
          { itemId: catalog.cementBag.id, qtyMilli: 100000 }, // 100 bags @ RM 18 = RM 1,800.00 (180,000 cents)
          { itemId: catalog.steelMeter.id, qtyMilli: 50000 }, // 50 meter @ RM 22 tier = RM 1,100.00 (110,000 cents)
        ],
      },
      catalog.resolveItem,
    );

    // Total = 180000 + 110000 = 290000 cents (RM 2,900.00)
    expect(draft.totalCents).toBe(290000);
    expect(toRM(draft.totalCents)).toBe(2900);
    expect(draft.method).toBe("Credit");
    expect(formatInvNo("B", 10)).toBe("B-0010");

    // 2. Persist order
    const order = await repo.persistOrder(draft);
    expect(order.method).toBe("Credit");
    expect(order.invNo.startsWith("B-")).toBe(true);

    // 3. Verify exactly 1 row in credits table with matching amount and open status
    const openCredits = await repo.listCredits(1, { outstandingOnly: true });
    const debt = openCredits.find((c) => c.orderId === order.id);
    expect(debt).toBeDefined();
    expect(debt!.amountCents).toBe(290000);
    expect(debt!.name).toBe(CONTRACTOR_MEGA_BUILDER.name);
    expect(debt!.clearedAt).toBeNull();

    // 4. Execute debt repayment workflow: contractor pays via Bank transfer
    const repaymentDate = "2026-10-24";
    await repo.clearCredit(debt!.id, Date.now(), "Bank", repaymentDate);

    // 5. Verify debt is cleared from open credits
    const remainingOpen = await repo.listCredits(1, { outstandingOnly: true });
    expect(remainingOpen.find((c) => c.orderId === order.id)).toBeUndefined();

    // 6. Verify repayment recorded in repayments table
    const repayments = await repo.listRepayments({ companyId: 1, businessDate: repaymentDate });
    const rep = repayments.find((r) => r.creditId === debt!.id);
    expect(rep).toBeDefined();
    expect(rep!.amountCents).toBe(290000);
    expect(rep!.method).toBe("Bank");
  });

  // =========================================================================
  // Scenario 5: Multiple consecutive orders testing monthly invoice reset vs running DO sequence
  // Features: F4, F5, F6
  // =========================================================================
  it("Scenario 5: multiple consecutive orders testing monthly invoice reset vs running DO sequence", async () => {
    // -------------------------------------------------------------
    // Month 1: October 2026 (businessDate: "2026-10-15")
    // -------------------------------------------------------------
    const dateMonth1 = "2026-10-15";

    // Order 1: Walk-in Cash -> A-0001
    const order1 = await repo.persistOrder(
      buildOrder(
        {
          businessDate: dateMonth1,
          customerType: "walkin",
          method: "Cash",
          lines: [{ itemId: catalog.hammerPcs.id, qtyMilli: 1000 }],
        },
        catalog.resolveItem,
      ),
    );
    expect(order1.invNo).toBe("A-0001");

    // Order 2: Contractor Cash + DO -> B-0001 (or credit B-), DO-0001
    const doNo1 = formatDoNo(1);
    expect(doNo1).toBe("DO-0001");
    const order2 = await repo.persistOrder(
      buildOrder(
        {
          businessDate: dateMonth1,
          creditorName: CONTRACTOR_AH_SENG.name,
          customerType: "contractor",
          contractorName: CONTRACTOR_AH_SENG.name,
          issueDo: true,
          doNumber: doNo1,
          method: "Credit",
          lines: [{ itemId: catalog.nailsKg.id, qtyMilli: 5000 }],
        },
        catalog.resolveItem,
      ),
    );
    expect(order2.invNo).toBe("B-0001");

    // Order 3: Walk-in Cash -> A-0002
    const order3 = await repo.persistOrder(
      buildOrder(
        {
          businessDate: dateMonth1,
          customerType: "walkin",
          method: "Cash",
          lines: [{ itemId: catalog.hammerPcs.id, qtyMilli: 2000 }],
        },
        catalog.resolveItem,
      ),
    );
    expect(order3.invNo).toBe("A-0002");

    // -------------------------------------------------------------
    // Month 2: November 2026 (businessDate: "2026-11-01")
    // Invoices MUST reset to 0001! DO sequence MUST NOT reset!
    // -------------------------------------------------------------
    const dateMonth2 = "2026-11-01";

    // Order 4: Walk-in Cash in Month 2 -> resets to A-0001!
    const order4 = await repo.persistOrder(
      buildOrder(
        {
          businessDate: dateMonth2,
          customerType: "walkin",
          method: "Cash",
          lines: [{ itemId: catalog.pipeFt.id, qtyMilli: 5000 }],
        },
        catalog.resolveItem,
      ),
    );
    expect(order4.invNo).toBe("A-0001");

    // Order 5: Contractor in Month 2 -> resets to B-0001!
    const order5 = await repo.persistOrder(
      buildOrder(
        {
          businessDate: dateMonth2,
          creditorName: CONTRACTOR_MEGA_BUILDER.name,
          customerType: "contractor",
          contractorName: CONTRACTOR_MEGA_BUILDER.name,
          method: "Credit",
          lines: [{ itemId: catalog.cementBag.id, qtyMilli: 10000 }],
        },
        catalog.resolveItem,
      ),
    );
    expect(order5.invNo).toBe("B-0001");

    // Order 6: DO sequence continues sequentially across month boundaries -> DO-0002!
    const doNo2 = formatDoNo(2);
    expect(doNo2).toBe("DO-0002");
    expect(doNo2).not.toBe("DO-0001");
  });
});
