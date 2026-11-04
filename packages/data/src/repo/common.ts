import {
  type PosRepo,
  type ItemInput,
  type ItemPatch,
  type TierInput,
  type OrderDraft,
  type Company,
  type Contractor,
  type ContractorInput,
  type ContractorMonthlyStatement,
  type ContractorPatch,
  type Credit,
  type DayClose,
  type Item,
  type PricedItem,
  type PriceTier,
  type Repayment,
  type RepaymentInput,
  type RepaymentMethod,
  type UnitType,
  type CustomerType,
  type Order,
  type OrderLine,
  type Unit,
  type CreateRefundInput,
  INV_SEQ_START,
  PosError,
  assertCanCloseDay,
  assertCanVoidOrder,
  assertCents,
  assertPositiveMilli,
  calculateContractorStatement,
  filterPushedRecordIds,
  formatDoNo,
  determineInvoicePrefix,
  formatInvNo,
  lineAmount,
  localDateStr,
  nextDateStr,
  planPartialRefund,
  planStockDeduction,
  validateContractor,
  validateContractorPatch,
  validateRepayment,
} from "@yf/core";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte } from "drizzle-orm";
import type { SqlDriver } from "../driver.js";
import { makeDrizzle, type DrizzleDb } from "../drizzle.js";
import {
  companies,
  contractors,
  credits,
  dayCloses,
  items,
  orderItems,
  orders,
  outbox,
  priceTiers,
  repayments,
  settings,
  unitTypes,
} from "../schema.js";

// One PosRepo. Queries are built with Drizzle and executed through SqlDriver
// (see drizzle.ts). sql.js and the Electron IPC driver are interchangeable here.

export const toItem = (r: typeof items.$inferSelect): Item => ({
  id: r.id,
  key: r.key,
  name: r.name,
  image: r.image,
  unit: r.unit as Unit,
  priceCents: r.priceCents,
  active: r.active,
  tracksTail: r.tracksTail,
  stockMilli: r.stockMilli,
  sortOrder: r.sortOrder,
});

export const toTier = (r: typeof priceTiers.$inferSelect): PriceTier => ({
  id: r.id,
  itemId: r.itemId,
  minQtyMilli: r.minQtyMilli,
  priceCents: r.priceCents,
});

/**
 * Hydrate a raw order_items row into a domain line: display fields come from
 * the joined item (items are only soft-deleted, so it's always there — the
 * fallbacks just keep a manually-tampered DB from crashing the till), and the
 * bulk-tier annotation is re-derived: a line was tier-priced when its stored
 * unit price matches a tier whose quantity threshold the line met.
 */
export const toLine = (
  r: typeof orderItems.$inferSelect,
  item: typeof items.$inferSelect | null,
  tiers: PriceTier[],
): OrderLine => {
  const tier = tiers
    .filter((t) => t.minQtyMilli <= r.qtyMilli && t.priceCents === r.priceCents)
    .sort((a, b) => b.minQtyMilli - a.minQtyMilli)[0];
  const baseName = item?.name ?? `Item #${r.itemId}`;
  return {
    id: r.id,
    itemId: r.itemId,
    name: r.customName || baseName,
    image: item?.image ?? "",
    unit: ((r.unit as Unit) || (item?.unit as Unit) || "each") as Unit,
    priceCents: r.priceCents,
    ...(r.origPriceCents != null ? { origPriceCents: r.origPriceCents } : {}),
    ...(r.customName ? { customName: r.customName } : {}),
    qtyMilli: r.qtyMilli,
    amountCents: lineAmount(r.priceCents, r.qtyMilli),
    tailCount: r.tailCount,
    bulkPrice: tier != null && r.origPriceCents == null,
    ...(tier && r.origPriceCents == null ? { bulkMinQtyMilli: tier.minQtyMilli } : {}),
  };
};

export const toContractor = (r: typeof contractors.$inferSelect): Contractor => ({
  id: r.id,
  companyId: r.companyId,
  name: r.name,
  phone: r.phone,
  tin: r.tin ?? "",
  address: r.address ?? "",
  active: r.active,
});

