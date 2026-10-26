import type { CompanyInfo, ContractorMonthlyStatement } from "@yf/core";
import {
  cleanCompanyRegNo,
  STORE_NAME,
  STORE_NAME_CN,
  STORE_REG_NO,
  STORE_ADDRESS,
  STORE_TEL,
  STORE_EMAIL,
  STORE_TIN,
  STORE_BANKS,
} from "@yf/core";
import { escapeHtml } from "./escapeHtml";

export { escapeHtml };

function formatCents(cents: number): string {
  const isNegative = cents < 0;
  const abs = Math.abs(cents);
  const formatted = (abs / 100).toFixed(2);
  return isNegative ? `-RM ${formatted}` : `RM ${formatted}`;
}

const MONTH_NAMES = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

function formatStatementMonth(yearMonth: string): string {
  const parts = yearMonth.split("-");
  if (parts.length === 2) {
    const y = parts[0];
    const m = parseInt(parts[1]!, 10);
    if (m >= 1 && m <= 12) {
      return `${MONTH_NAMES[m - 1]} ${y}`;
    }
  }
  return yearMonth;
}

/**
 * Standard A4 Contractor Monthly Statement of Account HTML renderer.
 * Produces a full-page A4 commercial statement complying with Malaysian business standards:
 * - Company header with Borneo Jasa, SSM reg no (227533-X), TIN, contact details.
 * - Formal Bill-To section with Contractor Name, TIN, Address, and Phone.
 * - Invoices Ledger table (Date, Invoice No, Particulars, Amount).
 * - Payments Received Ledger table (Date, Receipt/Ref, Method, Amount).
 * - Financial Summary (Brought Forward, Total Charges, Total Payments, Net Movement, Closing Outstanding Balance).
 * - Dual Bank Remittance Notice (Maybank & Public Bank).
 * - Dual Commercial Signature Blocks (Prepared By & Received/Confirmed By).
 */
