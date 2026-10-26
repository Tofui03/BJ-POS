import type {
  Company,
  Contractor,
  ContractorInput,
  ContractorMonthlyStatement,
  ContractorPatch,
  Credit,
  CreateRefundInput,
  CustomerType,
  DayClose,
  Order,
  PaymentMethod,
  PricedItem,
  Repayment,
  RepaymentInput,
  RepaymentMethod,
  UnitType,
  Unit,
} from "./types.js";

// The storage boundary. Implementations do *only* raw persistence — no pricing,
// no totals — so the domain rules stay in one place (pricing.ts / orders.ts).
// Async because that's the lowest common denominator: sql.js (sync) wraps
// trivially, while tauri-plugin-sql (async) could not be made sync.

export interface ItemInput {
  key: string;
  name: string;
  image?: string;
  unit?: Unit;
  priceCents: number;
  /** sold by the head — capture a tail/"ekor" count alongside weight */
  tracksTail?: boolean;
  /** remaining stock in milli-units; null/omitted = not stock-tracked */
  stockMilli?: number | null;
}

export type ItemPatch = Partial<ItemInput> & { active?: boolean };

/** A tier without ids — what the admin editor submits. */
export interface TierInput {
  minQtyMilli: number;
  priceCents: number;
}

/** A fully-priced, ready-to-persist order (built by orders.buildOrder). */
export interface OrderDraft {
  /** Company the sale belongs to; defaults to 1 when omitted. */
  companyId?: number;
  ts: number;
  businessDate?: string;
  customerType?: CustomerType;
  contractorId?: number | null;
  contractorName?: string;
  contractorTin?: string;
  contractorAddress?: string;
  contractorPhone?: string;
  issueDo?: boolean;
  doNumber?: string;
  siteAddress?: string;
  lorryPlate?: string;
  driverName?: string;
  contractorPo?: string;
  showPriceOnDo?: boolean;
  method: PaymentMethod;
  /** Whole-bill discount / rounding in cents (default 0). */
  discountCents?: number;
  totalCents: number;
  /** Name of the on-duty cashier who rang up this order. */
  cashierName?: string;
  /** If this is a refund, references the original order ID. */
  refundOfOrderId?: number | null;
  /** If this is a refund, references the original order invoice number. */
  refundOfInvNo?: string | null;
  /** Optional customer/cashier note on this sale or order. */
  note?: string | null;
  /**
   * Client-generated idempotency key. A repeated persist with the same key
   * returns the original order and does not deduct stock again.
   */
  clientRequestId?: string | null;
  lines: Array<{
    itemId: number;
    unit?: Unit;
    /** the *effective* unit price charged (after any tier or manual discount) */
    priceCents: number;
    /** original unit price when manually discounted below base/tier price */
    origPriceCents?: number | null;
    /** custom label for Lain-lain / ad-hoc lines */
    customName?: string | null;
    qtyMilli: number;
    /** head count ("ekor") on this line; 0 when the item doesn't track tail */
    tailCount?: number;
  }>;
}

export interface PosRepo {
  // --- lookups ---
  listCompanies(): Promise<Company[]>;
  listUnitTypes(): Promise<UnitType[]>;

  // --- items (always returned with their price tiers) ---
  /** The catalogue, optionally including inactive (soft-deleted) items. */
  listItems(includeInactive?: boolean): Promise<PricedItem[]>;
  getItem(id: number): Promise<PricedItem | null>;
  getItemByKey(key: string): Promise<PricedItem | null>;
  createItem(input: ItemInput): Promise<PricedItem>;
  updateItem(id: number, patch: ItemPatch): Promise<PricedItem>;
  setItemActive(id: number, active: boolean): Promise<void>;
  /** Persist a drag-arranged catalogue order: ids in display order, first = top. */
  setItemOrder(orderedIds: number[]): Promise<void>;
  /** Replace *all* tiers for an item (the editor sends the full set). */
  setTiers(itemId: number, tiers: TierInput[]): Promise<void>;

  // --- stock inbound ---
  /**
   * Atomically replenish or initialize item stock quantity.
   * If the item was previously untracked (stockMilli is null), it transitions to
   * tracked with stockMilli initialized to addQtyMilli.
   */
  restockItem(itemId: number, addQtyMilli: number, note?: string): Promise<PricedItem>;