export const toRepayment = (
  r: typeof repayments.$inferSelect,
  contractorName?: string,
): Repayment => ({
  id: r.id,
  companyId: r.companyId,
  creditId: r.creditId,
  orderId: r.orderId,
  contractorId: r.contractorId,
  contractorName,
  amountCents: r.amountCents,
  method: r.method as RepaymentMethod,
  ts: r.ts,
  businessDate: r.businessDate,
  notes: r.notes ?? null,
  cashierName: r.cashierName ?? null,
});

// `invNo` comes from the credited order (credits carry only its id); the
// fallback matches toOrder's — pre-invoice-number sales display their id.
export const toCredit = (r: typeof credits.$inferSelect, invNo: string | null): Credit => ({
  id: r.id,
  companyId: r.companyId,
  orderId: r.orderId,
  invNo: invNo ?? String(r.orderId),
  name: r.name,
  amountCents: r.amountCents,
  date: r.date,
  clearedAt: r.isClear ?? null,
  clearedMethod: (r.clearedMethod as RepaymentMethod) ?? null,
});

export const toDayClose = (r: typeof dayCloses.$inferSelect): DayClose => ({
  id: r.id,
  companyId: r.companyId,
  businessDate: r.businessDate,
  closedAt: r.closedAt,
  auto: r.auto,
  closedBy: r.closedBy ?? null,
});


export const toOrder = (
  r: typeof orders.$inferSelect,
  lines: OrderLine[],
  creditorName?: string,
  refundOfInvNo?: string,
): Order => {
  const discountCents = r.discountCents ?? 0;
  const subtotalCents = r.totalCents + discountCents;
  const effectiveContractorName = r.contractorName ?? creditorName;
  const tin = r.customerTin ?? undefined;
  const address = r.customerAddress ?? undefined;
  const phone = r.customerPhone ?? undefined;
  const doNum = r.doNumber ?? undefined;

  return {
    id: r.id,
    companyId: r.companyId,
    ts: r.ts,
    businessDate: r.businessDate ?? localDateStr(r.ts),
    invNo: r.invNo ?? String(r.id),
    method: r.method,
    subtotalCents,
    discountCents,
    totalCents: r.totalCents,
    items: lines,
    voidedAt: r.voidedAt ?? null,
    creditClearedAt: r.creditClearedAt ?? null,
    refundOfOrderId: r.refundOfOrderId ?? null,
    refundOfInvNo: refundOfInvNo ?? null,
    ...(r.note ? { note: r.note } : {}),
    ...(r.cashierName ? { cashierName: r.cashierName } : {}),
    ...(r.voidedBy !== undefined ? { voidedBy: r.voidedBy } : {}),
    ...(r.customerType ? { customerType: r.customerType as CustomerType } : {}),
    ...(r.contractorId != null ? { contractorId: r.contractorId } : {}),
    ...(effectiveContractorName ? { contractorName: effectiveContractorName } : {}),
    ...(tin ? { contractorTin: tin } : {}),
    ...(address ? { contractorAddress: address } : {}),
    ...(phone ? { contractorPhone: phone } : {}),
    ...(doNum ? {
      issueDo: true,
      doNumber: doNum,
      ...(r.siteAddress ? { siteAddress: r.siteAddress } : {}),
      ...(r.lorryPlate ? { lorryPlate: r.lorryPlate } : {}),
      ...(r.driverName ? { driverName: r.driverName } : {}),
      ...(r.contractorPo ? { contractorPo: r.contractorPo } : {}),
      showPriceOnDo: r.showPriceOnDo !== null ? Boolean(r.showPriceOnDo) : true,
    } : {
      ...(r.siteAddress ? { siteAddress: r.siteAddress } : {}),
      ...(r.lorryPlate ? { lorryPlate: r.lorryPlate } : {}),
      ...(r.driverName ? { driverName: r.driverName } : {}),
      ...(r.contractorPo ? { contractorPo: r.contractorPo } : {}),
      ...(r.showPriceOnDo != null ? { showPriceOnDo: Boolean(r.showPriceOnDo) } : {}),
    }),
  };
};
