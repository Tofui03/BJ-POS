import * as XLSX from "xlsx";
import {
  computeFinancialMetrics,
  lineDiscountCents,
  orderTotalDiscountCents,
  toQty,
  toRM,
  type FinancialMetrics,
  type Order,
  type OrderLine,
  type Repayment,
} from "@yf/core";

/**
 * Borneo Jasa v1 Close Day workbook (template v6).
 *   HQ Daily — one row per non-voided sale (with Subtotal, Discount, Amount)
 *   Invoice Items — one row per sold line (with Orig Price, Unit Price, Discount, Line Amount)
 */
export const DAILY_WORKBOOK_TEMPLATE_VERSION = 6;

export const HQ_DAILY_HEADERS = [
  "Name",
  "Date",
  "Inv No",
  "Pay Type",
  "Subtotal",
  "Discount",
  "Amount",
  "Credit",
  "Remarks",
] as const;

export const INVOICE_ITEMS_HEADERS = [
  "Inv No",
  "Item",
  "Spec",
  "Unit",
  "Qty",
  "Orig Price",
  "Unit Price",
  "Discount",
  "Line Amount",
  "Credit?",
] as const;

const validOrders = (orders: Order[]): Order[] =>
  [...orders].filter((order) => order.voidedAt == null).sort((a, b) => a.ts - b.ts);

/** Re-export domain discount calculations from @yf/core */
export { lineDiscountCents, orderTotalDiscountCents };

/** Split "Name — Spec" for the Invoice Items sheet; bare names leave Spec blank. */
export function splitNameSpec(name: string): { item: string; spec: string } {
  const idx = name.indexOf(" — ");
  if (idx >= 0) {
    return { item: name.slice(0, idx).trim(), spec: name.slice(idx + 3).trim() };
  }
  const dashIdx = name.indexOf(" - ");
  if (dashIdx >= 0) {
    return { item: name.slice(0, dashIdx).trim(), spec: name.slice(dashIdx + 3).trim() };
  }
  return { item: name.trim(), spec: "" };
}

/** Compute the canonical financial metrics aligned across all 4 surfaces */
export { computeFinancialMetrics };
export type { FinancialMetrics };

function setFormulaOrZero(
  sheet: XLSX.WorkSheet,
  cell: string,
  column: string,
  firstDataRow: number,
  dataRows: number,
  format = "0.00",
): void {
  sheet[cell] = dataRows > 0
    ? { t: "n", f: `SUM(${column}${firstDataRow}:${column}${firstDataRow + dataRows - 1})`, z: format }
    : { t: "n", v: 0, z: format };
}

function setNumberFormat(
  sheet: XLSX.WorkSheet,
  column: number,
  firstRow: number,
  lastRow: number,
  format: string,
): void {
  for (let row = firstRow; row <= lastRow; row += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ c: column, r: row })];
    if (cell) cell.z = format;
  }
}

/** Sheet 1 — one row per invoice or repayment (voids excluded). */
function hqDailySheet(orders: Order[], repayments: Repayment[] = []): XLSX.WorkSheet {
  const sales = validOrders(orders);
  const rows: (string | number)[][] = sales.map((order) => {
    const isCredit = order.method === "Credit";
    const totalDiscCents = orderTotalDiscountCents(order);
    const grossSubtotalCents = order.totalCents + totalDiscCents;
    const isRefund = order.refundOfOrderId != null || order.totalCents < 0;
    const noteParts: string[] = [];
    if (order.cashierName) noteParts.push(`Cashier: ${order.cashierName}`);
    if (isRefund) {
      noteParts.push(order.refundOfInvNo ? `Refund: Ref #${order.refundOfInvNo}` : "Refund");
    }
    return [
      isCredit ? (order.contractorName ?? "") : "",
      order.businessDate,
      order.invNo,
      order.method === "Bank" ? "Bank Transfer" : order.method,
      toRM(grossSubtotalCents),
      totalDiscCents > 0 ? toRM(totalDiscCents) : "",
      toRM(order.totalCents),
      isCredit ? toRM(order.totalCents) : "",
      noteParts.join(" | "),
    ];
  });

  const repRows: (string | number)[][] = repayments.map((r) => {
    const parts: string[] = [];
    if (r.cashierName) parts.push(`Cashier: ${r.cashierName}`);
    if (r.notes) parts.push(r.notes);
    return [
      r.contractorName ?? "Credit Repayment",
      r.businessDate,
      `RP-${r.id}`,
      r.method === "Bank" ? "Bank Transfer" : r.method,
      toRM(r.amountCents),
      "",
      toRM(r.amountCents),
      "",
      parts.length ? `Repayment: ${parts.join(" | ")}` : "Repayment",
    ];
  });

  const allRows = [...rows, ...repRows];
  const totalRow = allRows.length + 2;
  const sheet = XLSX.utils.aoa_to_sheet([
    [...HQ_DAILY_HEADERS],
    ...allRows,
    ["TOTAL", "", "", "", 0, 0, 0, 0, ""],
  ]);
  setFormulaOrZero(sheet, `E${totalRow}`, "E", 2, allRows.length);
  setFormulaOrZero(sheet, `F${totalRow}`, "F", 2, allRows.length);
  setFormulaOrZero(sheet, `G${totalRow}`, "G", 2, allRows.length);
  setFormulaOrZero(sheet, `H${totalRow}`, "H", 2, allRows.length);
  setNumberFormat(sheet, 4, 1, totalRow, "0.00");
  setNumberFormat(sheet, 5, 1, totalRow, "0.00");
  setNumberFormat(sheet, 6, 1, totalRow, "0.00");
  setNumberFormat(sheet, 7, 1, totalRow, "0.00");
  sheet["!cols"] = [
    { wch: 22 },
    { wch: 12 },
    { wch: 11 },
    { wch: 10 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 20 },
  ];
  sheet["!autofilter"] = { ref: `A1:I${Math.max(1, allRows.length + 1)}` };
  return sheet;
}

