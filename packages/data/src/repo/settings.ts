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

export class SettingsRepo {
  constructor(protected readonly repo: any) {}

  protected get db(): SqlDriver { return this.repo.db; }
  protected get dz(): DrizzleDb { return this.repo.dz; }

  // PosRepo interface declarations for cross-method calls

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

}
