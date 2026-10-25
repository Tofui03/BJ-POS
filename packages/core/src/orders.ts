import type {
  CustomerType,
  PaymentMethod,
  Order,
  Cents,
  OrderLine,
  Unit,
  RefundPlan,
  RefundPlanLine,
  RefundLineInput,
  StockReplenishment,
  StockRowInput,
} from "./types.js";
import { PAYMENT_METHODS, validateCashierName } from "./types.js";
import type { OrderDraft, PosRepo } from "./repo.js";
import { LAIN_LAIN_KEY } from "./hardware-catalog.js";
import { lineAmount } from "./money.js";
import { priceLine } from "./pricing.js";

import { PosError } from "./errors.js";
export { PosError };

/** The sequence every month's invoice numbering starts from. */
export const INV_SEQ_START = 1;

/**
 * The invoice number for a sale with prefix ('A' for walk-in / cash, 'B' for contractor / credit)
 * and sequence `seq`, e.g. ("A", 1) -> "A-0001", ("B", 2) -> "B-0002".
 * Also supports compatibility call signatures like (businessDate, seq, prefix?).
 */
export function formatInvNo(
  prefixOrDate: string,
  seq: number,
  prefixArg?: "A" | "B" | string,
): string {
  let prefix: "A" | "B" = "A";
  const upperFirst = (prefixOrDate || "").trim().toUpperCase();
  const upperArg = (prefixArg || "").trim().toUpperCase();
  if (
    upperFirst === "B" ||
    upperFirst.startsWith("B-") ||
    upperFirst === "CREDIT" ||
    upperArg === "B" ||
    upperArg.startsWith("B-") ||
    upperArg === "CREDIT"
  ) {
    prefix = "B";
  } else {
    prefix = "A";
  }
  const rawNum = Number(seq);
  const n = Number.isFinite(rawNum) ? Math.max(1, Math.floor(rawNum)) : 1;
  return `${prefix}-${String(n).padStart(4, "0")}`;
}

/**
 * Delivery Order running number sequence formatter, e.g. 1 -> "DO-0001", 42 -> "DO-0042".
 */
export function formatDoNo(seq: number): string {
  const rawNum = Number(seq);
  const n = Number.isFinite(rawNum) ? Math.max(1, Math.floor(rawNum)) : 1;
  return `DO-${String(n).padStart(4, "0")}`;
}

/**
 * Determines whether an order should receive an "A-" (walk-in) or "B-" (contractor/credit)
 * invoice sequence prefix based on customer decoupling rules.
 */
export function determineInvoicePrefix(draft: {
  customerType?: CustomerType;
  method?: PaymentMethod;
  contractorName?: string;
  contractorId?: number | null;
  creditorName?: string;
}): "A" | "B" {
  // An explicit walk-in sale stays on the A sequence. A leftover contractor
  // id or name must not renumber it. Credit is always B, including walk-in credit.
  if (draft.customerType === "walkin" && draft.method !== "Credit") return "A";
  if (
    draft.customerType === "contractor" ||
    draft.method === "Credit" ||
    Boolean(draft.contractorName?.trim()) ||
    Boolean(draft.contractorId) ||
    Boolean(draft.creditorName?.trim())
  ) {
    return "B";
  }
  return "A";
}

export interface OrderLineInput {
  itemId?: number;
  key?: string;
  qtyMilli: number;
  /** Optional unit override (e.g. for Lain-lain ad-hoc lines). Defaults to item.unit. */
  unit?: Unit;
  /** Optional till-side unit price override in cents (e.g. bargaining or Lain-lain). */
  unitPriceCents?: number;
  /** Optional custom line name (e.g. "Lain-lain — Skru"). */
  customName?: string;
  /** head count ("ekor") for tail-tracking items; ignored otherwise */
  tailCount?: number;
}

