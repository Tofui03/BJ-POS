import { describe, expect, it } from "vitest";
import type { CompanyInfo, DeliveryOrder } from "@yf/core";
import { escapeHtml, renderDeliveryOrderHtml } from "./renderDeliveryOrderHtml";

const mockCompany: CompanyInfo = {
  name: "Borneo Jasa Sdn. Bhd.",
  nameCn: "婆罗洲贸易有限公司",
  regNo: "(227533-X)",
  tin: "C2398472901",
  address: "Lot 12, Kolombong Industrial Estate, 88450 Kota Kinabalu, Sabah",
  tel: "088-385555 / 016-8882233",
  email: "billing@borneojasa.com.my",
};

const sampleDo: DeliveryOrder = {
  companyId: 1,
  businessDate: "2026-10-23",
  doNumber: "DO-0001",
  doNo: "DO-0001",
  invNo: "B-0001",
  dateText: "23/10/2026 14:30",
  storeName: "Borneo Jasa Sdn. Bhd.",
  storeNameCn: "婆罗洲贸易有限公司",
  storeAddress: "Lot 12, Kolombong Industrial Estate, 88450 Kota Kinabalu, Sabah",
  regNo: "(227533-X)",
  tel: "088-385555 / 016-8882233",
  contractorName: "Ah Seng Construction",
  contractorTin: "C1234567890",
  contractorAddress: "Lot 42, Telipok Industrial Park, Sabah",
  contractorPhone: "012-3456789",
  siteAddress: "Tapak Projek Vista Minintod, Penampang",
  lorryPlate: "SABAH 8888",
  driverName: "Pak Mat",
  contractorPo: "PO-AS-2026-9921",
  showPriceOnDo: true,
  totalQtyMilli: 45500,
  totalQtyText: "45.500",
  lines: [
    {
      itemNo: 1,
      name: "Common Wire Nails 2\"",
      itemName: "Common Wire Nails 2\"",
      unit: "kg",
      qtyMilli: 15500,
      qtyText: "15.5 kg",
      unitPriceCents: 1000,
      unitPriceText: "RM 10.00/kg",
      lineAmountCents: 15500,
      amountText: "RM 155.00",
    },
    {
      itemNo: 2,
      name: "PVC Pipe Class D 1/2\"",
      itemName: "PVC Pipe Class D 1/2\"",
      unit: "ft",
      qtyMilli: 30000,
      qtyText: "30 ft",
      unitPriceCents: 200,
      unitPriceText: "RM 2.00/ft",
      lineAmountCents: 6000,
      amountText: "RM 60.00",
    },
  ],
  subtotalCents: 21500,
  subtotalText: "RM 215.00",
  totalAmountCents: 21500,
  totalText: "RM 215.00",
  signatories: {
    issuedBy: "Cashier Wong",
    deliveredBy: "Pak Mat",
    receivedBy: "Site Supervisor",
  },
};

