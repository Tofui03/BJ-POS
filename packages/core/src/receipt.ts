import type { Order, PaymentMethod } from "./types.js";
import { fmtMoney, fmtQty, fmtQtySold, unitLabel } from "./money.js";
import {
  lineDiscountCents,
  orderGrossSubtotalCents,
  orderTotalDiscountCents,
} from "./orders.js";
import {
  STORE_BANKS,
  STORE_EMAIL,
  STORE_MSIC,
  STORE_NAME_CN,
  STORE_REG_NO,
  STORE_TEL,
  STORE_TIN,
} from "./hardware-catalog.js";

// A device-agnostic receipt model. buildReceipt() turns a persisted Order into
// ready-to-render text; concrete printers (HTML/PDF now, ESC/POS later) consume
// this shape, so swapping hardware never touches pricing or the domain.

export interface ReceiptLine {
  name: string;
  qtyText: string; // e.g. "1.5"
  unitPriceText: string; // e.g. "RM 25.00/kg" or "RM 24.00 → RM 23.00/bag"
  discountText?: string; // e.g. "Discount -RM 2.00"
  amountText: string; // e.g. "RM 37.50"
}

export interface ReceiptContractor {
  name: string;
  tin?: string;
  address?: string;
  phone?: string;
}

export interface Receipt {
  storeName: string;
  storeNameCn?: string;
  storeAddress?: string;
  regNo?: string;
  tin?: string;
  msic?: string;
  tel?: string;
  email?: string;
  bankInfo?: string;
  /** The customer-facing invoice number, e.g. "A-0001" or "B-0001". */
  invNo: string;
  dateText: string;
  method: PaymentMethod;
  /** Set for Credit sales: the contractor the order is owed by. */
  creditorName?: string;
  contractor?: ReceiptContractor;
  itemCount: number;
  totalQtyText?: string;
  lines: ReceiptLine[];
  /** Gross subtotal before discounts. */
  subtotalText?: string;
  /** Total discount amount formatted as "-RM X.XX" or "RM 0.00". */
  discountText?: string;
  taxText?: string;
  roundingText?: string;
  totalText: string;
  paidText?: string;
  changeText?: string;
  /** True when this document is a return against an earlier sale. */
  isRefund?: boolean;
  /** Invoice number of the sale this return refers to. */
  refundOfInvNo?: string | null;
  /** Internal id of the original sale, used when the invoice number is absent. */
  refundOfOrderId?: number | null;
  /** Name of the cashier who processed this order. */
  cashierName?: string;
  /** Optional customer/cashier note on this sale or order. */
  note?: string;
  footer: string;
}

export interface BuildReceiptOptions {
  storeName: string;
  storeNameCn?: string;
  storeAddress?: string;
  regNo?: string;
  tin?: string;
  msic?: string;
  tel?: string;
  email?: string;
  bankInfo?: string;
  /** Optional note printed at the bottom (defaults to a thank-you). */
  footer?: string;
  contractor?: ReceiptContractor;
  dateText?: string;
  taxText?: string;
  roundingText?: string;
  paidText?: string;
  changeText?: string;
}

/** Normalizes company registration number to display only (227533-X) when present */
export function cleanCompanyRegNo(regNo?: string): string {
  if (!regNo) return "";
  const s = String(regNo).trim();
  if (!s) return "";
  const normalized = s.toUpperCase().replace(/\s+/g, "");
  if (normalized.includes("227533-X")) return "(227533-X)";
  return s.startsWith("(") ? s : `(${s})`;
}

function isValidDate(d: Date): boolean {
  return !Number.isNaN(d.getTime());
}

function renderReceiptDateString(d: Date): string {
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, "0");
  const mins = String(d.getMinutes()).padStart(2, "0");
  return `${day}/${month}/${year} ${hours}:${mins}`;
}

/** Formats a timestamp into DD/MM/YYYY HH:mm (e.g. 23/10/2026 15:56) */
export function formatReceiptDate(ts: number | Date | string | null | undefined): string {
  if (ts == null) return "";
  if (typeof ts === "string") {
    const trimmed = ts.trim();
    if (!trimmed) return "";
    const n = Number(trimmed);
    if (!Number.isNaN(n)) {
      if (n <= 0) return "";
      const d = new Date(n);
      return isValidDate(d) ? renderReceiptDateString(d) : "";
    }
    const d = new Date(trimmed);
    return isValidDate(d) ? renderReceiptDateString(d) : "";
  }
  if (typeof ts === "number") {
    if (ts <= 0 || !Number.isFinite(ts)) return "";
    const d = new Date(ts);
    return isValidDate(d) ? renderReceiptDateString(d) : "";
  }
  if (ts instanceof Date) {
    return isValidDate(ts) ? renderReceiptDateString(ts) : "";
  }
  return "";
}

