import type { Cents, Milli, Order, Unit } from "./types.js";
import { fmtMoney, fmtQty, isMeasureUnit, unitLabel } from "./money.js";
import { formatDoNo } from "./orders.js";
import { cleanCompanyRegNo, formatReceiptDate } from "./receipt.js";
import {
  STORE_BANKS,
  STORE_EMAIL,
  STORE_NAME,
  STORE_NAME_CN,
  STORE_REG_NO,
  STORE_TEL,
  STORE_TIN,
} from "./hardware-catalog.js";

export { formatDoNo };

export interface DeliveryOrderLine {
  itemNo: number;
  name: string;
  itemName: string;
  unit: Unit;
  qtyMilli: Milli;
  qtyText: string;
  unitPriceCents?: Cents;
  unitPriceText?: string;
  lineAmountCents?: Cents;
  amountText?: string;
}

export interface Signatories {
  issuedBy: string;
  deliveredBy: string;
  receivedBy: string;
}

export interface CompanyInfo {
  name?: string;
  nameCn?: string;
  address?: string;
  regNo?: string;
  tin?: string;
  tel?: string;
  email?: string;
  bankInfo?: string;
}

export interface DeliveryOrder {
  companyId: number;
  businessDate: string;
  doNumber: string;
  doNo: string;
  invNo: string;
  dateText: string;
  storeName: string;
  storeNameCn?: string;
  storeAddress?: string;
  regNo?: string;
  tin?: string;
  tel?: string;
  email?: string;
  contractorName?: string;
  contractorTin?: string;
  contractorAddress?: string;
  contractorPhone?: string;
  siteAddress: string;
  lorryPlate: string;
  driverName: string;
  contractorPo?: string;
  showPriceOnDo: boolean;
  totalQtyMilli: Milli;
  totalQtyText: string;
  lines: DeliveryOrderLine[];
  subtotalCents?: Cents;
  subtotalText?: string;
  totalAmountCents?: Cents;
  totalText?: string;
  signatories: Signatories;
}

export interface BuildDeliveryOrderOptions {
  company?: CompanyInfo;
  storeName?: string;
  storeNameCn?: string;
  storeAddress?: string;
  regNo?: string;
  tin?: string;
  tel?: string;
  email?: string;
  dateText?: string;
  signatories?: {
    issuedBy?: string;
    deliveredBy?: string;
    receivedBy?: string;
  };
}

/**
 * Builds a pure DeliveryOrder domain model from a completed or drafted Order.
 * When `showPriceOnDo` is false, completely suppresses all unit prices and monetary amounts.
 */
export function buildDeliveryOrder(
  order: Order,
  opts?: BuildDeliveryOrderOptions,
): DeliveryOrder {
  const storeName = opts?.company?.name ?? opts?.storeName ?? STORE_NAME;
  const isBorneo = storeName.toLowerCase().includes("borneo");

  const rawRegNo = opts?.company?.regNo ?? opts?.regNo ?? (isBorneo ? STORE_REG_NO : undefined);
  const regNo = rawRegNo ? cleanCompanyRegNo(rawRegNo) : undefined;
  const tin = opts?.company?.tin ?? opts?.tin ?? (isBorneo ? STORE_TIN : undefined);
  const storeNameCn = opts?.company?.nameCn ?? opts?.storeNameCn ?? (isBorneo ? STORE_NAME_CN : undefined);
  const storeAddress = opts?.company?.address ?? opts?.storeAddress;
  const tel = opts?.company?.tel ?? opts?.tel ?? (isBorneo ? STORE_TEL : undefined);
  const email = opts?.company?.email ?? opts?.email ?? (isBorneo ? STORE_EMAIL : undefined);

  const dateText = opts?.dateText ?? formatReceiptDate(order.ts);
  const doNumber = order.doNumber?.trim() || order.doNo?.trim() || formatDoNo(1);
  const isPriceVisible = order.showPriceOnDo !== false;

  const lines: DeliveryOrderLine[] = (order.items || []).map((it, idx) => {
    const displayName = it.customName?.trim() || it.name;
    return {
      itemNo: idx + 1,
      name: displayName,
      itemName: displayName,
      unit: it.unit,
      qtyMilli: it.qtyMilli,
      qtyText: isMeasureUnit(it.unit) ? `${fmtQty(it.qtyMilli)} ${it.unit}` : fmtQty(it.qtyMilli),
      ...(isPriceVisible
        ? {
            unitPriceCents: it.priceCents,
            unitPriceText: `${fmtMoney(it.priceCents)}/${unitLabel(it.unit)}`,
            lineAmountCents: it.amountCents,
            amountText: fmtMoney(it.amountCents),
          }
        : {}),
    };
  });

  const totalQtyMilli = (order.items || []).reduce((acc, it) => acc + (it.qtyMilli || 0), 0);
  const totalQtyText = fmtQty(totalQtyMilli);

  const contractorName = order.contractorName?.trim() || order.creditorName?.trim() || undefined;
  const contractorTin = (order.contractorTin ?? order.customerTin)?.trim() || undefined;
  const contractorAddress = (order.contractorAddress ?? order.customerAddress)?.trim() || undefined;
  const contractorPhone = (order.contractorPhone ?? order.customerPhone)?.trim() || undefined;

  const signatories: Signatories = {
    issuedBy: opts?.signatories?.issuedBy ?? (order.cashierName?.trim() || "Store / Cashier"),
    deliveredBy: opts?.signatories?.deliveredBy ?? (order.driverName?.trim() || "Driver"),
    receivedBy: opts?.signatories?.receivedBy ?? "Site Supervisor",
  };

  return {
    companyId: order.companyId ?? 1,
    businessDate: order.businessDate,
    doNumber,
    doNo: doNumber,
    invNo: order.invNo,
    dateText,
    storeName,
    storeNameCn,
    storeAddress,
    regNo,
    tin,
    tel,
    email,
    contractorName,
    contractorTin,
    contractorAddress,
    contractorPhone,
    siteAddress: order.siteAddress?.trim() || "",
    lorryPlate: order.lorryPlate?.trim() || "",
    driverName: order.driverName?.trim() || "",
    contractorPo: order.contractorPo?.trim() || undefined,
    showPriceOnDo: isPriceVisible,
    totalQtyMilli,
    totalQtyText,
    lines,
    ...(isPriceVisible
      ? {
          subtotalCents: order.subtotalCents ?? order.totalCents,
          subtotalText: fmtMoney(order.subtotalCents ?? order.totalCents),
          totalAmountCents: order.totalCents,
          totalText: fmtMoney(order.totalCents),
        }
      : {}),
    signatories,
  };
}
