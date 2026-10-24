import { PosError } from "./errors.js";

export type Cents = number;
export type Milli = number;

/**
 * Payment method for an order.
 * Note: "QR" represents "QR / Card" in the UI and receipts while preserving the underlying DB enum.
 */
export type PaymentMethod = "Cash" | "Bank" | "QR" | "Credit";
export const PAYMENT_METHODS: readonly PaymentMethod[] = ["Cash", "Bank", "QR", "Credit"];

export type Unit =
  | "pcs"
  | "batang"
  | "unit"
  | "bag"
  | "bundle"
  | "roll"
  | "ft"
  | "kg"
  | "meter"
  | "cup"
  | "box"
  | "pack"
  | "pieces"
  | "bottle"
  | "each";

export type CustomerType = "walkin" | "contractor";
export const CUSTOMER_TYPES: readonly CustomerType[] = ["walkin", "contractor"];

/** A company/tenant (lookup table). */
export interface Company {
  id: number;
  name: string;
}

/** A unit of sale, e.g. kg / box / bottle (lookup table). */
export interface UnitType {
  id: number;
  name: string;
}

export interface Item {
  id: number;
  key: string;
  name: string;
  image: string;
  unit: Unit;
  priceCents: Cents;
  active: boolean;
  /**
   * When true this item is sold by the head ("ekor") as well as by weight, so
   * the till captures a separate tail count (e.g. "38 fish") independent of the
   * kg quantity. Off for everything that isn't an animal/piece.
   */
  tracksTail: boolean;
  /**
   * Remaining stock in milli-units, or null when the item isn't stock-tracked.
   * Counts for countable units (5 cups = 5000), weight for kg (12.5 kg = 12500).
   */
  stockMilli: Milli | null;
  /** Manual display position (drag-to-arrange in admin); ties break by id. */
  sortOrder: number;
}

/** A quantity-break: at >= minQtyMilli the unit price drops to priceCents. */
export interface PriceTier {
  id: number;
  itemId: number;
  minQtyMilli: Milli;
  priceCents: Cents;
}

/** An item together with its tiers — the unit of work for pricing. */
export interface PricedItem extends Item {
  tiers: PriceTier[];
}

/**
 * An order line. The DB stores only the sale facts (item, price, qty, tail);
 * `name`/`image`/`unit` are hydrated from the items table at read time, and the
 * bulk-tier fields are re-derived from the item's price tiers. Items are only
 * ever soft-deleted (`active = 0`), so the join always resolves.
 */
export interface OrderLine {
  id: number;
  itemId: number;
  name: string;
  image: string;
  unit: Unit;
  /** the *effective* unit price charged (after any tier or manual discount) */
  priceCents: Cents;
  /** original unit price when cashier manually lowered the price on the till */
  origPriceCents?: Cents | null;
  /** custom display label for Lain-lain / ad-hoc lines */
  customName?: string | null;
  qtyMilli: Milli;
  amountCents: Cents;
  /**
   * Head count ("ekor") sold on this line, independent of qtyMilli. 0 for lines
   * whose item doesn't track tail.
   */
  tailCount: number;
  /** True when a quantity-break price was applied at sale time (derived). */
  bulkPrice: boolean;
  /** The quantity-break threshold that was applied, if derivable. */
  bulkMinQtyMilli?: Milli;
}

