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

export class ContractorsRepo {
  constructor(protected readonly repo: any) {}

  protected get db(): SqlDriver { return this.repo.db; }
  protected get dz(): DrizzleDb { return this.repo.dz; }

  // PosRepo interface declarations for cross-method calls

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
}