export interface CreateOrderInput {
  method: PaymentMethod;
  ts?: number;
  /** Business day the sale counts toward; defaults to ts's local calendar day. */
  businessDate?: string;
  /** Company the sale belongs to; defaults to 1 when omitted. */
  companyId?: number;
  /** Customer type: "walkin" (default) or "contractor". */
  customerType?: CustomerType;
  contractorId?: number | null;
  contractorName?: string;
  customerTin?: string;
  contractorTin?: string;
  customerAddress?: string;
  contractorAddress?: string;
  customerPhone?: string;
  contractorPhone?: string;
  /** Delivery Order fields */
  issueDo?: boolean;
  doNumber?: string;
  doNo?: string;
  siteAddress?: string;
  lorryPlate?: string;
  driverName?: string;
  contractorPo?: string;
  showPriceOnDo?: boolean;
  /** Required when method is "Credit" (unless contractorName is provided). */
  creditorName?: string;
  /** Optional whole-bill discount / rounding in cents. */
  discountCents?: number;
  /** Name of the on-duty cashier ringing up the sale. */
  cashierName?: string;
  /** Optional customer/cashier note on this sale. */
  note?: string | null;
  lines: OrderLineInput[];
}

/**
 * Resolve + price an order against the catalogue. Pure given the items it's
 * handed — throws PosError on any invalid line.
 */
export function buildOrder(
  input: CreateOrderInput,
  resolve: (line: OrderLineInput) => import("./types.js").PricedItem | null,
): OrderDraft {
  if (!PAYMENT_METHODS.includes(input.method)) {
    throw new PosError(`method must be one of ${PAYMENT_METHODS.join(", ")}`);
  }
  const effectiveCreditor = input.creditorName?.trim() || input.contractorName?.trim();
  if (input.method === "Credit" && !effectiveCreditor) {
    throw new PosError("a creditor name is required for credit sales");
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new PosError("an order needs at least one line");
  }

  let subtotalCents = 0;
  const lines = input.lines.map((line) => {
    const item = resolve(line);
    if (!item || !item.active) {
      throw new PosError(
        `unknown or inactive item: ${JSON.stringify(line.itemId ?? line.key)}`,
        "unknown_item",
      );
    }
    if (!(line.qtyMilli > 0)) {
      throw new PosError(`qty must be > 0 for ${item.name}`);
    }
    const base = priceLine(item, line.qtyMilli);
    let unitCents = base.unitCents;
    let amountCents = base.amountCents;
    let origPriceCents: number | null = null;
    if (line.unitPriceCents != null) {
      if (!Number.isInteger(line.unitPriceCents) || line.unitPriceCents < 0) {
        throw new PosError(`unit price must be a non-negative integer for ${item.name}`);
      }
      unitCents = line.unitPriceCents;
      amountCents = lineAmount(unitCents, line.qtyMilli);
      if (item.priceCents > 0 && unitCents < item.priceCents) {
        origPriceCents = item.priceCents;
      }
    }
    subtotalCents += amountCents;
    const customName = line.customName?.trim() || null;
    const customUnit = line.unit ?? item.unit;
    return {
      itemId: item.id,
      ...(customUnit ? { unit: customUnit } : {}),
      priceCents: unitCents,
      ...(origPriceCents != null ? { origPriceCents } : {}),
      ...(customName ? { customName } : {}),
      qtyMilli: line.qtyMilli,
      tailCount: item.tracksTail ? Math.max(0, Math.round(line.tailCount ?? 0)) : 0,
    };
  });

  const discountCents = input.discountCents ?? 0;
  if (!Number.isInteger(discountCents) || discountCents < 0) {
    throw new PosError("discountCents must be a non-negative integer");
  }
  if (discountCents > subtotalCents) {
    throw new PosError("discountCents cannot exceed subtotal");
  }
  const totalCents = subtotalCents - discountCents;

  // Cashier chose Walk-in. Ignore any contractor id/name still attached to the
  // payload (for example after switching back from the contractor tab).
  const explicitWalkIn = input.customerType === "walkin" && input.method !== "Credit";
  const hasContractorInfo =
    !explicitWalkIn &&
    (input.customerType === "contractor" ||
      Boolean(input.contractorName?.trim()) ||
      Boolean(input.contractorId));
  const customerType: CustomerType = hasContractorInfo ? "contractor" : (input.customerType ?? "walkin");
  const contractorName = explicitWalkIn ? undefined : input.contractorName?.trim() || undefined;
  const tin = explicitWalkIn
    ? undefined
    : (input.customerTin ?? input.contractorTin)?.trim() || undefined;
  const address = explicitWalkIn
    ? undefined
    : (input.customerAddress ?? input.contractorAddress)?.trim() || undefined;
  const phone = explicitWalkIn
    ? undefined
    : (input.customerPhone ?? input.contractorPhone)?.trim() || undefined;
  const doNum = (input.doNumber ?? input.doNo)?.trim() || undefined;
  const cashierName = input.cashierName ? validateCashierName(input.cashierName) : undefined;

  return {
    companyId: input.companyId ?? 1,
    ts: input.ts ?? Date.now(),
    method: input.method,
    customerType,
    ...(cashierName ? { cashierName } : {}),
    ...(!explicitWalkIn && input.contractorId != null ? { contractorId: input.contractorId } : {}),
    ...(contractorName ? { contractorName } : {}),
    ...(tin ? { customerTin: tin, contractorTin: tin } : {}),
    ...(address ? { customerAddress: address, contractorAddress: address } : {}),
    ...(phone ? { customerPhone: phone, contractorPhone: phone } : {}),
    ...(input.issueDo ? { issueDo: true } : {}),
    ...(doNum ? { doNumber: doNum, doNo: doNum } : {}),
    ...(input.siteAddress?.trim() ? { siteAddress: input.siteAddress.trim() } : {}),
    ...(input.lorryPlate?.trim() ? { lorryPlate: input.lorryPlate.trim() } : {}),
    ...(input.driverName?.trim() ? { driverName: input.driverName.trim() } : {}),
    ...(input.contractorPo?.trim() ? { contractorPo: input.contractorPo.trim() } : {}),
    ...(input.showPriceOnDo != null ? { showPriceOnDo: input.showPriceOnDo } : {}),
    ...(discountCents > 0 ? { discountCents } : {}),
    totalCents,
    lines,
    ...(input.businessDate ? { businessDate: input.businessDate } : {}),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    ...(input.method === "Credit" ? { creditorName: effectiveCreditor } : {}),
  };
}

