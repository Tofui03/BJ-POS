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
import { toItem, toTier, toLine, toContractor, toRepayment, toCredit, toDayClose, toOrder } from "./common.js";

export class OrdersRepo {
  constructor(protected readonly repo: any) {}

  protected get db(): SqlDriver { return this.repo.db; }
  protected get dz(): DrizzleDb { return this.repo.dz; }

  // PosRepo interface declarations for cross-method calls

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
      const requestId = draft.clientRequestId?.trim() || null;
      if (requestId) {
        const [existing] = await this.db.all(
          "SELECT id FROM orders WHERE client_request_id = ?",
          [requestId],
        );
        if (existing?.id != null) return Number(existing.id);
      }
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
      let contractorName = isContractor ? draft.contractorName?.trim() || null : null;
      let customerTin = isContractor ? draft.contractorTin?.trim() || null : null;
      let customerAddress = isContractor ? draft.contractorAddress?.trim() || null : null;
      let customerPhone = isContractor ? draft.contractorPhone?.trim() || null : null;

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
      let doNumber: string | null = draft.doNumber?.trim() || null;
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
          clientRequestId: requestId,
        })
        .returning({ id: orders.id });

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
        const creditor = draft.contractorName?.trim() || contractorName;
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
    return (await this.repo.getOrder(id))!;
  }

  // --- contractors ---

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
    return toOrder(r, linesMap.get(id) ?? [], names.get(id), refInvNo);
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
      toOrder(
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
      toOrder(
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
    return (await this.repo.getOrder(orderId)) as Order;
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
    return rows.map((r) => toOrder(r, linesMap.get(r.id) ?? [], names.get(r.id), origInvNo));
  }

  async createRefundOrder(input: CreateRefundInput): Promise<Order> {
    const id = await this.db.tx(async () => {
      // Reserve the original row before reading remaining quantity, so a second
      // refund cannot plan against a snapshot that does not include this one.
      await this.db.run("UPDATE orders SET voided_at = voided_at WHERE id = ?", [
        input.originalOrderId,
      ]);
      const orig = await this.repo.getOrder(input.originalOrderId);
      if (!orig) {
        throw new PosError(`original order #${input.originalOrderId} not found`);
      }
      if (orig.voidedAt != null) {
        throw new PosError("cannot refund a voided order");
      }
      if (orig.refundOfOrderId != null) {
        throw new PosError("cannot refund a refund order");
      }

      const priorRefunds = await this.repo.getRefundsForOrder(orig.id);
      const itemIds = (input.lines ?? []).map((l) => l.itemId);
      const stockRows = itemIds.length > 0
        ? await this.dz
            .select({ id: items.id, stockMilli: items.stockMilli })
            .from(items)
            .where(inArray(items.id, itemIds))
        : [];

      const plan = planPartialRefund(orig, priorRefunds, input.lines, stockRows);

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
          customerTin: orig.contractorTin ?? null,
          customerAddress: orig.contractorAddress ?? null,
          customerPhone: orig.contractorPhone ?? null,
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

    return (await this.repo.getOrder(id))!;
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

}