export function buildReceipt(order: Order, opts: BuildReceiptOptions): Receipt {
  const dateText = opts.dateText ?? formatReceiptDate(order.ts);

  const lines: ReceiptLine[] = order.items.map((it) => {
    const displayName = it.customName?.trim() || it.name;
    const hasManualDiscount = it.origPriceCents != null && it.origPriceCents > it.priceCents;
    let unitPriceText: string;
    let discountText: string | undefined;
    if (hasManualDiscount) {
      const savedCents = lineDiscountCents(it);
      unitPriceText = `${fmtMoney(it.origPriceCents!)} → ${fmtMoney(it.priceCents)}/${unitLabel(it.unit)}`;
      if (savedCents > 0) {
        discountText = `Discount -${fmtMoney(savedCents)}`;
      }
    } else {
      unitPriceText =
        `${fmtMoney(it.priceCents)}/${unitLabel(it.unit)}` +
        (it.bulkPrice && it.bulkMinQtyMilli != null
          ? ` (${fmtQty(it.bulkMinQtyMilli)}${unitLabel(it.unit, it.bulkMinQtyMilli)})`
          : "");
    }
    return {
      name: displayName,
      qtyText: fmtQtySold(it.qtyMilli, it.unit),
      unitPriceText,
      ...(discountText ? { discountText } : {}),
      amountText: fmtMoney(it.amountCents),
    };
  });

  const totalDiscountCents = orderTotalDiscountCents(order);
  const grossSubtotalCents = orderGrossSubtotalCents(order);
  const totalQtyMilli = order.items.reduce((acc, it) => acc + (it.qtyMilli || 0), 0);

  const isBorneo = opts.storeName.toLowerCase().includes("borneo");

  const isA = (order.invNo || "").trim().toUpperCase().startsWith("A-");
  const isRefund = order.refundOfOrderId != null || order.totalCents < 0;
  const orderContractor: ReceiptContractor | undefined = order.contractorName?.trim()
    ? {
        name: order.contractorName.trim(),
        tin: order.contractorTin,
        address: order.contractorAddress,
        phone: order.contractorPhone,
      }
    : undefined;

  const rawContractor = opts.contractor?.name?.trim()
    ? opts.contractor
    : orderContractor;
  const contractor: ReceiptContractor | undefined = isA ? undefined : rawContractor;

  return {
    storeName: opts.storeName,
    storeNameCn: opts.storeNameCn ?? (isBorneo ? STORE_NAME_CN : undefined),
    storeAddress: opts.storeAddress,
    regNo: opts.regNo ? cleanCompanyRegNo(opts.regNo) : (isBorneo ? STORE_REG_NO : undefined),
    tin: opts.tin ?? (isBorneo ? STORE_TIN : undefined),
    msic: opts.msic ?? (isBorneo ? STORE_MSIC : undefined),
    tel: opts.tel ?? (isBorneo ? STORE_TEL : undefined),
    email: opts.email ?? (isBorneo ? STORE_EMAIL : undefined),
    bankInfo: opts.bankInfo ?? (isBorneo ? STORE_BANKS : undefined),
    invNo: order.invNo,
    dateText,
    method: order.method,
    ...(order.method === "Credit" && order.contractorName ? { creditorName: order.contractorName } : {}),
    contractor,
    itemCount: order.items.length,
    totalQtyText: fmtQty(totalQtyMilli),
    subtotalText: fmtMoney(grossSubtotalCents),
    discountText: totalDiscountCents > 0 ? `-${fmtMoney(totalDiscountCents)}` : "RM 0.00",
    taxText: opts.taxText ?? "RM 0.00",
    roundingText: opts.roundingText ?? "RM 0.00",
    totalText: fmtMoney(order.totalCents),
    paidText: opts.paidText ?? fmtMoney(order.totalCents),
    changeText: opts.changeText ?? "RM 0.00",
    ...(isRefund ? { isRefund: true } : {}),
    ...(order.refundOfInvNo ? { refundOfInvNo: order.refundOfInvNo } : {}),
    ...(order.refundOfOrderId != null ? { refundOfOrderId: order.refundOfOrderId } : {}),
    ...(order.cashierName ? { cashierName: order.cashierName } : {}),
    ...(order.note ? { note: order.note } : {}),
    footer: opts.footer ?? "Thank you!",
    lines,
  };
}
