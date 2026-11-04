import { describe, expect, it } from "vitest";
import type { Order, DeliveryOrder, Receipt } from "@yf/core";
import { renderReceiptHtml } from "../printing/renderReceiptHtml";
import { renderDeliveryOrderHtml } from "../printing/renderDeliveryOrderHtml";
import { buildDailyWorkbook } from "../report/daily";

describe("Printed output and exports", () => {
    const mockReceipt: Receipt = {
      storeName: "Borneo Jasa Hardware",
      invNo: "A-20261024-001",
      dateText: "24 Oct 2026 · 10:00 am",
      method: "Cash",
      itemCount: 1,
      lines: [
        {
          name: "PVC Pipe 1 inch",
          qtyText: "2 pcs",
          unitPriceText: "RM 15.50",
          amountText: "RM 31.00",
        },
      ],
      totalText: "RM 31.00",
      paidText: "RM 50.00",
      changeText: "RM 19.00",
      footer: "Thank you!",
    };

    const mockDO: DeliveryOrder = {
      companyId: 1,
      businessDate: "2026-10-24",
      doNumber: "DO-20261024-001",
      invNo: "B-20261024-001",
      dateText: "24/10/2026 10:00",
      storeName: "Borneo Jasa Sdn. Bhd.",
      storeAddress: "Lot 123, Industrial Zone, Keningau",
      contractorName: "Ah Seng Contractor",
      siteAddress: "Tapak Projek Lot 88, Keningau",
      lorryPlate: "SAB 1234 X",
      driverName: "Pak Ali",
      contractorPo: "PO-9999",
      showPriceOnDo: true,
      totalQtyMilli: 2000,
      totalQtyText: "2.000",
      lines: [
        {
          itemNo: 1,
          name: "PVC Pipe 1 inch",
          itemName: "PVC Pipe 1 inch",
          unit: "pcs",
          qtyMilli: 2000,
          qtyText: "2 pcs",
          unitPriceCents: 1550,
          unitPriceText: "RM 15.50",
          lineAmountCents: 3100,
          amountText: "RM 31.00",
        },
      ],
      signatories: {
        issuedBy: "Store / Cashier",
        deliveredBy: "Pak Ali",
        receivedBy: "Site Supervisor",
      },
    };

    const mockOrder: Order = {
      id: 101,
      companyId: 1,
      ts: new Date("2026-10-24T10:00:00+08:00").getTime(),
      businessDate: "2026-10-24",
      invNo: "A-20261024-001",
      method: "Cash",
      totalCents: 3100,
      voidedAt: null,
      items: [
        {
          id: 1,
          itemId: 1,
          name: "PVC Pipe 1 inch",
          image: "",
          unit: "pcs",
          priceCents: 1550,
          qtyMilli: 2000,
          amountCents: 3100,
          tailCount: 0,
          bulkPrice: false,
        },
      ],
    };

    it("strictly preserves commercial English format on thermal receipts", () => {
      {
        const receiptHtml = renderReceiptHtml(mockReceipt, 80);

        // 1. Mandatory commercial headers and fields
        expect(receiptHtml).toContain("Borneo Jasa Hardware");
        expect(receiptHtml).toContain("Receipt #A-20261024-001");
        expect(receiptHtml).toContain("RM 31.00");
        expect(receiptHtml).toContain("Cash");
        expect(receiptHtml).toContain("PVC Pipe 1 inch");

        // 2. CRITICAL: Absolute prohibition of UI Chinese strings leaking onto thermal receipts
        expect(receiptHtml).not.toContain("结账");
        expect(receiptHtml).not.toContain("总计");
        expect(receiptHtml).not.toContain("现金");
        expect(receiptHtml).not.toContain("找零");
      }
    });

    it("strictly preserves commercial format on Delivery Orders ", () => {
      {
        const doHtml = renderDeliveryOrderHtml(mockDO);

        // 1. Mandatory commercial DO headers
        expect(doHtml).toContain("DELIVERY ORDER");
        expect(doHtml).toContain("DO No:");
        expect(doHtml).toContain("STORE COPY");
        expect(doHtml).toContain("CUSTOMER COPY");
        expect(doHtml).toContain("Tapak Projek Lot 88, Keningau");
        expect(doHtml).toContain("Pak Ali");

        // 2. CRITICAL: Absolute prohibition of Chinese UI strings leaking into DO printout
        expect(doHtml).not.toContain("送货单");
        expect(doHtml).not.toContain("存根联");
        expect(doHtml).not.toContain("客户联");
        expect(doHtml).not.toContain("工程商");
      }
    });

    it("strictly preserves daily Excel export workbook sheet structure and headers ", () => {

      const wb = buildDailyWorkbook([mockOrder], []);
      expect(wb.SheetNames).toContain("HQ Daily");
      expect(wb.SheetNames).toContain("Invoice Items");

      const hqSheet = wb.Sheets["HQ Daily"];
      expect(hqSheet).toBeDefined();

      // Check standard English column headers in row 1 (HQ_DAILY_HEADERS)
      expect(hqSheet!["A1"]?.v).toBe("Name");
      expect(hqSheet!["B1"]?.v).toBe("Date");
      expect(hqSheet!["C1"]?.v).toBe("Inv No");
      expect(hqSheet!["D1"]?.v).toBe("Pay Type");
    });
});