/** Sheet 2 — one row per sold line (voids excluded). */
function invoiceItemsSheet(orders: Order[]): XLSX.WorkSheet {
  const sales = validOrders(orders);
  const rows: (string | number)[][] = [];
  for (const order of sales) {
    const creditFlag = order.method === "Credit" ? "Y" : "";
    const isRefund = order.refundOfOrderId != null || order.totalCents < 0;
    const sign = isRefund ? -1 : 1;
    for (const line of order.items) {
      const displayName = line.customName?.trim() || line.name;
      const { item, spec } = splitNameSpec(displayName);
      const lineDiscCents = lineDiscountCents(line);
      const origUnitCents =
        line.origPriceCents != null && line.origPriceCents > line.priceCents
          ? line.origPriceCents
          : line.priceCents;
      rows.push([
        order.invNo,
        item,
        spec,
        line.unit,
        toQty(line.qtyMilli) * sign,
        toRM(origUnitCents),
        toRM(line.priceCents),
        lineDiscCents > 0 ? toRM(lineDiscCents) : "",
        toRM(line.amountCents) * sign,
        creditFlag,
      ]);
    }
  }
  const totalRow = rows.length + 2;
  const sheet = XLSX.utils.aoa_to_sheet([
    [...INVOICE_ITEMS_HEADERS],
    ...rows,
    ["TOTAL", "", "", "", "", "", "", 0, 0, ""],
  ]);
  setFormulaOrZero(sheet, `H${totalRow}`, "H", 2, rows.length);
  setFormulaOrZero(sheet, `I${totalRow}`, "I", 2, rows.length);
  setNumberFormat(sheet, 4, 1, Math.max(1, totalRow - 1), "0.###");
  setNumberFormat(sheet, 5, 1, totalRow, "0.00");
  setNumberFormat(sheet, 6, 1, totalRow, "0.00");
  setNumberFormat(sheet, 7, 1, totalRow, "0.00");
  setNumberFormat(sheet, 8, 1, totalRow, "0.00");
  sheet["!cols"] = [
    { wch: 11 },
    { wch: 22 },
    { wch: 18 },
    { wch: 8 },
    { wch: 8 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 8 },
  ];
  sheet["!autofilter"] = { ref: `A1:J${Math.max(1, rows.length + 1)}` };
  return sheet;
}

/** Build the stable, versioned daily workbook used by Export and Close Day. */
export function buildDailyWorkbook(orders: Order[], repayments: Repayment[] = []): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  workbook.Props = {
    Title: "Borneo Jasa daily sales",
    Subject: `HQ daily workbook template v${DAILY_WORKBOOK_TEMPLATE_VERSION}`,
    Author: "Borneo Jasa POS",
  };
  XLSX.utils.book_append_sheet(workbook, hqDailySheet(orders, repayments), "HQ Daily");
  XLSX.utils.book_append_sheet(workbook, invoiceItemsSheet(orders), "Invoice Items");
  return workbook;
}

/** The daily workbook as base64 (stored on the outbox row, uploaded by main). */
export function buildDailyExcelB64(orders: Order[], repayments: Repayment[] = []): string {
  return XLSX.write(buildDailyWorkbook(orders, repayments), {
    type: "base64",
    bookType: "xlsx",
  }) as string;
}

/** Download the same workbook from Chrome or Electron's renderer. */
export function downloadDailyExcel(base64: string, filename: string): void {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const url = URL.createObjectURL(
    new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function dailyReportSubject(storeName: string, businessDate: string, auto: boolean): string {
  return `${storeName} — Daily sales ${businessDate}${auto ? " (auto-closed)" : ""}`;
}

/** Plain-text note stored on the outbox row (Drive upload metadata). */
export function dailyReportBody(
  storeName: string,
  businessDate: string,
  auto: boolean,
): string {
  const lines: string[] = [
    `${storeName} — daily sales for ${businessDate}`,
    auto ? "(Closed automatically — the day was not closed at the till.)" : "",
    "",
    `Excel template: v${DAILY_WORKBOOK_TEMPLATE_VERSION}`,
    "Uploaded to the shop Google Drive folder.",
  ];
  return lines.filter((line) => line !== "").join("\n");
}

/** @deprecated use dailyReportSubject — kept for any leftover email UI strings */
export const dailyEmailSubject = dailyReportSubject;
/** @deprecated use dailyReportBody */
export const dailyEmailBody = (
  storeName: string,
  businessDate: string,
  _orders: Order[],
  auto: boolean,
): string => dailyReportBody(storeName, businessDate, auto);
