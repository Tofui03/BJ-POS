import { describe, expect, it } from "vitest";
import type { Receipt } from "@yf/core";
import { printableWidthMm, renderReceiptHtml } from "./renderReceiptHtml";

const receipt: Receipt = {
  storeName: "Yun Fook Trading",
  invNo: "08-1000",
  dateText: "10 Aug 2026 · 09:00 am",
  method: "Cash",
  itemCount: 1,
  lines: [
    {
      name: "Ikan Tilapia",
      qtyText: "1.25 kg",
      unitPriceText: "RM 25.00/kg",
      amountText: "RM 31.25",
    },
  ],
  totalText: "RM 31.25",
  footer: "Thank you!",
};

describe("receipt print layout", () => {
  it("keeps content inside the printable area of an 80 mm roll", () => {
    expect(printableWidthMm(80)).toBe(72);
    const html = renderReceiptHtml(receipt, 80);
    expect(html).toContain("@page { size: 80mm auto; margin: 0; }");
    expect(html).toContain("width: 72mm;");
    expect(html).toContain("font-family: Verdana,");
  });

  it("prints the invoice number, not the internal order id", () => {
    expect(renderReceiptHtml(receipt)).toContain("Receipt #08-1000");
  });

  it("prints the creditor name for a Credit sale", () => {
    const creditReceipt: Receipt = { ...receipt, method: "Credit", creditorName: "Pak Abu" };
    expect(renderReceiptHtml(creditReceipt)).toContain('<div class="creditor">Pak Abu</div>');
  });

  it("prints nothing extra for a non-Credit sale", () => {
    expect(renderReceiptHtml(receipt)).not.toContain('class="creditor"');
  });

  it("prints line discount and whole-bill discount when present", () => {
    const discountedReceipt: Receipt = {
      ...receipt,
      lines: [
        {
          name: "Cement — 50 kg",
          qtyText: "2 bag",
          unitPriceText: "RM 26.00 → RM 24.00/bag",
          discountText: "-RM 4.00",
          amountText: "RM 48.00",
        },
      ],
      subtotalText: "RM 52.00",
      discountText: "-RM 7.00",
      totalText: "RM 45.00",
    };
    const html = renderReceiptHtml(discountedReceipt);
    expect(html).toContain("RM 26.00 → RM 24.00/bag");
    expect(html).toContain("Diskaun: -RM 4.00");
    expect(html).toContain("Subtotal");
    expect(html).toContain("RM 52.00");
    expect(html).toContain("<span>Disc</span>");
    expect(html).toContain("-RM 7.00");
  });

  it("confirms R1: company registration retains only (227533-X), removes MSIC, and formats timestamp on the right with invoice title on the left", () => {
    const r1Receipt: Receipt = {
      ...receipt,
      regNo: "(227533-X)",
      tin: "C7875887040",
      msic: "47520",
      dateText: "23/10/2026 15:56",
    };
    const html = renderReceiptHtml(r1Receipt);
    // Company registration
    expect(html).toContain("(227533-X)");
    expect(html).not.toContain("199101017221");
    // Absence of MSIC
    expect(html).not.toContain("MSIC");
    // Timestamp and title
    expect(html).toContain("TAX INVOICE");
    expect(html).toContain("23/10/2026 15:56");
    const titleIdx = html.indexOf("TAX INVOICE");
    const dateIdx = html.indexOf("23/10/2026 15:56");
    expect(titleIdx).toBeLessThan(dateIdx);
  });

  it("confirms R3: B-receipts include contractor Name, TIN, and Address, while A-receipts omit them", () => {
    const bReceipt: Receipt = {
      ...receipt,
      invNo: "B-0001",
      method: "Credit",
      contractor: {
        name: "Ah Seng Contractor",
        tin: "IG99887766",
        address: "Lot 123, Industrial Zone, 89007 Keningau",
        phone: "019-8765432",
      },
    };
    const bHtml = renderReceiptHtml(bReceipt);
    expect(bHtml).toContain("Bill To / Kepada:");
    expect(bHtml).toContain("Ah Seng Contractor");
    expect(bHtml).toContain("TIN: IG99887766");
    expect(bHtml).toContain("Lot 123, Industrial Zone, 89007 Keningau");
    expect(bHtml).toContain("Tel: 019-8765432");

    const aReceipt: Receipt = {
      ...receipt,
      invNo: "A-0001",
      method: "Cash",
    };
    const aHtml = renderReceiptHtml(aReceipt);
    expect(aHtml).not.toContain("Bill To / Kepada:");
    expect(aHtml).not.toContain("class=\"bill-to\"");
  });

  it("confirms R4: 4-column layout (ITEM | QTY | U/P | AMOUNT (RM)) with single-line names", () => {
    const html = renderReceiptHtml(receipt);
    expect(html).toContain("<span>ITEM</span>");
    expect(html).toContain("<span class=\"h-qty\">QTY</span>");
    expect(html).toContain("<span class=\"h-up\">U/P</span>");
    expect(html).toContain("<span class=\"h-amt\">AMOUNT (RM)</span>");
    // Check dedicated U/P column in line row
    expect(html).toContain("<span class=\"item-up\">RM 25.00/kg</span>");
    // Check absence of obsolete item-rate beneath name
    expect(html).not.toContain("class=\"item-rate\"");
    // Check styling for full visibility of item names without ellipsis cut-offs
    expect(html).toContain("word-break: break-word;");
  });

  it("confirms R5: totals summary strictly follows Malaysian sequence and removes obsolete terms line", () => {
    const html = renderReceiptHtml(receipt);

    const totalQtyIdx = html.indexOf("Total Qty");
    const subtotalIdx = html.indexOf("Subtotal");
    const discIdx = html.indexOf("Disc");
    const taxIdx = html.indexOf("Tax (0%)");
    const roundingIdx = html.indexOf("Rounding");
    const totalIdx = html.indexOf("TOTAL");
    const paidIdx = html.indexOf("Paid: Cash");
    const changeIdx = html.indexOf("Change");

    expect(totalQtyIdx).toBeGreaterThan(-1);
    expect(subtotalIdx).toBeGreaterThan(-1);
    expect(discIdx).toBeGreaterThan(-1);
    expect(taxIdx).toBeGreaterThan(-1);
    expect(roundingIdx).toBeGreaterThan(-1);
    expect(totalIdx).toBeGreaterThan(-1);
    expect(paidIdx).toBeGreaterThan(-1);
    expect(changeIdx).toBeGreaterThan(-1);

    expect(totalQtyIdx).toBeLessThan(subtotalIdx);
    expect(subtotalIdx).toBeLessThan(discIdx);
    expect(discIdx).toBeLessThan(taxIdx);
    expect(taxIdx).toBeLessThan(roundingIdx);
    expect(roundingIdx).toBeLessThan(totalIdx);
    expect(totalIdx).toBeLessThan(paidIdx);
    expect(paidIdx).toBeLessThan(changeIdx);

    // Terms check: removed line
    expect(html).not.toContain("An official receipt will be issued on payment.");
    expect(html).toContain("Goods sold are not returnable or exchanged.");
  });

  describe("adversarial edge cases & robustness", () => {
    it("handles legacy 12-digit registration prefixes and retains strictly (227533-X)", () => {
      const legacyReceipt: Receipt = {
        ...receipt,
        regNo: "199101017221 (227533-X)",
      };
      const html = renderReceiptHtml(legacyReceipt);
      expect(html).toContain("(227533-X)");
      expect(html).not.toContain("199101017221");

      const bareReceipt: Receipt = {
        ...receipt,
        regNo: "227533-X",
      };
      const bareHtml = renderReceiptHtml(bareReceipt);
      expect(bareHtml).toContain("(227533-X)");
    });

    it("renders multiline contractor address cleanly with pre-line wrapping", () => {
      const multilineReceipt: Receipt = {
        ...receipt,
        invNo: "B-0002",
        contractor: {
          name: "Borneo Builders Ltd",
          tin: "C1234567890",
          address: "Lot 123, Industrial Zone\n89007 Keningau\nSabah",
        },
      };
      const html = renderReceiptHtml(multilineReceipt);
      expect(html).toContain("Lot 123, Industrial Zone\n89007 Keningau\nSabah");
      expect(html).toContain("white-space: pre-line;");
    });

    it("survives missing/nullish lines, amounts, and footer without throwing TypeErrors", () => {
      const corruptReceipt: Receipt = {
        ...receipt,
        lines: undefined as never,
        footer: undefined as never,
      };
      expect(() => renderReceiptHtml(corruptReceipt)).not.toThrow();
      const html = renderReceiptHtml(corruptReceipt);
      expect(html).toContain("TAX INVOICE");
    });

    it("ensures B-receipts with ad-hoc creditor names render cleanly without crashing", () => {
      const adhocReceipt: Receipt = {
        ...receipt,
        invNo: "B-0005",
        creditorName: "Pak Abu (Ad-hoc)",
        contractor: undefined,
      };
      const html = renderReceiptHtml(adhocReceipt);
      expect(html).toContain("Bill To / Kepada:");
      expect(html).toContain("Pak Abu (Ad-hoc)");
      expect(html).not.toContain("TIN:");
      expect(html).not.toContain("Tel:");
    });

    it("ensures A-receipt strictly omits Bill To / Kepada even if contractor or creditorName is present", () => {
      const aReceiptWithContractor: Receipt = {
        ...receipt,
        invNo: "A-0005",
        method: "Cash",
        creditorName: "Pak Abu",
        contractor: { name: "Pak Abu", tin: "T123", address: "Keningau" },
      };
      const html = renderReceiptHtml(aReceiptWithContractor);
      expect(html).not.toContain("Bill To / Kepada:");
      expect(html).not.toContain("class=\"bill-to\"");
    });

    it("maximizes ITEM column space by avoiding artificial body left-margins and protecting U/P", () => {
      const html = renderReceiptHtml(receipt);
      expect(html).not.toContain("margin-left: 6mm;");
      expect(html).toContain("margin: 0 auto;");
      expect(html).toContain("word-break: break-word;");
    });

    it("handles lowercase a- and b- invoice prefixes correctly", () => {
      const lowerA: Receipt = {
        ...receipt,
        invNo: "a-0042",
        contractor: { name: "Sneaky Contractor" },
      };
      const aHtml = renderReceiptHtml(lowerA);
      expect(aHtml).not.toContain("Bill To / Kepada:");

      const lowerB: Receipt = {
        ...receipt,
        invNo: "b-0042",
        contractor: { name: "Valid Contractor", tin: "T999" },
      };
      const bHtml = renderReceiptHtml(lowerB);
      expect(bHtml).toContain("Bill To / Kepada:");
      expect(bHtml).toContain("Valid Contractor");
    });

    it("safely formats line item amounts with negative values, bare negatives, accounting parentheses, or non-breaking spaces", () => {
      const negativeLineReceipt: Receipt = {
        ...receipt,
        lines: [
          {
            name: "Deposit Refund / Return",
            qtyText: "1",
            unitPriceText: "-RM 25.00/pcs",
            amountText: "-RM 25.00",
          },
          {
            name: "Bare Negative Without RM",
            qtyText: "1",
            unitPriceText: "-25.00/pcs",
            amountText: "-25.00",
          },
          {
            name: "Bare Small Negative",
            qtyText: "1",
            unitPriceText: "-0.50/pcs",
            amountText: "-0.50",
          },
          {
            name: "Accounting Parentheses",
            qtyText: "1",
            unitPriceText: "(RM 25.00)/pcs",
            amountText: "(25.00)",
          },
          {
            name: "Non-breaking Space Line",
            qtyText: "2",
            unitPriceText: "RM 10.00/pcs",
            amountText: "RM\u00A020.00",
          },
        ],
      };
      const html = renderReceiptHtml(negativeLineReceipt);
      expect(html).toContain("<span class=\"item-amount\">-25.00</span>");
      expect(html).not.toContain("--25.00");
      expect(html).toContain("<span class=\"item-amount\">-0.50</span>");
      expect(html).not.toContain("--0.50");
      expect(html).toContain("<span class=\"item-amount\">20.00</span>");
    });

    it("falls back to Paid: Cash when method is missing", () => {
      const noMethodReceipt = { ...receipt, method: undefined as never };
      const html = renderReceiptHtml(noMethodReceipt);
      expect(html).toContain("Paid: Cash");
      expect(html).not.toContain("Paid: undefined");
    });

    it("formats QR payment method as QR / Card", () => {
      const qrReceipt: Receipt = { ...receipt, method: "QR" };
      const html = renderReceiptHtml(qrReceipt);
      expect(html).toContain("Paid: QR / Card");
    });

    it("omits empty or whitespace-only contractor subfields", () => {
      const wsContractorReceipt: Receipt = {
        ...receipt,
        invNo: "B-0088",
        contractor: {
          name: "Contractor With Empty Details",
          tin: "   ",
          address: "   ",
          phone: "   ",
        },
      };
      const html = renderReceiptHtml(wsContractorReceipt);
      expect(html).toContain("Contractor With Empty Details");
      expect(html).not.toContain("TIN:");
      expect(html).not.toContain("Tel:");
      expect(html).not.toContain("class=\"bill-to-address\"");
    });
  });
});
