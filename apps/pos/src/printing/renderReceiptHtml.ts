import { cleanCompanyRegNo, type Receipt } from "@yf/core";

// Render a Receipt into a standalone HTML document sized for an 80mm thermal
// roll. Printed via the OS print pipeline, so any driver-installed printer works
// (and a normal A4 printer too, for testing before the thermal unit arrives).

export const PAPER_WIDTH_MM = 80; // default; overridable per print via settings
const NON_PRINTABLE_EDGE_MM = 4;

/**
 * Thermal rolls are named by paper width, not printable width. Leave 4 mm on
 * each side so Windows drivers cannot clip the receipt at the print-head edge.
 */
export const printableWidthMm = (paperWidthMm: number): number =>
  Math.max(1, paperWidthMm - NON_PRINTABLE_EDGE_MM * 2);

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

// Drop the "RM " prefix from a money string ("RM 253.00" -> "253.00") so the
// line-item amount column shows bare, right-aligned numbers while preserving signs.
const amt = (s?: string): string => {
  if (s == null) return "";
  const str = String(s).trim();
  if (!str) return "";
  const isNegative = str.includes("-") || (str.startsWith("(") && str.endsWith(")"));
  const clean = str.replace(/[A-Za-z\s()\-]/g, "");
  if (!clean) return "";
  const num = parseFloat(clean.replace(/,/g, ""));
  if (isNegative && num > 0) {
    return esc(`-${clean}`);
  }
  return esc(clean);
};

