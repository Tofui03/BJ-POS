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

describe("Combined checkout flows", () => {
  let repo: SqlPosRepo;
  let catalog: SeededCatalog;

  beforeEach(async () => {
    const booted = await freshTestRepo();
    repo = booted.repo;
    catalog = await seedHardwareCatalog(repo);
  });

  // -------------------------------------------------------------------------
  // Interaction 1: F1 (Measurement Units) + F2 (Reverse Calculation)
  // -------------------------------------------------------------------------
  it("P1: reverse calculation accurately computes target quantities for both ft and meter units", () => {
    // PVC Pipe (ft): RM 2.00/ft (200 cents). Customer budget: RM 50.00 (5000 cents) -> 25.000 ft (25,000 milli)
    const pipeRes = reversePriceLine(catalog.pipeFt, 5000);
    expect(catalog.pipeFt.unit).toBe("ft");
    expect(isMeasureUnit(catalog.pipeFt.unit)).toBe(true);
    expect(pipeRes.qtyMilli).toBe(25000);
    expect(toQty(pipeRes.qtyMilli)).toBe(25);
    expect(pipeRes.lineAmountCents).toBe(5000);

    // Steel Bar (meter): RM 25.00/m (2500 cents). Customer budget: RM 50.00 (5000 cents) -> 2.000 meter (2,000 milli)
    const steelRes = reversePriceLine(catalog.steelMeter, 5000);
    expect(catalog.steelMeter.unit).toBe("meter");
    expect(isMeasureUnit(catalog.steelMeter.unit)).toBe(true);
    expect(steelRes.qtyMilli).toBe(2000);
    expect(toQty(steelRes.qtyMilli)).toBe(2);
    expect(steelRes.lineAmountCents).toBe(5000);
  });

  // -------------------------------------------------------------------------
  // Interaction 2: F1 (Measurement Units) + F3 (Tare Deduction)
  // -------------------------------------------------------------------------
  it("P2: tare deduction on weighable item (kg) prices strictly the net quantity", () => {
    // Weighing 12.500 kg nails inside 0.500 kg metal container
    // Gross = 12500 milli, Tare = 500 milli -> Net = 12000 milli (12.000 kg)
    const gross = 12500;
    const tare = 500;
    const net = deductTare(gross, tare);
    expect(net).toBe(12000);
    validateNetWeight(net);

    const draft = buildOrder(
      {
        method: "Cash",
        lines: [{ itemId: catalog.nailsKg.id, qtyMilli: net }],
      },
      catalog.resolveItem,
    );

    // 12.000 kg at RM 10.00/kg base = RM 120.00 (12,000 cents)
    expect(draft.totalCents).toBe(12000);
    expect(toRM(draft.totalCents)).toBe(120);
  });

  // -------------------------------------------------------------------------
  // Interaction 3: F2 (Reverse Calculation) + F3 (Tare Deduction)
  // -------------------------------------------------------------------------
  it("P3: combines tare container deduction with reverse target amount calculation", () => {
    // Customer asks for RM 100.00 worth of nails, bringing their own 0.800 kg bucket
    const budgetCents = 10000;
    const tareMilli = 800; // 0.800 kg

    // Reverse price nails for RM 100.00 budget: 10,000 cents / 1,000 cents = 10,000 milli (10.000 kg net)
    const rev = reversePriceLine(catalog.nailsKg, budgetCents);
    expect(rev.qtyMilli).toBe(10000);

    // Gross target reading on scale = net + tare = 10,000 + 800 = 10,800 milli (10.800 kg)
    const expectedScaleReading = rev.qtyMilli + tareMilli;
    expect(expectedScaleReading).toBe(10800);

    // Scale verifies: net = deductTare(gross, tare) exactly recovers the budgeted 10,000 milli
    const verifiedNet = deductTare(expectedScaleReading, tareMilli);
    expect(verifiedNet).toBe(rev.qtyMilli);
  });

  // -------------------------------------------------------------------------
  // Interaction 4: F4 (Customer Decoupling) + F5 (Contractor Non-Credit Checkout)
  // -------------------------------------------------------------------------
  it("P4: contractor customer paying via Bank transfer retains B-invoice sequence with zero credit rows", async () => {
    const draft = buildOrder(
      {
        customerType: "contractor",
        contractorName: CONTRACTOR_AH_SENG.name,
        contractorTin: CONTRACTOR_AH_SENG.tin,
        contractorAddress: CONTRACTOR_AH_SENG.address,
        contractorPhone: CONTRACTOR_AH_SENG.phone,
        method: "Bank",
        lines: [
          { itemId: catalog.pipeFt.id, qtyMilli: 20000 },
          { itemId: catalog.cementBag.id, qtyMilli: 10000 },
        ],
      },
      catalog.resolveItem,
    );

    expect(draft.method).toBe("Bank");
    expect(draft.customerType).toBe("contractor");
    expect(draft.contractorName).toBe("Ah Seng Construction");
    expect(formatInvNo(draft.customerType === "contractor" ? "B" : "A", 1)).toBe("B-0001");

    const order = await repo.persistOrder(draft);
    expect(order.method).toBe("Bank");

    // Verify 0 debt rows created in credits table
    const openCredits = await repo.listCredits(1, { outstandingOnly: true });
    expect(openCredits.find((c) => c.orderId === order.id)).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Interaction 5: F4 (Customer Decoupling) + F6 (DO Running Sequence & Metadata)
  // -------------------------------------------------------------------------
  it("P5: contractor order with Delivery Order captures contractor details and site delivery metadata", () => {
    const draft = buildOrder(
      {
        customerType: "contractor",
        contractorName: CONTRACTOR_MEGA_BUILDER.name,
        contractorTin: CONTRACTOR_MEGA_BUILDER.tin,
        contractorAddress: CONTRACTOR_MEGA_BUILDER.address,
        contractorPhone: CONTRACTOR_MEGA_BUILDER.phone,
        issueDo: true,
        doNumber: formatDoNo(15),
        siteAddress: "Plot 88, Kolombong Industrial Zone, Kota Kinabalu",
        lorryPlate: "SABAH 9901",
        driverName: "Zainal Abidin",
        contractorPo: "PO-MB-2026-004",
        showPriceOnDo: false,
        method: "Cash",
        lines: [{ itemId: catalog.steelMeter.id, qtyMilli: 50000 }],
      },
      catalog.resolveItem,
    );

    const order: Order = {
      ...draft,
      id: 55,
      companyId: 1,
      invNo: "B-0015",
      businessDate: "2026-10-23",
      voidedAt: null,
      items: [
        {
          id: 1,
          itemId: catalog.steelMeter.id,
          name: catalog.steelMeter.name,
          image: "",
          unit: "meter",
          priceCents: 2200,
          qtyMilli: 50000,
          amountCents: 110000,
          tailCount: 0,
          bulkPrice: true,
        },
      ],
    };

    const doModel = buildDeliveryOrder(order);
    expect(doModel.contractorName).toBe("Mega Builder Sdn Bhd");
    expect(doModel.contractorTin).toBe("C9876543210");
    expect(doModel.doNumber).toBe("DO-0015");
    expect(doModel.siteAddress).toBe("Plot 88, Kolombong Industrial Zone, Kota Kinabalu");
    expect(doModel.lorryPlate).toBe("SABAH 9901");
    expect(doModel.driverName).toBe("Zainal Abidin");
    expect(doModel.contractorPo).toBe("PO-MB-2026-004");
  });

  // -------------------------------------------------------------------------
  // Interaction 6: F6 (DO Running Sequence) + F7 (A4 Dual-Copy HTML Rendering)
  // -------------------------------------------------------------------------
  it("P6: DO running sequence renders accurately across both copies of A4 HTML printout", async () => {
    const doSeq = 42;
    const doNumber = formatDoNo(doSeq);
    expect(doNumber).toBe("DO-0042");

    const order: Order = {
      id: 42,
      companyId: 1,
      ts: Date.now(),
      businessDate: "2026-10-23",
      invNo: "B-0042",
      doNumber,
      siteAddress: "Site Alpha, Telipok",
      method: "Cash",
      totalCents: 5000,
      voidedAt: null,
      items: [
        {
          id: 1,
          itemId: catalog.nailsKg.id,
          name: catalog.nailsKg.name,
          image: "",
          unit: "kg",
          priceCents: 1000,
          qtyMilli: 5000,
          amountCents: 5000,
          tailCount: 0,
          bulkPrice: false,
        },
      ],
    };

    const html = await renderDeliveryOrderHtml(buildDeliveryOrder(order), TEST_STORE_INFO);
    const doMatches = html.match(/DO-0042/g);
    expect(doMatches).not.toBeNull();
    // Must appear in document title and in both Store Copy and Customer Copy
    expect(doMatches!.length).toBeGreaterThanOrEqual(2);
  });

  // -------------------------------------------------------------------------
  // Interaction 7: F6 (Delivery Order) + F9 (Price Suppression Toggle)
  // -------------------------------------------------------------------------
  it("P7: delivery order with showPriceOnDo false suppresses unit prices and line amounts", async () => {
    const order: Order = {
      id: 1,
      companyId: 1,
      ts: Date.now(),
      businessDate: "2026-10-23",
      invNo: "B-0001",
      doNumber: "DO-0001",
      showPriceOnDo: false,
      method: "Cash",
      totalCents: 85000,
      voidedAt: null,
      items: [
        {
          id: 1,
          itemId: catalog.steelMeter.id,
          name: catalog.steelMeter.name,
          image: "",
          unit: "meter",
          priceCents: 2500,
          qtyMilli: 20000,
          amountCents: 50000,
          tailCount: 0,
          bulkPrice: false,
        },
        {
          id: 2,
          itemId: catalog.cementBag.id,
          name: catalog.cementBag.name,
          image: "",
          unit: "bag",
          priceCents: 1800,
          qtyMilli: 20000,
          amountCents: 35000,
          tailCount: 0,
          bulkPrice: false,
        },
      ],
    };

    const doModel = buildDeliveryOrder(order);
    expect(doModel.showPriceOnDo).toBe(false);
    expect(doModel.lines[0]!.unitPriceCents).toBeUndefined();
    expect(doModel.lines[0]!.lineAmountCents).toBeUndefined();
    expect(doModel.totalAmountCents).toBeUndefined();

    const html = await renderDeliveryOrderHtml(doModel, TEST_STORE_INFO);
    expect(html).not.toContain("850.00");
    expect(html).not.toContain("500.00");
    expect(html).not.toContain("350.00");
    expect(html).not.toContain("U/P");
    expect(html).not.toContain("AMOUNT (RM)");
  });

  // -------------------------------------------------------------------------
  // Interaction 8: F7 (A4 Dual-Copy HTML) + F8 (Triple Signature Blocks)
  // -------------------------------------------------------------------------
  it("P8: A4 dual-copy HTML printout embeds 3 signature blocks on both Store and Customer copies (6 total)", async () => {
    const order: Order = {
      id: 1,
      companyId: 1,
      ts: Date.now(),
      businessDate: "2026-10-23",
      invNo: "B-0001",
      driverName: "Hassan bin Ahmad",
      method: "Cash",
      totalCents: 5000,
      voidedAt: null,
      items: [],
    };

    const html = await renderDeliveryOrderHtml(buildDeliveryOrder(order), TEST_STORE_INFO);

    // Check Issued By blocks
    const issuedMatches = html.match(/ISSUED BY/gi) || [];
    expect(issuedMatches.length).toBe(2);

    // Check Delivered By blocks with driver name
    const deliveredMatches = html.match(/DELIVERED BY/gi) || [];
    expect(deliveredMatches.length).toBe(2);
    expect(html).toContain("Hassan bin Ahmad");

    // Check Received By blocks with chop
    const receivedMatches = html.match(/RECEIVED BY/gi) || [];
    expect(receivedMatches.length).toBe(2);
    expect(html.toLowerCase()).toMatch(/company chop|stamp/);
  });

  // -------------------------------------------------------------------------
  // Interaction 9: F1 (Measure Units) + F6 (DO) + F9 (Price Suppression)
  // -------------------------------------------------------------------------
  it("P9: DO with mixed kg, ft, and meter items displays quantities and units while suppressing all prices", async () => {
    const order: Order = {
      id: 1,
      companyId: 1,
      ts: Date.now(),
      businessDate: "2026-10-23",
      invNo: "B-0001",
      showPriceOnDo: false,
      method: "Cash",
      totalCents: 45000,
      voidedAt: null,
      items: [
        {
          id: 1,
          itemId: catalog.nailsKg.id,
          name: "Common Wire Nails 2\"",
          image: "",
          unit: "kg",
          priceCents: 1000,
          qtyMilli: 15500,
          amountCents: 15500,
          tailCount: 0,
          bulkPrice: false,
        },
        {
          id: 2,
          itemId: catalog.pipeFt.id,
          name: "PVC Pipe Class D 1/2\"",
          image: "",
          unit: "ft",
          priceCents: 200,
          qtyMilli: 30000,
          amountCents: 6000,
          tailCount: 0,
          bulkPrice: false,
        },
        {
          id: 3,
          itemId: catalog.steelMeter.id,
          name: "Steel Deformed Bar Y12",
          image: "",
          unit: "meter",
          priceCents: 2500,
          qtyMilli: 2500,
          amountCents: 6250,
          tailCount: 0,
          bulkPrice: false,
        },
      ],
    };

    const html = await renderDeliveryOrderHtml(buildDeliveryOrder(order), TEST_STORE_INFO);

    // Quantities and units MUST be clearly visible
    expect(html).toContain("15.5 kg");
    expect(html).toContain("30 ft");
    expect(html).toContain("2.5 meter");

    // Prices and monetary symbols MUST be absent
    expect(html).not.toContain("155.00");
    expect(html).not.toContain("60.00");
    expect(html).not.toContain("62.50");
    expect(html).not.toContain("450.00");
    expect(html).not.toContain("U/P (RM)");
  });

  // -------------------------------------------------------------------------
  // Interaction 10: F3 + F4 + F5 + F6 (Full Hardware Checkout Flow)
  // -------------------------------------------------------------------------
  it("P10: full hardware checkout flow: tare deduction -> contractor selection -> Cash checkout -> DO generation", async () => {
    // 1. Scale tare deduction for sand
    const grossSandMilli = 50250; // 50.250 kg gross reading
    const bucketTareMilli = 250; // 0.250 kg bucket
    const netSandMilli = deductTare(grossSandMilli, bucketTareMilli); // 50.000 kg net
    expect(netSandMilli).toBe(50000);

    // 2. Build order with contractor and DO fields
    const draft = buildOrder(
      {
        customerType: "contractor",
        contractorName: CONTRACTOR_AH_SENG.name,
        contractorTin: CONTRACTOR_AH_SENG.tin,
        contractorAddress: CONTRACTOR_AH_SENG.address,
        contractorPhone: CONTRACTOR_AH_SENG.phone,
        issueDo: true,
        doNumber: formatDoNo(1),
        siteAddress: "Lot 42, Telipok Industrial Park",
        lorryPlate: "SABAH 2341",
        driverName: "Ah Kow",
        showPriceOnDo: true,
        method: "Cash",
        lines: [
          { itemId: catalog.sandKg.id, qtyMilli: netSandMilli },
          { itemId: catalog.cementBag.id, qtyMilli: 5000 },
        ],
      },
      catalog.resolveItem,
    );

    expect(draft.method).toBe("Cash");
    expect(draft.customerType).toBe("contractor");
    expect(formatInvNo(draft.customerType === "contractor" ? "B" : "A", 1)).toBe("B-0001");

    // 3. Persist order
    const order = await repo.persistOrder(draft);
    expect(order.method).toBe("Cash");

    // 4. Verify 0 open credit rows
    const openCredits = await repo.listCredits(1, { outstandingOnly: true });
    expect(openCredits.find((c) => c.orderId === order.id)).toBeUndefined();

    // 5. Generate and verify Delivery Order
    const doModel = buildDeliveryOrder({
      ...order,
      contractorName: draft.contractorName,
      siteAddress: draft.siteAddress,
      lorryPlate: draft.lorryPlate,
      driverName: draft.driverName,
    });
    expect(doModel.doNumber).toBe("DO-0001");
    expect(doModel.contractorName).toBe("Ah Seng Construction");
    expect(doModel.siteAddress).toBe("Lot 42, Telipok Industrial Park");
    expect(doModel.lorryPlate).toBe("SABAH 2341");
    expect(doModel.driverName).toBe("Ah Kow");

    const html = await renderDeliveryOrderHtml(doModel, TEST_STORE_INFO);
    expect(html).toContain("DO-0001");
    expect(html).toContain("STORE COPY");
    expect(html).toContain("CUSTOMER COPY");
    expect(html).toContain("Ah Seng Construction");
    expect(html).toContain("50 kg");
  });
});
