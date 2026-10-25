import { describe, expect, it } from "vitest";
import type { Order, OrderLine, PaymentMethod } from "@yf/core";
import { renderDayReportHtml } from "./renderDayReportHtml";

// Text-only view of the printout, so assertions read like the paper roll.
const asText = (html: string): string =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

let nextId = 1;

const line = (name: string, amountCents: number): OrderLine => ({
  id: nextId++,
  itemId: name.length, // stable per name; the report only groups on itemId
  name,
  image: "",
  unit: "kg",
  qtyMilli: 1000,
  tailCount: 0,
  priceCents: amountCents,
  amountCents,
  bulkPrice: false,
});

const order = (
  method: PaymentMethod,
  totalCents: number,
  items: OrderLine[],
  extra: Partial<Order> = {},
): Order => ({
  id: nextId++,
  companyId: 1,
  ts: Date.now(),
  businessDate: "2026-08-14",
  invNo: `08-${1000 + nextId}`,
  method,
  totalCents,
  items,
  voidedAt: null,
  ...extra,
});

const render = (orders: Order[]): string =>
  renderDayReportHtml({ storeName: "Yun Fook Trading", businessDate: "2026-08-14", orders });

describe("day report — credit split", () => {
  const cash = order("Cash", 5000, [line("Ikan Tilapia", 5000)]);
  const credit = order("Credit", 12500, [line("Fresh Milk 500 ml", 12500)], {
    creditorName: "Pak Abu",
  });

  it("keeps credit items out of BY ITEM but inside TOTAL", () => {
    const text = asText(render([cash, credit]));
    const byItem = text.slice(text.indexOf("BY ITEM"), text.indexOf("BY ITEM - CREDIT"));
    expect(byItem).toContain("Ikan Tilapia");
    expect(byItem).not.toContain("Fresh Milk 500 ml"); // it moved to the credit section
    expect(text).toContain("TOTAL (RM) 175.00"); // 50.00 cash + 125.00 credit
    expect(text).toContain("2 sale(s)");
  });

  it("prints BY ITEM - CREDIT between BY ITEM and BY PAYMENT", () => {
    const text = asText(render([cash, credit]));
    expect(text.indexOf("BY ITEM")).toBeLessThan(text.indexOf("BY ITEM - CREDIT"));
    expect(text.indexOf("BY ITEM - CREDIT")).toBeLessThan(text.indexOf("BY PAYMENT"));
    expect(text).toContain("Fresh Milk 500 ml 1 kg 125.00");
    expect(text).not.toContain("Credit total"); // BY PAYMENT already carries it
  });

  it("keeps the Credit line under Cash in BY PAYMENT", () => {
    const text = asText(render([cash, credit]));
    const byPayment = text.slice(text.indexOf("BY PAYMENT"));
    expect(byPayment).toContain("Cash (1) 50.00");
    expect(byPayment).toContain("Credit (1) 125.00");
    expect(byPayment.indexOf("Cash (1)")).toBeLessThan(byPayment.indexOf("Credit (1)"));
  });

  it("rolls credit items up across sales, biggest quantity first", () => {
    const more = order("Credit", 3000, [line("Fresh Milk 500 ml", 3000)], {
      creditorName: "Ah Meng",
    });
    const text = asText(render([cash, credit, more]));
    expect(text).toContain("Fresh Milk 500 ml 2 kg 155.00");
    expect(text).toContain("Credit (2) 155.00"); // the BY PAYMENT line
  });

  it("adds the two item sections up to TOTAL", () => {
    const bank = order("Bank", 2000, [line("Prawn", 2000)]);
    const text = asText(render([cash, credit, bank]));
    expect(text).toContain("TOTAL (RM) 195.00"); // 50 + 20 paid, 125 on the book
  });

  it("omits the whole section on a day with no credit sales", () => {
    const text = asText(render([cash]));
    expect(text).not.toContain("BY ITEM - CREDIT");
    expect(text).toContain("TOTAL (RM) 50.00");
  });

  it("leaves a voided credit sale out of BY ITEM - CREDIT", () => {
    const voidedCredit = order("Credit", 9900, [line("Crab", 9900)], {
      creditorName: "Pak Abu",
      voidedAt: Date.now(),
    });
    const text = asText(render([cash, voidedCredit]));
    expect(text).not.toContain("BY ITEM - CREDIT");
    expect(text).toContain("Voided: 1 sale(s)");
  });

  it("includes repayment method in BY PAYMENT even when sales count for that method is 0", () => {
    const bankRepayment: import("@yf/core").Repayment = {
      id: 1,
      companyId: 1,
      creditId: 5,
      orderId: 1,
      contractorName: "Ah Meng",
      amountCents: 8000,
      method: "Bank",
      ts: Date.now(),
      businessDate: "2026-08-14",
    };
    const html = renderDayReportHtml({
      storeName: "Yun Fook Trading",
      businessDate: "2026-08-14",
      orders: [cash],
      repayments: [bankRepayment],
    });
    const text = asText(html);
    expect(text).toContain("CREDIT REPAYMENTS COLLECTED");
    expect(text).toContain("Ah Meng (Bank Transfer) 80.00");
    const byPayment = text.slice(text.indexOf("BY PAYMENT"));
    expect(byPayment).toContain("Cash (1) 50.00");
    expect(byPayment).toContain("Bank Transfer 80.00");
    expect(text).toContain("TOTAL (RM) 130.00");
  });

  it("formats QR and Card payment methods and repayments separately", () => {
    const qrOrder = order("QR", 4500, [line("Plywood", 4500)]);
    const qrRepayment: import("@yf/core").Repayment = {
      id: 2,
      companyId: 1,
      creditId: 6,
      orderId: 2,
      contractorName: "Ah Meng",
      amountCents: 6000,
      method: "QR",
      ts: Date.now(),
      businessDate: "2026-08-14",
    };
    const html = renderDayReportHtml({
      storeName: "Yun Fook Trading",
      businessDate: "2026-08-14",
      orders: [cash, qrOrder],
      repayments: [qrRepayment],
    });
    const text = asText(html);
    expect(text).toContain("Ah Meng (QR) 60.00");
    const byPayment = text.slice(text.indexOf("BY PAYMENT"));
    expect(byPayment).toContain("QR (1) 105.00");

    const cardOrder = order("Card", 2000, [line("Nails", 2000)]);
    const cardHtml = renderDayReportHtml({
      storeName: "Yun Fook Trading",
      businessDate: "2026-08-14",
      orders: [cardOrder],
      repayments: [],
    });
    expect(asText(cardHtml)).toContain("Card (1) 20.00");
  });

  it("ensures all 5 payment methods (Cash, Card, QR, Bank, Credit) remain aligned and render correctly", () => {
    const cashOrder = order("Cash", 5000, [line("Hammer", 5000)]);
    const cardOrder = order("Card", 3500, [line("Chisel", 3500)]);
    const qrOrder = order("QR", 2500, [line("Saw", 2500)]);
    const bankOrder = order("Bank", 8000, [line("Drill", 8000)]);
    const creditOrder = order("Credit", 12000, [line("Cement", 12000)], { contractorName: "Ah Seng" });

    const html = renderDayReportHtml({
      storeName: "Yun Fook Trading",
      businessDate: "2026-08-14",
      orders: [cashOrder, cardOrder, qrOrder, bankOrder, creditOrder],
    });

    const byPaymentSection = html.slice(html.indexOf('<div class="h">BY PAYMENT</div>'));

    // Check all 5 payment methods are rendered with proper labels and amounts
    expect(byPaymentSection).toContain('<span class="name">Cash (1)</span><span class="amt">50.00</span>');
    expect(byPaymentSection).toContain('<span class="name">Card (1)</span><span class="amt">35.00</span>');
    expect(byPaymentSection).toContain('<span class="name">QR (1)</span><span class="amt">25.00</span>');
    expect(byPaymentSection).toContain('<span class="name">Bank Transfer (1)</span><span class="amt">80.00</span>');
    expect(byPaymentSection).toContain('<span class="name">Credit (1)</span><span class="amt">120.00</span>');

    // Check strictly ordered sequence of the 5 payment methods
    const cashIdx = byPaymentSection.indexOf("Cash (1)");
    const cardIdx = byPaymentSection.indexOf("Card (1)");
    const qrIdx = byPaymentSection.indexOf("QR (1)");
    const bankIdx = byPaymentSection.indexOf("Bank Transfer (1)");
    const creditIdx = byPaymentSection.indexOf("Credit (1)");

    expect(cashIdx).toBeLessThan(cardIdx);
    expect(cardIdx).toBeLessThan(qrIdx);
    expect(qrIdx).toBeLessThan(bankIdx);
    expect(bankIdx).toBeLessThan(creditIdx);

    // Total reflects all 5 orders: 50 + 35 + 25 + 80 + 120 = 310
    expect(html).toContain("<span>TOTAL (RM)</span><span>310.00</span>");
    expect(html).toContain("5 sale(s)");
  });

  it("renders refund orders row under BY PAYMENT section and updates total", () => {
    const cashOrder = order("Cash", 5000, [line("Hammer", 5000)]);
    const refundOrder = order("Cash", -2000, [line("Hammer", 2000)], {
      refundOfOrderId: cashOrder.id,
      refundOfInvNo: cashOrder.invNo,
    });

    const html = renderDayReportHtml({
      storeName: "Yun Fook Trading",
      businessDate: "2026-08-14",
      orders: [cashOrder, refundOrder],
    });

    expect(html).toContain("Refunds (1 order(s))");
    expect(html).toContain("-20.00");
    // Net total: 50.00 - 20.00 = 30.00
    expect(html).toContain("<span>TOTAL (RM)</span><span>30.00</span>");
  });
});