export function renderReceiptHtml(r: Receipt, widthMm: number = PAPER_WIDTH_MM): string {
  const contentWidthMm = printableWidthMm(widthMm);

  const upperInvNo = (r.invNo || "").trim().toUpperCase();
  const isWalkIn = upperInvNo.startsWith("A-");
  const isContractorReceipt =
    !isWalkIn &&
    (upperInvNo.startsWith("B-") ||
      r.method === "Credit" ||
      Boolean(r.contractor || r.creditorName));

  const contractorName = (r.contractor?.name || r.creditorName || "").trim();
  const contractorTin = (r.contractor?.tin || "").trim();
  const contractorAddress = (r.contractor?.address || "").trim();
  const contractorPhone = (r.contractor?.phone || (r.contractor as any)?.tel || "").trim();

  const lines = r.lines ?? [];
  const rows = lines
    .map(
      (l) => `
      <div class="item">
        <div class="item-row">
          <span class="item-detail">
            <span class="item-name">${esc(l.name)}</span>
            ${l.discountText ? `<span class="item-discount">Diskaun: ${esc(l.discountText)}</span>` : ""}
          </span>
          <span class="item-qty">${esc(l.qtyText)}</span>
          <span class="item-up">${esc(l.unitPriceText)}</span>
          <span class="item-amount">${amt(l.amountText)}</span>
        </div>
      </div>`,
    )
    .join("");

  const totalQtyDisplay =
    r.totalQtyText ??
    (lines.length > 0
      ? String(
          lines.reduce((acc, l) => {
            const parsed = parseFloat(l.qtyText);
            return acc + (Number.isFinite(parsed) ? parsed : 1);
          }, 0),
        )
      : String(r.itemCount ?? 0));

  const subtotalDisplay = r.subtotalText || r.totalText;
  const discountDisplay = r.discountText || "RM 0.00";
  const taxDisplay = r.taxText || "RM 0.00";
  const roundingDisplay = r.roundingText || "RM 0.00";
  const totalDisplay = r.totalText;
  const paidDisplay = r.paidText || r.totalText;
  const changeDisplay = r.changeText || "RM 0.00";

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Receipt #${esc(r.invNo)}</title>
<style>
  @page { size: ${widthMm}mm auto; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    width: ${contentWidthMm}mm;
    max-width: ${contentWidthMm}mm;
    margin: 0 auto;
    font-family: Verdana, Tahoma, "DejaVu Sans", sans-serif;
    font-variant-numeric: tabular-nums;
    color: #000;
    line-height: 1.25;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .receipt { width: 100%; padding: 3mm 1mm 5mm; overflow: hidden; }
  .store-cn {
    text-align: center;
    font-size: 13pt;
    font-weight: 900;
    letter-spacing: 2px;
    margin-bottom: 0.5mm;
  }
  .store {
    text-align: center;
    font-size: 11pt;
    font-weight: 800;
    letter-spacing: 0.3px;
    text-transform: uppercase;
  }
  .reg-no {
    text-align: center;
    font-size: 7.5pt;
    font-weight: 700;
    margin-top: 0.5mm;
  }
  .address {
    text-align: center;
    font-size: 6.8pt;
    margin-top: 0.8mm;
    line-height: 1.3;
    color: #222;
  }
  .contact {
    text-align: center;
    font-size: 7pt;
    font-weight: 600;
    margin-top: 0.8mm;
  }
  .tax-box {
    text-align: center;
    font-size: 7.5pt;
    font-weight: 800;
    margin-top: 1.2mm;
    letter-spacing: 0.4px;
  }
  .meta-row {
    display: flex;
    justify-content: space-between;
    font-size: 7.5pt;
    font-weight: 700;
    margin-top: 1.5mm;
  }
  .doc-title-row {
    align-items: baseline;
    margin-top: 2mm;
  }
  .doc-title {
    font-size: 10pt;
    font-weight: 900;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    text-decoration: underline;
  }
  .doc-date {
    font-size: 7.5pt;
    font-weight: 700;
    text-align: right;
  }
  .bill-to {
    margin-top: 1.5mm;
    padding: 1.5mm;
    border: 1px solid #000;
    font-size: 7.2pt;
    line-height: 1.35;
    text-align: left;
  }
  .bill-to-title {
    font-size: 7.5pt;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    margin-bottom: 0.5mm;
  }
  .creditor {
    font-size: 8.5pt;
    font-weight: 800;
    margin-bottom: 0.5mm;
  }
  .bill-to-line {
    font-size: 7pt;
    color: #222;
  }
  .bill-to-address {
    font-size: 6.8pt;
    line-height: 1.25;
    white-space: pre-line;
    word-break: break-word;
  }
  .hr {
    border-top: 1px dashed #000;
    margin: 2mm 0;
  }
  .table-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 8mm 17mm 16mm;
    gap: 1mm;
    font-size: 6.8pt;
    font-weight: 700;
    letter-spacing: 0.3px;
    margin-bottom: 1.6mm;
    align-items: end;
  }
  .table-head .h-qty { text-align: right; }
  .table-head .h-up { text-align: right; }
  .table-head .h-amt { text-align: right; white-space: nowrap; }
  .item {
    margin-bottom: 1.8mm;
    font-size: 8.5pt;
    break-inside: avoid;
  }
  .item-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 8mm 17mm 16mm;
    gap: 1mm;
    align-items: baseline;
  }
  .item-detail {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.4mm;
  }
  .item-name {
    font-size: 7.2pt;
    font-weight: 700;
    line-height: 1.25;
    word-break: break-word;
    overflow-wrap: break-word;
  }
  .item-discount {
    color: #000;
    font-size: 6.5pt;
    font-weight: 700;
  }
  .item-qty {
    text-align: right;
    white-space: nowrap;
    font-size: 7.5pt;
    min-width: 0;
  }
  .item-up {
    text-align: right;
    font-size: 6.8pt;
    font-weight: 600;
    line-height: 1.2;
    word-break: break-word;
    overflow-wrap: break-word;
    min-width: 0;
  }
  .item-amount {
    font-weight: 800;
    white-space: nowrap;
    text-align: right;
    font-size: 7.5pt;
    min-width: 0;
  }
  .summary-section {
    margin-top: 0.5mm;
  }
  .sub-row {
    display: flex;
    justify-content: space-between;
    gap: 3mm;
    font-size: 7.5pt;
    font-weight: 700;
    margin-bottom: 0.8mm;
  }
  .discount-row {
    color: #000;
  }
  .total {
    display: flex;
    justify-content: space-between;
    gap: 3mm;
    font-size: 13pt;
    font-weight: 900;
    line-height: 1.15;
    margin-top: 1mm;
    margin-bottom: 1.2mm;
    border-top: 1px dashed #000;
    border-bottom: 1px dashed #000;
    padding: 1.2mm 0;
  }
  .pay {
    display: flex;
    justify-content: space-between;
    gap: 3mm;
    font-size: 7.5pt;
    margin-top: 1mm;
    margin-bottom: 0.8mm;
  }
  .pay-method { font-weight: 700; }
  .change-row {
    font-size: 7.5pt;
    font-weight: 700;
    margin-bottom: 1mm;
  }
  .bank-box {
    margin-top: 2.5mm;
    font-size: 6.8pt;
    line-height: 1.35;
    border-top: 1px dotted #444;
    padding-top: 1.5mm;
    text-align: center;
  }
  .bank-box .b-title { font-weight: 700; }
  .terms {
    margin-top: 2mm;
    font-size: 6.5pt;
    line-height: 1.3;
    text-align: center;
    color: #333;
  }
  .foot {
    text-align: center;
    font-size: 7.5pt;
    font-weight: 700;
    margin-top: 2.5mm;
  }