  // --- orders ---
  /** Persist a pre-priced draft atomically and return the stored order. */
  persistOrder(draft: OrderDraft): Promise<Order>;
  getOrder(id: number): Promise<Order | null>;
  /** Orders with ts in [startMs, endMs), newest first; optionally one company. */
  listOrders(startMs: number, endMs: number, companyId?: number): Promise<Order[]>;
  /** Orders with business_date in [fromDate, toDate] (inclusive), newest first. */
  listOrdersByBusinessDate(fromDate: string, toDate: string, companyId?: number): Promise<Order[]>;
  /** Mark a sale cancelled at `at` (epoch ms); removes its credit row if any. */
  voidOrder(orderId: number, at: number, voidedBy?: string): Promise<Order>;
  /** Create a partial or full refund order referencing an existing order. */
  createRefundOrder(input: CreateRefundInput): Promise<Order>;
  /** Retrieve all prior non-voided refund orders linked to an order. */
  getRefundsForOrder(orderId: number): Promise<Order[]>;

  // --- business days (Close Day) ---
  getDayClose(businessDate: string, companyId?: number): Promise<DayClose | null>;
  /** Record a day as closed. Throws if already closed. */
  closeDay(businessDate: string, opts?: { companyId?: number; auto?: boolean; at?: number; closedBy?: string }): Promise<DayClose>;
  /**
   * Undo a close: deletes the close record and pulls sales that were pushed to
   * the next business day (but rung up on `businessDate`'s calendar day) back.
   */
  reopenDay(businessDate: string, companyId?: number): Promise<void>;
  /** Business dates before `beforeDate` that have orders but no close record. */
  listUnclosedDays(beforeDate: string, companyId?: number): Promise<string[]>;

  // --- settings (key/value, shared with the Electron main process) ---
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;

  // --- outbox (queued Close Day workbooks; Electron uploads/sends them) ---
  queueEmail(input: {
    companyId?: number;
    businessDate: string;
    subject: string;
    body: string;
    attachmentName?: string;
    attachmentB64?: string;
    /** Default 'drive' for Borneo Jasa v1; 'email' kept for legacy rows. */
    channel?: "drive" | "email";
  }): Promise<number>;
  /** Outbox rows for one business date (or all), newest first. */
  listOutbox(businessDate?: string): Promise<
    Array<{
      id: number;
      companyId: number;
      businessDate: string;
      subject: string;
      attachmentName: string | null;
      channel: "drive" | "email";
      createdAt: number;
      sentAt: number | null;
      attempts: number;
      lastError: string | null;
    }>
  >;

  // --- contractors ---
  listContractors(companyId?: number, opts?: { activeOnly?: boolean }): Promise<Contractor[]>;
  getContractor(id: number): Promise<Contractor | null>;
  getContractorByName(name: string, companyId?: number): Promise<Contractor | null>;
  createContractor(input: ContractorInput): Promise<Contractor>;
  updateContractor(id: number, patch: ContractorPatch): Promise<Contractor>;
  setContractorActive(id: number, active: boolean): Promise<void>;

  // --- credits (pay-later) ---
  /** Credits, newest first; optionally one company and/or only the outstanding ones. */
  listCredits(companyId?: number, opts?: { outstandingOnly?: boolean }): Promise<Credit[]>;
  /** Mark every outstanding credit for `name` as settled at `clearedAt` (epoch ms). */
  clearCreditsByName(
    name: string,
    clearedAt: number,
    companyId?: number,
    method?: RepaymentMethod,
    notes?: string,
    businessDate?: string,
    cashierName?: string,
  ): Promise<number>;
  /** Mark a specific set of credit IDs as settled at `clearedAt` (epoch ms) atomically. */
  clearCreditsByIds(
    creditIds: number[],
    clearedAt: number,
    companyId?: number,
    method?: RepaymentMethod,
    notes?: string,
    businessDate?: string,
    cashierName?: string,
  ): Promise<number>;
  /** Mark a single credit (one receipt) as settled at `clearedAt` (epoch ms). */
  clearCredit(
    creditId: number,
    clearedAt: number,
    method?: RepaymentMethod,
    businessDate?: string,
    cashierName?: string,
  ): Promise<void>;

  // --- repayments ---
  recordRepayment(input: RepaymentInput): Promise<Repayment>;
  listRepayments(opts?: { companyId?: number; businessDate?: string; fromDate?: string; toDate?: string }): Promise<Repayment[]>;
  listRepaymentsByBusinessDate(fromDate: string, toDate: string, companyId?: number): Promise<Repayment[]>;

  // --- contractor monthly statements ---
  getContractorMonthlyStatement(contractorIdOrName: number | string, yearMonth: string, companyId?: number): Promise<ContractorMonthlyStatement>;
  listCreditOrdersForContractor?(contractorId: number, companyId?: number, opts?: { upToYearMonth?: string }): Promise<Order[]>;
  listRepaymentsForContractor?(contractorId: number, companyId?: number, opts?: { upToYearMonth?: string }): Promise<Repayment[]>;
}
