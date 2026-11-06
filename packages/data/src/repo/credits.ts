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

export class CreditsRepo {
  constructor(protected readonly repo: any) {}

  protected get db(): SqlDriver { return this.repo.db; }
  protected get dz(): DrizzleDb { return this.repo.dz; }

  // PosRepo interface declarations for cross-method calls

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
    return await this.db.tx(async () => this.writeRepayment(input));
  }

  /** Every slice of one settlement: payment row, balance, and order stamp. */
  async recordRepayments(inputs: RepaymentInput[]): Promise<Repayment[]> {
    if (inputs.length === 0) return [];
    return await this.db.tx(async () => {
      const written: Repayment[] = [];
      for (const input of inputs) written.push(await this.writeRepayment(input));
      return written;
    });
  }

  private async writeRepayment(input: RepaymentInput): Promise<Repayment> {
    const validated = validateRepayment(input);
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
      const contractor = await this.repo.getContractorByName(creditRow.name, creditRow.companyId);
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
        const rep = await this.writeRepayment({
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

  async listCreditOrdersForContractor(
    contractorId: number,
    companyId = 1,
    opts?: { upToYearMonth?: string },
  ): Promise<Order[]> {
    const contractor = await this.repo.getContractor(contractorId);
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
      this.repo.creditorNamesFor(orderIds),
      this.repo.linesForOrders(orderIds),
      this.repo.refundInvNosFor(refundOriginIds),
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
        doNumber: r.do_number ?? null,
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
        clientRequestId: null,
      };
      return toOrder(
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
    const contractor = await this.repo.getContractor(contractorId);
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
      contractor = await this.repo.getContractor(contractorIdOrName);
    } else {
      contractor = await this.repo.getContractorByName(contractorIdOrName, companyId);
      if (!contractor && !isNaN(Number(contractorIdOrName))) {
        contractor = await this.repo.getContractor(Number(contractorIdOrName));
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
