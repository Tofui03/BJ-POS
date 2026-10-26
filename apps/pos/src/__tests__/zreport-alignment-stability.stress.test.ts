import { describe, it, expect } from "vitest";
import {
  PAYMENT_METHODS,
  REPAYMENT_METHODS,
  computeStats,
  aggregateItemSales,
  fmtMoney,
  type Order,
  type OrderLine,
  type PaymentMethod,
  type Repayment,
  type RepaymentMethod,
  type DeliveryOrder,
  type CompanyInfo,
} from "@yf/core";
import { renderDayReportHtml, escapeHtml } from "../printing/renderDayReportHtml";
import { renderReceiptHtml, printableWidthMm } from "../printing/renderReceiptHtml";
import { renderDeliveryOrderHtml } from "../printing/renderDeliveryOrderHtml";

let idCounter = 1000;

function createTestLine(
  itemId: number,
  name: string,
  priceCents: number,
  qtyMilli: number = 1000,
  unit: import("@yf/core").Unit = "pcs",
): OrderLine {
  return {
    id: ++idCounter,
    itemId,
    name,
    image: "",
    unit,
    priceCents,
    qtyMilli,
    amountCents: Math.round((priceCents * qtyMilli) / 1000),
    tailCount: 0,
    bulkPrice: false,
  };
}

function createTestOrder(
  method: PaymentMethod,
  items: OrderLine[],
  overrides: Partial<Order> = {},
): Order {
  const totalCents = items.reduce((sum, item) => sum + item.amountCents, 0);
  return {
    id: ++idCounter,
    companyId: 1,
    ts: Date.now(),
    businessDate: "2026-10-24",
    invNo: method === "Credit" ? `B-${idCounter}` : `A-${idCounter}`,
    method,
    totalCents,
    items,
    voidedAt: null,
    ...overrides,
  };
}

function createTestRepayment(
  method: RepaymentMethod,
  amountCents: number,
  contractorName: string = "Ah Seng Contractor",
  overrides: Partial<Repayment> = {},
): Repayment {
  return {
    id: ++idCounter,
    companyId: 1,
    creditId: 100,
    orderId: 200,
    contractorName,
    amountCents,
    method,
    ts: Date.now(),
    businessDate: "2026-10-24",
    ...overrides,
  };
}

