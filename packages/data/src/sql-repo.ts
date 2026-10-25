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
import type { SqlDriver } from "./driver.js";
import { makeDrizzle, type DrizzleDb } from "./drizzle.js";
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
} from "./schema.js";

// One PosRepo, driver-agnostic. Queries are built with Drizzle and executed
// through the SqlDriver (see drizzle.ts); swapping sql.js for tauri-plugin-sql /
// node:sqlite is just a different SqlDriver.

const toItem = (r: typeof items.$inferSelect): Item => ({
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

const toTier = (r: typeof priceTiers.$inferSelect): PriceTier => ({
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
const toLine = (
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

const toContractor = (r: typeof contractors.$inferSelect): Contractor => ({
  id: r.id,
  companyId: r.companyId,
  name: r.name,
  phone: r.phone,
  tin: r.tin ?? "",
  address: r.address ?? "",
  active: r.active,
});

const toRepayment = (
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
const toCredit = (r: typeof credits.$inferSelect, invNo: string | null): Credit => ({
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

export class SqlPosRepo implements PosRepo {
  private readonly dz: DrizzleDb;

  constructor(private readonly db: SqlDriver) {
    this.dz = makeDrizzle(db);
  }

  // --- lookups ---
  async listCompanies(): Promise<Company[]> {
    return this.dz.select().from(companies).orderBy(asc(companies.id));
  }

  async listUnitTypes(): Promise<UnitType[]> {
    return this.dz.select().from(unitTypes).orderBy(asc(unitTypes.id));
  }

  // --- items ---
  private async attachTiers(list: Item[]): Promise<PricedItem[]> {
    if (list.length === 0) return [];
    const ids = list.map((i) => i.id);
    const tierRows = await this.dz
      .select()
      .from(priceTiers)
      .where(inArray(priceTiers.itemId, ids))
      .orderBy(asc(priceTiers.minQtyMilli));
    const byItem = new Map<number, PriceTier[]>();
    for (const r of tierRows) {
      const t = toTier(r);
      (byItem.get(t.itemId) ?? byItem.set(t.itemId, []).get(t.itemId)!).push(t);
    }
    return list.map((i) => ({ ...i, tiers: byItem.get(i.id) ?? [] }));
  }

  async listItems(includeInactive = false): Promise<PricedItem[]> {
    const rows = await this.dz
      .select()
      .from(items)
      .where(includeInactive ? undefined : eq(items.active, true))
      .orderBy(asc(items.sortOrder), asc(items.id));
    return this.attachTiers(rows.map(toItem));
  }

  async getItem(id: number): Promise<PricedItem | null> {
    const rows = await this.dz.select().from(items).where(eq(items.id, id)).limit(1);
    if (rows.length === 0) return null;
    return (await this.attachTiers([toItem(rows[0]!)]))[0]!;
  }

  async getItemByKey(key: string): Promise<PricedItem | null> {
    const rows = await this.dz.select().from(items).where(eq(items.key, key)).limit(1);
    if (rows.length === 0) return null;
    return (await this.attachTiers([toItem(rows[0]!)]))[0]!;
  }

  async createItem(input: ItemInput): Promise<PricedItem> {
    assertCents(input.priceCents, "priceCents");
    const [row] = await this.dz
      .insert(items)
      .values({
        key: input.key,
        name: input.name,
        image: input.image ?? "",
        unit: input.unit ?? "each",
        priceCents: input.priceCents,
        tracksTail: input.tracksTail ?? false,
        stockMilli: input.stockMilli ?? null,
      })
      .returning({ id: items.id });
    // New items land at the end of the arranged catalogue.
    await this.db.run(
      "UPDATE items SET sort_order = (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM items) WHERE id = ?",
      [row!.id],
    );
    return (await this.getItem(row!.id))!;
  }

  async updateItem(id: number, patch: ItemPatch): Promise<PricedItem> {
    const cur = await this.getItem(id);
    if (!cur) throw new Error("item not found");
    if (patch.priceCents != null) assertCents(patch.priceCents, "priceCents");
    await this.dz
      .update(items)
      .set({
        name: patch.name ?? cur.name,
        image: patch.image ?? cur.image,
        unit: patch.unit ?? cur.unit,
        priceCents: patch.priceCents ?? cur.priceCents,
        active: patch.active ?? cur.active,
        tracksTail: patch.tracksTail ?? cur.tracksTail,
        // null is a real value here (= stop tracking), so only an absent key
        // keeps the current stock.
        stockMilli: patch.stockMilli === undefined ? cur.stockMilli : patch.stockMilli,
      })
      .where(eq(items.id, id));
    return (await this.getItem(id))!;
  }

  async setItemActive(id: number, active: boolean): Promise<void> {
    await this.dz.update(items).set({ active }).where(eq(items.id, id));
  }

  async setItemOrder(orderedIds: number[]): Promise<void> {
    await this.db.tx(async () => {
      for (const [index, id] of orderedIds.entries()) {
        await this.dz.update(items).set({ sortOrder: index + 1 }).where(eq(items.id, id));
      }
    });
  }

  async setTiers(itemId: number, tiers: TierInput[]): Promise<void> {
    for (const t of tiers) {
      assertPositiveMilli(t.minQtyMilli, "tier minQtyMilli");
      assertCents(t.priceCents, "tier priceCents");
    }
    await this.db.tx(async () => {
      await this.dz.delete(priceTiers).where(eq(priceTiers.itemId, itemId));
      for (const t of tiers) {
        await this.dz
          .insert(priceTiers)
          .values({ itemId, minQtyMilli: t.minQtyMilli, priceCents: t.priceCents });
      }
    });
  }

  // --- stock inbound ---
  async restockItem(itemId: number, addQtyMilli: number, _note?: string): Promise<PricedItem> {
    assertPositiveMilli(addQtyMilli, "restock quantity");

    return await this.db.tx(async () => {
      const existing = await this.getItem(itemId);
      if (!existing) {
        throw new PosError(`item #${itemId} not found`);
      }

      await this.db.run(
        "UPDATE items SET stock_milli = COALESCE(stock_milli, 0) + ? WHERE id = ?",
        [addQtyMilli, itemId],
      );

      return (await this.getItem(itemId))!;
    });
  }

  // --- orders ---
  async persistOrder(draft: OrderDraft): Promise<Order> {
    if (draft.refundOfOrderId == null) {
      assertCents(draft.totalCents, "order totalCents");
    }
    const discountCents = draft.discountCents ?? 0;
    assertCents(discountCents, "order discountCents");
    for (const l of draft.lines) {
      assertCents(l.priceCents, "line priceCents");
      if (l.origPriceCents != null) assertCents(l.origPriceCents, "line origPriceCents");
      assertPositiveMilli(l.qtyMilli, "line qtyMilli");
    }
    const id = await this.db.tx(async () => {
      const businessDate = (draft.businessDate ? draft.businessDate.trim() : localDateStr(draft.ts));
      const prefix = determineInvoicePrefix(draft);
      const isContractor = prefix === "B";
      const companyId = draft.companyId ?? 1;
      // Dual monthly-resetting invoice sequences:
      // A-0001 for Walk-in / Cash / Non-credit, B-0001 for Contractor / Credit.
      // Reset to 0001 at the beginning of each business month.
      const [seqRow] = await this.db.all(
        `SELECT COALESCE(MAX(CAST(substr(inv_no, 3) AS INTEGER)), 0) + 1 AS seq
         FROM orders
         WHERE company_id = ?
           AND substr(business_date, 1, 7) = ?
           AND inv_no LIKE ?`,
        [companyId, businessDate.slice(0, 7), `${prefix}-%`],
      );
      const invNo = formatInvNo(prefix, Number(seqRow?.seq ?? 1));

      // Resolve contractor details if contractorId was provided.
      // Walk-in (A) sales do not keep a contractor, even if one was still attached.
      let contractorName = isContractor
        ? (draft.contractorName ?? draft.creditorName)?.trim() || null
        : null;
      let customerTin = isContractor
        ? (draft.customerTin ?? draft.contractorTin)?.trim() || null
        : null;
      let customerAddress = isContractor
        ? (draft.customerAddress ?? draft.contractorAddress)?.trim() || null
        : null;
      let customerPhone = isContractor
        ? (draft.customerPhone ?? draft.contractorPhone)?.trim() || null
        : null;

      if (isContractor && draft.contractorId != null) {
        const [c] = await this.dz
          .select()
          .from(contractors)
          .where(eq(contractors.id, draft.contractorId))
          .limit(1);
        if (c) {
          if (!contractorName) contractorName = c.name;
          if (!customerTin && c.tin) customerTin = c.tin;
          if (!customerAddress && c.address) customerAddress = c.address;
          if (!customerPhone && c.phone) customerPhone = c.phone;
        }
      }

      // Generate Delivery Order sequence if DO is requested or DO fields are present
      let doNumber: string | null = (draft.doNumber ?? draft.doNo)?.trim() || null;
      const hasDo = Boolean(
        draft.issueDo ||
        doNumber ||
        draft.siteAddress?.trim() ||
        draft.lorryPlate?.trim() ||
        draft.driverName?.trim() ||
        draft.contractorPo?.trim()
      );
      if (hasDo && !doNumber) {
        const [doRow] = await this.db.all(
          `SELECT COALESCE(MAX(CAST(substr(do_number, 4) AS INTEGER)), 0) + 1 AS seq
           FROM orders
           WHERE company_id = ?
             AND do_number LIKE 'DO-%'`,
          [companyId],
        );
        doNumber = formatDoNo(Number(doRow?.seq ?? 1));
      }

      const [o] = await this.dz
        .insert(orders)
        .values({
          companyId: draft.companyId ?? 1,
          ts: draft.ts,
          businessDate,
          invNo,
          customerType: isContractor ? "contractor" : "walkin",
          contractorId: isContractor ? (draft.contractorId ?? null) : null,
          contractorName,
          customerTin,
          customerAddress,
          customerPhone,
          doNumber,
          siteAddress: draft.siteAddress?.trim() || null,
          lorryPlate: draft.lorryPlate?.trim() || null,
          driverName: draft.driverName?.trim() || null,
          contractorPo: draft.contractorPo?.trim() || null,
          showPriceOnDo: hasDo ? (draft.showPriceOnDo !== false) : (draft.showPriceOnDo ?? null),
          discountCents,
          totalCents: draft.totalCents,
          method: draft.method,
          cashierName: draft.cashierName?.trim() || null,
          note: draft.note?.trim() || null,
          refundOfOrderId: draft.refundOfOrderId ?? null,
        })
        .returning({ id: orders.id });

      if (doNumber) {
        await this.db.run("UPDATE orders SET do_no = ? WHERE id = ?", [doNumber, o!.id]);
      }
      const stockRows = await this.dz
        .select({ id: items.id, name: items.name, stockMilli: items.stockMilli })
        .from(items)
        .where(inArray(items.id, draft.lines.map((l) => l.itemId)));
      const deductions = planStockDeduction(stockRows, draft.lines);
      for (const d of deductions) {
        await this.dz
          .update(items)
          .set({ stockMilli: d.nextStockMilli })
          .where(eq(items.id, d.itemId));
      }
      for (const l of draft.lines) {
        await this.dz.insert(orderItems).values({
          orderId: o!.id,
          itemId: l.itemId,
          unit: l.unit ?? null,
          priceCents: l.priceCents,
          origPriceCents: l.origPriceCents ?? null,
          customName: l.customName ?? null,
          qtyMilli: l.qtyMilli,
          tailCount: l.tailCount ?? 0,
        });
      }
      // A credit sale also records who owes it — one outstanding credit per order.
      if (draft.method === "Credit") {
        const creditor = (draft.contractorName ?? draft.creditorName)?.trim() || contractorName;
        if (!creditor) {
          throw new PosError("a creditor name is required for credit sales");
        }
        await this.dz.insert(credits).values({
          companyId: draft.companyId ?? 1,
          orderId: o!.id,
          name: creditor,
          amountCents: draft.totalCents,
          date: draft.ts,
          isClear: null,
        });
      }
      return o!.id;
    });
    return (await this.getOrder(id))!;
  }

  // --- contractors ---
  async listContractors(companyId = 1, opts?: { activeOnly?: boolean }): Promise<Contractor[]> {
    const conds = [eq(contractors.companyId, companyId)];
    if (opts?.activeOnly) conds.push(eq(contractors.active, true));
    const rows = await this.dz
      .select()
      .from(contractors)
      .where(and(...conds))
      .orderBy(asc(contractors.name));
    return rows.map(toContractor);
  }

  async getContractor(id: number): Promise<Contractor | null> {
    const [row] = await this.dz
      .select()
      .from(contractors)
      .where(eq(contractors.id, id))
      .limit(1);
    return row ? toContractor(row) : null;
  }

  async getContractorByName(name: string, companyId = 1): Promise<Contractor | null> {
    const trimmed = name.trim().toLowerCase();
    const rows = await this.dz
      .select()
      .from(contractors)
      .where(eq(contractors.companyId, companyId));
    const found = rows.find((r) => r.name.trim().toLowerCase() === trimmed);
    return found ? toContractor(found) : null;
  }

  async createContractor(input: ContractorInput): Promise<Contractor> {
    const validated = validateContractor(input);
    const companyId = input.companyId ?? 1;
    const existing = await this.getContractorByName(validated.name, companyId);
    if (existing) {
      throw new PosError(`contractor "${validated.name}" already exists`);
    }
    const [row] = await this.dz
      .insert(contractors)
      .values({
        companyId,
        name: validated.name,
        phone: validated.phone,
        tin: validated.tin,
        address: validated.address ?? "",
        active: validated.active,
      })
      .returning();
    return toContractor(row!);
  }

  async updateContractor(id: number, patch: ContractorPatch): Promise<Contractor> {
    const validated = validateContractorPatch(patch);
    const cur = await this.getContractor(id);
    if (!cur) throw new PosError("contractor not found");

    if (validated.name && validated.name.toLowerCase() !== cur.name.toLowerCase()) {
      const existing = await this.getContractorByName(validated.name, cur.companyId);
      if (existing && existing.id !== id) {
        throw new PosError(`contractor "${validated.name}" already exists`);
      }
    }

    return await this.db.tx(async () => {
      await this.dz
        .update(contractors)
        .set({
          name: validated.name ?? cur.name,
          phone: validated.phone !== undefined ? validated.phone : cur.phone,
          tin: validated.tin !== undefined ? validated.tin : cur.tin,
          address: validated.address !== undefined ? validated.address : (cur.address ?? ""),
          active: validated.active !== undefined ? validated.active : cur.active,
        })
        .where(eq(contractors.id, id));

      if (validated.name && validated.name !== cur.name) {
        await this.db.run(
          "UPDATE credits SET name = ? WHERE company_id = ? AND lower(trim(name)) = lower(trim(?))",
          [validated.name, cur.companyId, cur.name],
        );
        await this.db.run(
          "UPDATE orders SET contractor_name = ? WHERE company_id = ? AND (contractor_id = ? OR lower(trim(contractor_name)) = lower(trim(?)))",
          [validated.name, cur.companyId, id, cur.name],
        );
      }

      return (await this.getContractor(id))!;
    });
  }

  async setContractorActive(id: number, active: boolean): Promise<void> {
    await this.dz.update(contractors).set({ active }).where(eq(contractors.id, id));
  }

  // --- credits ---
  async listCredits(companyId?: number, opts?: { outstandingOnly?: boolean }): Promise<Credit[]> {
    const conds = [];
    if (companyId != null) conds.push(eq(credits.companyId, companyId));
    if (opts?.outstandingOnly) conds.push(isNull(credits.isClear));
    const rows = await this.dz
      .select({ credit: credits, invNo: orders.invNo })
      .from(credits)
      .leftJoin(orders, eq(credits.orderId, orders.id))
      .where(and(...conds))
      .orderBy(desc(credits.date));
    return rows.map((r) => toCredit(r.credit, r.invNo));
  }

  // --- repayments & clearance ---
  async recordRepayment(input: RepaymentInput): Promise<Repayment> {
    const validated = validateRepayment(input);
    return await this.db.tx(async () => {
      const conds = [eq(credits.id, validated.creditId)];
      if (input.companyId != null) conds.push(eq(credits.companyId, validated.companyId));
      const [creditRow] = await this.dz
        .select()
        .from(credits)
        .where(and(...conds))
        .limit(1);
      if (!creditRow) {
        throw new PosError(`credit #${validated.creditId} not found`);
      }
      if (creditRow.isClear != null) {
        throw new PosError(`credit #${validated.creditId} is already cleared`);
      }

      // Check if associated order is voided
      const [orderRow] = await this.dz
        .select({ voidedAt: orders.voidedAt })
        .from(orders)
        .where(eq(orders.id, creditRow.orderId))
        .limit(1);
      if (orderRow?.voidedAt != null) {
        throw new PosError("cannot record repayment for a voided order");
      }

      if (validated.amountCents != null && validated.amountCents > creditRow.amountCents) {
        throw new PosError("repayment amount cannot exceed credit balance");
      }

      const amountCents = validated.amountCents ?? creditRow.amountCents;
      const isPartial = amountCents < creditRow.amountCents;

      if (isPartial) {
        // Split credit: original row reflects paid portion and is marked clear
        const remainingCents = creditRow.amountCents - amountCents;
        await this.dz
          .update(credits)
          .set({
            amountCents,
            isClear: validated.ts,
            clearedMethod: validated.method,
          })
          .where(eq(credits.id, creditRow.id));

        // Insert new credit row for remaining balance
        await this.dz.insert(credits).values({
          companyId: creditRow.companyId,
          orderId: creditRow.orderId,
          name: creditRow.name,
          amountCents: remainingCents,
          date: creditRow.date,
          isClear: null,
          clearedMethod: null,
        });
      } else {
        // 1. Mark credit as cleared with payment method
        await this.dz
          .update(credits)
          .set({
            isClear: validated.ts,
            clearedMethod: validated.method,
          })
          .where(eq(credits.id, creditRow.id));

        // 2. Check if any other open credits remain for this order before stamping order
        const openForOrder = await this.dz
          .select({ id: credits.id })
          .from(credits)
          .where(and(eq(credits.orderId, creditRow.orderId), isNull(credits.isClear)));
        if (openForOrder.length === 0) {
          await this.dz
            .update(orders)
            .set({ creditClearedAt: validated.ts })
            .where(eq(orders.id, creditRow.orderId));
        }
      }

      // 3. Resolve contractor id if not provided
      let contractorId = validated.contractorId ?? null;
      if (!contractorId) {
        const contractor = await this.getContractorByName(creditRow.name, creditRow.companyId);
        if (contractor) contractorId = contractor.id;
      }

      // 4. Insert repayment record
      const [repRow] = await this.dz
        .insert(repayments)
        .values({
          companyId: creditRow.companyId,
          creditId: creditRow.id,
          orderId: creditRow.orderId,
          contractorId,
          amountCents,
          method: validated.method,
          ts: validated.ts,
          businessDate: validated.businessDate,
          notes: validated.notes ?? null,
          cashierName: validated.cashierName?.trim() || null,
        })
        .returning();

      return toRepayment(repRow!, creditRow.name);
    });
  }

  async clearCredit(
    creditId: number,
    clearedAt: number,
    method: RepaymentMethod = "Cash",
    businessDate?: string,
    cashierName?: string,
  ): Promise<void> {
    await this.recordRepayment({
      creditId,
      ts: clearedAt,
      method,
      businessDate: businessDate ?? localDateStr(clearedAt),
      cashierName,
    });
  }

  async clearCreditsByIds(
    creditIds: number[],
    clearedAt: number,
    companyId = 1,
    method: RepaymentMethod = "Cash",
    notes?: string,
    businessDate?: string,
    cashierName?: string,
  ): Promise<number> {
    if (creditIds.length === 0) return 0;
    const uniqueIds = Array.from(new Set(creditIds));
    return await this.db.tx(async () => {
      const bDate = businessDate ?? localDateStr(clearedAt);
      let settled = 0;
      for (const id of uniqueIds) {
        const rep = await this.recordRepayment({
          companyId,
          creditId: id,
          method,
          ts: clearedAt,
          businessDate: bDate,
          ...(notes ? { notes } : {}),
          cashierName,
        });
        settled += rep.amountCents;
      }
      return settled;
    });
  }

  async clearCreditsByName(
    name: string,
    clearedAt: number,
    companyId = 1,
    method: RepaymentMethod = "Cash",
    notes?: string,
    businessDate?: string,
    cashierName?: string,
  ): Promise<number> {
    const target = name.trim().toLowerCase();
    const openCredits = await this.listCredits(companyId, { outstandingOnly: true });
    const matched = openCredits.filter((c) => c.name.trim().toLowerCase() === target);
    return this.clearCreditsByIds(
      matched.map((c) => c.id),
      clearedAt,
      companyId,
      method,
      notes,
      businessDate,
      cashierName,
    );
  }

  async listRepayments(opts?: {
    companyId?: number;
    businessDate?: string;
    fromDate?: string;
    toDate?: string;
  }): Promise<Repayment[]> {
    const conds = [];
    if (opts?.companyId != null) conds.push(eq(repayments.companyId, opts.companyId));
    if (opts?.businessDate != null) conds.push(eq(repayments.businessDate, opts.businessDate));
    if (opts?.fromDate != null) conds.push(gte(repayments.businessDate, opts.fromDate));
    if (opts?.toDate != null) conds.push(lte(repayments.businessDate, opts.toDate));

    const rows = await this.dz
      .select({
        repayment: repayments,
        creditorName: credits.name,
        contractorName: contractors.name,
      })
      .from(repayments)
      .leftJoin(credits, eq(repayments.creditId, credits.id))
      .leftJoin(contractors, eq(repayments.contractorId, contractors.id))
      .where(and(...conds))
      .orderBy(desc(repayments.ts));

    return rows.map((r) =>
      toRepayment(r.repayment, r.contractorName ?? r.creditorName ?? undefined),
    );
  }

  async listRepaymentsByBusinessDate(fromDate: string, toDate: string, companyId = 1): Promise<Repayment[]> {
    return this.listRepayments({ companyId, fromDate, toDate });
  }

  /** Map order_id -> creditor name for the given orders (only credit orders have one). */
  private async creditorNamesFor(orderIds: number[]): Promise<Map<number, string>> {
    if (orderIds.length === 0) return new Map();
    const rows = await this.dz
      .select()
      .from(credits)
      .where(inArray(credits.orderId, orderIds));
    const m = new Map<number, string>();
    for (const r of rows) if (!m.has(r.orderId)) m.set(r.orderId, r.name);
    return m;
  }

  private async linesForOrders(orderIds: number[]): Promise<Map<number, OrderLine[]>> {
    const byOrder = new Map<number, OrderLine[]>();
    if (orderIds.length === 0) return byOrder;
    const rows = await this.dz
      .select({ line: orderItems, item: items })
      .from(orderItems)
      .leftJoin(items, eq(orderItems.itemId, items.id))
      .where(inArray(orderItems.orderId, orderIds))
      .orderBy(asc(orderItems.id));
    if (rows.length === 0) return byOrder;
    const itemIds = [...new Set(rows.map((r) => r.line.itemId))];
    const tierRows = await this.dz
      .select()
      .from(priceTiers)
      .where(inArray(priceTiers.itemId, itemIds));
    const tiersByItem = new Map<number, PriceTier[]>();
    for (const t of tierRows) {
      (tiersByItem.get(t.itemId) ?? tiersByItem.set(t.itemId, []).get(t.itemId)!).push(toTier(t));
    }
    for (const r of rows) {
      const line = toLine(r.line, r.item, tiersByItem.get(r.line.itemId) ?? []);
      const list = byOrder.get(r.line.orderId);
      if (list) list.push(line);
      else byOrder.set(r.line.orderId, [line]);
    }
    return byOrder;
  }

  private async refundInvNosFor(orderIds: number[]): Promise<Map<number, string>> {
    if (orderIds.length === 0) return new Map();
    const rows = await this.dz
      .select({ id: orders.id, invNo: orders.invNo })
      .from(orders)
      .where(inArray(orders.id, orderIds));
    return new Map(rows.map((r) => [r.id, r.invNo ?? String(r.id)]));
  }

  async getOrder(id: number): Promise<Order | null> {
    const rows = await this.dz.select().from(orders).where(eq(orders.id, id)).limit(1);
    if (rows.length === 0) return null;
    const r = rows[0]!;
    const [names, linesMap, refundInvNos] = await Promise.all([
      r.method === "Credit" ? this.creditorNamesFor([id]) : Promise.resolve(new Map<number, string>()),
      this.linesForOrders([id]),
      r.refundOfOrderId != null ? this.refundInvNosFor([r.refundOfOrderId]) : Promise.resolve(new Map<number, string>()),
    ]);
    const refInvNo = r.refundOfOrderId != null ? refundInvNos.get(r.refundOfOrderId) : undefined;
    return this.toOrder(r, linesMap.get(id) ?? [], names.get(id), refInvNo);
  }

  async listOrders(startMs: number, endMs: number, companyId?: number): Promise<Order[]> {
    const conds = [gte(orders.ts, startMs), lt(orders.ts, endMs)];
    if (companyId != null) conds.push(eq(orders.companyId, companyId));
    const rows = await this.dz
      .select()
      .from(orders)
      .where(and(...conds))
      .orderBy(desc(orders.ts));
    const refundOriginIds = rows.map((r) => r.refundOfOrderId).filter((id): id is number => id != null);
    const [names, linesMap, refundInvNos] = await Promise.all([
      this.creditorNamesFor(rows.filter((r) => r.method === "Credit").map((r) => r.id)),
      this.linesForOrders(rows.map((r) => r.id)),
      this.refundInvNosFor(refundOriginIds),
    ]);
    return rows.map((r) =>
      this.toOrder(
        r,
        linesMap.get(r.id) ?? [],
        names.get(r.id),
        r.refundOfOrderId != null ? refundInvNos.get(r.refundOfOrderId) : undefined,
      ),
    );
  }

  private toOrder(
    r: typeof orders.$inferSelect,
    lines: OrderLine[],
    creditorName?: string,
    refundOfInvNo?: string,
  ): Order {
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
      // Sales from before invoice numbers shipped are deliberately never
      // renumbered (their receipts were printed with the order id) — they
      // keep displaying the id; every sale since is numbered at insert.
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
      ...(effectiveContractorName ? {
        contractorName: effectiveContractorName,
        ...(r.method === "Credit" ? { creditorName: effectiveContractorName } : {}),
      } : {}),
      ...(tin ? { customerTin: tin, contractorTin: tin } : {}),
      ...(address ? { customerAddress: address, contractorAddress: address } : {}),
      ...(phone ? { customerPhone: phone, contractorPhone: phone } : {}),
      ...(doNum ? {
        issueDo: true,
        doNumber: doNum,
        doNo: doNum,
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
  }

  async listOrdersByBusinessDate(fromDate: string, toDate: string, companyId?: number): Promise<Order[]> {
    const conds = [gte(orders.businessDate, fromDate), lte(orders.businessDate, toDate)];
    if (companyId != null) conds.push(eq(orders.companyId, companyId));
    const rows = await this.dz
      .select()
      .from(orders)
      .where(and(...conds))
      .orderBy(desc(orders.ts));
    const refundOriginIds = rows.map((r) => r.refundOfOrderId).filter((id): id is number => id != null);
    const [names, linesMap, refundInvNos] = await Promise.all([
      this.creditorNamesFor(rows.filter((r) => r.method === "Credit").map((r) => r.id)),
      this.linesForOrders(rows.map((r) => r.id)),
      this.refundInvNosFor(refundOriginIds),
    ]);
    return rows.map((r) =>
      this.toOrder(
        r,
        linesMap.get(r.id) ?? [],
        names.get(r.id),
        r.refundOfOrderId != null ? refundInvNos.get(r.refundOfOrderId) : undefined,
      ),
    );
  }

  async voidOrder(orderId: number, at: number, voidedBy?: string): Promise<Order> {
    await this.db.tx(async () => {
      // Guard on the current voided state so a double-void can't restore
      // the same stock twice.
      const [cur] = await this.dz
        .select({
          voidedAt: orders.voidedAt,
          creditClearedAt: orders.creditClearedAt,
          refundOfOrderId: orders.refundOfOrderId,
        })
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);
      if (!cur) return;

      // Check if any partial repayment or cleared credit exists for this order
      const [clearedCredit] = await this.dz
        .select({ id: credits.id })
        .from(credits)
        .where(and(eq(credits.orderId, orderId), isNotNull(credits.isClear)))
        .limit(1);
      const [existingRepayment] = await this.dz
        .select({ id: repayments.id })
        .from(repayments)
        .where(eq(repayments.orderId, orderId))
        .limit(1);

      // Check if any active (non-voided) refunds exist for this order
      const [activeRefund] = await this.dz
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.refundOfOrderId, orderId), isNull(orders.voidedAt)))
        .limit(1);

      const decision = assertCanVoidOrder({
        voidedAt: cur.voidedAt,
        creditClearedAt: cur.creditClearedAt,
        hasClearedCredit: Boolean(clearedCredit),
        hasRepayment: Boolean(existingRepayment),
        refundOfOrderId: cur.refundOfOrderId,
        hasRefunds: Boolean(activeRefund),
      });
      if (decision === "noop") return;

      await this.dz.update(orders).set({
        voidedAt: at,
        voidedBy: voidedBy?.trim() || null,
      }).where(eq(orders.id, orderId));
      // A cancelled sale puts its stock back on the shelf (tracked items only).
      const lines = await this.dz
        .select({ itemId: orderItems.itemId, qtyMilli: orderItems.qtyMilli })
        .from(orderItems)
        .where(eq(orderItems.orderId, orderId));
      for (const l of lines) {
        await this.db.run(
          "UPDATE items SET stock_milli = stock_milli + ? WHERE id = ? AND stock_milli IS NOT NULL",
          [l.qtyMilli, l.itemId],
        );
      }
      // A cancelled credit sale is no longer owed — drop its credit record.
      await this.dz.delete(credits).where(eq(credits.orderId, orderId));
    });
    return (await this.getOrder(orderId)) as Order;
  }

  async getRefundsForOrder(orderId: number): Promise<Order[]> {
    const rows = await this.dz
      .select()
      .from(orders)
      .where(and(eq(orders.refundOfOrderId, orderId), isNull(orders.voidedAt)))
      .orderBy(asc(orders.ts));
    if (rows.length === 0) return [];
    const [names, linesMap] = await Promise.all([
      this.creditorNamesFor(rows.filter((r) => r.method === "Credit").map((r) => r.id)),
      this.linesForOrders(rows.map((r) => r.id)),
    ]);
    const [origRow] = await this.dz
      .select({ invNo: orders.invNo })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    const origInvNo = origRow?.invNo ?? String(orderId);
    return rows.map((r) => this.toOrder(r, linesMap.get(r.id) ?? [], names.get(r.id), origInvNo));
  }

  async createRefundOrder(input: CreateRefundInput): Promise<Order> {
    const orig = await this.getOrder(input.originalOrderId);
    if (!orig) {
      throw new PosError(`original order #${input.originalOrderId} not found`);
    }
    if (orig.voidedAt != null) {
      throw new PosError("cannot refund a voided order");
    }
    if (orig.refundOfOrderId != null) {
      throw new PosError("cannot refund a refund order");
    }

    const priorRefunds = await this.getRefundsForOrder(orig.id);
    const itemIds = (input.lines ?? []).map((l) => l.itemId);
    const stockRows = itemIds.length > 0
      ? await this.dz
          .select({ id: items.id, stockMilli: items.stockMilli })
          .from(items)
          .where(inArray(items.id, itemIds))
      : [];

    const plan = planPartialRefund(orig, priorRefunds, input.lines, stockRows);

    const id = await this.db.tx(async () => {
      const ts = input.ts ?? Date.now();
      const businessDate = input.businessDate?.trim() || orig.businessDate || localDateStr(ts);
      const companyId = orig.companyId ?? 1;

      // Invoice sequence matching original prefix
      const prefix = orig.invNo.startsWith("B-") || orig.method === "Credit" ? "B" : "A";
      const [seqRow] = await this.db.all(
        `SELECT COALESCE(MAX(CAST(substr(inv_no, 3) AS INTEGER)), 0) + 1 AS seq
         FROM orders
         WHERE company_id = ?
           AND substr(business_date, 1, 7) = ?
           AND inv_no LIKE ?`,
        [companyId, businessDate.slice(0, 7), `${prefix}-%`],
      );
      const invNo = formatInvNo(prefix, Number(seqRow?.seq ?? 1));

      const [o] = await this.dz
        .insert(orders)
        .values({
          companyId,
          ts,
          businessDate,
          invNo,
          customerType: orig.customerType ?? "walkin",
          contractorId: orig.contractorId ?? null,
          contractorName: orig.contractorName ?? null,
          customerTin: orig.customerTin ?? null,
          customerAddress: orig.customerAddress ?? null,
          customerPhone: orig.customerPhone ?? null,
          discountCents: 0,
          totalCents: plan.totalCents, // Negative total!
          method: orig.method, // Matching original payment method!
          cashierName: input.cashierName?.trim() || orig.cashierName || null,
          note: input.note?.trim() || null,
          refundOfOrderId: orig.id,
        })
        .returning({ id: orders.id });

      // Insert refund lines
      for (const line of plan.lines) {
        await this.dz.insert(orderItems).values({
          orderId: o!.id,
          itemId: line.itemId,
          unit: line.unit ?? null,
          priceCents: line.priceCents,
          origPriceCents: line.origPriceCents ?? null,
          customName: line.customName ?? null,
          qtyMilli: line.qtyMilli,
          tailCount: 0,
        });
      }

      // Replenish stock for returned items
      for (const repl of plan.replenishments) {
        await this.db.run(
          "UPDATE items SET stock_milli = stock_milli + ? WHERE id = ? AND stock_milli IS NOT NULL",
          [repl.qtyMilli, repl.itemId],
        );
      }

      // If original order was Credit, adjust outstanding credit in credits table
      if (orig.method === "Credit") {
        const refundAmount = Math.abs(plan.totalCents);
        let remainingToDeduct = refundAmount;
        const openCredits = await this.dz
          .select()
          .from(credits)
          .where(and(eq(credits.orderId, orig.id), isNull(credits.isClear)));

        for (const c of openCredits) {
          if (remainingToDeduct <= 0) break;
          if (c.amountCents <= remainingToDeduct) {
            remainingToDeduct -= c.amountCents;
            await this.dz
              .update(credits)
              .set({
                amountCents: 0,
                isClear: ts,
              })
              .where(eq(credits.id, c.id));
          } else {
            await this.dz
              .update(credits)
              .set({
                amountCents: c.amountCents - remainingToDeduct,
              })
              .where(eq(credits.id, c.id));
            remainingToDeduct = 0;
          }
        }

        const openRemaining = await this.dz
          .select({ id: credits.id })
          .from(credits)
          .where(and(eq(credits.orderId, orig.id), isNull(credits.isClear)));
        if (openRemaining.length === 0 && openCredits.length > 0) {
          await this.dz
            .update(orders)
            .set({ creditClearedAt: ts })
            .where(eq(orders.id, orig.id));
        }
      }

      return o!.id;
    });

    return (await this.getOrder(id))!;
  }

  // --- business days (Close Day) ---
  private toDayClose(r: typeof dayCloses.$inferSelect): DayClose {
    return {
      id: r.id,
      companyId: r.companyId,
      businessDate: r.businessDate,
      closedAt: r.closedAt,
      auto: r.auto,
      closedBy: r.closedBy ?? null,
    };
  }

  async getDayClose(businessDate: string, companyId = 1): Promise<DayClose | null> {
    const rows = await this.dz
      .select()
      .from(dayCloses)
      .where(and(eq(dayCloses.businessDate, businessDate), eq(dayCloses.companyId, companyId)))
      .limit(1);
    return rows.length ? this.toDayClose(rows[0]!) : null;
  }

  async closeDay(
    businessDate: string,
    opts: { companyId?: number; auto?: boolean; at?: number; closedBy?: string } = {},
  ): Promise<DayClose> {
    const companyId = opts.companyId ?? 1;
    const wallToday = localDateStr(opts.at ?? Date.now());
    const existingClose = await this.getDayClose(businessDate, companyId);
    assertCanCloseDay(businessDate, wallToday, Boolean(existingClose));
    const closedBy = opts.closedBy?.trim() || null;
    const [row] = await this.dz
      .insert(dayCloses)
      .values({
        companyId,
        businessDate,
        closedAt: opts.at ?? Date.now(),
        auto: opts.auto ?? false,
        closedBy,
      })
      .returning({ id: dayCloses.id });
    return (
      (await this.getDayClose(businessDate, companyId)) ?? {
        id: row!.id,
        companyId,
        businessDate,
        closedAt: opts.at ?? Date.now(),
        auto: opts.auto ?? false,
        closedBy,
      }
    );
  }

  async reopenDay(businessDate: string, companyId = 1): Promise<void> {
    const next = nextDateStr(businessDate);
    await this.db.tx(async () => {
      await this.dz
        .delete(dayCloses)
        .where(and(eq(dayCloses.businessDate, businessDate), eq(dayCloses.companyId, companyId)));
      // Sales pushed to the next business day by the close, but physically rung
      // up on this calendar day, come back to the reopened day. The calendar-day
      // check runs in JS — sql.js has no reliable 'localtime'.
      const pushed = await this.dz
        .select({ id: orders.id, ts: orders.ts })
        .from(orders)
        .where(and(eq(orders.businessDate, next), eq(orders.companyId, companyId)));
      const ids = filterPushedRecordIds(pushed, businessDate);
      if (ids.length) {
        await this.dz.update(orders).set({ businessDate }).where(inArray(orders.id, ids));
      }
      // Repayments pushed to the next business day also come back to the reopened day
      const pushedRepayments = await this.dz
        .select({ id: repayments.id, ts: repayments.ts })
        .from(repayments)
        .where(and(eq(repayments.businessDate, next), eq(repayments.companyId, companyId)));
      const repIds = filterPushedRecordIds(pushedRepayments, businessDate);
      if (repIds.length) {
        await this.dz.update(repayments).set({ businessDate }).where(inArray(repayments.id, repIds));
      }
    });
  }

  async listUnclosedDays(beforeDate: string, companyId?: number): Promise<string[]> {
    const rows = await this.db.all(
      `SELECT DISTINCT d FROM (
         SELECT business_date AS d, company_id FROM orders WHERE business_date IS NOT NULL
         UNION
         SELECT business_date AS d, company_id FROM repayments WHERE business_date IS NOT NULL
       ) t
       WHERE t.d < ?
         ${companyId != null ? "AND t.company_id = ?" : ""}
         AND NOT EXISTS (
           SELECT 1 FROM day_closes c
           WHERE c.business_date = t.d AND c.company_id = t.company_id
         )
       ORDER BY d ASC`,
      companyId != null ? [beforeDate, companyId] : [beforeDate],
    );
    return rows.map((r) => String(r.d));
  }

  // --- settings ---
  async getSetting(key: string): Promise<string | null> {
    const rows = await this.dz.select().from(settings).where(eq(settings.key, key)).limit(1);
    return rows.length ? rows[0]!.value : null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.dz
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } });
  }

  // --- outbox ---
  async queueEmail(input: {
    companyId?: number;
    businessDate: string;
    subject: string;
    body: string;
    attachmentName?: string;
    attachmentB64?: string;
    channel?: "drive" | "email";
  }): Promise<number> {
    const companyId = input.companyId ?? 1;
    const channel = input.channel ?? "drive";
    if (input.attachmentName) {
      const existing = await this.dz
        .select({ id: outbox.id })
        .from(outbox)
        .where(
          and(
            eq(outbox.companyId, companyId),
            eq(outbox.businessDate, input.businessDate),
            eq(outbox.attachmentName, input.attachmentName),
            eq(outbox.channel, channel),
          ),
        )
        .limit(1);
      if (existing.length > 0) {
        const id = existing[0]!.id;
        await this.dz
          .update(outbox)
          .set({
            subject: input.subject,
            body: input.body,
            attachmentB64: input.attachmentB64 ?? null,
            sentAt: null,
            lastError: null,
          })
          .where(eq(outbox.id, id));
        return id;
      }
    }
    const [row] = await this.dz
      .insert(outbox)
      .values({
        companyId,
        businessDate: input.businessDate,
        subject: input.subject,
        body: input.body,
        attachmentName: input.attachmentName ?? null,
        attachmentB64: input.attachmentB64 ?? null,
        channel,
        createdAt: Date.now(),
      })
      .returning({ id: outbox.id });
    return row!.id;
  }

  async listOutbox(businessDate?: string): Promise<
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
  > {
    const rows = await this.dz
      .select()
      .from(outbox)
      .where(businessDate != null ? eq(outbox.businessDate, businessDate) : undefined)
      .orderBy(desc(outbox.createdAt));
    return rows.map((r) => ({
      id: r.id,
      companyId: r.companyId,
      businessDate: r.businessDate,
      subject: r.subject,
      attachmentName: r.attachmentName ?? null,
      channel: (r.channel === "email" ? "email" : "drive") as "drive" | "email",
      createdAt: r.createdAt,
      sentAt: r.sentAt ?? null,
      attempts: r.attempts,
      lastError: r.lastError ?? null,
    }));
  }

  async listCreditOrdersForContractor(
    contractorId: number,
    companyId = 1,
    opts?: { upToYearMonth?: string },
  ): Promise<Order[]> {
    const contractor = await this.getContractor(contractorId);
    if (!contractor) return [];

    const params: any[] = [companyId, contractorId, contractor.name, contractor.name];
    let dateFilter = "";
    if (opts?.upToYearMonth) {
      dateFilter = "AND substr(COALESCE(o.business_date, ''), 1, 7) <= ?";
      params.push(opts.upToYearMonth);
    }

    const rows = await this.db.all(
      `SELECT o.*
       FROM orders o
       LEFT JOIN credits c ON c.order_id = o.id
       WHERE o.company_id = ?
         AND o.method = 'Credit'
         AND o.voided_at IS NULL
         AND (
           o.contractor_id = ?
           OR lower(trim(COALESCE(o.contractor_name, ''))) = lower(trim(?))
           OR lower(trim(COALESCE(c.name, ''))) = lower(trim(?))
         )
         ${dateFilter}
       GROUP BY o.id
       ORDER BY o.business_date ASC, o.ts ASC, o.id ASC`,
      params,
    );

    if (rows.length === 0) return [];

    const orderIds = rows.map((r: any) => Number(r.id));
    const refundOriginIds = rows
      .map((r: any) => r.refund_of_order_id)
      .filter((id: any): id is number => id != null);

    const [names, linesMap, refundInvNos] = await Promise.all([
      this.creditorNamesFor(orderIds),
      this.linesForOrders(orderIds),
      this.refundInvNosFor(refundOriginIds),
    ]);

    return rows.map((r: any) => {
      const rowCamel: typeof orders.$inferSelect = {
        id: Number(r.id),
        companyId: Number(r.company_id),
        ts: Number(r.ts),
        businessDate: r.business_date ?? null,
        invNo: r.inv_no ?? null,
        customerType: r.customer_type ?? "walkin",
        contractorId: r.contractor_id != null ? Number(r.contractor_id) : null,
        contractorName: r.contractor_name ?? null,
        customerTin: r.customer_tin ?? null,
        customerAddress: r.customer_address ?? null,
        customerPhone: r.customer_phone ?? null,
        doNumber: r.do_number ?? r.do_no ?? null,
        siteAddress: r.site_address ?? null,
        lorryPlate: r.lorry_plate ?? null,
        driverName: r.driver_name ?? null,
        contractorPo: r.contractor_po ?? null,
        showPriceOnDo: r.show_price_on_do != null ? Boolean(r.show_price_on_do) : null,
        discountCents: Number(r.discount_cents ?? 0),
        totalCents: Number(r.total_cents),
        refundOfOrderId: r.refund_of_order_id != null ? Number(r.refund_of_order_id) : null,
        method: r.method,
        cashierName: r.cashier_name ?? null,
        note: r.note ?? null,
        voidedAt: r.voided_at != null ? Number(r.voided_at) : null,
        voidedBy: r.voided_by ?? null,
        creditClearedAt: r.credit_cleared_at != null ? Number(r.credit_cleared_at) : null,
      };
      return this.toOrder(
        rowCamel,
        linesMap.get(rowCamel.id) ?? [],
        names.get(rowCamel.id),
        rowCamel.refundOfOrderId != null ? refundInvNos.get(rowCamel.refundOfOrderId) : undefined,
      );
    });
  }

  async listRepaymentsForContractor(
    contractorId: number,
    companyId = 1,
    opts?: { upToYearMonth?: string },
  ): Promise<Repayment[]> {
    const contractor = await this.getContractor(contractorId);
    if (!contractor) return [];

    const params: any[] = [companyId, contractorId, contractor.name, contractor.name];
    let dateFilter = "";
    if (opts?.upToYearMonth) {
      dateFilter = "AND substr(COALESCE(r.business_date, ''), 1, 7) <= ?";
      params.push(opts.upToYearMonth);
    }

    const rows = await this.db.all(
      `SELECT r.*, c.name AS creditor_name, ct.name AS contractor_name
       FROM repayments r
       LEFT JOIN credits c ON r.credit_id = c.id
       LEFT JOIN contractors ct ON r.contractor_id = ct.id
       WHERE r.company_id = ?
         AND (
           r.contractor_id = ?
           OR lower(trim(COALESCE(ct.name, ''))) = lower(trim(?))
           OR lower(trim(COALESCE(c.name, ''))) = lower(trim(?))
         )
         ${dateFilter}
       ORDER BY r.business_date ASC, r.ts ASC, r.id ASC`,
      params,
    );

    return rows.map((r: any) => {
      const repRow: typeof repayments.$inferSelect = {
        id: Number(r.id),
        companyId: Number(r.company_id),
        creditId: Number(r.credit_id),
        orderId: Number(r.order_id),
        contractorId: r.contractor_id != null ? Number(r.contractor_id) : null,
        amountCents: Number(r.amount_cents),
        method: r.method,
        ts: Number(r.ts),
        businessDate: r.business_date,
        notes: r.notes ?? null,
        cashierName: r.cashier_name ?? null,
      };
      return toRepayment(repRow, r.contractor_name ?? r.creditor_name ?? undefined);
    });
  }

  async getContractorMonthlyStatement(
    contractorIdOrName: number | string,
    yearMonth: string,
    companyId = 1,
  ): Promise<ContractorMonthlyStatement> {
    let contractor: Contractor | null = null;
    if (typeof contractorIdOrName === "number") {
      contractor = await this.getContractor(contractorIdOrName);
    } else {
      contractor = await this.getContractorByName(contractorIdOrName, companyId);
      if (!contractor && !isNaN(Number(contractorIdOrName))) {
        contractor = await this.getContractor(Number(contractorIdOrName));
      }
    }
    if (!contractor) {
      throw new PosError(`contractor "${contractorIdOrName}" not found`);
    }

    const [creditOrders, repaymentsList] = await Promise.all([
      this.listCreditOrdersForContractor(contractor.id, companyId, { upToYearMonth: yearMonth }),
      this.listRepaymentsForContractor(contractor.id, companyId, { upToYearMonth: yearMonth }),
    ]);

    return calculateContractorStatement(contractor, yearMonth, creditOrders, repaymentsList);
  }
}
