import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import type { Order, OrderLine, Receipt, Repayment } from "@yf/core";
import { renderReceiptHtml } from "../printing/renderReceiptHtml";
import { renderDayReportHtml } from "../printing/renderDayReportHtml";
import {
  buildDailyWorkbook,
  buildDailyExcelB64,
  HQ_DAILY_HEADERS,
  INVOICE_ITEMS_HEADERS,
} from "../report/daily";
import { L, PAY_LABEL } from "../labels";
import { PAYMENT_UI } from "../payments";

const makeLine = (
  id: number,
  name: string,
  priceCents: number,
  qtyMilli = 1000,
  unit: import("@yf/core").Unit = "pcs",
): OrderLine => ({
  id,
  itemId: id,
  name,
  image: "",
  unit,
  priceCents,
  qtyMilli,
  tailCount: 0,
  amountCents: Math.round((priceCents * qtyMilli) / 1000),
  bulkPrice: false,
});

describe("Empirical Document Formatting Stress Suite", () => {
  describe("1. Thermal Receipt Formatting (Explicit Methods: QR, Card, Bank Transfer)", () => {
    const baseReceipt: Receipt = {
      storeName: "Borneo Jasa Hardware",
      regNo: "(227533-X)",
      tin: "C1234567890",
      invNo: "A-0001",
      dateText: "24/10/2026 10:30",
      method: "Cash",
      itemCount: 2,
      lines: [
        {
          name: "PVC Pipe 1/2 inch",
          qtyText: "2 ft",
          unitPriceText: "RM 2.00/ft",
          amountText: "RM 4.00",
        },
        {
          name: "Common Wire Nails 2\"",
          qtyText: "1.5 kg",
          unitPriceText: "RM 10.00/kg",
          amountText: "RM 15.00",
        },
      ],
      subtotalText: "RM 19.00",
      totalText: "RM 19.00",
      paidText: "RM 19.00",
      changeText: "RM 0.00",
      footer: "Terima Kasih / Thank you",
    };

    it("renders 'Paid: QR' when receipt method is 'QR'", () => {
      const qrReceipt: Receipt = {
        ...baseReceipt,
        method: "QR",
      };
      const html = renderReceiptHtml(qrReceipt);

      // Positive check: Must contain 'Paid: QR'
      expect(html).toContain("Paid: QR");
      expect(html).toContain("<span class=\"pay-method\">Paid: QR</span>");
    });

    it("renders 'Paid: Card' when receipt method is 'Card'", () => {
      const cardReceipt: Receipt = {
        ...baseReceipt,
        method: "Card",
      };
      const html = renderReceiptHtml(cardReceipt);
      expect(html).toContain("Paid: Card");
      expect(html).toContain("<span class=\"pay-method\">Paid: Card</span>");
    });

    it("renders 'Paid: Cash' for Cash receipts", () => {
      const cashReceipt: Receipt = {
        ...baseReceipt,
        method: "Cash",
      };
      const html = renderReceiptHtml(cashReceipt);
      expect(html).toContain("Paid: Cash");
    });

    it("renders 'Paid: Bank Transfer' for Bank receipts", () => {
      const bankReceipt: Receipt = {
        ...baseReceipt,
        method: "Bank",
      };
      const html = renderReceiptHtml(bankReceipt);
      expect(html).toContain("Paid: Bank Transfer");
    });

    it("renders 'Paid: Credit' for Credit receipts and prints contractor Bill To block", () => {
      const creditReceipt: Receipt = {
        ...baseReceipt,
        invNo: "B-0001",
        method: "Credit",
        contractor: {
          name: "Seng Hing Construction",
          tin: "IG998877",
          address: "Batu 3, Jalan Apas, Tawau",
          phone: "019-8887766",
        },
      };
      const html = renderReceiptHtml(creditReceipt);
      expect(html).toContain("Paid: Credit");
      expect(html).toContain("Bill To / Kepada:");
      expect(html).toContain("Seng Hing Construction");
    });

    it("falls back to 'Paid: Cash' when method is undefined or empty string", () => {
      const fallbackReceipt1 = { ...baseReceipt, method: undefined as never };
      const fallbackReceipt2 = { ...baseReceipt, method: "" as never };

      expect(renderReceiptHtml(fallbackReceipt1)).toContain("Paid: Cash");
      expect(renderReceiptHtml(fallbackReceipt2)).toContain("Paid: Cash");
    });

    it("formats Contractor B-series receipt paid via QR as 'Paid: QR'", () => {
      const contractorQrReceipt: Receipt = {
        ...baseReceipt,
        invNo: "B-0042",
        method: "QR",
        contractor: {
          name: "Mega Builders Sdn Bhd",
          tin: "C9988776655",
          address: "Lot 10, Industrial Estate, Kota Kinabalu",
          phone: "088-721234",
        },
      };
      const html = renderReceiptHtml(contractorQrReceipt);
      expect(html).toContain("Bill To / Kepada:");
      expect(html).toContain("Mega Builders Sdn Bhd");
      expect(html).toContain("Paid: QR");
    });
  });

  describe("2. Day Report HTML Formatting", () => {
    const cashOrder: Order = {
      id: 1,
      companyId: 1,
      ts: 1000,
      businessDate: "2026-08-14",
      invNo: "A-0001",
      method: "Cash",
      totalCents: 5000,
      voidedAt: null,
      items: [makeLine(1, "Cement 50kg", 2500, 2000, "bag")],
    };

    const qrOrder: Order = {
      id: 2,
      companyId: 1,
      ts: 2000,
      businessDate: "2026-08-14",
      invNo: "A-0002",
      method: "QR",
      totalCents: 8500,
      voidedAt: null,
      items: [makeLine(2, "Plywood 9mm", 8500, 1000, "pcs")],
    };

    const creditOrder: Order = {
      id: 3,
      companyId: 1,
      ts: 3000,
      businessDate: "2026-08-14",
      invNo: "B-0001",
      method: "Credit",
      contractorName: "Pak Abu",
      totalCents: 12000,
      voidedAt: null,
      items: [makeLine(3, "GI Pipe 1 inch", 4000, 3000, "batang")],
    };

    const qrRepayment: Repayment = {
      id: 10,
      companyId: 1,
      creditId: 5,
      orderId: 99,
      contractorName: "Ah Meng Contractor",
      amountCents: 6000,
      method: "QR",
      ts: 4000,
      businessDate: "2026-08-14",
    };

    const bankRepayment: Repayment = {
      id: 11,
      companyId: 1,
      creditId: 6,
      orderId: 98,
      contractorName: "Syarikat Jaya",
      amountCents: 4500,
      method: "Bank",
      ts: 5000,
      businessDate: "2026-08-14",
    };

    it("formats QR in BY PAYMENT and CREDIT REPAYMENTS COLLECTED as 'QR'", () => {
      const html = renderDayReportHtml({
        storeName: "Borneo Jasa Hardware",
        businessDate: "2026-08-14",
        orders: [cashOrder, qrOrder, creditOrder],
        repayments: [qrRepayment, bankRepayment],
      });

      // 1. CREDIT REPAYMENTS COLLECTED section
      expect(html).toContain("CREDIT REPAYMENTS COLLECTED");
      expect(html).toContain("Ah Meng Contractor (QR)");
      expect(html).toContain("Syarikat Jaya (Bank Transfer)");

      // 2. BY PAYMENT section
      // QR line combines: QR sales order (8500) + QR repayment (6000) = 14500 cents (145.00)
      // Count is 1 (repayments do not increment invoice count)
      expect(html).toContain("QR (1)");
      expect(html).toContain("145.00");

      // Cash line: 50.00 (1)
      expect(html).toContain("Cash (1)");
      expect(html).toContain("50.00");

      // Bank line: 45.00 (repayment only, count is 0 so no count label)
      expect(html).toContain("<span class=\"name\">Bank Transfer</span>");
      expect(html).toContain("45.00");

      // Credit line: 120.00 (1)
      expect(html).toContain("Credit (1)");
      expect(html).toContain("120.00");
    });

    it("displays 'QR' without count in BY PAYMENT when day has 0 QR orders but 1+ QR repayments", () => {
      const html = renderDayReportHtml({
        storeName: "Borneo Jasa Hardware",
        businessDate: "2026-08-14",
        orders: [cashOrder], // only cash order, NO QR order
        repayments: [qrRepayment], // 1 QR repayment (RM 60.00)
      });

      const byPaymentSlice = html.slice(html.indexOf("BY PAYMENT"));
      // Must render "QR" without "(0)"
      expect(byPaymentSlice).toContain("<span class=\"name\">QR</span>");
      expect(byPaymentSlice).not.toContain("QR (0)");
      expect(byPaymentSlice).toContain("60.00");

      // Repayments section
      expect(html).toContain("Ah Meng Contractor (QR)");
    });
  });

  describe("3. Daily Excel Sheets Formatting", () => {
    const orders: Order[] = [
      {
        id: 1,
        companyId: 1,
        ts: 1000,
        businessDate: "2026-08-14",
        invNo: "A-0001",
        method: "Cash",
        totalCents: 5000,
        voidedAt: null,
        items: [makeLine(1, "Item 1 — Spec A", 5000, 1000, "pcs")],
      },
      {
        id: 2,
        companyId: 1,
        ts: 2000,
        businessDate: "2026-08-14",
        invNo: "A-0002",
        method: "QR",
        totalCents: 7500,
        voidedAt: null,
        items: [makeLine(2, "Item 2 — Spec B", 7500, 1000, "pcs")],
      },
      {
        id: 3,
        companyId: 1,
        ts: 3000,
        businessDate: "2026-08-14",
        invNo: "B-0001",
        method: "Credit",
        contractorName: "Kontraktor Ali",
        totalCents: 15000,
        voidedAt: null,
        items: [makeLine(3, "Item 3 — Spec C", 15000, 1000, "pcs")],
      },
    ];

    const repayments: Repayment[] = [
      {
        id: 1,
        companyId: 1,
        creditId: 10,
        orderId: 3,
        contractorName: "Kontraktor Ali",
        amountCents: 5000,
        method: "QR",
        ts: 4000,
        businessDate: "2026-08-14",
        notes: "DuitNow settlement",
      },
      {
        id: 2,
        companyId: 1,
        creditId: 11,
        orderId: 3,
        contractorName: "Kontraktor Ali",
        amountCents: 3000,
        method: "Cash",
        ts: 5000,
        businessDate: "2026-08-14",
        notes: "Cash partial",
      },
    ];

    it("renders 'QR' in Pay Type column on HQ Daily sheet for both orders and repayments", () => {
      const workbook = buildDailyWorkbook(orders, repayments);
      const sheet = workbook.Sheets["HQ Daily"]!;
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" }) as unknown[][];

      expect(rows[0]).toEqual([...HQ_DAILY_HEADERS]);

      // Row 1: Cash order
      expect(rows[1]?.[2]).toBe("A-0001");
      expect(rows[1]?.[3]).toBe("Cash");

      // Row 2: QR order -> MUST BE 'QR'
      expect(rows[2]?.[2]).toBe("A-0002");
      expect(rows[2]?.[3]).toBe("QR");

      // Row 3: Credit order
      expect(rows[3]?.[2]).toBe("B-0001");
      expect(rows[3]?.[3]).toBe("Credit");

      // Row 4: QR Repayment -> MUST BE 'QR'
      expect(rows[4]?.[2]).toBe("RP-1");
      expect(rows[4]?.[3]).toBe("QR");
      expect(rows[4]?.[0]).toBe("Kontraktor Ali");
      expect(rows[4]?.[4]).toBe(50); // RM 50.00
      expect(rows[4]?.[6]).toBe(50); // RM 50.00
      expect(rows[4]?.[7]).toBe(""); // Credit column must NOT be populated for repayment!

      // Row 5: Cash Repayment
      expect(rows[5]?.[2]).toBe("RP-2");
      expect(rows[5]?.[3]).toBe("Cash");

      // Row 6: TOTAL
      expect(rows[6]?.[0]).toBe("TOTAL");
      // Total formula includes rows 2 to 6
      expect(sheet["G7"]?.f).toBe("SUM(G2:G6)");
    });

    it("encodes workbook to valid base64 and roundtrips without losing 'QR' text", () => {
      const b64 = buildDailyExcelB64(orders, repayments);
      expect(typeof b64).toBe("string");
      expect(b64.length).toBeGreaterThan(100);

      const parsed = XLSX.read(b64, { type: "base64" });
      const sheet = parsed.Sheets["HQ Daily"]!;
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" }) as unknown[][];

      // Verify round-tripped Pay Type values
      expect(rows[2]?.[3]).toBe("QR"); // QR order
      expect(rows[4]?.[3]).toBe("QR"); // QR repayment
    });
  });

  describe("4. UI Constants & Labels Alignment", () => {
    it("ensures L.qr, PAY_LABEL.QR, and PAYMENT_UI.QR all uniformly resolve to 'QR'", () => {
      expect(L.qr).toBe("QR");
      expect(PAY_LABEL.QR).toBe("QR");
      expect(PAYMENT_UI.QR.label).toBe("QR");
      expect(L.card).toBe("Card / Kad");
      expect(PAY_LABEL.Card).toBe("Card / Kad");
      expect(PAYMENT_UI.Card.label).toBe("Card / Kad");
      expect(L.bank).toBe("Bank Transfer");
      expect(PAY_LABEL.Bank).toBe("Bank Transfer");
      expect(PAYMENT_UI.Bank.label).toBe("Bank Transfer");
    });
  });
});