describe("Empirical Challenge Suite — Z-Report Payment Method Alignment & Stats", () => {
  it("Scenario 1: All 5 payment methods simultaneous in a single report", () => {
    const orders: Order[] = [
      createTestOrder("Cash", [createTestLine(1, "Portland Cement", 2250, 2000)]), // 4500
      createTestOrder("Card", [createTestLine(2, "Cordless Drill", 18500, 1000)]), // 18500
      createTestOrder("QR", [createTestLine(3, "Masking Tape", 350, 4000)]), // 1400
      createTestOrder("Bank", [createTestLine(4, "Steel Rod Y12", 3200, 5000)]), // 16000
      createTestOrder("Credit", [createTestLine(5, "Plywood 9mm", 2400, 3000)], {
        contractorName: "Chong Construction",
      }), // 7200
    ];

    const stats = computeStats(orders, "today", []);
    expect(stats.count).toBe(5);
    expect(stats.totalCents).toBe(4500 + 18500 + 1400 + 16000 + 7200);

    const html = renderDayReportHtml({
      storeName: "Yun Fook Trading",
      businessDate: "2026-10-24",
      orders,
    });

    const byPaymentIdx = html.indexOf('<div class="h">BY PAYMENT</div>');
    expect(byPaymentIdx).toBeGreaterThan(-1);
    const byPaymentHtml = html.slice(byPaymentIdx);

    // Verify all 5 lines in exact order
    expect(byPaymentHtml).toContain('<span class="name">Cash (1)</span><span class="amt">45.00</span>');
    expect(byPaymentHtml).toContain('<span class="name">Card (1)</span><span class="amt">185.00</span>');
    expect(byPaymentHtml).toContain('<span class="name">QR (1)</span><span class="amt">14.00</span>');
    expect(byPaymentHtml).toContain('<span class="name">Bank Transfer (1)</span><span class="amt">160.00</span>');
    expect(byPaymentHtml).toContain('<span class="name">Credit (1)</span><span class="amt">72.00</span>');

    const cashPos = byPaymentHtml.indexOf("Cash (1)");
    const cardPos = byPaymentHtml.indexOf("Card (1)");
    const qrPos = byPaymentHtml.indexOf("QR (1)");
    const bankPos = byPaymentHtml.indexOf("Bank Transfer (1)");
    const creditPos = byPaymentHtml.indexOf("Credit (1)");

    expect(cashPos).toBeLessThan(cardPos);
    expect(cardPos).toBeLessThan(qrPos);
    expect(qrPos).toBeLessThan(bankPos);
    expect(bankPos).toBeLessThan(creditPos);

    expect(html).toContain("<span>TOTAL (RM)</span><span>476.00</span>");
    expect(html).toContain('<div class="count">5 sale(s)</div>');
  });

  it("Scenario 2: Repayments under diverse methods with zero sales for some methods", () => {
    // Only Cash sales, but repayments in Bank, QR, Card, and Cash
    const orders: Order[] = [
      createTestOrder("Cash", [createTestLine(1, "Nails 2 inch", 800, 1000)]), // 800
    ];

    const repayments: Repayment[] = [
      createTestRepayment("Bank", 25000, "Syarikat Megah"), // 25000
      createTestRepayment("QR", 5000, "Ah Seng"), // 5000
      createTestRepayment("Card", 12000, "Tan Construction"), // 12000
      createTestRepayment("Cash", 3000, "Uncle Lim"), // 3000
    ];

    const stats = computeStats(orders, "today", repayments);
    expect(stats.count).toBe(1); // 1 sale
    expect(stats.repaymentsCount).toBe(4);
    expect(stats.repaymentsTotalCents).toBe(25000 + 5000 + 12000 + 3000); // 45000
    expect(stats.totalCents).toBe(800 + 45000); // 45800

    const html = renderDayReportHtml({
      storeName: "Yun Fook Trading",
      businessDate: "2026-10-24",
      orders,
      repayments,
    });

    const byPaymentHtml = html.slice(html.indexOf('<div class="h">BY PAYMENT</div>'));

    // Cash has 1 sale (800) + 1 repayment (3000) = 3800 -> Cash (1) 38.00
    expect(byPaymentHtml).toContain('<span class="name">Cash (1)</span><span class="amt">38.00</span>');
    // Card has 0 sales, 1 repayment (12000) -> Card 120.00 (no count badge)
    expect(byPaymentHtml).toContain('<span class="name">Card</span><span class="amt">120.00</span>');
    // QR has 0 sales, 1 repayment (5000) -> QR 50.00 (no count badge)
    expect(byPaymentHtml).toContain('<span class="name">QR</span><span class="amt">50.00</span>');
    // Bank has 0 sales, 1 repayment (25000) -> Bank Transfer 250.00 (no count badge)
    expect(byPaymentHtml).toContain('<span class="name">Bank Transfer</span><span class="amt">250.00</span>');

    // Credit should NOT appear in BY PAYMENT because count = 0 and total = 0
    expect(byPaymentHtml).not.toContain("Credit");

    // Repayments section
    expect(html).toContain('<div class="h">CREDIT REPAYMENTS COLLECTED</div>');
    expect(html).toContain("Syarikat Megah (Bank Transfer)");
    expect(html).toContain("Ah Seng (QR)");
    expect(html).toContain("Tan Construction (Card)");
    expect(html).toContain("Uncle Lim (Cash)");

    expect(html).toContain("<span>TOTAL (RM)</span><span>458.00</span>");
    expect(html).toContain('<div class="count">1 sale(s)</div>');
  });

  it("Scenario 3: Credit sales isolation and mathematical integrity", () => {
    // 3 Cash sales and 2 Credit sales with overlapping items
    const orders: Order[] = [
      createTestOrder("Cash", [
        createTestLine(1, "Common Red Brick", 60, 10000), // 600
        createTestLine(2, "River Sand", 4500, 1000), // 4500
      ]),
      createTestOrder("Cash", [createTestLine(1, "Common Red Brick", 60, 5000)]), // 300
      createTestOrder("Credit", [
        createTestLine(1, "Common Red Brick", 60, 20000), // 1200
        createTestLine(3, "PVC Pipe", 1200, 2000), // 2400
      ], { contractorName: "Wong Contractor" }),
      createTestOrder("Credit", [createTestLine(2, "River Sand", 4500, 2000)], {
        contractorName: "Lee Builder",
      }), // 9000
    ];

    const html = renderDayReportHtml({
      storeName: "Yun Fook Trading",
      businessDate: "2026-10-24",
      orders,
    });

    const byItemIdx = html.indexOf('<div class="h">BY ITEM</div>');
    const byCreditIdx = html.indexOf('<div class="h">BY ITEM - CREDIT</div>');
    const byPaymentIdx = html.indexOf('<div class="h">BY PAYMENT</div>');

    expect(byItemIdx).toBeLessThan(byCreditIdx);
    expect(byCreditIdx).toBeLessThan(byPaymentIdx);

    const byItemSection = html.slice(byItemIdx, byCreditIdx);
    const byCreditSection = html.slice(byCreditIdx, byPaymentIdx);

    // BY ITEM should only have Cash lines:
    // Red Brick: 10000 + 5000 = 15000 milli = 15 pcs, amount 900 cents = 9.00
    expect(byItemSection).toContain('<span class="name">Common Red Brick</span>');
    expect(byItemSection).toContain('<span class="qty">15 pcs</span>');
    expect(byItemSection).toContain('<span class="amt">9.00</span>');
    // PVC Pipe was ONLY sold on Credit, so must NOT appear in BY ITEM
    expect(byItemSection).not.toContain("PVC Pipe");

    // BY ITEM - CREDIT should only have Credit lines:
    // Red Brick: 20000 milli = 20 pcs, 12.00
    expect(byCreditSection).toContain('<span class="name">Common Red Brick</span>');
    expect(byCreditSection).toContain('<span class="qty">20 pcs</span>');
    expect(byCreditSection).toContain('<span class="amt">12.00</span>');
    // PVC Pipe: 2000 milli = 2 pcs, 24.00
    expect(byCreditSection).toContain('<span class="name">PVC Pipe</span>');
    expect(byCreditSection).toContain('<span class="qty">2 pcs</span>');
    expect(byCreditSection).toContain('<span class="amt">24.00</span>');

    // Total: Cash (600 + 4500 + 300 = 5400) + Credit (1200 + 2400 + 9000 = 12600) = 18000 (180.00)
    expect(html).toContain("<span>TOTAL (RM)</span><span>180.00</span>");
    expect(html).toContain('<div class="count">4 sale(s)</div>');
  });

  it("Scenario 4: Voided orders correctly segregated and struck out", () => {
    const validOrder = createTestOrder("Cash", [createTestLine(1, "Tape", 500, 1000)]); // 500
    const voidedOrder = createTestOrder("Cash", [createTestLine(2, "Hammer", 2500, 1000)], {
      voidedAt: Date.now(),
    }); // 2500 voided

    const stats = computeStats([validOrder, voidedOrder], "today", []);
    expect(stats.count).toBe(1);
    expect(stats.totalCents).toBe(500);

    const html = renderDayReportHtml({
      storeName: "Yun Fook Trading",
      businessDate: "2026-10-24",
      orders: [validOrder, voidedOrder],
    });

    // Voided item must not appear in BY ITEM
    expect(html).not.toContain("Hammer");
    // BY PAYMENT must only reflect valid sales
    expect(html).toContain('<span class="name">Cash (1)</span><span class="amt">5.00</span>');
    // Voided row must appear with strike-through styling
    expect(html).toContain('<div class="row void"><span class="name">Voided: 1 sale(s)</span><span class="amt">25.00</span></div>');
  });

  it("Scenario 5: High volume sales across all 5 methods and 4 repayment methods", () => {
    const orders: Order[] = [];
    const methods: PaymentMethod[] = ["Cash", "Card", "QR", "Bank", "Credit"];

    for (let i = 0; i < 50; i++) {
      const method = methods[i % 5]!;
      orders.push(createTestOrder(method, [createTestLine(i + 1, `Item ${i + 1}`, 1000, 1000)]));
    }

    const repayments: Repayment[] = [];
    const repMethods: RepaymentMethod[] = ["Cash", "Card", "QR", "Bank"];
    for (let i = 0; i < 20; i++) {
      repayments.push(createTestRepayment(repMethods[i % 4]!, 2000, `Contractor ${i + 1}`));
    }

    const stats = computeStats(orders, "today", repayments);
    expect(stats.count).toBe(50);
    // 50 orders * 1000 = 50,000 cents
    // 20 repayments * 2000 = 40,000 cents
    // Total = 90,000 cents
    expect(stats.totalCents).toBe(90000);

    const html = renderDayReportHtml({
      storeName: "Yun Fook Trading",
      businessDate: "2026-10-24",
      orders,
      repayments,
    });

    expect(html).toContain("<span>TOTAL (RM)</span><span>900.00</span>");
    expect(html).toContain('<div class="count">50 sale(s)</div>');

    // All 5 methods present in BY PAYMENT
    for (const m of methods) {
      const label = m === "Bank" ? "Bank Transfer" : m;
      expect(html).toContain(`<span class="name">${label} (10)</span>`);
    }
  });
});

