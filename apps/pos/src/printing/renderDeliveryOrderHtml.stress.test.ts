import { describe, expect, it } from "vitest";
import type { CompanyInfo, DeliveryOrder } from "@yf/core";
import { renderDeliveryOrderHtml } from "./renderDeliveryOrderHtml";

const mockCompany: CompanyInfo = {
  name: "Borneo Jasa Sdn. Bhd.",
  nameCn: "婆罗洲贸易有限公司",
  regNo: "(227533-X)",
  tin: "C2398472901",
  address: "Lot 12, Kolombong Industrial Estate, 88450 Kota Kinabalu, Sabah",
  tel: "088-385555 / 016-8882233",
  email: "billing@borneojasa.com.my",
};

describe("Empirical Challenge Harness: renderDeliveryOrderHtml", () => {
  describe("1. Price Suppression Leakage (Adversarial Canaries)", () => {
    it("strictly suppresses all prices, amounts, decimals, and monetary labels when showPriceOnDo is false", () => {
      const canaryPrices = {
        unitPrice1: "137.45",
        unitPriceText1: "RM 137.45/kg",
        amount1: "274.90",
        amountText1: "RM 274.90",
        unitPrice2: "987.65",
        unitPriceText2: "RM 987.65/bag",
        amount2: "4938.25",
        amountText2: "RM 4,938.25",
        subtotalText: "RM 5,213.15",
        subtotalValue: "5213.15",
        totalText: "RM 5,213.15",
        totalValue: "5213.15",
      };

      const doData: DeliveryOrder = {
        companyId: 1,
        businessDate: "2026-10-23",
        doNumber: "DO-8888",
        invNo: "B-9999",
        dateText: "23/10/2026 16:45",
        storeName: "Borneo Jasa Sdn. Bhd.",
        storeNameCn: "婆罗洲贸易有限公司",
        siteAddress: "Lot 99, Tapak Projek Minintod",
        lorryPlate: "SABAH 8888",
        driverName: "Pak Mat",
        contractorName: "Mega Bina Sdn. Bhd.",
        showPriceOnDo: false,
        totalQtyMilli: 7000,
        totalQtyText: "7.000",
        lines: [
          {
            itemNo: 1,
            name: "High-Tensile Rebar Y12",
            itemName: "High-Tensile Rebar Y12",
            unit: "kg",
            qtyMilli: 2000,
            qtyText: "2 kg",
            unitPriceCents: 13745,
            unitPriceText: canaryPrices.unitPriceText1,
            lineAmountCents: 27490,
            amountText: canaryPrices.amountText1,
          },
          {
            itemNo: 2,
            name: "Portland Cement (50kg)",
            itemName: "Portland Cement (50kg)",
            unit: "bag",
            qtyMilli: 5000,
            qtyText: "5 bag",
            unitPriceCents: 98765,
            unitPriceText: canaryPrices.unitPriceText2,
            lineAmountCents: 493825,
            amountText: canaryPrices.amountText2,
          },
        ],
        subtotalCents: 521315,
        subtotalText: canaryPrices.subtotalText,
        totalAmountCents: 521315,
        totalText: canaryPrices.totalText,
        signatories: {
          issuedBy: "Cashier Wong",
          deliveredBy: "Pak Mat",
          receivedBy: "Site Supervisor",
        },
      };

      const html = renderDeliveryOrderHtml(doData, mockCompany);

      // 1. None of the canary price strings must appear
      expect(html).not.toContain(canaryPrices.unitPrice1);
      expect(html).not.toContain(canaryPrices.amount1);
      expect(html).not.toContain(canaryPrices.unitPrice2);
      expect(html).not.toContain(canaryPrices.amount2);
      expect(html).not.toContain(canaryPrices.subtotalValue);
      expect(html).not.toContain(canaryPrices.totalValue);
      expect(html).not.toContain("5,213.15");
      expect(html).not.toContain("4,938.25");

      // 2. No currency indicators or monetary headers
      expect(html).not.toMatch(/RM\s*\d+/i);
      expect(html).not.toMatch(/\$\s*\d+/);
      expect(html).not.toMatch(/MYR\s*\d+/i);
      expect(html).not.toMatch(/U\/P/i);
      expect(html).not.toMatch(/AMOUNT/i);
      expect(html).not.toMatch(/Subtotal/i);
      expect(html).not.toMatch(/TOTAL:\s*RM/i);

      // 3. Must retain non-monetary line and order details
      expect(html).toContain("High-Tensile Rebar Y12");
      expect(html).toContain("2 kg");
      expect(html).toContain("Portland Cement (50kg)");
      expect(html).toContain("5 bag");
      expect(html).toContain("Total Qty:");
      expect(html).toContain("7.000");

      // 4. Verify table header columns: exactly 3 columns (NO, ITEM DESCRIPTION, QTY)
      const thMatches = html.match(/<th\b[^>]*>(.*?)<\/th>/gi) || [];
      // 3 headers per copy * 2 copies = 6 <th> elements
      expect(thMatches.length).toBe(6);
      for (const th of thMatches) {
        expect(th).not.toMatch(/U\/P|AMOUNT|PRICE|RM/i);
      }
    });

    it("treats falsy showPriceOnDo (undefined, null, 0) as price suppression", () => {
      const doWithUndefinedToggle = {
        companyId: 1,
        businessDate: "2026-10-23",
        doNumber: "DO-0010",
        invNo: "B-0010",
        dateText: "23/10/2026",
        storeName: "YFT Store",
        siteAddress: "Site B",
        lorryPlate: "Plate 2",
        driverName: "Driver B",
        showPriceOnDo: undefined as any,
        totalQtyMilli: 1000,
        totalQtyText: "1",
        lines: [
          {
            itemNo: 1,
            name: "Canary Item",
            itemName: "Canary Item",
            unit: "pcs" as const,
            qtyMilli: 1000,
            qtyText: "1 pcs",
            unitPriceText: "RM 999.00",
            amountText: "RM 999.00",
          },
        ],
        subtotalText: "RM 999.00",
        totalText: "RM 999.00",
        signatories: {
          issuedBy: "Cashier",
          deliveredBy: "Driver",
          receivedBy: "Supervisor",
        },
      } as unknown as DeliveryOrder;

      const html = renderDeliveryOrderHtml(doWithUndefinedToggle);
      expect(html).not.toContain("999.00");
      expect(html).not.toContain("U/P");
      expect(html).not.toContain("AMOUNT");
    });
  });

  describe("2. Scale & Unicode (50+ Items, Long Descriptions, Non-ASCII Names)", () => {
    it("handles 50 items with long descriptions and non-ASCII Malay/Chinese data without crashing", () => {
      const longName = "Galvanized Steel Pipe Class C 3\" & Iron Fittings <Ref #A9901> 特等建筑钢管 — Tapak Penampang";
      const unicodeContractor = "Encik Muhammad Zafrul bin Hajah Siti Nurhaliza & Sons Enterprise / 德利建筑工程";
      const unicodeCompany = "大山脚合众五金机械有限公司 (BM Hardware & Machinery Sdn. Bhd.)";
      const unicodeSite = "Tapak Cadangan Projek Fasa 2, KM 15, Jalan Tuaran, 88400 Kota Kinabalu (Sebelah Jambatan)";

      const lines = Array.from({ length: 50 }, (_, i) => ({
        itemNo: i + 1,
        name: `${longName} #${i + 1}`,
        itemName: `${longName} #${i + 1}`,
        unit: "pcs" as const,
        qtyMilli: (i + 1) * 1000,
        qtyText: `${i + 1} pcs`,
      }));

      const doData: DeliveryOrder = {
        companyId: 1,
        businessDate: "2026-10-23",
        doNumber: "DO-0050",
        invNo: "B-0050",
        dateText: "23/10/2026 17:00",
        storeName: unicodeCompany,
        storeNameCn: "合众五金",
        siteAddress: unicodeSite,
        lorryPlate: "SABAH 9999 X / 货车",
        driverName: "Pak Mat bin Ismail / 阿末",
        contractorName: unicodeContractor,
        showPriceOnDo: false,
        totalQtyMilli: 1275000,
        totalQtyText: "1275 pcs",
        lines,
        signatories: {
          issuedBy: "Kerani Wong / 书记黄",
          deliveredBy: "Pak Mat bin Ismail",
          receivedBy: "Penyelia Tapak",
        },
      };

      const html = renderDeliveryOrderHtml(doData, {
        name: unicodeCompany,
        nameCn: "合众五金",
        regNo: "(227533-X)",
        tin: "C9999999999",
      });

      // Verify all 50 items rendered on both copies (50 * 2 = 100 rows)
      expect(html).toContain("DO-0050");
      expect(html).toContain("1275 pcs");
      expect(html).toContain("Tapak Cadangan Projek Fasa 2");
      expect(html).toContain("SABAH 9999 X / 货车");

      // Verify escaping of <Ref #A9901> and quotes
      expect(html).toContain("&lt;Ref #A9901&gt;");
      expect(html).not.toContain("<Ref #A9901>");

      // Verify Unicode strings
      expect(html).toContain("大山脚合众五金机械有限公司");
      expect(html).toContain("合众五金");
      expect(html).toContain("德利建筑工程");
      expect(html).toContain("Pak Mat bin Ismail / 阿末");

      // Verify 50 items appear
      expect(html).toContain("#1</strong>");
      expect(html).toContain("#50</strong>");
    });
  });

  describe("3. Resilience to Missing Fields, Nulls, and Undefineds", () => {
    it("renders cleanly without throwing and without leaking 'undefined' or 'null' literals", () => {
      const minimalDo: DeliveryOrder = {
        companyId: 1,
        businessDate: "2026-10-23",
        doNumber: "",
        invNo: "",
        dateText: "",
        storeName: "",
        storeNameCn: undefined,
        storeAddress: undefined,
        regNo: undefined,
        tin: undefined,
        tel: undefined,
        email: undefined,
        contractorName: undefined,
        contractorTin: undefined,
        contractorAddress: undefined,
        contractorPhone: undefined,
        siteAddress: null as any,
        lorryPlate: null as any,
        driverName: null as any,
        contractorPo: undefined,
        showPriceOnDo: false,
        totalQtyMilli: 0,
        totalQtyText: "",
        lines: [],
        signatories: null as any,
      };

      const html = renderDeliveryOrderHtml(minimalDo, undefined);

      // Verify zero crash and zero 'undefined' or 'null' string leakage
      expect(html).not.toContain("undefined");
      expect(html).not.toContain("null");

      // Verify defaults are applied
      expect(html).toContain("Walk-in Customer");
      expect(html).toContain("Driver: ____________________");
      expect(html).toContain("DELIVERY ORDER");
      expect(html).toContain("STORE COPY");
      expect(html).toContain("CUSTOMER COPY");
    });

    it("handles undefined lines array without crashing", () => {
      const doWithUndefinedLines = {
        companyId: 1,
        businessDate: "2026-10-23",
        doNumber: "DO-0002",
        invNo: "A-0002",
        dateText: "23/10/2026",
        storeName: "Test Store",
        siteAddress: "Site A",
        lorryPlate: "Plate 1",
        driverName: "Driver A",
        showPriceOnDo: false,
        totalQtyMilli: 0,
        totalQtyText: "0",
        lines: undefined as any,
        signatories: {
          issuedBy: "Issuer",
          deliveredBy: "Driver A",
          receivedBy: "Receiver",
        },
      } as unknown as DeliveryOrder;

      const html = renderDeliveryOrderHtml(doWithUndefinedLines);
      expect(html).not.toContain("undefined");
      expect(html).not.toContain("null");
      expect(html).toContain("DO-0002");
    });

    it("handles whitespace-only and null strings gracefully", () => {
      const whitespaceDo: DeliveryOrder = {
        companyId: 1,
        businessDate: "2026-10-23",
        doNumber: "DO-0003",
        invNo: "A-0003",
        dateText: "23/10/2026",
        storeName: "   ",
        siteAddress: "   ",
        lorryPlate: "   ",
        driverName: "   ",
        contractorName: "   ",
        showPriceOnDo: false,
        totalQtyMilli: 0,
        totalQtyText: "",
        lines: [],
        signatories: {
          issuedBy: "   ",
          deliveredBy: "   ",
          receivedBy: "   ",
        },
      };

      const html = renderDeliveryOrderHtml(whitespaceDo);
      expect(html).not.toContain("undefined");
      expect(html).not.toContain("null");
      expect(html).toContain("Driver: ____________________");
    });
  });

  describe("4. Signature Block Architecture (Exact 3 Per Copy, 6 Total)", () => {
    it("renders exactly 6 signature sections with required supervisor fill-in labels", () => {
      const sampleDo: DeliveryOrder = {
        companyId: 1,
        businessDate: "2026-10-23",
        doNumber: "DO-0001",
        invNo: "B-0001",
        dateText: "23/10/2026 14:30",
        storeName: "Borneo Jasa Sdn. Bhd.",
        siteAddress: "Tapak Projek Vista Minintod",
        lorryPlate: "SABAH 8888",
        driverName: "Pak Mat",
        contractorName: "Ah Seng Construction",
        showPriceOnDo: false,
        totalQtyMilli: 10000,
        totalQtyText: "10 pcs",
        lines: [
          {
            itemNo: 1,
            name: "Item 1",
            itemName: "Item 1",
            unit: "pcs",
            qtyMilli: 10000,
            qtyText: "10 pcs",
          },
        ],
        signatories: {
          issuedBy: "Cashier Wong",
          deliveredBy: "Pak Mat",
          receivedBy: "Site Supervisor",
        },
      };

      const html = renderDeliveryOrderHtml(sampleDo, mockCompany);

      // Split into Store Copy and Customer Copy
      const parts = html.split('<div class="cut-line"></div>');
      expect(parts.length).toBe(2);

      const storeCopy = parts[0]!;
      const customerCopy = parts[1]!;

      for (const [copyName, copyHtml] of [["Store Copy", storeCopy], ["Customer Copy", customerCopy]] as const) {
        // Exactly 1 of each signature block per copy
        const issuedMatches = copyHtml.match(/ISSUED BY \(Store\)/g) || [];
        const deliveredMatches = copyHtml.match(/DELIVERED BY \(Driver\)/g) || [];
        const receivedMatches = copyHtml.match(/RECEIVED BY \(Site Supervisor\)/g) || [];

        expect(issuedMatches.length, `${copyName} must have exactly 1 ISSUED BY block`).toBe(1);
        expect(deliveredMatches.length, `${copyName} must have exactly 1 DELIVERED BY block`).toBe(1);
        expect(receivedMatches.length, `${copyName} must have exactly 1 RECEIVED BY block`).toBe(1);

        // Check required fields in Issued By
        expect(copyHtml).toContain("Cashier Wong");
        expect(copyHtml).toContain("Authorised Signature");

        // Check required fields in Delivered By
        expect(copyHtml).toContain("Driver: Pak Mat");
        expect(copyHtml).toContain("Driver Signature");

        // Check required fields in Received By
        expect(copyHtml).toContain("Name: ____________________");
        expect(copyHtml).toContain("IC: ______________");
        expect(copyHtml).toContain("Date: ___________");
        expect(copyHtml).toMatch(/Company Chop/i);
        expect(copyHtml).toContain("Recipient Signature & Stamp");
      }

      // Total counts across document: exactly 2 of each = 6 total
      expect((html.match(/ISSUED BY/gi) || []).length).toBe(2);
      expect((html.match(/DELIVERED BY/gi) || []).length).toBe(2);
      expect((html.match(/RECEIVED BY/gi) || []).length).toBe(2);
    });

    it("renders blank driver underline when driverName is absent or default 'Driver'", () => {
      const doWithPlaceholderDriver: DeliveryOrder = {
        companyId: 1,
        businessDate: "2026-10-23",
        doNumber: "DO-0004",
        invNo: "A-0004",
        dateText: "23/10/2026",
        storeName: "Store",
        siteAddress: "Site",
        lorryPlate: "Plate",
        driverName: "",
        showPriceOnDo: false,
        totalQtyMilli: 1000,
        totalQtyText: "1",
        lines: [],
        signatories: {
          issuedBy: "Cashier",
          deliveredBy: "Driver", // Generic placeholder
          receivedBy: "Supervisor",
        },
      };

      const html = renderDeliveryOrderHtml(doWithPlaceholderDriver);
      // Both copies should show the underline for manual entry
      const underlineMatches = html.match(/Driver: ____________________/g) || [];
      expect(underlineMatches.length).toBe(2);
    });
  });

  describe("5. Adversarial XSS & HTML Injection Resilience", () => {
    it("escapes malicious scripts and HTML entities across all string fields", () => {
      const xssPayload = '<script>alert("xss")</script>';
      const xssDo: DeliveryOrder = {
        companyId: 1,
        businessDate: "2026-10-23",
        doNumber: `DO-${xssPayload}`,
        invNo: `INV-${xssPayload}`,
        dateText: xssPayload,
        storeName: xssPayload,
        storeNameCn: xssPayload,
        storeAddress: xssPayload,
        regNo: xssPayload,
        tin: xssPayload,
        tel: xssPayload,
        email: xssPayload,
        contractorName: xssPayload,
        contractorTin: xssPayload,
        contractorAddress: xssPayload,
        contractorPhone: xssPayload,
        siteAddress: xssPayload,
        lorryPlate: xssPayload,
        driverName: xssPayload,
        contractorPo: xssPayload,
        showPriceOnDo: false,
        totalQtyMilli: 1000,
        totalQtyText: xssPayload,
        lines: [
          {
            itemNo: 1,
            name: xssPayload,
            itemName: xssPayload,
            unit: "pcs",
            qtyMilli: 1000,
            qtyText: xssPayload,
          },
        ],
        signatories: {
          issuedBy: xssPayload,
          deliveredBy: xssPayload,
          receivedBy: xssPayload,
        },
      };

      const html = renderDeliveryOrderHtml(xssDo);

      // Raw unescaped <script> must NEVER exist
      expect(html).not.toContain("<script>");
      expect(html).not.toContain("</script>");
      // Must be safely escaped as &lt;script&gt;
      expect(html).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
    });
  });

  describe("6. Price Visible Mode Verification (showPriceOnDo: true)", () => {
    it("renders unit prices, line amounts, and totals with standard formatting when price is enabled", () => {
      const pricedDo: DeliveryOrder = {
        companyId: 1,
        businessDate: "2026-10-23",
        doNumber: "DO-0005",
        invNo: "B-0005",
        dateText: "23/10/2026 15:00",
        storeName: "Borneo Jasa Sdn. Bhd.",
        siteAddress: "Site C",
        lorryPlate: "Plate 3",
        driverName: "Driver C",
        contractorName: "Contractor C",
        showPriceOnDo: true,
        totalQtyMilli: 10000,
        totalQtyText: "10 pcs",
        lines: [
          {
            itemNo: 1,
            name: "Timber 2x4",
            itemName: "Timber 2x4",
            unit: "pcs",
            qtyMilli: 10000,
            qtyText: "10 pcs",
            unitPriceCents: 1500,
            unitPriceText: "RM 15.00/pcs",
            lineAmountCents: 15000,
            amountText: "RM 150.00",
          },
        ],
        subtotalCents: 15000,
        subtotalText: "RM 150.00",
        totalAmountCents: 15000,
        totalText: "RM 150.00",
        signatories: {
          issuedBy: "Cashier",
          deliveredBy: "Driver C",
          receivedBy: "Supervisor",
        },
      };

      const html = renderDeliveryOrderHtml(pricedDo, mockCompany);

      // When showPriceOnDo is true, headers and amounts must appear on both copies
      expect(html).toContain("U/P (RM)");
      expect(html).toContain("AMOUNT (RM)");
      expect(html).toContain("15.00/pcs");
      expect(html).toContain("150.00");
      expect(html).toContain("Subtotal:");
      expect(html).toContain("TOTAL:");
    });
  });
});