</style>
</head>
<body>
  <div class="receipt">
    ${r.storeNameCn ? `<div class="store-cn">${esc(r.storeNameCn)}</div>` : ""}
    <div class="store">${esc(r.storeName)}</div>
    ${r.regNo ? `<div class="reg-no">${esc(cleanCompanyRegNo(r.regNo))}</div>` : ""}
    ${r.storeAddress ? `<div class="address">${esc(r.storeAddress)}</div>` : ""}
    ${r.tel ? `<div class="contact">Tel / Fax: ${esc(r.tel)}</div>` : ""}
    ${r.tin ? `<div class="tax-box">TIN: ${esc(r.tin)}</div>` : ""}
    
    <div class="meta-row doc-title-row">
      <span class="doc-title">TAX INVOICE</span>
      <span class="doc-date">${esc(r.dateText)}</span>
    </div>
    <div class="meta-row">
      <span>Receipt #${esc(r.invNo)}</span>
      ${r.cashierName ? `<span>Cashier: ${esc(r.cashierName)}</span>` : ""}
    </div>

    ${isContractorReceipt ? `
    <div class="bill-to">
      <div class="bill-to-title">Bill To / Kepada:</div>
      ${contractorName ? `<div class="creditor">${esc(contractorName)}</div>` : ""}
      ${contractorTin ? `<div class="bill-to-line">TIN: ${esc(contractorTin)}</div>` : ""}
      ${contractorAddress ? `<div class="bill-to-line bill-to-address">${esc(contractorAddress)}</div>` : ""}
      ${contractorPhone ? `<div class="bill-to-line">Tel: ${esc(contractorPhone)}</div>` : ""}
    </div>` : ""}

    <div class="hr"></div>
    <div class="table-head">
      <span>ITEM</span>
      <span class="h-qty">QTY</span>
      <span class="h-up">U/P</span>
      <span class="h-amt">AMOUNT (RM)</span>
    </div>
    ${rows}
    <div class="hr"></div>
    <div class="summary-section">
      <div class="sub-row"><span>Total Qty</span><span>${esc(totalQtyDisplay)}</span></div>
      <div class="sub-row"><span>Subtotal</span><span>${esc(subtotalDisplay)}</span></div>
      <div class="sub-row discount-row"><span>Disc</span><span>${esc(discountDisplay)}</span></div>
      <div class="sub-row"><span>Tax (0%)</span><span>${esc(taxDisplay)}</span></div>
      <div class="sub-row"><span>Rounding</span><span>${esc(roundingDisplay)}</span></div>
      <div class="total"><span>TOTAL</span><span>${esc(totalDisplay)}</span></div>
      <div class="pay"><span class="pay-method">Paid: ${esc((r.method === "QR" ? "QR / Card" : r.method) || "Cash")}</span><span>${esc(paidDisplay)}</span></div>
      <div class="sub-row change-row"><span>Change</span><span>${esc(changeDisplay)}</span></div>
    </div>

    ${r.bankInfo ? `
    <div class="bank-box">
      <div class="b-title">Bank Account Details:</div>
      <div>${esc(r.bankInfo)}</div>
    </div>` : ""}

    <div class="terms">
      <div>- Goods sold are not returnable or exchanged.</div>
      <div>E. &amp; O. E.</div>
    </div>
    <div class="foot">${esc(r.footer)}</div>
  </div>
</body>
</html>`;
}