/** Read catalogue → build+price → persist atomically. */
export async function createOrder(
  repo: PosRepo,
  input: CreateOrderInput,
): Promise<Order> {
  // Pre-fetch every referenced item so buildOrder can stay synchronous/pure.
  const cache = new Map<string, import("./types.js").PricedItem | null>();
  for (const line of input.lines ?? []) {
    if (line.itemId != null && line.itemId > 0 && !cache.has(`id:${line.itemId}`)) {
      cache.set(`id:${line.itemId}`, await repo.getItem(line.itemId));
    } else if (line.key != null && !cache.has(`key:${line.key}`)) {
      let item = await repo.getItemByKey(line.key);
      if (!item && line.key === LAIN_LAIN_KEY) {
        item = await repo.createItem({
          key: LAIN_LAIN_KEY,
          name: "Lain-lain",
          unit: "pcs",
          priceCents: 0,
        });
      }
      cache.set(`key:${line.key}`, item);
    }
  }
  const draft = buildOrder(input, (line) =>
    line.itemId != null && line.itemId > 0
      ? (cache.get(`id:${line.itemId}`) ?? null)
      : line.key != null
        ? (cache.get(`key:${line.key}`) ?? null)
        : null,
  );
  return repo.persistOrder(draft);
}

/**
 * Compute the discount amount in cents on an individual order line.
 * When origPriceCents > priceCents, calculates the difference between original and charged amounts.
 */
export function lineDiscountCents(
  line: Pick<OrderLine, "priceCents" | "origPriceCents" | "qtyMilli"> & { amountCents?: Cents },
): Cents {
  if (line.origPriceCents != null && line.origPriceCents > line.priceCents) {
    const charged = line.amountCents ?? lineAmount(line.priceCents, line.qtyMilli);
    return Math.max(0, lineAmount(line.origPriceCents, line.qtyMilli) - charged);
  }
  return 0;
}

/**
 * Total discount (all line discounts + whole-bill discount) for an order, in cents.
 */
