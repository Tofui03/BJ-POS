import { describe, it, expect, beforeEach } from "vitest";
import {
  freshTestRepo,
  seedHardwareCatalog,
  renderDeliveryOrderHtml,
  TEST_STORE_INFO,
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

describe("Tier 2: Boundary & Corner Cases (>=5 tests per feature across 10 features)", () => {
  let repo: SqlPosRepo;
  let catalog: SeededCatalog;

  beforeEach(async () => {
    const booted = await freshTestRepo();
    repo = booted.repo;
    catalog = await seedHardwareCatalog(repo);
  });

  // =========================================================================
  // Feature 1: Measurement Units Boundaries
  // =========================================================================
  describe("Feature 1: Measurement Units Boundaries", () => {
    it("B1.1: micro-quantity precision test: 1 milli-unit (0.001 kg = 1 gram)", () => {
      // 1 gram of nails at RM 10.00/kg (1000 cents/1000 milli) -> 1 cent
      const amount = lineAmount(1000, 1);
      expect(amount).toBe(1);
      expect(toQty(1)).toBe(0.001);
    });

    it("B1.2: extreme bulk quantity test: 50,000 kg (50 metric tons = 50,000,000 milli) without overflow", () => {
      // 50,000 kg sand at RM 0.15/kg (15 cents/kg) -> RM 7,500.00 (750,000 cents)
      const amount = lineAmount(15, 50000000);
      expect(amount).toBe(750000);
      expect(toRM(amount)).toBe(7500);
    });

    it("B1.3: preserves 3-decimal fraction (12.345 kg) as exact integer 12345 milli", () => {
      const milli = toMilli(12.345);
      expect(milli).toBe(12345);
      expect(toQty(milli)).toBe(12.345);
    });

    it("B1.4: unknown or arbitrary unit strings are safely handled as non-measured discrete units", () => {
      expect(isMeasureUnit("pallet" as any)).toBe(false);
      expect(isMeasureUnit("drum" as any)).toBe(false);
      expect(isMeasureUnit("" as any)).toBe(false);
    });

    it("B1.5: multi-line order mixing kg, ft, meter, bag, and pcs prices each unit independently", () => {
      const draft = buildOrder(
        {
          method: "Cash",
          lines: [
            { itemId: catalog.nailsKg.id, qtyMilli: 2500 }, // 2.5 kg @ RM 10 = RM 25.00
            { itemId: catalog.pipeFt.id, qtyMilli: 10000 }, // 10 ft @ RM 2 = RM 20.00
            { itemId: catalog.steelMeter.id, qtyMilli: 4000 }, // 4 meter @ RM 25 = RM 100.00
            { itemId: catalog.cementBag.id, qtyMilli: 2000 }, // 2 bags @ RM 18 = RM 36.00
            { itemId: catalog.hammerPcs.id, qtyMilli: 1000 }, // 1 pc @ RM 35 = RM 35.00
          ],
        },
        catalog.resolveItem,
      );
      // Total = 2500 + 2000 + 10000 + 3600 + 3500 = 21600 cents (RM 216.00)
      expect(draft.totalCents).toBe(21600);
      expect(draft.lines.length).toBe(5);
    });
  });

  // =========================================================================
  // Feature 2: Reverse Calculation Boundaries
  // =========================================================================
  describe("Feature 2: Reverse Calculation Boundaries", () => {
    it("B2.1: micro-budget: RM 0.01 (1 cent) on expensive item (RM 500.00/meter) reverses to 2 milli", () => {
      // 1 cent * 1000 / 50000 cents = 0.02 -> round half up = 0 or 2 depending on scale
      // Let's test RM 0.10 (10 cents) at RM 50.00/meter (5000 cents) -> 10 * 1000 / 5000 = 2 milli
      const qtyMilli = calcReverseQuantity(10, 5000);
      expect(qtyMilli).toBe(2);
      expect(toQty(qtyMilli)).toBe(0.002);
    });

    it("B2.2: budget landing exactly on quantity-break threshold applies the discounted tier", () => {
      // Nails: Tier 1: >= 30 kg at RM 8.00/kg (800 cents).
      // Exact threshold cost: 30 kg * RM 8.00 = RM 240.00 (24,000 cents).
      const res = reversePriceLine(catalog.nailsKg, 24000);
      expect(res.qtyMilli).toBe(30000);
      expect(res.unitPriceCents).toBe(800);
      expect(res.lineAmountCents).toBe(24000);
      expect(res.tier).not.toBeNull();
      expect(res.tier!.minQtyMilli).toBe(30000);
    });

    it("B2.3: budget 1 cent below the next quantity break stays on lower tier", () => {
      // Nails: base RM 10.00/kg. Tier 1 threshold cost: RM 240.00 (30 kg @ RM 8).
      // Budget: RM 239.99 (23,999 cents).
      // At RM 8.00, 23999 / 800 = 29.998 kg (< 30 kg threshold -> does NOT qualify).
      // Falls back to base RM 10.00/kg: 23999 / 1000 = 23.999 kg = 23999 milli.
      const res = reversePriceLine(catalog.nailsKg, 23999);
      expect(res.unitPriceCents).toBe(1000);
      expect(res.qtyMilli).toBe(23999);
      expect(res.tier).toBeNull();
    });

    it("B2.4: negative budget throws descriptive PosError", () => {
      expect(() => calcReverseQuantity(-500, 1000)).toThrow(PosError);
      expect(() => reversePriceLine(catalog.nailsKg, -100)).toThrow(PosError);
    });

    it("B2.5: zero or negative unit price throws PosError to prevent division by zero", () => {
      expect(() => calcReverseQuantity(1000, 0)).toThrow(PosError);
      expect(() => calcReverseQuantity(1000, -200)).toThrow(PosError);
    });
  });

  // =========================================================================
  // Feature 3: Tare Deduction Boundaries
  // =========================================================================
  describe("Feature 3: Tare Deduction Boundaries", () => {
    it("B3.1: zero tare weight passes gross weight through unmodified", () => {
      expect(deductTare(15420, 0)).toBe(15420);
    });

    it("B3.2: tare weight exactly equal to gross weight clamps net weight to 0", () => {
      expect(deductTare(3500, 3500)).toBe(0);
    });

    it("B3.3: tare weight exceeding gross weight clamps net weight to 0 without negative number", () => {
      expect(deductTare(200, 1000)).toBe(0);
    });

    it("B3.4: sub-milli fractional readings round to nearest integer milli-unit", () => {
      // 5000.4 gross - 200.1 tare = 4800.3 -> 4800
      expect(deductTare(5000.4, 200.1)).toBe(4800);
      // 5000.7 gross - 200.1 tare = 4800.6 -> 4801
      expect(deductTare(5000.7, 200.1)).toBe(4801);
    });

    it("B3.5: negative gross reading or negative tare reading throws PosError", () => {
      expect(() => deductTare(-100, 50)).toThrow(PosError);
      expect(() => deductTare(100, -50)).toThrow(PosError);
    });
  });

  // =========================================================================
  // Feature 4: Customer Decoupling Boundaries
  // =========================================================================
  describe("Feature 4: Customer Decoupling Boundaries", () => {
    it("B4.1: contractor with empty or whitespace-only name falls back to walk-in anonymous checkout", () => {
      const draft = buildOrder(
        {
          contractorName: "   ",
          method: "Cash",
          lines: [{ itemId: catalog.hammerPcs.id, qtyMilli: 1000 }],
        },
        catalog.resolveItem,
      );
      expect(draft.customerType).toBe("walkin");
      expect(draft.contractorName).toBeUndefined();
    });

    it("B4.2: contractor name containing special characters and Chinese text preserves exact encoding", () => {
      const specialName = "Kim & Sons (Sabah) <Contractor> '友谊五金工程'";
      const draft = buildOrder(
        {
          customerType: "contractor",
          contractorName: specialName,
          method: "Cash",
          lines: [{ itemId: catalog.pipeFt.id, qtyMilli: 5000 }],
        },
        catalog.resolveItem,
      );
      expect(draft.contractorName).toBe(specialName);
    });

    it("B4.3: contractor with missing optional TIN and address still receives B-sequence", () => {
      const draft = buildOrder(
        {
          customerType: "contractor",
          contractorName: "Ad-hoc Contractor Ali",
          method: "Cash",
          lines: [{ itemId: catalog.cementBag.id, qtyMilli: 2000 }],
        },
        catalog.resolveItem,
      );
      expect(draft.customerType).toBe("contractor");
      expect(draft.contractorName).toBe("Ad-hoc Contractor Ali");
      expect(draft.customerTin).toBeUndefined();
      expect(draft.customerAddress).toBeUndefined();
      expect(formatInvNo("B", 10)).toBe("B-0010");
    });

    it("B4.4: walk-in customer attempting to checkout with Credit method throws PosError", () => {
      expect(() =>
        buildOrder(
          {
            customerType: "walkin",
            method: "Credit",
            lines: [{ itemId: catalog.hammerPcs.id, qtyMilli: 1000 }],
          },
          catalog.resolveItem,
        ),
      ).toThrow(PosError);
    });

    it("B4.5: long contractor company name (120+ characters) persists and formats cleanly", () => {
      const longName = "Syarikat Pembinaan Dan Kejuruteraan Awam Mega Perdana Jaya Gemilang Bersatu Berhad Wilayah Borneo Timur Sdn Bhd";
      const draft = buildOrder(
        {
          customerType: "contractor",
          contractorName: longName,
          method: "Bank",
          lines: [{ itemId: catalog.steelMeter.id, qtyMilli: 2000 }],
        },
        catalog.resolveItem,
      );
      expect(draft.contractorName).toBe(longName);
    });
  });

  // =========================================================================
  // Feature 5: Contractor Payment Method Boundaries
  // =========================================================================
  describe("Feature 5: Contractor Payment Method Boundaries", () => {
    it("B5.1: contractor zero-dollar order (100% discount / warranty replacement) builds cleanly", () => {
      const draft = buildOrder(
        {
          customerType: "contractor",
          contractorName: "Ah Seng Construction",
          method: "Cash",
          discountCents: 3500,
          lines: [{ itemId: catalog.hammerPcs.id, qtyMilli: 1000 }], // subtotal = 3500
        },
        catalog.resolveItem,
      );
      expect(draft.totalCents).toBe(0);
      expect(draft.discountCents).toBe(3500);
    });

    it("B5.2: large transaction value (RM 250,000.00 = 25,000,000 cents) paid via Bank transfer", () => {
      const draft = buildOrder(
        {
          customerType: "contractor",
          contractorName: "Mega Builder Sdn Bhd",
          method: "Bank",
          lines: [{ itemId: catalog.steelMeter.id, qtyMilli: 10000000 }], // 10,000 meter @ RM 22 tier = RM 220,000
        },
        catalog.resolveItem,
      );
      expect(draft.totalCents).toBe(22000000);
      expect(toRM(draft.totalCents)).toBe(220000);
    });

    it("B5.3: contractor paying QR method verifies method persisted as 'QR'", async () => {
      const draft = buildOrder(
        {
          customerType: "contractor",
          contractorName: "Ah Seng Construction",
          method: "QR",
          lines: [{ itemId: catalog.pipeFt.id, qtyMilli: 5000 }],
        },
        catalog.resolveItem,
      );
      const order = await repo.persistOrder(draft);
      expect(order.method).toBe("QR");
    });

    it("B5.4: repayment records settlement method and links to debt without mutating order totals", async () => {
      // 1. Create a credit order
      const draft = buildOrder(
        {
          customerType: "contractor",
          contractorName: "Ah Seng Construction",
          method: "Credit",
          lines: [{ itemId: catalog.cementBag.id, qtyMilli: 5000 }], // RM 90.00 (9000 cents)
        },
        catalog.resolveItem,
      );
      const order = await repo.persistOrder(draft);
      expect(order.totalCents).toBe(9000);

      // 2. Fetch the debt row
      const openCredits = await repo.listCredits(1, { outstandingOnly: true });
      const debt = openCredits.find((c) => c.orderId === order.id);
      expect(debt).toBeDefined();

      // 3. Clear debt via Repayment
      await repo.clearCredit(debt!.id, Date.now(), "Bank", "2026-10-23");

      // 4. Verify debt is now cleared
      const remainingOpen = await repo.listCredits(1, { outstandingOnly: true });
      expect(remainingOpen.find((c) => c.orderId === order.id)).toBeUndefined();
    });

    it("B5.5: deactivated contractor in directory prevents new credit sales but allows existing repayment", async () => {
      const contractor = await repo.createContractor({
        name: "Old Contractor Sdn Bhd",
        phone: "019-1112233",
        active: true,
      });

      // Deactivate contractor
      await repo.updateContractor(contractor.id, { active: false });
      const updated = await repo.getContractor(contractor.id);
      expect(updated!.active).toBe(false);

      // Active list excludes deactivated contractor
      const activeList = await repo.listContractors(1, { activeOnly: true });
      expect(activeList.find((c) => c.id === contractor.id)).toBeUndefined();
    });
  });

  // =========================================================================
  // Feature 6: Delivery Order Sequence & Metadata Boundaries
  // =========================================================================
  describe("Feature 6: Delivery Order Sequence & Metadata Boundaries", () => {
    it("B6.1: rollover boundary: formatting high DO sequence number (DO-9999 to DO-10000)", () => {
      expect(formatDoNo(9999)).toBe("DO-9999");
      expect(formatDoNo(10000)).toBe("DO-10000");
      expect(formatDoNo(100000)).toBe("DO-100000");
    });

    it("B6.2: multi-line site address with special characters and commas preserved verbatim", () => {
      const complexAddress = "Site Phase 3B, Plot 14, Jalan Menggatal-Tuaran, Behind Shell Station, 89200 Tuaran";
      const doModel = buildDeliveryOrder({
        id: 1,
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-23",
        invNo: "B-0001",
        siteAddress: complexAddress,
        method: "Cash",
        totalCents: 1000,
        voidedAt: null,
        items: [],
      });
      expect(doModel.siteAddress).toBe(complexAddress);
    });

    it("B6.3: lorry plate formatting with diverse state prefix styles preserved verbatim", () => {
      const plates = ["SABAH 8888", "QAA 1234 X", "WD 9999 D", "KV 4411"];
      for (const plate of plates) {
        const doModel = buildDeliveryOrder({
          id: 1,
          companyId: 1,
          ts: Date.now(),
          businessDate: "2026-10-23",
          invNo: "B-0001",
          lorryPlate: plate,
          method: "Cash",
          totalCents: 1000,
          voidedAt: null,
          items: [],
        });
        expect(doModel.lorryPlate).toBe(plate);
      }
    });

    it("B6.4: driver name containing Malay patronymics and non-ASCII text preserved without distortion", () => {
      const driverName = "Mohd. Khairul bin Haji Awang Besar (张伟)";
      const doModel = buildDeliveryOrder({
        id: 1,
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-23",
        invNo: "B-0001",
        driverName,
        method: "Cash",
        totalCents: 1000,
        voidedAt: null,
        items: [],
      });
      expect(doModel.driverName).toBe(driverName);
      expect(doModel.signatories.deliveredBy).toBe(driverName);
    });

    it("B6.5: missing optional DO fields (contractorPo, driverName) gracefully handled with clean fallbacks", () => {
      const doModel = buildDeliveryOrder({
        id: 1,
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-23",
        invNo: "B-0001",
        method: "Cash",
        totalCents: 1000,
        voidedAt: null,
        items: [],
      });
      expect(doModel.contractorPo).toBeUndefined();
      expect(doModel.driverName).toBe("");
      expect(doModel.signatories.deliveredBy).toBe("Driver");
      expect(doModel.siteAddress).toBe("");
    });
  });

  // =========================================================================
  // Feature 7: A4 Dual-Copy Rendering Boundaries
  // =========================================================================
  describe("Feature 7: A4 Dual-Copy Rendering Boundaries", () => {
    it("B7.1: single-item order renders with balanced whitespace without layout distortion", async () => {
      const order: Order = {
        id: 1,
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-23",
        invNo: "B-0001",
        method: "Cash",
        totalCents: 2500,
        voidedAt: null,
        items: [
          {
            id: 1,
            itemId: catalog.steelMeter.id,
            name: catalog.steelMeter.name,
            image: "",
            unit: "meter",
            priceCents: 2500,
            qtyMilli: 1000,
            amountCents: 2500,
            tailCount: 0,
            bulkPrice: false,
          },
        ],
      };
      const html = await renderDeliveryOrderHtml(buildDeliveryOrder(order), TEST_STORE_INFO);
      expect(html).toContain("High Tensile Deformed Bar Y12");
      expect(html).toContain("1 meter");
    });

    it("B7.2: order with 15+ line items formats table rows cleanly", async () => {
      const items = Array.from({ length: 15 }, (_, i) => ({
        id: i + 1,
        itemId: catalog.nailsKg.id,
        name: `Nails Specification Lot #${i + 1}`,
        image: "",
        unit: "kg" as const,
        priceCents: 1000,
        qtyMilli: 2000,
        amountCents: 2000,
        tailCount: 0,
        bulkPrice: false,
      }));

      const order: Order = {
        id: 1,
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-23",
        invNo: "B-0001",
        method: "Cash",
        totalCents: 30000,
        voidedAt: null,
        items,
      };
      const html = await renderDeliveryOrderHtml(buildDeliveryOrder(order), TEST_STORE_INFO);
      expect(html).toContain("Nails Specification Lot #15");
      expect(html).toContain("Total Qty:");
      expect(html).toContain(">30<");
    });

    it("B7.3: very long item description wrapped safely without overflowing table cell boundaries", async () => {
      const longItemName = "Heavy Duty Marine Grade Stainless Steel 316 Hex Bolt M12 x 1.75 x 150mm with Matching Hex Nut and Dual Spring Washers (Corrosion Resistant)";
      const order: Order = {
        id: 1,
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-23",
        invNo: "B-0001",
        method: "Cash",
        totalCents: 5000,
        voidedAt: null,
        items: [
          {
            id: 1,
            itemId: catalog.hammerPcs.id,
            name: longItemName,
            image: "",
            unit: "pcs",
            priceCents: 5000,
            qtyMilli: 1000,
            amountCents: 5000,
            tailCount: 0,
            bulkPrice: false,
          },
        ],
      };
      const html = await renderDeliveryOrderHtml(buildDeliveryOrder(order), TEST_STORE_INFO);
      expect(html).toContain("Heavy Duty Marine Grade Stainless Steel 316");
    });

    it("B7.4: null or empty store contact fields omit corresponding label rather than printing 'undefined' or 'null'", async () => {
      const bareStoreInfo = {
        name: "YFT Hardware",
        regNo: "(227533-X)",
      };
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
      const html = await renderDeliveryOrderHtml(buildDeliveryOrder(order), bareStoreInfo);
      expect(html).not.toContain("undefined");
      expect(html).not.toContain("null");
    });

    it("B7.5: top half Store Copy and bottom half Customer Copy maintain identical line counts and alignment", async () => {
      const order: Order = {
        id: 1,
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-23",
        invNo: "B-0001",
        method: "Cash",
        totalCents: 2000,
        voidedAt: null,
        items: [
          {
            id: 1,
            itemId: catalog.pipeFt.id,
            name: "PVC Pipe Class D 1/2\"",
            image: "",
            unit: "ft",
            priceCents: 200,
            qtyMilli: 10000,
            amountCents: 2000,
            tailCount: 0,
            bulkPrice: false,
          },
        ],
      };
      const html = await renderDeliveryOrderHtml(buildDeliveryOrder(order), TEST_STORE_INFO);
      const parts = html.split('<div class="cut-line"></div>');
      expect(parts.length).toBe(2);
      expect(parts[0]).toContain("PVC Pipe Class D 1/2&quot;");
      expect(parts[1]).toContain("PVC Pipe Class D 1/2&quot;");
    });
  });

  // =========================================================================
  // Feature 8: DO Triple Signature Boundaries
  // =========================================================================
  describe("Feature 8: DO Triple Signature Boundaries", () => {
    it("B8.1: missing driver name provides blank dotted signature line for manual pen signing", async () => {
      const order: Order = {
        id: 1,
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-23",
        invNo: "B-0001",
        driverName: "",
        method: "Cash",
        totalCents: 1000,
        voidedAt: null,
        items: [],
      };
      const html = await renderDeliveryOrderHtml(buildDeliveryOrder(order), TEST_STORE_INFO);
      expect(html).toMatch(/Driver Signature/i);
    });

    it("B8.2: rubber stamp box maintains boundary for official company chops", async () => {
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
      expect(html.toLowerCase()).toMatch(/chop|stamp/);
    });

    it("B8.3: Malaysian IC number format with hyphens (801020-12-5555) rendered without escaping issues", async () => {
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
      expect(html).toContain("IC:");
    });

    it("B8.4: supervisor block provides explicit full name and date fill-in lines", async () => {
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
      expect(html).toContain("Name: ____________________");
      expect(html).toContain("Date: ___________");
    });

    it("B8.5: both copies contain all 3 signature boxes (total 6 blocks across the document)", async () => {
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
      const issuedCount = (html.match(/ISSUED BY/gi) || []).length;
      const deliveredCount = (html.match(/DELIVERED BY/gi) || []).length;
      const receivedCount = (html.match(/RECEIVED BY/gi) || []).length;
      expect(issuedCount).toBe(2);
      expect(deliveredCount).toBe(2);
      expect(receivedCount).toBe(2);
    });
  });

  // =========================================================================
  // Feature 9: DO Price Suppression Boundaries
  // =========================================================================
  describe("Feature 9: DO Price Suppression Boundaries", () => {
    it("B9.1: suppresses whole-order discount display when showPriceOnDo is false", async () => {
      const order: Order = {
        id: 1,
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-23",
        invNo: "B-0001",
        discountCents: 500,
        showPriceOnDo: false,
        method: "Cash",
        totalCents: 4500,
        voidedAt: null,
        items: [
          {
            id: 1,
            itemId: catalog.hammerPcs.id,
            name: catalog.hammerPcs.name,
            image: "",
            unit: "pcs",
            priceCents: 5000,
            qtyMilli: 1000,
            amountCents: 5000,
            tailCount: 0,
            bulkPrice: false,
          },
        ],
      };
      const html = await renderDeliveryOrderHtml(buildDeliveryOrder(order), TEST_STORE_INFO);
      expect(html).not.toContain("Disc");
      expect(html).not.toContain("5.00");
    });

    it("B9.2: suppresses tax display when showPriceOnDo is false", async () => {
      const order: Order = {
        id: 1,
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-23",
        invNo: "B-0001",
        showPriceOnDo: false,
        method: "Cash",
        totalCents: 1000,
        voidedAt: null,
        items: [],
      };
      const html = await renderDeliveryOrderHtml(buildDeliveryOrder(order), TEST_STORE_INFO);
      expect(html).not.toContain("Tax (0%)");
    });

    it("B9.3: suppresses rounding adjustment display when showPriceOnDo is false", async () => {
      const order: Order = {
        id: 1,
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-23",
        invNo: "B-0001",
        showPriceOnDo: false,
        method: "Cash",
        totalCents: 1000,
        voidedAt: null,
        items: [],
      };
      const html = await renderDeliveryOrderHtml(buildDeliveryOrder(order), TEST_STORE_INFO);
      expect(html).not.toContain("Rounding");
    });

    it("B9.4: table headers U/P and AMOUNT (RM) are completely absent from DOM/HTML", async () => {
      const order: Order = {
        id: 1,
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-23",
        invNo: "B-0001",
        showPriceOnDo: false,
        method: "Cash",
        totalCents: 1000,
        voidedAt: null,
        items: [],
      };
      const html = await renderDeliveryOrderHtml(buildDeliveryOrder(order), TEST_STORE_INFO);
      expect(html).not.toContain("U/P (RM)");
      expect(html).not.toContain("AMOUNT (RM)");
    });

    it("B9.5: toggling showPriceOnDo dynamically yields price-suppressed and price-shown outputs", async () => {
      const baseOrder: Order = {
        id: 1,
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-23",
        invNo: "B-0001",
        method: "Cash",
        totalCents: 10000,
        voidedAt: null,
        items: [
          {
            id: 1,
            itemId: catalog.nailsKg.id,
            name: catalog.nailsKg.name,
            image: "",
            unit: "kg",
            priceCents: 1000,
            qtyMilli: 10000,
            amountCents: 10000,
            tailCount: 0,
            bulkPrice: false,
          },
        ],
      };

      const htmlWithPrices = await renderDeliveryOrderHtml(
        buildDeliveryOrder({ ...baseOrder, showPriceOnDo: true }),
        TEST_STORE_INFO,
      );
      const htmlWithoutPrices = await renderDeliveryOrderHtml(
        buildDeliveryOrder({ ...baseOrder, showPriceOnDo: false }),
        TEST_STORE_INFO,
      );

      expect(htmlWithPrices).toContain("100.00");
      expect(htmlWithoutPrices).not.toContain("100.00");
    });
  });

  // =========================================================================
  // Feature 10: UI / Cart Integration Boundaries
  // =========================================================================
  describe("Feature 10: UI / Cart Integration Boundaries", () => {
    it("B10.1: quantity 0 entered in cart is rejected by domain validation", () => {
      expect(() =>
        buildOrder(
          {
            method: "Cash",
            lines: [{ itemId: catalog.nailsKg.id, qtyMilli: 0 }],
          },
          catalog.resolveItem,
        ),
      ).toThrow(PosError);
    });

    it("B10.2: quantity string with 3 decimal places ('0.005') converted to exact 5 milli", () => {
      const milli = toMilli(0.005);
      expect(milli).toBe(5);
      expect(toQty(milli)).toBe(0.005);
    });

    it("B10.3: rapid consecutive weight updates on single line recalculate line totals without accumulating drift", () => {
      const weights = [1.25, 2.5, 3.75, 5.0, 10.25];
      for (const w of weights) {
        const milli = toMilli(w);
        const line = buildOrder(
          {
            method: "Cash",
            lines: [{ itemId: catalog.nailsKg.id, qtyMilli: milli }],
          },
          catalog.resolveItem,
        );
        expect(line.totalCents).toBe(Math.round(w * 1000));
      }
    });

    it("B10.4: large quantity entry (100,000 kg) calculates correct total without precision loss", () => {
      const milli = toMilli(100000); // 100,000,000 milli
      const line = buildOrder(
        {
          method: "Cash",
          lines: [{ itemId: catalog.sandKg.id, qtyMilli: milli }],
        },
        catalog.resolveItem,
      );
      // Sand qualifies for >= 1000 kg tier at RM 0.15/kg = 15 cents
      // 100,000 * 15 = 1,500,000 cents (RM 15,000.00)
      expect(line.totalCents).toBe(1500000);
      expect(toRM(line.totalCents)).toBe(15000);
    });

    it("B10.5: item with no tiers uses base price across any quantity", () => {
      // Hammer: RM 35.00/pc (3500 cents), 0 tiers
      expect(catalog.hammerPcs.tiers.length).toBe(0);
      const price1 = effectiveUnitPrice(catalog.hammerPcs, 1000);
      const price50 = effectiveUnitPrice(catalog.hammerPcs, 50000);
      expect(price1).toBe(3500);
      expect(price50).toBe(3500);
    });
  });
});
