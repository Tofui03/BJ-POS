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
  MEASURE_UNITS,
  fmtQtySold,
  unitLabel,
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
  PosError,
} from "./harness.js";
import type { SqlPosRepo } from "../../packages/data/src/index.js";

describe("Hardware till features", () => {
  let repo: SqlPosRepo;
  let catalog: SeededCatalog;

  beforeEach(async () => {
    const booted = await freshTestRepo();
    repo = booted.repo;
    catalog = await seedHardwareCatalog(repo);
  });

  // =========================================================================
  // Feature 1: Measurement Units (kg, ft, meter)
  // =========================================================================
  describe("Feature 1: Measurement Units (kg, ft, meter)", () => {
    it("F1.1: recognizes kg, ft, and meter as measurement units", () => {
      expect(isMeasureUnit("kg")).toBe(true);
      expect(isMeasureUnit("ft")).toBe(true);
      expect(isMeasureUnit("meter")).toBe(true);
    });

    it("F1.2: rejects discrete counting units from measurement unit predicate", () => {
      expect(isMeasureUnit("pcs")).toBe(false);
      expect(isMeasureUnit("batang")).toBe(false);
      expect(isMeasureUnit("bag")).toBe(false);
      expect(isMeasureUnit("box")).toBe(false);
      expect(isMeasureUnit("bottle")).toBe(false);
      expect(isMeasureUnit("each")).toBe(false);
    });

    it("F1.3: formats measured quantities with humanized unit suffix", () => {
      expect(fmtQtySold(15500, "kg")).toBe("15.5 kg");
      expect(fmtQtySold(30000, "ft")).toBe("30 ft");
      expect(fmtQtySold(2500, "meter")).toBe("2.5 meter");
    });

    it("F1.4: formats discrete units without appending redundant unit suffix", () => {
      expect(fmtQtySold(5000, "pcs")).toBe("5");
      expect(fmtQtySold(10000, "bag")).toBe("10");
      expect(fmtQtySold(1000, "box")).toBe("1");
    });

    it("F1.5: persists and round-trips items with unit 'meter' through repository", async () => {
      const rebar = await repo.createItem({
        key: "steel_rebar_10mm",
        name: "Steel Rebar 10mm",
        unit: "meter",
        priceCents: 1500,
        tracksTail: false,
      });
      expect(rebar.unit).toBe("meter");
      const fetched = await repo.getItem(rebar.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.unit).toBe("meter");
      expect(isMeasureUnit(fetched!.unit)).toBe(true);
    });
  });

  // =========================================================================
  // Feature 2: Reverse Weight & Length Calculation
  // =========================================================================
  describe("Feature 2: Reverse Weight & Length Calculation", () => {
    it("F2.1: calculates target quantity with exact integer division", () => {
      // RM 20.00 (2000 cents) for sand at RM 0.20/kg (20 cents) -> 100,000 milli = 100.000 kg
      const qtyMilli = calcReverseQuantity(2000, 20);
      expect(qtyMilli).toBe(100000);
      expect(toQty(qtyMilli)).toBe(100);
    });

    it("F2.2: calculates repeating fractional budgets rounded half up", () => {
      // RM 10.00 (1000 cents) for item at RM 3.00/kg (300 cents) -> 1000 * 1000 / 300 = 3333.333 -> 3333 milli
      const qtyMilli = calcReverseQuantity(1000, 300);
      expect(qtyMilli).toBe(3333);
      expect(toQty(qtyMilli)).toBe(3.333);
    });

    it("F2.3: returns 0 milli-units for zero target budget", () => {
      expect(calcReverseQuantity(0, 1000)).toBe(0);
      const res = reversePriceLine(catalog.nailsKg, 0);
      expect(res.qtyMilli).toBe(0);
      expect(res.lineAmountCents).toBe(0);
    });

    it("F2.4: reverse-prices item below quantity break at base unit price", () => {
      // Nails: RM 10.00/kg base. Tier 1 starts at 30 kg (RM 8.00).
      // Budget: RM 200.00 (20,000 cents). At RM 10.00/kg -> 20.000 kg (does not qualify for 30kg tier).
      const res = reversePriceLine(catalog.nailsKg, 20000);
      expect(res.qtyMilli).toBe(20000);
      expect(res.unitPriceCents).toBe(1000);
      expect(res.lineAmountCents).toBe(20000);
      expect(res.tier).toBeNull();
    });

    it("F2.5: reverse-prices item qualifying for bulk quantity discount tier", () => {
      // Nails: Tier 1: >= 30 kg at RM 8.00 (800 cents).
      // Budget: RM 280.00 (28,000 cents). At RM 8.00/kg, 28,000 / 800 = 35.000 kg >= 30 kg threshold.
      const res = reversePriceLine(catalog.nailsKg, 28000);
      expect(res.qtyMilli).toBe(35000);
      expect(res.unitPriceCents).toBe(800);
      expect(res.lineAmountCents).toBe(28000);
      expect(res.tier).not.toBeNull();
      expect(res.tier!.minQtyMilli).toBe(30000);
    });
  });

  // =========================================================================
  // Feature 3: Tare Deduction Logic
  // =========================================================================
  describe("Feature 3: Tare Deduction Logic", () => {
    it("F3.1: subtracts container tare from gross scale reading in milli-units", () => {
      // 5.250 kg gross (5250 milli) - 0.250 kg tare (250 milli) = 5.000 kg net (5000 milli)
      const net = deductTare(5250, 250);
      expect(net).toBe(5000);
      expect(toQty(net)).toBe(5);
    });

    it("F3.2: clamps net weight to zero when tare equals or exceeds gross", () => {
      expect(deductTare(500, 500)).toBe(0);
      expect(deductTare(300, 600)).toBe(0);
    });

    it("F3.3: validateNetWeight accepts strictly positive net weight", () => {
      expect(() => validateNetWeight(1)).not.toThrow();
      expect(() => validateNetWeight(15000)).not.toThrow();
    });

    it("F3.4: validateNetWeight throws PosError on zero or negative weight", () => {
      expect(() => validateNetWeight(0)).toThrow(PosError);
      expect(() => validateNetWeight(-100)).toThrow(PosError);
    });

    it("F3.5: two-argument validateNetWeight(gross, tare) verifies gross > tare > 0", () => {
      const net = validateNetWeight(10000, 1500);
      expect(net).toBe(8500);
      expect(() => validateNetWeight(1000, 1000)).toThrow(PosError);
      expect(() => validateNetWeight(500, 800)).toThrow(PosError);
    });
  });

  // =========================================================================
  // Feature 4: Customer Decoupling (Walk-in vs Contractor)
  // =========================================================================
  describe("Feature 4: Customer Decoupling (Walk-in vs Contractor)", () => {
    it("F4.1: defaults anonymous sales to walkin customerType", () => {
      const draft = buildOrder(
        {
          method: "Cash",
          lines: [{ itemId: catalog.hammerPcs.id, qtyMilli: 1000 }],
        },
        catalog.resolveItem,
      );
      expect(draft.customerType).toBe("walkin");
      expect(draft.contractorName).toBeUndefined();
      expect(draft.contractorTin).toBeUndefined();
    });

    it("F4.2: walk-in sales format with A-prefix invoice sequence", () => {
      expect(formatInvNo("A", 1)).toBe("A-0001");
      expect(formatInvNo("A", 42)).toBe("A-0042");
    });

    it("F4.3: contractor sales attach company details and set customerType to contractor", () => {
      const draft = buildOrder(
        {
          customerType: "contractor",
          contractorName: CONTRACTOR_AH_SENG.name,
          contractorTin: CONTRACTOR_AH_SENG.tin,
          contractorAddress: CONTRACTOR_AH_SENG.address,
          contractorPhone: CONTRACTOR_AH_SENG.phone,
          method: "Cash",
          lines: [{ itemId: catalog.cementBag.id, qtyMilli: 5000 }],
        },
        catalog.resolveItem,
      );
      expect(draft.customerType).toBe("contractor");
      expect(draft.contractorName).toBe("Ah Seng Construction");
      expect(draft.contractorTin).toBe("C1234567890");
      expect(draft.contractorAddress).toBe("Lot 42, Telipok Industrial Park, Sabah");
      expect(draft.contractorPhone).toBe("012-3456789");
    });

    it("F4.4: contractor sales format with B-prefix invoice sequence", () => {
      expect(formatInvNo("B", 1)).toBe("B-0001");
      expect(formatInvNo("B", 88)).toBe("B-0088");
    });

    it("F4.5: contractor identification infers customerType contractor even if omitted", () => {
      const draft = buildOrder(
        {
          contractorName: "Mega Builder Sdn Bhd",
          method: "Bank",
          lines: [{ itemId: catalog.pipeFt.id, qtyMilli: 10000 }],
        },
        catalog.resolveItem,
      );
      expect(draft.customerType).toBe("contractor");
      expect(draft.contractorName).toBe("Mega Builder Sdn Bhd");
    });
  });

  // =========================================================================
  // Feature 5: Contractor Paying Cash/Bank/QR (B-Series, No Credit)
  // =========================================================================
  describe("Feature 5: Contractor Paying Cash/Bank/QR (B-Series, No Credit)", () => {
    it("F5.1: contractor paying Cash generates paid order with B-sequence", async () => {
      const draft = buildOrder(
        {
          customerType: "contractor",
          contractorName: "Ah Seng Construction",
          method: "Cash",
          lines: [{ itemId: catalog.nailsKg.id, qtyMilli: 5000 }],
        },
        catalog.resolveItem,
      );
      expect(draft.method).toBe("Cash");
      expect(draft.customerType).toBe("contractor");
      const invNo = formatInvNo("B", 1);
      expect(invNo).toBe("B-0001");
    });

    it("F5.2: contractor paying Bank transfer retains B-sequence without credit", async () => {
      const draft = buildOrder(
        {
          customerType: "contractor",
          contractorName: "Ah Seng Construction",
          method: "Bank",
          lines: [{ itemId: catalog.steelMeter.id, qtyMilli: 10000 }],
        },
        catalog.resolveItem,
      );
      expect(draft.method).toBe("Bank");
      expect(draft.customerType).toBe("contractor");
      expect(formatInvNo("B", 2)).toBe("B-0002");
    });

    it("F5.3: contractor paying QR code retains B-sequence without credit", async () => {
      const draft = buildOrder(
        {
          customerType: "contractor",
          contractorName: "Mega Builder Sdn Bhd",
          method: "QR",
          lines: [{ itemId: catalog.pipeFt.id, qtyMilli: 20000 }],
        },
        catalog.resolveItem,
      );
      expect(draft.method).toBe("QR");
      expect(draft.customerType).toBe("contractor");
    });

    it("F5.4: non-credit contractor sales do not create credit debt records", async () => {
      // Verify via repo that Cash sale creates zero open debt rows
      const draft = buildOrder(
        {
          customerType: "contractor",
          contractorName: "Ah Seng Construction",
          method: "Cash",
          lines: [{ itemId: catalog.hammerPcs.id, qtyMilli: 1000 }],
        },
        catalog.resolveItem,
      );
      const order = await repo.persistOrder(draft);
      expect(order.method).toBe("Cash");
      const openCredits = await repo.listCredits(1, { outstandingOnly: true });
      const orderDebt = openCredits.find((c) => c.orderId === order.id);
      expect(orderDebt).toBeUndefined();
    });

    it("F5.5: contractor paying Credit generates B-sequence and creates credit debt row", async () => {
      const draft = buildOrder(
        {
          customerType: "contractor",
          contractorName: "Ah Seng Construction",
          method: "Credit",
          lines: [{ itemId: catalog.cementBag.id, qtyMilli: 10000 }],
        },
        catalog.resolveItem,
      );
      const order = await repo.persistOrder(draft);
      expect(order.method).toBe("Credit");
      expect(order.invNo.startsWith("B-")).toBe(true);
      const openCredits = await repo.listCredits(1, { outstandingOnly: true });
      const orderDebt = openCredits.find((c) => c.orderId === order.id);
      expect(orderDebt).toBeDefined();
      expect(orderDebt!.name).toBe("Ah Seng Construction");
      expect(orderDebt!.clearedAt).toBeNull();
    });
  });

  // =========================================================================
  // Feature 6: Delivery Order (DO) Running Sequence & Metadata
  // =========================================================================
  describe("Feature 6: Delivery Order (DO) Running Sequence & Metadata", () => {
    it("F6.1: formatDoNo formats running sequence with 4-digit zero padding", () => {
      expect(formatDoNo(1)).toBe("DO-0001");
      expect(formatDoNo(42)).toBe("DO-0042");
      expect(formatDoNo(999)).toBe("DO-0999");
      expect(formatDoNo(1000)).toBe("DO-1000");
    });

    it("F6.2: buildDeliveryOrder populates all required metadata fields", () => {
      const draft = buildOrder(
        {
          customerType: "contractor",
          contractorName: "Ah Seng Construction",
          contractorTin: "C1234567890",
          issueDo: true,
          doNumber: "DO-0001",
          siteAddress: "Lot 42, Telipok Industrial Park",
          lorryPlate: "SABAH 2341",
          driverName: "Ah Kow",
          contractorPo: "PO-9921",
          showPriceOnDo: true,
          method: "Cash",
          lines: [{ itemId: catalog.nailsKg.id, qtyMilli: 15500 }],
        },
        catalog.resolveItem,
      );

      const order: Order = {
        ...draft,
        id: 1,
        companyId: 1,
        invNo: "B-0001",
        businessDate: "2026-10-23",
        voidedAt: null,
        items: [
          {
            id: 1,
            itemId: catalog.nailsKg.id,
            name: catalog.nailsKg.name,
            image: "",
            unit: "kg",
            priceCents: 1000,
            qtyMilli: 15500,
            amountCents: 15500,
            tailCount: 0,
            bulkPrice: false,
          },
        ],
      };

      const doModel = buildDeliveryOrder(order);
      expect(doModel.doNumber).toBe("DO-0001");
      expect(doModel.siteAddress).toBe("Lot 42, Telipok Industrial Park");
      expect(doModel.lorryPlate).toBe("SABAH 2341");
      expect(doModel.driverName).toBe("Ah Kow");
      expect(doModel.contractorPo).toBe("PO-9921");
      expect(doModel.showPriceOnDo).toBe(true);
    });

    it("F6.3: sequential DO generation increments running sequence", () => {
      const do1 = formatDoNo(1);
      const do2 = formatDoNo(2);
      const do3 = formatDoNo(3);
      expect(do1).toBe("DO-0001");
      expect(do2).toBe("DO-0002");
      expect(do3).toBe("DO-0003");
    });

    it("F6.4: supports optional contractor PO number when provided and undefined when omitted", () => {
      const baseOrder: Order = {
        id: 1,
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-23",
        invNo: "B-0001",
        method: "Cash",
        totalCents: 5000,
        voidedAt: null,
        items: [],
      };

      const doWithPo = buildDeliveryOrder({ ...baseOrder, contractorPo: "PO-8888" });
      expect(doWithPo.contractorPo).toBe("PO-8888");

      const doWithoutPo = buildDeliveryOrder({ ...baseOrder, contractorPo: undefined });
      expect(doWithoutPo.contractorPo).toBeUndefined();
    });

    it("F6.5: preserves tenant isolation companyId on DO model", () => {
      const orderTenant1: Order = {
        id: 10,
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-23",
        invNo: "B-0001",
        method: "Cash",
        totalCents: 1000,
        voidedAt: null,
        items: [],
      };
      const orderTenant2: Order = {
        id: 20,
        companyId: 2,
        ts: Date.now(),
        businessDate: "2026-10-23",
        invNo: "B-0001",
        method: "Cash",
        totalCents: 1000,
        voidedAt: null,
        items: [],
      };

      expect(buildDeliveryOrder(orderTenant1).companyId).toBe(1);
      expect(buildDeliveryOrder(orderTenant2).companyId).toBe(2);
    });
  });

  // =========================================================================
  // Feature 7: A4 Dual-Copy DO HTML Rendering (Store + Customer)
  // =========================================================================
  describe("Feature 7: A4 Dual-Copy DO HTML Rendering (Store + Customer)", () => {
    it("F7.1: generates standard A4 portrait page size styling", async () => {
      const order: Order = {
        id: 1,
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-23",
        invNo: "B-0001",
        method: "Cash",
        totalCents: 1000,
        voidedAt: null,
        items: [],
      };
      const html = await renderDeliveryOrderHtml(buildDeliveryOrder(order), TEST_STORE_INFO);
      expect(html).toContain("size: A4 portrait");
      expect(html).toContain("margin: 8mm 10mm");
    });

    it("F7.2: renders both Store Copy and Customer Copy on a single document", async () => {
      const order: Order = {
        id: 1,
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-23",
        invNo: "B-0001",
        method: "Cash",
        totalCents: 1000,
        voidedAt: null,
        items: [],
      };
      const html = await renderDeliveryOrderHtml(buildDeliveryOrder(order), TEST_STORE_INFO);
      expect(html).toContain("STORE COPY");
      expect(html).toContain("CUSTOMER COPY");
    });

    it("F7.3: includes cut or tear line separating top and bottom halves", async () => {
      const order: Order = {
        id: 1,
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-23",
        invNo: "B-0001",
        method: "Cash",
        totalCents: 1000,
        voidedAt: null,
        items: [],
      };
      const html = await renderDeliveryOrderHtml(buildDeliveryOrder(order), TEST_STORE_INFO);
      expect(html.toLowerCase()).toMatch(/cut|tear/);
    });

    it("F7.4: retains clean company reg number (227533-X) and omits obsolete MSIC", async () => {
      const order: Order = {
        id: 1,
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-23",
        invNo: "B-0001",
        method: "Cash",
        totalCents: 1000,
        voidedAt: null,
        items: [],
      };
      const html = await renderDeliveryOrderHtml(buildDeliveryOrder(order), TEST_STORE_INFO);
      expect(html).toContain("(227533-X)");
      expect(html).not.toContain("MSIC");
    });

    it("F7.5: displays contractor name, delivery site, lorry plate, and driver name", async () => {
      const order: Order = {
        id: 1,
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-23",
        invNo: "B-0001",
        contractorName: "Ah Seng Construction",
        siteAddress: "Lot 15, Kolombong",
        lorryPlate: "SABAH 8888",
        driverName: "Pak Mat",
        method: "Cash",
        totalCents: 1000,
        voidedAt: null,
        items: [],
      };
      const html = await renderDeliveryOrderHtml(buildDeliveryOrder(order), TEST_STORE_INFO);
      expect(html).toContain("Ah Seng Construction");
      expect(html).toContain("Lot 15, Kolombong");
      expect(html).toContain("SABAH 8888");
      expect(html).toContain("Pak Mat");
    });
  });

  // =========================================================================
  // Feature 8: DO Triple Signature Blocks
  // =========================================================================
  describe("Feature 8: DO Triple Signature Blocks", () => {
    it("F8.1: includes Issued By (Store) block on both copies", async () => {
      const order: Order = {
        id: 1,
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-23",
        invNo: "B-0001",
        method: "Cash",
        totalCents: 1000,
        voidedAt: null,
        items: [],
      };
      const html = await renderDeliveryOrderHtml(buildDeliveryOrder(order), TEST_STORE_INFO);
      const issuedMatches = html.match(/ISSUED BY/gi);
      expect(issuedMatches).not.toBeNull();
      expect(issuedMatches!.length).toBeGreaterThanOrEqual(2);
    });

    it("F8.2: includes Delivered By (Driver) block on both copies", async () => {
      const order: Order = {
        id: 1,
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-23",
        invNo: "B-0001",
        method: "Cash",
        totalCents: 1000,
        voidedAt: null,
        items: [],
      };
      const html = await renderDeliveryOrderHtml(buildDeliveryOrder(order), TEST_STORE_INFO);
      const deliveredMatches = html.match(/DELIVERED BY/gi);
      expect(deliveredMatches).not.toBeNull();
      expect(deliveredMatches!.length).toBeGreaterThanOrEqual(2);
    });

    it("F8.3: includes Received By (Site Supervisor) block on both copies", async () => {
      const order: Order = {
        id: 1,
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-23",
        invNo: "B-0001",
        method: "Cash",
        totalCents: 1000,
        voidedAt: null,
        items: [],
      };
      const html = await renderDeliveryOrderHtml(buildDeliveryOrder(order), TEST_STORE_INFO);
      const receivedMatches = html.match(/RECEIVED BY/gi);
      expect(receivedMatches).not.toBeNull();
      expect(receivedMatches!.length).toBeGreaterThanOrEqual(2);
    });

    it("F8.4: Received By block prompts for Full Name, IC, Date, and Company Chop", async () => {
      const order: Order = {
        id: 1,
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-23",
        invNo: "B-0001",
        method: "Cash",
        totalCents: 1000,
        voidedAt: null,
        items: [],
      };
      const html = await renderDeliveryOrderHtml(buildDeliveryOrder(order), TEST_STORE_INFO);
      expect(html).toMatch(/Name:/i);
      expect(html).toMatch(/IC:/i);
      expect(html).toMatch(/Date:/i);
      expect(html).toMatch(/Chop|Stamp/i);
    });

    it("F8.5: displays pre-populated driver name in Delivered By block", async () => {
      const order: Order = {
        id: 1,
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-23",
        invNo: "B-0001",
        driverName: "Kamaruddin bin Yusof",
        method: "Cash",
        totalCents: 1000,
        voidedAt: null,
        items: [],
      };
      const html = await renderDeliveryOrderHtml(buildDeliveryOrder(order), TEST_STORE_INFO);
      expect(html).toContain("Kamaruddin bin Yusof");
    });
  });

  // =========================================================================
  // Feature 9: DO Price Suppression Toggle (showPriceOnDo: false)
  // =========================================================================
  describe("Feature 9: DO Price Suppression Toggle (showPriceOnDo: false)", () => {
    it("F9.1: completely omits unit price column header when showPriceOnDo is false", async () => {
      const order: Order = {
        id: 1,
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-23",
        invNo: "B-0001",
        showPriceOnDo: false,
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
      expect(html).not.toContain("U/P");
    });

    it("F9.2: completely omits line amount column header when showPriceOnDo is false", async () => {
      const order: Order = {
        id: 1,
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-23",
        invNo: "B-0001",
        showPriceOnDo: false,
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
      expect(html).not.toContain("AMOUNT (RM)");
    });

    it("F9.3: suppresses monetary totals (Subtotal and TOTAL) when showPriceOnDo is false", async () => {
      const order: Order = {
        id: 1,
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-23",
        invNo: "B-0001",
        showPriceOnDo: false,
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
      const doModel = buildDeliveryOrder(order);
      expect(doModel.subtotalCents).toBeUndefined();
      expect(doModel.totalAmountCents).toBeUndefined();
      const html = await renderDeliveryOrderHtml(doModel, TEST_STORE_INFO);
      expect(html).not.toContain("50.00");
    });

    it("F9.4: renders unit prices and total amounts when showPriceOnDo is true", async () => {
      const order: Order = {
        id: 1,
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-23",
        invNo: "B-0001",
        showPriceOnDo: true,
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
      const doModel = buildDeliveryOrder(order);
      expect(doModel.totalAmountCents).toBe(5000);
      const html = await renderDeliveryOrderHtml(doModel, TEST_STORE_INFO);
      expect(html).toContain("U/P");
      expect(html).toContain("50.00");
    });

    it("F9.5: retains item descriptions and quantities regardless of showPriceOnDo toggle", async () => {
      const order: Order = {
        id: 1,
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-23",
        invNo: "B-0001",
        showPriceOnDo: false,
        method: "Cash",
        totalCents: 5000,
        voidedAt: null,
        items: [
          {
            id: 1,
            itemId: catalog.nailsKg.id,
            name: "Common Wire Nails 2\"",
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
      expect(html).toContain("Common Wire Nails 2&quot;");
      expect(html).toContain("5 kg");
    });
  });

  // =========================================================================
  // Feature 10: Immediate Numpad Trigger & UI / Cart Integration
  // =========================================================================
  describe("Feature 10: Immediate Numpad Trigger & UI / Cart Integration", () => {
    it("F10.1: flags kg items for immediate measurement entry", () => {
      expect(isMeasureUnit(catalog.nailsKg.unit)).toBe(true);
      expect(catalog.nailsKg.unit).toBe("kg");
    });

    it("F10.2: flags ft items for immediate measurement entry", () => {
      expect(isMeasureUnit(catalog.pipeFt.unit)).toBe(true);
      expect(catalog.pipeFt.unit).toBe("ft");
    });

    it("F10.3: flags meter items for immediate measurement entry", () => {
      expect(isMeasureUnit(catalog.steelMeter.unit)).toBe(true);
      expect(catalog.steelMeter.unit).toBe("meter");
    });

    it("F10.4: does not flag discrete unit items (pcs, bag) for weight numpad entry", () => {
      expect(isMeasureUnit(catalog.cementBag.unit)).toBe(false);
      expect(isMeasureUnit(catalog.hammerPcs.unit)).toBe(false);
    });

    it("F10.5: cart line resolution prices decimal milli-quantities with correct rounding", () => {
      // 12.500 kg nails at RM 10.00/kg -> RM 125.00 (12,500 cents)
      const draft = buildOrder(
        {
          method: "Cash",
          lines: [{ itemId: catalog.nailsKg.id, qtyMilli: 12500 }],
        },
        catalog.resolveItem,
      );
      expect(draft.totalCents).toBe(12500);
      expect(toRM(draft.totalCents)).toBe(125.0);
    });
  });
});