export function orderTotalDiscountCents(
  order: Pick<Order, "items"> & { discountCents?: Cents },
): Cents {
  const lineDisc = (order.items || []).reduce((acc, l) => acc + lineDiscountCents(l), 0);
  return lineDisc + (order.discountCents ?? 0);
}

/**
 * Gross subtotal before discounts: order.totalCents + orderTotalDiscountCents(order).
 */
export function orderGrossSubtotalCents(
  order: Pick<Order, "totalCents" | "items"> & { discountCents?: Cents },
): Cents {
  return order.totalCents + orderTotalDiscountCents(order);
}

/**
 * Guard whether an order can be voided.
 * Returns "noop" if already voided, "ok" if voidable, or throws PosError if settled,
 * if it is a refund order, or if it has active refunds.
 */
export function assertCanVoidOrder(input: {
  voidedAt: number | null;
  creditClearedAt?: number | null;
  hasClearedCredit: boolean;
  hasRepayment: boolean;
  refundOfOrderId?: number | null;
  hasRefunds?: boolean;
}): "noop" | "ok" {
  if (input.voidedAt != null) {
    return "noop";
  }
  if (input.refundOfOrderId != null) {
    throw new PosError("cannot void a refund order");
  }
  if (input.hasRefunds) {
    throw new PosError("cannot void an order with active refunds");
  }
  if (input.creditClearedAt != null || input.hasClearedCredit || input.hasRepayment) {
    throw new PosError("cannot void a credit order that has already been settled");
  }
  return "ok";
}

/**
 * Pure domain calculation for a partial return / refund.
 * Validates remaining returnable quantities, calculates refund amounts based strictly
 * on historical transacted unit prices, and generates stock replenishment instructions.
 * Lines are matched by unique line identifier (orderItemId / line index) rather than
 * collapsing all lines by itemId.
 */
