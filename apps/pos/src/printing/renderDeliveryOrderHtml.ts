import type { CompanyInfo, DeliveryOrder } from "@yf/core";
import { cleanCompanyRegNo } from "@yf/core";

export function escapeHtml(str: unknown): string {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Standard A4 Dual-Copy Delivery Order HTML renderer.
 * Produces a printable single-sheet A4 document with two identical half-page copies:
 * - Top half: Store Copy / Office Copy ("SALINAN KEDAI / STORE COPY")
 * - Middle: Dashed tear / cut line ("--- GUNTING DI SINI / CUT HERE ---")
 * - Bottom half: Customer Copy / Contractor Copy ("SALINAN PELANGGAN / CUSTOMER COPY")
 *
 * Each copy contains:
 * - Clean company header with registration number (e.g. "(227533-X)") and no obsolete MSIC.
 * - Transport and delivery metadata (DO number, invoice ref, date, contractor bill-to, site address, lorry plate, driver).
 * - Items table respecting the `showPriceOnDo` toggle:
 *     - If `showPriceOnDo === true`: columns NO | ITEM DESCRIPTION | QTY | U/P (RM) | AMOUNT (RM), with Subtotal and Total RM.
 *     - If `showPriceOnDo === false`: columns NO | ITEM DESCRIPTION | QTY, completely suppressing all monetary amounts,
 *       unit prices, line amounts, subtotals, and total RM.
 * - Triple signature blocks on EACH copy:
 *     1. ISSUED BY (Store)
 *     2. DELIVERED BY (Driver)
 *     3. RECEIVED BY (Site Supervisor with Full Name, IC No, Date, and Company Chop)
 */
export function renderDeliveryOrderHtml(
  d: DeliveryOrder,
  company?: CompanyInfo,
): string {
  const storeName = company?.name ?? d.storeName ?? "";
  const storeNameCn = company?.nameCn ?? d.storeNameCn;
  const rawRegNo = company?.regNo ?? d.regNo;
  const regNo = rawRegNo ? cleanCompanyRegNo(rawRegNo) : undefined;
  const tel = company?.tel ?? d.tel;
  const address = company?.address ?? d.storeAddress;
  const email = company?.email ?? d.email;

  const contactParts: string[] = [];
  if (regNo) contactParts.push(`Reg No: ${escapeHtml(regNo)}`);
  if (tel) contactParts.push(`Tel: ${escapeHtml(tel)}`);
  if (email) contactParts.push(`Email: ${escapeHtml(email)}`);
  const contactLine = contactParts.length > 0
    ? `<div style="font-size: 10px; color: #333;">${contactParts.join(" | ")}</div>`
    : "";

  const addressLine = address
    ? `<div style="font-size: 10px; color: #444;">${escapeHtml(address)}</div>`
    : "";

  const storeNameCnDisplay = storeNameCn
    ? `<span style="font-size: 12px; font-weight: normal; margin-left: 6px;">${escapeHtml(storeNameCn)}</span>`
    : "";

  const renderCopy = (copyTitle: string) => {
    const priceHeaders = d.showPriceOnDo
      ? '<th style="width: 15%; text-align: right;">U/P (RM)</th><th style="width: 18%; text-align: right;">AMOUNT (RM)</th>'
      : "";

    const rows = (d.lines || [])
      .map((l) => {
        const displayName = l.name || l.itemName;
        const priceCells = d.showPriceOnDo
          ? `<td style="text-align: right;">${l.unitPriceText ? escapeHtml(l.unitPriceText.replace("RM ", "")) : ""}</td>
             <td style="text-align: right;">${l.amountText ? escapeHtml(l.amountText.replace("RM ", "")) : ""}</td>`
          : "";
        return `
        <tr>
          <td style="text-align: center;">${l.itemNo}</td>
          <td><strong>${escapeHtml(displayName)}</strong></td>
          <td style="text-align: right;">${escapeHtml(l.qtyText)}</td>
          ${priceCells}
        </tr>`;
      })
      .join("");

    const totalsSection = d.showPriceOnDo
      ? `
      <div style="display: flex; justify-content: flex-end; margin-top: 6px;">
        <table style="width: 40%; font-size: 11px;">
          <tr><td>Total Qty:</td><td style="text-align: right;">${escapeHtml(d.totalQtyText)}</td></tr>
          <tr><td>Subtotal:</td><td style="text-align: right;">${escapeHtml(d.subtotalText ?? "")}</td></tr>
          <tr style="font-weight: bold; border-top: 1px solid #000;">
            <td>TOTAL:</td><td style="text-align: right;">${escapeHtml(d.totalText ?? "")}</td>
          </tr>
        </table>
      </div>`
      : `<div style="font-size: 11px; margin-top: 4px;"><strong>Total Qty:</strong> ${escapeHtml(d.totalQtyText)}</div>`;

    const issuedByName = d.signatories?.issuedBy ?? "Store / Cashier";
    const rawDriver = d.driverName?.trim() || d.signatories?.deliveredBy?.trim();
    const deliveredByName = rawDriver && rawDriver !== "Driver" ? rawDriver : (d.driverName?.trim() || "");

    return `
    <div class="do-half" style="box-sizing: border-box; height: 138mm; padding: 6mm 8mm; position: relative;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #000; padding-bottom: 4px;">
        <div>
          <h2 style="margin: 0; font-size: 16px; font-weight: bold; text-transform: uppercase;">${escapeHtml(storeName)}${storeNameCnDisplay}</h2>
          ${contactLine}
          ${addressLine}
        </div>
        <div style="text-align: right;">
          <h1 style="margin: 0; font-size: 18px; font-weight: 800; letter-spacing: 1px;">DELIVERY ORDER</h1>
          <div style="font-size: 11px; font-weight: bold; color: #d00;">[ ${copyTitle} ]</div>
          <div style="font-size: 11px;"><strong>DO No:</strong> ${escapeHtml(d.doNumber)}</div>
          <div style="font-size: 11px;"><strong>Date:</strong> ${escapeHtml(d.dateText)}</div>
          <div style="font-size: 11px;"><strong>Invoice No:</strong> ${escapeHtml(d.invNo)}</div>
        </div>
      </div>

      <div style="display: flex; justify-content: space-between; margin: 6px 0; font-size: 11px; background: #fafafa; padding: 4px 6px; border: 1px solid #eee;">
        <div style="width: 58%;">
          <div><strong>Contractor:</strong> ${escapeHtml(d.contractorName ?? "Walk-in Customer")}</div>
          ${d.contractorTin ? `<div><strong>TIN:</strong> ${escapeHtml(d.contractorTin)}</div>` : ""}
          ${d.contractorAddress ? `<div><strong>Address:</strong> ${escapeHtml(d.contractorAddress)}</div>` : ""}
          ${d.contractorPhone ? `<div><strong>Tel:</strong> ${escapeHtml(d.contractorPhone)}</div>` : ""}
          <div><strong>Site Address:</strong> ${escapeHtml(d.siteAddress || "-")}</div>
        </div>
        <div style="width: 38%;">
          <div><strong>Lorry Plate:</strong> ${escapeHtml(d.lorryPlate || "-")}</div>
          <div><strong>Driver:</strong> ${escapeHtml(d.driverName || "-")}</div>
          ${d.contractorPo ? `<div><strong>PO No:</strong> ${escapeHtml(d.contractorPo)}</div>` : ""}
        </div>
      </div>

      <table style="width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 4px;">
        <thead>
          <tr style="border-top: 1px solid #000; border-bottom: 1px solid #000; background: #f0f0f0;">
            <th style="width: 6%; text-align: center;">NO</th>
            <th style="text-align: left;">ITEM DESCRIPTION</th>
            <th style="width: 16%; text-align: right;">QTY</th>
            ${priceHeaders}
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>

      ${totalsSection}

      <!-- Triple Signature Blocks -->
      <div style="display: flex; justify-content: space-between; margin-top: 10px; padding-top: 4px; font-size: 10px;">
        <div style="width: 30%; border: 1px solid #ccc; padding: 4px; height: 26mm; display: flex; flex-direction: column; justify-content: space-between;">
          <div style="font-weight: bold; border-bottom: 1px dashed #ccc; padding-bottom: 2px;">ISSUED BY (Store)</div>
          <div style="font-size: 9px; color: #555;">Name: ${escapeHtml(issuedByName)}</div>
          <div style="border-top: 1px dotted #888; padding-top: 2px; text-align: center;">Authorised Signature</div>
        </div>
        <div style="width: 30%; border: 1px solid #ccc; padding: 4px; height: 26mm; display: flex; flex-direction: column; justify-content: space-between;">
          <div style="font-weight: bold; border-bottom: 1px dashed #ccc; padding-bottom: 2px;">DELIVERED BY (Driver)</div>
          <div style="font-size: 9px; color: #555;">${deliveredByName ? `Driver: ${escapeHtml(deliveredByName)}` : "Driver: ____________________"}</div>
          <div style="border-top: 1px dotted #888; padding-top: 2px; text-align: center;">Driver Signature</div>
        </div>
        <div style="width: 36%; border: 1px solid #000; padding: 4px; height: 26mm; display: flex; flex-direction: column; justify-content: space-between;">
          <div style="font-weight: bold; border-bottom: 1px dashed #000; padding-bottom: 2px;">RECEIVED BY (Site Supervisor)</div>
          <div style="font-size: 9px;">Name: ____________________ IC: ______________</div>
          <div style="font-size: 9px;">Date: ___________ <span style="display: inline-block; border: 1px solid #999; padding: 1px 4px; margin-left: 4px;">Company Chop</span></div>
          <div style="border-top: 1px dotted #888; padding-top: 2px; text-align: center;">Recipient Signature & Stamp</div>
        </div>
      </div>
    </div>`;
  };

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Delivery Order - ${escapeHtml(d.doNumber)}</title>
  <style>
    @page { size: A4 portrait; margin: 8mm 10mm; }
    body { font-family: 'Nunito', 'Segoe UI', Arial, sans-serif; margin: 0; padding: 0; color: #000; }
    .cut-line {
      border-top: 1px dashed #999;
      text-align: center;
      margin: 2mm 0;
      position: relative;
    }
    .cut-line::after {
      content: '✂ --- GUNTING DI SINI / CUT HERE (TEAR OR CUT HERE: STORE COPY ABOVE — CUSTOMER COPY BELOW) --- ✂';
      position: absolute;
      top: -7px;
      left: 10%;
      background: #fff;
      padding: 0 8px;
      font-size: 9px;
      color: #777;
      letter-spacing: 1px;
    }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  ${renderCopy("STORE COPY / SALINAN KEDAI")}
  <div class="cut-line"></div>
  ${renderCopy("CUSTOMER COPY / SALINAN PELANGGAN")}
</body>
</html>`;
}