export function renderContractorStatementHtml(
  statement: ContractorMonthlyStatement,
  company?: CompanyInfo,
): string {
  const storeName = company?.name ?? STORE_NAME;
  const storeNameCn = company?.nameCn ?? STORE_NAME_CN;
  const rawRegNo = company?.regNo ?? STORE_REG_NO;
  const regNo = rawRegNo ? cleanCompanyRegNo(rawRegNo) : STORE_REG_NO;
  const tin = company?.tin ?? STORE_TIN;
  const tel = company?.tel ?? STORE_TEL;
  const email = company?.email ?? STORE_EMAIL;
  const address = company?.address ?? STORE_ADDRESS;
  const banks = company?.bankInfo ?? STORE_BANKS;

  const contractor = statement.contractor;
  const cName = contractor.name || "Contractor";
  const cTin = contractor.tin?.trim() || "—";
  const cAddress = contractor.address?.trim() || "—";
  const cPhone = contractor.phone?.trim() || "—";
  const accountRef = `CTR-${String(contractor.id).padStart(4, "0")}`;

  const monthLabel = formatStatementMonth(statement.yearMonth);

  const printDate = new Date();
  const printDateStr = `${String(printDate.getDate()).padStart(2, "0")}/${String(
    printDate.getMonth() + 1,
  ).padStart(2, "0")}/${printDate.getFullYear()}`;

  const creditLines = statement.creditLines ?? [];
  const repaymentLines = statement.repaymentLines ?? [];

  const broughtForward = statement.broughtForwardCents ?? 0;
  const monthCredits = statement.monthCreditsCents ?? 0;
  const monthRepayments = statement.monthRepaymentsCents ?? 0;
  const monthNet = statement.monthNetCents ?? (monthCredits - monthRepayments);
  const closingDebt = statement.closingDebtCents ?? (broughtForward + monthNet);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Statement of Account - ${escapeHtml(cName)} (${escapeHtml(statement.yearMonth)})</title>
<style>
  @page {
    size: A4 portrait;
    margin: 12mm 15mm;
  }
  * {
    box-sizing: border-box;
  }
  body {
    font-family: 'Nunito', 'Segoe UI', -apple-system, BlinkMacSystemFont, Arial, sans-serif;
    color: #111;
    margin: 0;
    padding: 0;
    font-size: 11px;
    line-height: 1.4;
    background: #fff;
  }
  @media print {
    body {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }

  .statement-container {
    width: 100%;
    max-width: 190mm;
    margin: 0 auto;
  }

  /* Header Section */
  .header-table {
    width: 100%;
    border-bottom: 2px solid #000;
    padding-bottom: 8px;
    margin-bottom: 12px;
  }
  .company-title {
    font-size: 17px;
    font-weight: 900;
    color: #000;
    letter-spacing: 0.3px;
  }
  .company-cn {
    font-size: 13px;
    font-weight: 700;
    margin-left: 6px;
    color: #222;
  }
  .company-meta {
    font-size: 10px;
    color: #333;
    margin-top: 2px;
  }
  .statement-title-box {
    text-align: right;
  }
  .statement-title {
    font-size: 17px;
    font-weight: 900;
    color: #000;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .statement-subtitle {
    font-size: 10px;
    font-weight: 700;
    color: #555;
  }
  .statement-period {
    font-size: 13px;
    font-weight: 800;
    color: #000;
    margin-top: 4px;
  }

  /* Bill-To & Info Box */
  .meta-grid {
    display: flex;
    justify-content: space-between;
    margin-bottom: 14px;
    gap: 16px;
  }
  .bill-to-card {
    flex: 1.2;
    border: 1px solid #000;
    padding: 8px 12px;
    background: #fafafa;
  }
  .account-info-card {
    flex: 0.8;
    border: 1px solid #000;
    padding: 8px 12px;
    background: #fafafa;
  }
  .section-label {
    font-size: 9.5px;
    font-weight: 800;
    text-transform: uppercase;
    color: #444;
    border-bottom: 1px solid #ddd;
    padding-bottom: 3px;
    margin-bottom: 6px;
  }
  .contractor-name {
    font-size: 14px;
    font-weight: 800;
    color: #000;
  }
  .meta-line {
    font-size: 10.5px;
    color: #222;
    margin-top: 2px;
  }

  /* Tables */
  .table-title {
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
    color: #000;
    margin: 12px 0 4px 0;
  }
  table.ledger-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 8px;
    page-break-inside: auto;
  }
  table.ledger-table thead {
    display: table-header-group;
  }
  table.ledger-table th {
    background: #e5e7eb;
    border: 1px solid #9ca3af;
    padding: 5px 8px;
    font-size: 10px;
    font-weight: 800;
    text-align: left;
    color: #000;
  }
  table.ledger-table th.num-col {
    text-align: right;
  }
  table.ledger-table td {
    border: 1px solid #d1d5db;
    padding: 5px 8px;
    font-size: 10.5px;
    color: #111;
  }
  table.ledger-table td.num-col {
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-weight: 700;
  }
  table.ledger-table tr {
    page-break-inside: avoid;
  }
  table.ledger-table tr.total-row td {
    background: #f3f4f6;
    font-weight: 800;
    border-top: 1.5px solid #000;
  }

  /* Summary Section */
  .summary-wrap {
    display: flex;
    justify-content: flex-end;
    margin: 14px 0;
    page-break-inside: avoid;
  }
  .summary-card {
    width: 320px;
    border: 1.5px solid #000;
    background: #fff;
  }
  .summary-row {
    display: flex;
    justify-content: space-between;
    padding: 5px 12px;
    border-bottom: 1px solid #e5e7eb;
    font-size: 11px;
  }
  .summary-row.bold {
    font-weight: 700;
  }
  .summary-row.total-due {
    background: #f8fafc;
    border-top: 2px solid #000;
    border-bottom: none;
    padding: 8px 12px;
    font-size: 13px;
    font-weight: 900;
  }

  /* Remittance Note */
  .remittance-card {
    border: 1px dashed #666;
    padding: 8px 12px;
    margin: 12px 0;
    background: #fcfcfc;
    font-size: 10px;
    color: #222;
    page-break-inside: avoid;
  }
  .remittance-title {
    font-weight: 800;
    text-transform: uppercase;
    margin-bottom: 2px;
  }

  /* Signatures */
  .signature-grid {
    display: flex;
    justify-content: space-between;
    gap: 40px;
    margin-top: 24px;
    page-break-inside: avoid;
  }
  .signature-box {
    flex: 1;
    border-top: 1px solid #000;
    padding-top: 6px;
    font-size: 10px;
    color: #333;
  }
  .signature-space {
    height: 48px;
  }
  .signature-role {
    font-weight: 800;
    color: #000;
  }
</style>
</head>
<body>
<div class="statement-container">
  <!-- Header Table -->
  <table class="header-table" cellpadding="0" cellspacing="0">
    <tr>
      <td style="vertical-align: top;">
        <span class="company-title">${escapeHtml(storeName)}</span>
        ${storeNameCn ? `<span class="company-cn">${escapeHtml(storeNameCn)}</span>` : ""}
        <div class="company-meta">Company Reg No: <strong>${escapeHtml(regNo)}</strong> | LHDN TIN: <strong>${escapeHtml(tin)}</strong></div>
        <div class="company-meta">${escapeHtml(address)}</div>
        <div class="company-meta">Tel: ${escapeHtml(tel)} | Email: ${escapeHtml(email)}</div>
      </td>
      <td class="statement-title-box" style="vertical-align: top;">
        <div class="statement-title">Statement of Account</div>
        <div class="statement-subtitle">PENYATA KIRA-KIRA BULANAN</div>
        <div class="statement-period">${escapeHtml(monthLabel)}</div>
      </td>
    </tr>
  </table>

  <!-- Meta Grid: Bill To & Statement Info -->
  <div class="meta-grid">
    <div class="bill-to-card">
      <div class="section-label">Bill To / Kepada:</div>
      <div class="contractor-name">${escapeHtml(cName)}</div>
      <div class="meta-line"><strong>TIN:</strong> ${escapeHtml(cTin)}</div>
      <div class="meta-line"><strong>Address:</strong> ${escapeHtml(cAddress)}</div>
      <div class="meta-line"><strong>Tel:</strong> ${escapeHtml(cPhone)}</div>
    </div>
    <div class="account-info-card">
      <div class="section-label">Account Details / Butiran Akaun:</div>
      <div class="meta-line"><strong>Account No:</strong> ${escapeHtml(accountRef)}</div>
      <div class="meta-line"><strong>Statement Date:</strong> ${escapeHtml(statement.yearMonth)}</div>
      <div class="meta-line"><strong>Date Printed:</strong> ${escapeHtml(printDateStr)}</div>
      <div class="meta-line"><strong>Payment Terms:</strong> 30 Days / 30 Hari</div>
    </div>
  </div>

  <!-- Table 1: Invoices & Credit Purchases -->
  <div class="table-title">1. Credit Invoices & Charges / Invois & Pembelian Kredit</div>
  <table class="ledger-table">
    <thead>
      <tr>
        <th style="width: 14%;">Date</th>
        <th style="width: 18%;">Invoice No</th>
        <th style="width: 48%;">Particulars / Description</th>
        <th style="width: 20%;" class="num-col">Amount (RM)</th>
      </tr>
    </thead>
    <tbody>
      ${
        creditLines.length === 0
          ? `<tr><td colspan="4" style="text-align: center; color: #666; padding: 10px;">No credit purchases recorded in this month / Tiada pembelian kredit direkodkan bulan ini.</td></tr>`
          : creditLines
              .map(
                (l) => `<tr>
        <td>${escapeHtml(l.date)}</td>
        <td style="font-weight: 700;">${escapeHtml(l.invoiceNo || (l as any).invNo)}</td>
        <td>${escapeHtml(l.description)}</td>
        <td class="num-col">${formatCents(l.amountCents)}</td>
      </tr>`,
              )
              .join("")
      }
      <tr class="total-row">
        <td colspan="3" style="text-align: right; padding-right: 12px;">Total Month Charges / Jumlah Belian Bulan Ini:</td>
        <td class="num-col">${formatCents(monthCredits)}</td>
      </tr>
    </tbody>
  </table>

  <!-- Table 2: Payments Received -->
  <div class="table-title">2. Payments Received / Bayaran Diterima</div>
  <table class="ledger-table">
    <thead>
      <tr>
        <th style="width: 14%;">Date</th>
        <th style="width: 24%;">Receipt / Ref No</th>
        <th style="width: 42%;">Payment Method & Notes</th>
        <th style="width: 20%;" class="num-col">Amount (RM)</th>
      </tr>
    </thead>
    <tbody>
      ${
        repaymentLines.length === 0
          ? `<tr><td colspan="4" style="text-align: center; color: #666; padding: 10px;">No repayments recorded in this month / Tiada bayaran direkodkan bulan ini.</td></tr>`
          : repaymentLines
              .map((r) => {
                const methodNote = [
                  r.method,
                  r.cashierName ? `Cashier: ${r.cashierName}` : null,
                  r.notes ? r.notes : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return `<tr>
        <td>${escapeHtml(r.date)}</td>
        <td style="font-weight: 700;">${escapeHtml(r.receiptNo || (r as any).ref || `RP-${r.id}`)}</td>
        <td>${escapeHtml(methodNote)}</td>
        <td class="num-col">${formatCents(r.amountCents)}</td>
      </tr>`;
              })
              .join("")
      }
      <tr class="total-row">
        <td colspan="3" style="text-align: right; padding-right: 12px;">Total Month Payments / Jumlah Bayaran Bulan Ini:</td>
        <td class="num-col">${formatCents(monthRepayments)}</td>
      </tr>
    </tbody>
  </table>

  <!-- Financial Summary Box -->
  <div class="summary-wrap">
    <div class="summary-card">
      <div class="summary-row">
        <span>Brought Forward Balance / Baki Bawa Hadapan:</span>
        <span style="font-weight: 700;">${formatCents(broughtForward)}</span>
      </div>
      <div class="summary-row">
        <span>Add: Total Charges / Tambah: Belian Bulan Ini:</span>
        <span style="font-weight: 700;">+${formatCents(monthCredits)}</span>
      </div>
      <div class="summary-row">
        <span>Less: Total Payments / Tolak: Bayaran Bulan Ini:</span>
        <span style="font-weight: 700;">-${formatCents(monthRepayments)}</span>
      </div>
      <div class="summary-row bold" style="background: #f9fafb;">
        <span>Net Movement / Pergerakan Bersih Bulan Ini:</span>
        <span>${formatCents(monthNet)}</span>
      </div>
      <div class="summary-row total-due">
        <span>CLOSING BALANCE DUE / BAKI AKHIR:</span>
        <span>${formatCents(closingDebt)}</span>
      </div>
    </div>
  </div>

  <!-- Payment Remittance Notice -->
  <div class="remittance-card">
    <div class="remittance-title">Remittance Instructions / Arahan Bayaran:</div>
    <div>Please remit payment to: <strong>${escapeHtml(banks)}</strong> (${escapeHtml(storeName)}).</div>
    <div>Kindly quote contractor name <strong>"${escapeHtml(cName)}"</strong> or Account No <strong>"${escapeHtml(accountRef)}"</strong> as payment reference.</div>
  </div>

  <!-- Dual Signature Blocks -->
  <div class="signature-grid">
    <div class="signature-box">
      <div class="signature-space"></div>
      <div class="signature-role">PREPARED BY / DISEDIAKAN OLEH</div>
      <div>Authorised Signature &amp; Company Chop</div>
      <div style="margin-top: 4px;">Date: ________________________</div>
    </div>
    <div class="signature-box">
      <div class="signature-space"></div>
      <div class="signature-role">RECEIVED &amp; CONFIRMED BY / DISAHKAN OLEH</div>
      <div>Customer Signature, Full Name &amp; Chop</div>
      <div style="margin-top: 4px;">Date: ________________________</div>
    </div>
  </div>
</div>
</body>
</html>`;
}