export function planPartialRefund(
  originalOrder: Order,
  priorRefunds: Order[],
  returnLines: RefundLineInput[],
  stockRows?: StockRowInput[],
): RefundPlan {
  if (originalOrder.voidedAt != null) {
    throw new PosError("cannot refund a voided order");
  }
  if (originalOrder.refundOfOrderId != null) {
    throw new PosError("cannot refund a refund order");
  }
  if (!Array.isArray(returnLines) || returnLines.length === 0) {
    throw new PosError("at least one line must have return quantity > 0");
  }

  // Set up tracking slots for each line in the original order
  interface LineSlot {
    index: number;
    orderItemId?: number;
    line: OrderLine;
    purchasedQty: number;
    priorRefundedQty: number;
    remainingQty: number;
    requestedQty: number;
  }

  const slots: LineSlot[] = (originalOrder.items || []).map((line, index) => ({
    index,
    orderItemId: line.id,
    line,
    purchasedQty: line.qtyMilli,
    priorRefundedQty: 0,
    remainingQty: line.qtyMilli,
    requestedQty: 0,
  }));

  // Deduct non-voided prior refunds from line slots
  for (const refOrder of priorRefunds) {
    if (refOrder.voidedAt != null) continue;
    for (const refItem of refOrder.items) {
      let unallocated = refItem.qtyMilli;

      // 1. Try matching slot with same itemId and same priceCents (and matching customName if available)
      for (const slot of slots) {
        if (unallocated <= 0) break;
        if (slot.remainingQty <= 0) continue;
        if (
          slot.line.itemId === refItem.itemId &&
          slot.line.priceCents === refItem.priceCents &&
          (refItem.customName == null || slot.line.customName === refItem.customName)
        ) {
          const deduct = Math.min(slot.remainingQty, unallocated);
          slot.priorRefundedQty += deduct;
          slot.remainingQty -= deduct;
          unallocated -= deduct;
        }
      }

      // 2. If still unallocated, match any slot with same itemId and remainingQty > 0
      if (unallocated > 0) {
        for (const slot of slots) {
          if (unallocated <= 0) break;
          if (slot.remainingQty <= 0) continue;
          if (slot.line.itemId === refItem.itemId) {
            const deduct = Math.min(slot.remainingQty, unallocated);
            slot.priorRefundedQty += deduct;
            slot.remainingQty -= deduct;
            unallocated -= deduct;
          }
        }
      }
    }
  }

  // Stock tracking map if provided
  const stockMap = stockRows
    ? new Map(
        stockRows.map((s) => {
          const id = "id" in s && s.id != null ? s.id : (s as any).itemId;
          const sm = "stockMilli" in s && s.stockMilli !== undefined ? s.stockMilli : (s as any).currentStockMilli;
          return [id, sm ?? null];
        }),
      )
    : null;

  // Process requested returns into slots
  for (const retLine of returnLines) {
    if (!retLine || retLine.itemId == null) {
      throw new PosError("invalid return line: missing itemId");
    }
    const qty = retLine.qtyMilli ?? 0;
    if (!Number.isInteger(qty) || qty < 0) {
      throw new PosError("return quantity must be a non-negative integer milli-unit");
    }
    if (qty === 0) continue;

    let targetSlot: LineSlot | undefined;
    if (retLine.orderItemId != null) {
      targetSlot = slots.find((s) => s.orderItemId === retLine.orderItemId && s.line.itemId === retLine.itemId);
      if (!targetSlot) {
        targetSlot = slots.find((s) => s.orderItemId === retLine.orderItemId || s.index === retLine.orderItemId);
      }
      if (!targetSlot) {
        throw new PosError(`order line #${retLine.orderItemId} not found in original order`);
      }
    } else if ((retLine as any).lineIndex != null) {
      const idx = (retLine as any).lineIndex;
      targetSlot = slots[idx];
      if (!targetSlot || targetSlot.line.itemId !== retLine.itemId) {
        throw new PosError(`order line at index #${idx} not found in original order`);
      }
    } else {
      // Find slot by itemId with remaining returnable quantity
      const matchingSlots = slots.filter((s) => s.line.itemId === retLine.itemId);
      if (matchingSlots.length === 0) {
        throw new PosError(`item #${retLine.itemId} not found in original order`);
      }
      targetSlot = matchingSlots.find((s) => s.remainingQty > s.requestedQty) ?? matchingSlots[0];
    }

    if (!targetSlot) {
      throw new PosError(`item #${retLine.itemId} not found in original order`);
    }

    targetSlot.requestedQty += qty;
  }

  const hasAnyRequested = slots.some((s) => s.requestedQty > 0);
  if (!hasAnyRequested) {
    throw new PosError("at least one line must have return quantity > 0");
  }

  // Validate quantities against remaining returnable quota
  for (const slot of slots) {
    if (slot.requestedQty > slot.remainingQty) {
      throw new PosError(
        `return quantity (${slot.requestedQty}) exceeds remaining returnable quantity (${slot.remainingQty}) for item #${slot.line.itemId}`,
      );
    }
  }

  let totalRefundCents = 0;
  const lines: RefundPlanLine[] = [];
  const replenishmentsMap = new Map<number, number>();

  for (const slot of slots) {
    if (slot.requestedQty <= 0) continue;

    // Amount strictly calculated using historical transaction unit price of that specific line
    const amountCents = lineAmount(slot.line.priceCents, slot.requestedQty);
    totalRefundCents += amountCents;

    lines.push({
      itemId: slot.line.itemId,
      unit: slot.line.unit,
      customName: slot.line.customName ?? slot.line.name ?? null,
      priceCents: slot.line.priceCents,
      origPriceCents: slot.line.origPriceCents ?? null,
      qtyMilli: slot.requestedQty,
      amountCents,
      tailCount: 0,
    });

    const isTracked = stockMap ? stockMap.get(slot.line.itemId) !== null : true;
    if (isTracked) {
      replenishmentsMap.set(
        slot.line.itemId,
        (replenishmentsMap.get(slot.line.itemId) ?? 0) + slot.requestedQty,
      );
    }
  }

  const replenishments: StockReplenishment[] = [...replenishmentsMap.entries()].map(
    ([itemId, qtyMilli]) => ({ itemId, qtyMilli }),
  );

  return {
    originalOrderId: originalOrder.id,
    refundOfOrderId: originalOrder.id,
    refundOfInvNo: originalOrder.invNo,
    totalCents: -totalRefundCents,
    lines,
    replenishments,
  };
}
