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

export class CloseDayRepo {
  constructor(protected readonly repo: any) {}

  protected get db(): SqlDriver { return this.repo.db; }
  protected get dz(): DrizzleDb { return this.repo.dz; }

  // PosRepo interface declarations for cross-method calls

  async getDayClose(businessDate: string, companyId = 1): Promise<DayClose | null> {
    const rows = await this.dz
      .select()
      .from(dayCloses)
      .where(and(eq(dayCloses.businessDate, businessDate), eq(dayCloses.companyId, companyId)))
      .limit(1);
    return rows.length ? toDayClose(rows[0]!) : null;
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
}
