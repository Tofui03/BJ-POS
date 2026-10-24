import {
  aggregateItemSales,
  computeStats,
  fmtMoney,
  fmtQtyUnit,
  PAYMENT_METHODS,
  type Order,
  type Repayment,
} from "@yf/core";
import { printableWidthMm } from "./renderReceiptHtml";

// The paper copy of the daily sales report, printed on the roll at Close Day —
// same layout family as the receipt (renderReceiptHtml.ts).
//
// Credit sales are money owed rather than money taken, so their items are split
// out of BY ITEM into their own BY ITEM - CREDIT section. Both sections are part
// of the day's trade: BY ITEM + BY ITEM - CREDIT = BY PAYMENT = TOTAL.

export const escapeHtml = (s?: unknown): string => {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

const esc = escapeHtml;

// Bare right-aligned numbers in the amount column ("253.00", no "RM ").
const rm = (cents: number): string => fmtMoney(cents, "").trim();

export function renderDayReportHtml(opts: {
  storeName: string;
  storeAddress?: string;
  businessDate: string;
  orders: Order[];
  repayments?: Repayment[];
  paperWidthMm?: number;
}): string {
  const width = opts.paperWidthMm ?? 80;
  const contentWidth = printableWidthMm(width);
  const voided = opts.orders.filter((o) => o.voidedAt != null);

  // Only the item breakdown is split by credit; the totals cover the whole day.
  const paidOrders = opts.orders.filter((o) => o.method !== "Credit");
  const creditOrders = opts.orders.filter((o) => o.method === "Credit");
  const stats = computeStats(opts.orders, "today", opts.repayments ?? []);
  const sales = aggregateItemSales(paidOrders);
  const creditSales = aggregateItemSales(creditOrders);

  const itemRow = (s: (typeof sales)[number]): string => `
      <div class="row">
        <span class="name">${esc(s.name)}</span>
        <span class="qty">${esc(fmtQtyUnit(s.qtyMilli, s.unit))}</span>
        <span class="amt">${esc(rm(s.amountCents))}</span>
      </div>`;

  const itemRows = sales.map(itemRow).join("");

  // Same per-item shape as BY ITEM, but for what left the shop on the book.
  // No subtotal here — BY PAYMENT's Credit line already carries that number.
  const creditSection = creditSales.length
    ? `<div class="hr"></div>
    <div class="h">BY ITEM - CREDIT</div>
    ${creditSales.map(itemRow).join("")}`
    : "";

  const repaymentSection = opts.repayments && opts.repayments.length
    ? `<div class="hr"></div>
    <div class="h">CREDIT REPAYMENTS COLLECTED</div>
    ${opts.repayments
      .map(
        (r) => `
      <div class="row">
        <span class="name">${esc(r.contractorName || "Credit Repayment")} (${r.method === "QR" ? "QR / Card" : r.method})</span>
        <span class="qty"></span>
        <span class="amt">${esc(rm(r.amountCents))}</span>
      </div>`,
      )
      .join("")}`
    : "";

  const methodRows = PAYMENT_METHODS.map((m) => {
    const b = stats.byMethod[m];
    if (!b.count && !b.totalCents) return "";
    const countLabel = b.count ? ` (${b.count})` : "";
    const methodLabel = m === "QR" ? "QR / Card" : m;
    return `<div class="row"><span class="name">${methodLabel}${countLabel}</span><span class="amt">${esc(rm(b.totalCents))}</span></div>`;
  }).join("");

  const voidRow = voided.length
    ? `<div class="row void"><span class="name">Voided: ${voided.length} sale(s)</span><span class="amt">${esc(
        rm(voided.reduce((a, o) => a + o.totalCents, 0)),
      )}</span></div>`
    : "";

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Daily report ${esc(opts.businessDate)}</title>
<style>
  @page { size: ${width}mm auto; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    width: ${contentWidth}mm;
    max-width: ${contentWidth}mm;
    margin-left: 6mm;
    font-family: Verdana, Tahoma, "DejaVu Sans", sans-serif;
    font-variant-numeric: tabular-nums;
    color: #000;
    line-height: 1.25;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .report { width: 100%; padding: 3mm 3mm 6mm; overflow: hidden; }
  .store { text-align: center; font-size: 12pt; font-weight: 800; text-transform: uppercase; }
  .meta { text-align: center; font-size: 8pt; margin-top: 1mm; }
  .hr { border-top: 1px dashed #000; margin: 2.2mm 0; }
  .h { font-size: 8pt; font-weight: 800; letter-spacing: 0.5px; margin-bottom: 1.4mm; }
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 1.5mm;
    font-size: 8.5pt;
    margin-bottom: 1.4mm;
    align-items: baseline;
  }
  .row .name { font-weight: 800; overflow-wrap: anywhere; }
  .row .qty { white-space: nowrap; font-size: 7.5pt; color: #333; }
  .row .amt { white-space: nowrap; font-weight: 800; text-align: right; min-width: 16mm; }
  .row.void .name, .row.void .amt { font-weight: 400; text-decoration: line-through; }
  .total {
    display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 3mm;
    font-size: 13pt; font-weight: 900; margin-top: 1mm;
  }
  .count { text-align: center; font-size: 7.5pt; margin-top: 2.5mm; }
</style>
</head>
<body>
  <div class="report">
    <div class="store">${esc(opts.storeName)}</div>
    ${opts.storeAddress ? `<div class="meta">${esc(opts.storeAddress)}</div>` : ""}
    <div class="meta">DAILY SALES REPORT</div>
    <div class="meta">${esc(opts.businessDate)}</div>
    <div class="hr"></div>
    <div class="h">BY ITEM</div>
    ${itemRows || '<div class="meta">No sales.</div>'}
    ${creditSection}
    ${repaymentSection}
    <div class="hr"></div>
    <div class="h">BY PAYMENT</div>
    ${methodRows}
    ${voidRow}
    <div class="hr"></div>
    <div class="total"><span>TOTAL (RM)</span><span>${esc(rm(stats.totalCents))}</span></div>
    <div class="count">${stats.count} sale(s)</div>
  </div>
</body>
</html>`;
}
