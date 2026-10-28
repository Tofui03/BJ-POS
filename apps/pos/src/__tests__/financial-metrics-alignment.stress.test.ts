import { describe, expect, it } from "vitest";
import {
  computeFinancialMetrics,
  computeStats,
  fmtMoney,
  type Order,
  type OrderLine,
  type Repayment,
} from "@yf/core";
import { renderDayReportHtml } from "../printing/renderDayReportHtml";
import { buildDailyWorkbook } from "../report/daily";
import * as XLSX from "xlsx";

function makeLine(
  id: number,
  name: string,
  priceCents: number,
  qtyMilli = 1000,
): OrderLine {
  return {
    id,
    itemId: id,
    name,
    image: "",
    unit: "pcs",
    priceCents,
    qtyMilli,
    tailCount: 0,
    amountCents: Math.round((priceCents * qtyMilli) / 1000),
    bulkPrice: false,
  };
}

function makeOrder(
  id: number,
  method: Order["method"],
  totalCents: number,
  refundOfOrderId?: number,
): Order {
  return {
    id,
    companyId: 1,
    ts: 1700000000000 + id * 1000,
    businessDate: "2026-10-28",
    invNo: `INV-${String(id).padStart(4, "0")}`,
    method,
    totalCents,
    contractorName: method === "Credit" ? "Contractor Bob" : undefined,
    voidedAt: null,
    refundOfOrderId: refundOfOrderId ?? null,
    refundOfInvNo: refundOfOrderId ? `INV-${String(refundOfOrderId).padStart(4, "0")}` : undefined,
    items: [makeLine(id, `Item ${id}`, Math.abs(totalCents))],
  };
}

function makeRepayment(
  id: number,
  method: Repayment["method"],
  amountCents: number,
): Repayment {
  return {
    id,
    companyId: 1,
    creditId: id,
    orderId: 100 + id,
    contractorName: "Contractor Bob",
    amountCents,
    method,
    ts: 1700000000000 + id * 1000,
    businessDate: "2026-10-28",
    notes: `Debt repayment ${id}`,
  };
}

describe("Triple Financial Metrics Alignment (Anti Double-Counting Gate)", () => {
  it("strictly aligns Gross Merchandise Sales, Realized Inflow, and Expected Drawer Cash across all 4 surfaces", () => {
    // 1. Sales Orders:
    // Cash sale: RM 50.00
    // Card sale: RM 30.00
    // QR sale: RM 20.00
    // Bank sale: RM 40.00
    // Credit sale: RM 100.00
    // Cash refund: -RM 15.00
    // Card refund: -RM 5.00
    const orders: Order[] = [
      makeOrder(1, "Cash", 5000),
      makeOrder(2, "Card", 3000),
      makeOrder(3, "QR", 2000),
      makeOrder(4, "Bank", 4000),
      makeOrder(5, "Credit", 10000),
      makeOrder(6, "Cash", -1500, 1),
      makeOrder(7, "Card", -500, 2),
    ];

    // 2. Debt Repayments (historical debt collected today):
    // Cash repayment: RM 25.00
    // Bank repayment: RM 60.00
    const repayments: Repayment[] = [
      makeRepayment(1, "Cash", 2500),
      makeRepayment(2, "Bank", 6000),
    ];

    // Core Metrics Definition:
    // 营业额 (Gross Merchandise Sales): 现金/QR/卡/银行销售 + 赊账销售 - 退货 (不含历史欠款回收 repayments).
    // = 50 + 30 + 20 + 40 + 100 - 15 - 5 = RM 220.00 (22,000 cents)
    //
    // 实收资金 (Realized Inflow): 非赊账销售 + 当日收回的欠款 (repayments).
    // 非赊账销售净额: (50 - 15) + (30 - 5) + 20 + 40 = 35 + 25 + 20 + 40 = RM 120.00 (12,000 cents)
    // 欠款回收: 25 + 60 = RM 85.00 (8,500 cents)
    // 实收资金 = 120 + 85 = RM 205.00 (20,500 cents)
    //
    // 钱箱应有净现金 (Expected Drawer Cash): 现金销售 + 现金还款 - 现金退货.
    // 现金销售: RM 50.00
    // 现金还款: RM 25.00
    // 现金退货: RM 15.00
    // 应有净现金 = 50 + 25 - 15 = RM 60.00 (6,000 cents)

    const metrics = computeFinancialMetrics(orders, repayments);

    expect(metrics.grossMerchandiseSalesCents).toBe(22000);
    expect(metrics.realizedInflowCents).toBe(20500);
    expect(metrics.expectedDrawerCashCents).toBe(6000);

    // Verify renderDayReportHtml Z-Report output contains these exact reconciliation figures
    const html = renderDayReportHtml({
      storeName: "Borneo Jasa Hardware",
      businessDate: "2026-10-28",
      orders,
      repayments,
    });

    expect(html).toContain("FINANCIAL RECONCILIATION");
    expect(html).toContain('<span class="name">Gross Sales (GMV)</span><span class="amt">220.00</span>');
    expect(html).toContain('<span class="name">Realized Inflow</span><span class="amt">205.00</span>');
    expect(html).toContain('<span class="name">Expected Drawer Cash</span><span class="amt">60.00</span>');

    // Verify Excel Workbook can be generated seamlessly with zero errors
    const wb = buildDailyWorkbook(orders, repayments);
    expect(wb.SheetNames).toEqual(["HQ Daily", "Invoice Items"]);
  });

  it("handles empty periods with zero across all three metrics", () => {
    const metrics = computeFinancialMetrics([], []);
    expect(metrics.grossMerchandiseSalesCents).toBe(0);
    expect(metrics.realizedInflowCents).toBe(0);
    expect(metrics.expectedDrawerCashCents).toBe(0);
    expect(metrics.refundsCount).toBe(0);
    expect(metrics.repaymentsCount).toBe(0);
  });
});
