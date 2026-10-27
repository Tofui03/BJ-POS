import { describe, expect, it } from "vitest";
import type { Order, Receipt, Repayment } from "@yf/core";
import { computeStats } from "@yf/core";
import { renderReceiptHtml } from "../printing/renderReceiptHtml";
import { renderDayReportHtml } from "../printing/renderDayReportHtml";
import { buildDailyWorkbook, HQ_DAILY_HEADERS, INVOICE_ITEMS_HEADERS } from "../report/daily";
import * as XLSX from "xlsx";

describe("Receipt rendering and reporting", () => {
  describe("F2.6: renderReceiptHtml with Refund Orders", () => {
    it("renders RETURN header, reference invoice, and negative lines for Cash refund", () => {
      const refundReceipt: Receipt = {
        storeName: "YUN FOOK TRADING",
        storeNameCn: "润福五金",
        storeAddress: "Lot 123, Jalan Pasar",
        regNo: "227533-X",
        invNo: "A-0005",
        dateText: "24/10/2026 15:30",
        method: "Cash",
        itemCount: 2,
        lines: [
          {
            name: "Plywood 9mm",
            qtyText: "2",
            unitPriceText: "RM 35.00/pc",
            amountText: "RM 70.00",
          },
          {
            name: "Cement 50kg",
            qtyText: "1",
            unitPriceText: "RM 22.50/bag",
            amountText: "RM 22.50",
          },
        ],
        subtotalText: "-RM 92.50",
        totalText: "-RM 92.50",
        paidText: "-RM 92.50",
        changeText: "RM 0.00",
        footer: "Terima kasih!",
        ...({
          isRefund: true,
          refundOfInvNo: "A-0001",
          refundOfOrderId: 10,
        } as any),
      };

      const html = renderReceiptHtml(refundReceipt);

      // 1. Header checks
      expect(html).toContain("RETURN / 退货");
      expect(html).not.toContain("TAX INVOICE");

      // 2. Reference invoice
      expect(html).toContain("Ref: Receipt #A-0001");

      // 3. Negative line items
      expect(html).toContain('<span class="item-amount">-70.00</span>');
      expect(html).toContain('<span class="item-amount">-22.50</span>');

      // 4. Pay section
      expect(html).toContain("Refund: Cash");
      expect(html).not.toContain("Paid: Cash");

      // 5. Terms check
      expect(html).toContain("Returned goods acknowledged in good order.");
      expect(html).not.toContain("Goods sold are not returnable or exchanged.");

      // 6. Summary totals
      expect(html).toContain("-RM 92.50");
      expect(html).toContain("Change</span><span>RM 0.00</span>");
    });

    it("renders contractor B-series refund receipt with Bill-To section and Bank method", () => {
      const contractorRefundReceipt: Receipt = {
        storeName: "YUN FOOK TRADING",
        invNo: "B-0003",
        dateText: "24/10/2026 16:00",
        method: "Bank",
        contractor: {
          name: "Syarikat Pembinaan Jaya",
          tin: "C1234567890",
          address: "123 Jalan Industri, Tawau",
          phone: "012-3456789",
        },
        itemCount: 1,
        lines: [
          {
            name: "Steel Bar 12mm",
            qtyText: "10 pcs",
            unitPriceText: "RM 45.00/pc",
            amountText: "RM 450.00",
          },
        ],
        totalText: "-RM 450.00",
        footer: "Thank you!",
        ...({
          isRefund: true,
          refundOfInvNo: "B-0001",
        } as any),
      };

      const html = renderReceiptHtml(contractorRefundReceipt);

      expect(html).toContain("RETURN / 退货");
      expect(html).toContain("Ref: Receipt #B-0001");
      expect(html).toContain("Bill To / Kepada:");
      expect(html).toContain("Syarikat Pembinaan Jaya");
      expect(html).toContain("C1234567890");
      expect(html).toContain("123 Jalan Industri, Tawau");
      expect(html).toContain("Refund: Bank Transfer");
      expect(html).toContain('<span class="item-amount">-450.00</span>');
    });

    it("auto-detects refund status from negative totalText even if isRefund flag was omitted", () => {
      const implicitRefund: Receipt = {
        storeName: "YUN FOOK TRADING",
        invNo: "A-0009",
        dateText: "24/10/2026 16:15",
        method: "QR",
        itemCount: 1,
        lines: [
          {
            name: "Paip PVC 20mm",
            qtyText: "3",
            unitPriceText: "RM 8.00/pc",
            amountText: "RM 24.00",
          },
        ],
        totalText: "-RM 24.00",
        footer: "Thank you!",
        refundOfOrderId: 45,
      };

      const html = renderReceiptHtml(implicitRefund);
      expect(html).toContain("RETURN / 退货");
      expect(html).toContain("Ref: Receipt #45");
      expect(html).toContain("Refund: QR");
      expect(html).toContain('<span class="item-amount">-24.00</span>');
    });

    it("safely handles zero-amount items and preserves 0.00 without double minus signs", () => {
      const zeroRefund: Receipt = {
        storeName: "YUN FOOK TRADING",
        invNo: "A-0010",
        dateText: "24/10/2026 16:30",
        method: "Cash",
        itemCount: 1,
        lines: [
          {
            name: "Sample Promo Item",
            qtyText: "1",
            unitPriceText: "RM 0.00/pc",
            amountText: "RM 0.00",
          },
        ],
        totalText: "RM 0.00",
        footer: "Thank you!",
        ...({
          isRefund: true,
          refundOfInvNo: "A-0002",
        } as any),
      };

      const html = renderReceiptHtml(zeroRefund);
      expect(html).toContain("RETURN / 退货");
      expect(html).toContain('<span class="item-amount">0.00</span>');
      expect(html).not.toContain("-0.00");
      expect(html).not.toContain("--");
    });
  });

  describe("F2.7: Z-Report and Daily Stats Aggregation", () => {
    function makeOrder(overrides: Partial<Order>): Order {
      return {
        id: 1,
        companyId: 1,
        ts: 1729780000000,
        businessDate: "2026-10-24",
        invNo: "A-0001",
        method: "Cash",
        subtotalCents: 10000,
        discountCents: 0,
        totalCents: 10000,
        items: [
          {
            id: 1,
            itemId: 101,
            name: "Paku 2 inci",
            image: "",
            unit: "kg",
            priceCents: 1000,
            origPriceCents: null,
            qtyMilli: 10000,
            amountCents: 10000,
            tailCount: 0,
            bulkPrice: false,
          },
        ],
        voidedAt: null,
        creditClearedAt: null,
        refundOfOrderId: null,
        refundOfInvNo: null,
        ...overrides,
      };
    }

    it("accurately computes refundsCount and refundsTotalCents and nets revenue across payment methods", () => {
      const orders: Order[] = [
        makeOrder({ id: 1, invNo: "A-0001", method: "Cash", totalCents: 10000 }), // RM 100 Cash
        makeOrder({ id: 2, invNo: "A-0002", method: "Bank", totalCents: 15000 }), // RM 150 Bank
        makeOrder({ id: 3, invNo: "B-0001", method: "Credit", totalCents: 20000, contractorName: "Ah Meng" }), // RM 200 Credit
        // Refund 1: Cash refund of RM 30
        makeOrder({
          id: 4,
          invNo: "A-0003",
          method: "Cash",
          totalCents: -3000,
          refundOfOrderId: 1,
          refundOfInvNo: "A-0001",
        }),
        // Refund 2: Credit refund of RM 50
        makeOrder({
          id: 5,
          invNo: "B-0002",
          method: "Credit",
          totalCents: -5000,
          refundOfOrderId: 3,
          refundOfInvNo: "B-0001",
          contractorName: "Ah Meng",
        }),
        // Voided order: RM 80 Cash (should be ignored entirely)
        makeOrder({ id: 6, invNo: "A-0004", method: "Cash", totalCents: 8000, voidedAt: 1729781000000 }),
        // Voided refund: -RM 20 Cash (should be ignored entirely)
        makeOrder({
          id: 7,
          invNo: "A-0005",
          method: "Cash",
          totalCents: -2000,
          refundOfOrderId: 1,
          voidedAt: 1729781000000,
        }),
      ];

      const repayments: Repayment[] = [
        {
          id: 1,
          companyId: 1,
          creditId: 1,
          orderId: 3,
          contractorId: 1,
          contractorName: "Ah Meng",
          amountCents: 5000, // RM 50 repayment via Bank
          method: "Bank",
          ts: 1729782000000,
          businessDate: "2026-10-24",
        },
      ];

      const stats = computeStats(orders, "today", repayments);

      // Total orders counted: 5 non-voided (3 sales + 2 refunds)
      expect(stats.count).toBe(5);

      // Refunds specifically:
      expect(stats.refundsCount).toBe(2);
      expect(stats.refundsTotalCents).toBe(8000); // RM 30 + RM 50

      // Repayments:
      expect(stats.repaymentsCount).toBe(1);
      expect(stats.repaymentsTotalCents).toBe(5000);

      // Payment methods breakdown:
      // Cash: 10000 (order 1) - 3000 (refund 4) = 7000
      expect(stats.byMethod.Cash.totalCents).toBe(7000);
      expect(stats.byMethod.Cash.count).toBe(2);

      // Bank: 15000 (order 2) + 5000 (repayment 1) = 20000
      expect(stats.byMethod.Bank.totalCents).toBe(20000);
      expect(stats.byMethod.Bank.count).toBe(1);

      // Credit: 20000 (order 3) - 5000 (refund 5) = 15000
      expect(stats.byMethod.Credit.totalCents).toBe(15000);
      expect(stats.byMethod.Credit.count).toBe(2);

      // Total Net: 7000 + 20000 + 15000 = 42000
      expect(stats.totalCents).toBe(42000);

      // Test Day Report HTML rendering
      const html = renderDayReportHtml({
        storeName: "YUN FOOK TRADING",
        businessDate: "2026-10-24",
        orders,
        repayments,
      });

      expect(html).toContain("BY PAYMENT");
      expect(html).toContain("Refunds (2 order(s))");
      expect(html).toContain("-80.00");
      expect(html).toContain("420.00"); // 42000 cents
    });

    it("omits Refunds row in renderDayReportHtml when no refunds exist", () => {
      const orders: Order[] = [
        makeOrder({ id: 1, invNo: "A-0001", method: "Cash", totalCents: 5000 }),
      ];

      const html = renderDayReportHtml({
        storeName: "YUN FOOK TRADING",
        businessDate: "2026-10-24",
        orders,
      });

      expect(html).not.toContain("Refunds (");
    });
  });

  describe("F2.7: Daily Excel Export (daily.ts)", () => {
    function makeOrder(overrides: Partial<Order>): Order {
      return {
        id: 1,
        companyId: 1,
        ts: 1729780000000,
        businessDate: "2026-10-24",
        invNo: "A-0001",
        method: "Cash",
        subtotalCents: 5000,
        discountCents: 0,
        totalCents: 5000,
        items: [
          {
            id: 10,
            itemId: 201,
            name: "Cat Minyak — Putih 1L",
            image: "",
            unit: "each",
            priceCents: 2500,
            origPriceCents: null,
            qtyMilli: 2000,
            amountCents: 5000,
            tailCount: 0,
            bulkPrice: false,
          },
        ],
        voidedAt: null,
        creditClearedAt: null,
        refundOfOrderId: null,
        refundOfInvNo: null,
        ...overrides,
      };
    }

    it("exports refund rows with negative subtotal, negative amount, and reference notes in HQ Daily sheet", () => {
      const orders: Order[] = [
        makeOrder({ id: 1, invNo: "A-0001", totalCents: 5000 }),
        makeOrder({
          id: 2,
          invNo: "A-0002",
          totalCents: -2500,
          refundOfOrderId: 1,
          refundOfInvNo: "A-0001",
          items: [
            {
              id: 11,
              itemId: 201,
              name: "Cat Minyak — Putih 1L",
              image: "",
              unit: "each",
              priceCents: 2500,
              origPriceCents: null,
              qtyMilli: 1000,
              amountCents: 2500,
              tailCount: 0,
              bulkPrice: false,
            },
          ],
        }),
      ];

      const workbook = buildDailyWorkbook(orders, []);
      const hqSheet = workbook.Sheets["HQ Daily"];
      expect(hqSheet).toBeDefined();

      const hqJson: any[] = XLSX.utils.sheet_to_json(hqSheet!, { header: 1 });
      expect(hqJson[0]).toEqual([...HQ_DAILY_HEADERS]);

      // Row 1: Sale A-0001
      const saleRow = hqJson[1];
      expect(saleRow[2]).toBe("A-0001");
      expect(saleRow[6]).toBe(50); // RM 50.00

      // Row 2: Refund A-0002
      const refundRow = hqJson[2];
      expect(refundRow[2]).toBe("A-0002");
      expect(refundRow[4]).toBe(-25); // Subtotal: -RM 25.00
      expect(refundRow[6]).toBe(-25); // Amount: -RM 25.00
      expect(refundRow[8]).toContain("Refund: Ref #A-0001");

      // Check Invoice Items sheet
      const itemsSheet = workbook.Sheets["Invoice Items"];
      expect(itemsSheet).toBeDefined();
      const itemsJson: any[] = XLSX.utils.sheet_to_json(itemsSheet!, { header: 1 });
      expect(itemsJson[0]).toEqual([...INVOICE_ITEMS_HEADERS]);

      // Line item for refund row: Qty should be -1 and Line Amount should be -25
      const refundLineRow = itemsJson[2];
      expect(refundLineRow[0]).toBe("A-0002");
      expect(refundLineRow[1]).toBe("Cat Minyak");
      expect(refundLineRow[2]).toBe("Putih 1L");
      expect(refundLineRow[4]).toBe(-1); // -1 qty
      expect(refundLineRow[8]).toBe(-25); // -25 RM amount
    });
  });
});