export interface Order {
  id: number;
  /** Company/tenant the sale was made under. */
  companyId: number;
  ts: number; // epoch millis
  /**
   * The business day (local YYYY-MM-DD) this sale counts toward. Usually the
   * calendar day of `ts`, but sales rung up after Close Day belong to the next
   * day — see closeday.ts.
   */
  businessDate: string;
  /**
   * The invoice number the customer sees, `MM-<seq>`: the month of
   * `businessDate` then that month's running sequence from 1000 — `08-1000`,
   * `08-1001`, …, restarting at `09-1000` in September. Stamped once when the
   * sale is persisted and never changed: a voided sale keeps its number, so
   * cancellations leave gaps rather than shifting later invoices.
   */
  invNo: string;
  customerType?: CustomerType;
  contractorId?: number | null;
  contractorName?: string;
  customerTin?: string;
  contractorTin?: string;
  customerAddress?: string;
  contractorAddress?: string;
  customerPhone?: string;
  contractorPhone?: string;
  issueDo?: boolean;
  doNumber?: string;
  doNo?: string;
  siteAddress?: string;
  lorryPlate?: string;
  driverName?: string;
  contractorPo?: string;
  showPriceOnDo?: boolean;
  method: PaymentMethod;
  /** Sum of line amounts before any whole-bill discount. */
  subtotalCents?: Cents;
  /** Whole-bill discount / rounding subtracted from subtotalCents. */
  discountCents?: Cents;
  totalCents: Cents;
  items: OrderLine[];
  /** Set for "Credit" sales: the creditor the order is owed by. */
  creditorName?: string;
  /** Name of the on-duty cashier who rang up this order. */
  cashierName?: string;
  /** Epoch ms the sale was cancelled (voided); null for a normal sale. */
  voidedAt: number | null;
  /** Name of the cashier/user who voided this order; null for non-voided or unrecorded. */
  voidedBy?: string | null;
  /** Epoch ms the credit was settled; null for non-credit or outstanding credit. */
  creditClearedAt?: number | null;
}

/** A Close Day record — at most one per company per business day. */
export interface DayClose {
  id: number;
  companyId: number;
  businessDate: string;
  closedAt: number; // epoch ms
  /** True when the app closed the day itself (cashier forgot), not the cashier. */
  auto: boolean;
  /** Name of the cashier/user who performed the day close; null for auto-close. */
  closedBy?: string | null;
}

export type RepaymentMethod = "Cash" | "Bank" | "QR";
export const REPAYMENT_METHODS: readonly RepaymentMethod[] = ["Cash", "Bank", "QR"];

export interface Contractor {
  id: number;
  companyId: number;
  name: string;
  phone: string;
  tin: string;
  address?: string;
  active: boolean;
}

export interface ContractorInput {
  companyId?: number;
  name: string;
  phone?: string;
  tin?: string;
  address?: string;
  active?: boolean;
}

export interface ContractorPatch {
  name?: string;
  phone?: string;
  tin?: string;
  address?: string;
  active?: boolean;
}

/**
 * A pay-later sale recorded against a named creditor. One row per credited order.
 * `clearedAt` is null while outstanding and stamped (epoch ms) once settled.
 */
export interface Credit {
  id: number;
  companyId: number;
  orderId: number;
  /** Invoice number of the credited order — what the creditor is shown. */
  invNo: string;
  name: string;
  amountCents: Cents;
  date: number; // epoch ms when the credit was taken
  clearedAt: number | null; // null = outstanding
  /** Payment method used when debt was settled (Cash or Bank). */
  clearedMethod?: RepaymentMethod | null;
}

export interface Repayment {
  id: number;
  companyId: number;
  creditId: number;
  orderId: number;
  contractorId?: number | null;
  contractorName?: string;
  amountCents: Cents;
  method: RepaymentMethod;
  ts: number;
  businessDate: string;
  notes?: string | null;
  /** Name of the cashier who recorded this repayment. */
  cashierName?: string | null;
}

export interface RepaymentInput {
  companyId?: number;
  creditId: number;
  contractorId?: number | null;
  amountCents?: Cents;
  method: RepaymentMethod;
  ts?: number;
  businessDate?: string;
  notes?: string;
  cashierName?: string | null;
}

export type Period = "today" | "month" | "all";

export interface Stats {
  period: Period;
  count: number;
  totalCents: Cents;
  byMethod: Record<PaymentMethod, { count: number; totalCents: Cents }>;
  repaymentsTotalCents?: Cents;
  repaymentsCount?: number;
}

/**
 * Validate and sanitize a cashier name.
 * Trims leading and trailing whitespace; throws PosError if empty or only whitespace.
 */
export function validateCashierName(name: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) {
    throw new PosError("cashier name cannot be empty");
  }
  return trimmed;
}
