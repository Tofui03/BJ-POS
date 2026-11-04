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

export class CatalogRepo {
  constructor(protected readonly repo: any) {}

  protected get db(): SqlDriver { return this.repo.db; }
  protected get dz(): DrizzleDb { return this.repo.dz; }

  // PosRepo interface declarations for cross-method calls

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
        key: patch.key ?? cur.key,
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
}