describe("renderDeliveryOrderHtml", () => {
  describe("A4 Dual-Copy Layout & Cut Line", () => {
    it("renders A4 portrait page size with 8mm 10mm margins", () => {
      const html = renderDeliveryOrderHtml(sampleDo, mockCompany);
      expect(html).toContain("@page { size: A4 portrait; margin: 8mm 10mm; }");
    });

    it("renders exactly two copies separated by a cut line", () => {
      const html = renderDeliveryOrderHtml(sampleDo, mockCompany);
      const parts = html.split('<div class="cut-line"></div>');
      expect(parts.length).toBe(2);

      // Top copy is Store / Office Copy
      expect(parts[0]).toContain("STORE COPY");
      expect(parts[0]).toContain("SALINAN KEDAI");

      // Bottom copy is Customer / Contractor Copy
      expect(parts[1]).toContain("CUSTOMER COPY");
      expect(parts[1]).toContain("SALINAN PELANGGAN");
    });

    it("renders cut line styling with dashed border and cut/tear bilingual notice", () => {
      const html = renderDeliveryOrderHtml(sampleDo, mockCompany);
      expect(html).toContain(".cut-line");
      expect(html).toContain("border-top: 1px dashed");
      expect(html.toLowerCase()).toMatch(/cut|tear/);
      expect(html).toContain("GUNTING DI SINI");
    });
  });

  describe("Company Header & Compliance", () => {
    it("displays clean company registration number (227533-X) and omits obsolete MSIC", () => {
      const html = renderDeliveryOrderHtml(sampleDo, mockCompany);
      expect(html).toContain("(227533-X)");
      expect(html).not.toContain("MSIC");
    });

    it("displays store name, Chinese name, address, and telephone number on both copies", () => {
      const html = renderDeliveryOrderHtml(sampleDo, mockCompany);
      const parts = html.split('<div class="cut-line"></div>');
      for (const part of parts) {
        expect(part).toContain("Borneo Jasa Sdn. Bhd.");
        expect(part).toContain("婆罗洲贸易有限公司");
        expect(part).toContain("Lot 12, Kolombong Industrial Estate");
        expect(part).toContain("088-385555");
      }
    });

    it("omits empty or undefined contact fields without rendering 'undefined' or 'null'", () => {
      const bareCompany: CompanyInfo = {
        name: "YFT Hardware",
        regNo: "(227533-X)",
      };
      const bareDo: DeliveryOrder = {
        ...sampleDo,
        storeName: "YFT Hardware",
        storeAddress: undefined,
        tel: undefined,
        email: undefined,
      };
      const html = renderDeliveryOrderHtml(bareDo, bareCompany);
      expect(html).not.toContain("undefined");
      expect(html).not.toContain("null");
      expect(html).toContain("YFT Hardware");
      expect(html).toContain("(227533-X)");
    });
  });

  describe("Document & Delivery Metadata", () => {
    it("renders DO number, invoice ref, date, contractor details, and site address on both copies", () => {
      const html = renderDeliveryOrderHtml(sampleDo, mockCompany);
      const parts = html.split('<div class="cut-line"></div>');
      for (const part of parts) {
        expect(part).toContain("DO-0001");
        expect(part).toContain("B-0001");
        expect(part).toContain("23/10/2026 14:30");
        expect(part).toContain("Ah Seng Construction");
        expect(part).toContain("C1234567890");
        expect(part).toContain("Lot 42, Telipok Industrial Park");
        expect(part).toContain("012-3456789");
        expect(part).toContain("Tapak Projek Vista Minintod, Penampang");
        expect(part).toContain("SABAH 8888");
        expect(part).toContain("Pak Mat");
        expect(part).toContain("PO-AS-2026-9921");
      }
    });

    it("defaults contractor name to 'Walk-in Customer' when contractor name is absent", () => {
      const walkInDo: DeliveryOrder = {
        ...sampleDo,
        contractorName: undefined,
        contractorTin: undefined,
        contractorAddress: undefined,
        contractorPhone: undefined,
        siteAddress: "",
        lorryPlate: "",
        driverName: "",
        contractorPo: undefined,
      };
      const html = renderDeliveryOrderHtml(walkInDo, mockCompany);
      expect(html).toContain("Walk-in Customer");
    });
  });

  describe("Triple Signature Blocks", () => {
    it("renders all 3 signature blocks on each copy (total 6 blocks across document)", () => {
      const html = renderDeliveryOrderHtml(sampleDo, mockCompany);

      const issuedCount = (html.match(/ISSUED BY/gi) || []).length;
      const deliveredCount = (html.match(/DELIVERED BY/gi) || []).length;
      const receivedCount = (html.match(/RECEIVED BY/gi) || []).length;

      expect(issuedCount).toBe(2);
      expect(deliveredCount).toBe(2);
      expect(receivedCount).toBe(2);
    });

    it("renders Issued By block with authorizer name and signature line", () => {
      const html = renderDeliveryOrderHtml(sampleDo, mockCompany);
      expect(html).toContain("ISSUED BY (Store)");
      expect(html).toContain("Cashier Wong");
      expect(html).toContain("Authorised Signature");
    });

    it("renders Delivered By block with driver name and signature line", () => {
      const html = renderDeliveryOrderHtml(sampleDo, mockCompany);
      expect(html).toContain("DELIVERED BY (Driver)");
      expect(html).toContain("Pak Mat");
      expect(html).toContain("Driver Signature");
    });

    it("renders empty signature line for driver when driver name is empty", () => {
      const noDriverDo: DeliveryOrder = {
        ...sampleDo,
        driverName: "",
        signatories: {
          issuedBy: "Cashier",
          deliveredBy: "Driver",
          receivedBy: "Supervisor",
        },
      };
      const html = renderDeliveryOrderHtml(noDriverDo, mockCompany);
      expect(html).toMatch(/Driver Signature/i);
      expect(html).toContain("Driver: ____________________");
    });

    it("renders Received By block with explicit fill-in labels for Name, IC, Date, and Company Chop", () => {
      const html = renderDeliveryOrderHtml(sampleDo, mockCompany);
      expect(html).toContain("RECEIVED BY (Site Supervisor)");
      expect(html).toContain("Name: ____________________");
      expect(html).toContain("IC: ______________");
      expect(html).toContain("Date: ___________");
      expect(html).toMatch(/Company Chop/i);
      expect(html).toContain("Recipient Signature & Stamp");
    });
  });

  describe("Price Visibility Toggle (showPriceOnDo)", () => {
    it("renders unit prices, line amounts, subtotal, and total RM when showPriceOnDo is true", () => {
      const html = renderDeliveryOrderHtml(sampleDo, mockCompany);

      expect(html).toContain("U/P (RM)");
      expect(html).toContain("AMOUNT (RM)");
      expect(html).toContain("10.00/kg");
      expect(html).toContain("155.00");
      expect(html).toContain("2.00/ft");
      expect(html).toContain("60.00");
      expect(html).toContain("Subtotal:");
      expect(html).toContain("215.00");
    });

    it("completely suppresses unit prices, line amounts, subtotals, and total RM when showPriceOnDo is false", () => {
      const hiddenPriceDo: DeliveryOrder = {
        ...sampleDo,
        showPriceOnDo: false,
        lines: sampleDo.lines.map((l) => ({
          ...l,
          unitPriceCents: undefined,
          unitPriceText: undefined,
          lineAmountCents: undefined,
          amountText: undefined,
        })),
        subtotalCents: undefined,
        subtotalText: undefined,
        totalAmountCents: undefined,
        totalText: undefined,
      };

      const html = renderDeliveryOrderHtml(hiddenPriceDo, mockCompany);

      // Must NOT contain price/amount table headers
      expect(html).not.toContain("U/P (RM)");
      expect(html).not.toContain("AMOUNT (RM)");
      expect(html).not.toContain("U/P");

      // Must NOT contain monetary values
      expect(html).not.toContain("155.00");
      expect(html).not.toContain("60.00");
      expect(html).not.toContain("215.00");
      expect(html).not.toContain("Subtotal:");
      expect(html).not.toContain("Disc");
      expect(html).not.toContain("Tax (0%)");
      expect(html).not.toContain("Rounding");

      // Must retain descriptions and quantities
      expect(html).toContain("Common Wire Nails 2&quot;");
      expect(html).toContain("15.5 kg");
      expect(html).toContain("PVC Pipe Class D 1/2&quot;");
      expect(html).toContain("30 ft");
      expect(html).toContain("Total Qty:");
      expect(html).toContain("45.500");
    });
  });

  describe("Paper Checkbox for Warehouse Picking", () => {
    it("renders the ☐ paper checkbox preceding each line item description on both Store Copy and Customer Copy", () => {
      const html = renderDeliveryOrderHtml(sampleDo, mockCompany);
      const parts = html.split('<div class="cut-line"></div>');
      expect(parts.length).toBe(2);

      const [storeCopy, customerCopy] = parts;

      // Both copies must contain the checkbox preceding each line item description
      for (const [copyName, copyHtml] of [["Store Copy", storeCopy], ["Customer Copy", customerCopy]] as const) {
        expect(copyHtml).toContain("<strong>☐ Common Wire Nails 2&quot;</strong>");
        expect(copyHtml).toContain("<strong>☐ PVC Pipe Class D 1/2&quot;</strong>");

        // The checkbox count on each copy matches the number of lines
        const checkboxMatches = copyHtml!.match(/☐/g) || [];
        expect(checkboxMatches.length, `${copyName} checkbox count should equal lines count`).toBe(sampleDo.lines.length);
      }

      // Total checkbox count across both copies
      const allCheckboxes = html.match(/☐/g) || [];
      expect(allCheckboxes.length).toBe(sampleDo.lines.length * 2);
    });

    it("renders ☐ checkbox preceding line item when showPriceOnDo is false", () => {
      const hiddenPriceDo: DeliveryOrder = {
        ...sampleDo,
        showPriceOnDo: false,
      };
      const html = renderDeliveryOrderHtml(hiddenPriceDo, mockCompany);
      const parts = html.split('<div class="cut-line"></div>');
      expect(parts[0]).toContain("<strong>☐ Common Wire Nails 2&quot;</strong>");
      expect(parts[1]).toContain("<strong>☐ Common Wire Nails 2&quot;</strong>");
    });
  });

  describe("HTML Escaping & Security", () => {
    it("escapes HTML special characters in names, notes, and addresses", () => {
      expect(escapeHtml("Nails 2\" & Wire <3>")).toBe("Nails 2&quot; &amp; Wire &lt;3&gt;");
      expect(escapeHtml(null)).toBe("");
      expect(escapeHtml(undefined)).toBe("");
    });
  });
});