describe("Empirical Challenge Suite — Template Robustness, Escaping & CSS Formatting", () => {
  it("XSS Payloads in renderDayReportHtml are fully sanitized", () => {
    const maliciousOrder = createTestOrder("Cash", [
      createTestLine(1, '"><script>alert("xss-item")</script>', 1000),
    ]);
    const maliciousRepayment = createTestRepayment(
      "Bank",
      5000,
      '<img src=x onerror=alert("xss-contractor")>& "Co"',
    );

    const html = renderDayReportHtml({
      storeName: '<h1 id="vuln">Store</h1><script>alert(1)</script>',
      storeAddress: '<style>body{display:none}</style>Malicious Address',
      businessDate: '2026-10-24"><script>alert(2)</script>',
      orders: [maliciousOrder],
      repayments: [maliciousRepayment],
    });

    // Zero raw unescaped script tags
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain('<h1 id="vuln">');
    expect(html).not.toContain("<style>body{display:none}</style>");

    // Sanitized representations
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(&quot;xss-contractor&quot;)&gt;&amp; &quot;Co&quot;");
    expect(html).toContain("&quot;&gt;&lt;script&gt;alert(&quot;xss-item&quot;)&lt;/script&gt;");
  });

  it("CSS formatting & paper width adaptation for 80mm and 58mm", () => {
    const order = createTestOrder("Cash", [createTestLine(1, "Test Item", 1000)]);

    // 80mm default
    const html80 = renderDayReportHtml({
      storeName: "Test Store",
      businessDate: "2026-10-24",
      orders: [order],
      paperWidthMm: 80,
    });
    expect(html80).toContain("@page { size: 80mm auto; margin: 0; }");
    expect(html80).toContain("width: 72mm;");
    expect(html80).toContain("max-width: 72mm;");

    // 58mm narrow
    const html58 = renderDayReportHtml({
      storeName: "Test Store",
      businessDate: "2026-10-24",
      orders: [order],
      paperWidthMm: 58,
    });
    expect(html58).toContain("@page { size: 58mm auto; margin: 0; }");
    expect(html58).toContain("width: 50mm;");
    expect(html58).toContain("max-width: 50mm;");
  });

  it("Unbroken long item names & large amounts preserve layout without receipt truncation", () => {
    const longName = "A".repeat(150);
    const hugeAmountCents = 99999999; // RM 999,999.99
    const order = createTestOrder("Cash", [createTestLine(1, longName, hugeAmountCents)]);

    const html = renderDayReportHtml({
      storeName: "Test Store",
      businessDate: "2026-10-24",
      orders: [order],
    });

    // Contains CSS rules guaranteeing layout resilience against truncation
    expect(html).toContain("overflow-wrap: anywhere;");
    expect(html).toContain("grid-template-columns: minmax(0, 1fr) auto auto;");
    expect(html).toContain("white-space: nowrap; font-weight: 800; text-align: right; min-width: 16mm;");
    expect(html).toContain('<span class="amt">999999.99</span>');
  });

  it("Delivery order template has ☐ checkbox on both copies and sanitizes inputs", () => {
    const doData: DeliveryOrder = {
      companyId: 1,
      businessDate: "2026-10-24",
      doNumber: "DO-202610-0099",
      dateText: "24/10/2026",
      invNo: "B-202610-0099",
      storeName: "Yun Fook Trading",
      contractorName: "Chong Construction <script>alert(1)</script>",
      contractorTin: "TIN-12345",
      contractorAddress: "123 Site Road",
      contractorPhone: "012-3456789",
      siteAddress: "Building Plot 7",
      lorryPlate: "JXX 1234",
      driverName: "Ah Meng Driver",
      lines: [
        {
          itemNo: 1,
          name: "Reinforced Steel Bar 16mm",
          itemName: "Reinforced Steel Bar 16mm",
          unit: "pcs",
          qtyMilli: 100000,
          qtyText: "100 pcs",
          unitPriceText: "RM 45.00",
          amountText: "RM 4500.00",
        },
        {
          itemNo: 2,
          name: "Cement Bag 50kg",
          itemName: "Cement Bag 50kg",
          unit: "bag",
          qtyMilli: 50000,
          qtyText: "50 bags",
          unitPriceText: "RM 22.00",
          amountText: "RM 1100.00",
        },
      ],
      totalQtyMilli: 150000,
      totalQtyText: "150",
      subtotalText: "RM 5600.00",
      totalText: "RM 5600.00",
      showPriceOnDo: true,
      signatories: {
        issuedBy: "Store / Cashier",
        deliveredBy: "Ah Meng Driver",
        receivedBy: "Site Supervisor",
      },
    };

    const company: CompanyInfo = {
      name: "Yun Fook Trading",
      regNo: "227533-X",
      tel: "07-1234567",
      address: "Johor Bahru",
    };

    const html = renderDeliveryOrderHtml(doData, company);

    // Assert checkbox ☐ on line items
    expect(html).toContain("<td><strong>☐ Reinforced Steel Bar 16mm</strong></td>");
    expect(html).toContain("<td><strong>☐ Cement Bag 50kg</strong></td>");

    // Both Store Copy and Customer Copy have the 2 lines -> 4 checkboxes total
    const boxCount = (html.match(/☐/g) || []).length;
    expect(boxCount).toBe(4);

    // Zero unescaped script tag
    expect(html).not.toContain("<script>");
    expect(html).toContain("Chong Construction &lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("Receipt template strictly renders 6-line summary and suppresses Tax (0%) and Rounding", () => {
    const receipt = {
      invNo: "A-0001",
      dateText: "24/10/2026 15:30",
      method: "Cash" as PaymentMethod,
      lines: [
        {
          itemNo: 1,
          name: "Paint Roller 7 inch",
          qtyText: "2",
          unitPriceText: "RM 12.00",
          amountText: "RM 24.00",
        },
      ],
      totalQtyText: "2",
      subtotalText: "RM 24.00",
      discountText: "RM 0.00",
      totalText: "RM 24.00",
      paidText: "RM 50.00",
      changeText: "RM 26.00",
      footer: "Thank you",
      // Adversarially provide tax and rounding to ensure suppression
      taxText: "RM 0.00",
      roundingText: "RM 0.00",
    };

    const html = renderReceiptHtml(receipt as any);

    // Verify Tax (0%) and Rounding are NOT in the output
    expect(html).not.toContain("Tax (0%)");
    expect(html).not.toContain("Rounding");

    // Extract summary section
    const startIdx = html.indexOf('<div class="summary-section">');
    const endIdx = html.indexOf('</div>\n\n    <div class="terms">', startIdx);
    const summaryHtml = html.slice(startIdx, endIdx);

    // Verify exact 6 lines in order
    const expectedOrder = [
      "Total Qty",
      "Subtotal",
      "Disc",
      "TOTAL",
      "Paid: Cash",
      "Change",
    ];

    let lastIndex = -1;
    for (const label of expectedOrder) {
      const idx = summaryHtml.indexOf(label);
      expect(idx, `Expected ${label} in summary`).toBeGreaterThan(-1);
      expect(idx, `Expected ${label} to appear after previous summary line`).toBeGreaterThan(lastIndex);
      lastIndex = idx;
    }
  });
});
