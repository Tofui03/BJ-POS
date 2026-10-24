import { PosError } from "./errors.js";
import type { Item, Milli } from "./types.js";

// An item opts into stock tracking by having a non-null stockMilli; null means
// "don't track" and sells without limit. Countable units hold whole counts
// (5 cups = 5000), kg items hold weight (12.5 kg = 12500) — either way sales
// deduct the sold qtyMilli. Independent of Ekor: a tail-tracking fish can also
// track stock, and its head count never touches the stock figure.

type Stockable = Pick<Item, "stockMilli">;

/** True when sales of this item deduct (and are capped by) its stock. */
export function isStockTracked(item: Stockable): boolean {
  return item.stockMilli != null;
}

/** Milli-units still sellable; Infinity when the item isn't tracked. */
export function stockLeftMilli(item: Stockable): Milli {
  return isStockTracked(item) ? Math.max(0, item.stockMilli!) : Number.POSITIVE_INFINITY;
}

export interface StockDeductionRow {
  id: number;
  name: string;
  stockMilli: number | null;
}

export interface OrderLineStockDemand {
  itemId: number;
  qtyMilli: number;
}

export interface StockDeductionPlan {
  itemId: number;
  nextStockMilli: number;
}

/**
 * Pure domain calculation to check stock sufficiency and plan stock deductions.
 * Throws PosError if stock is insufficient for any tracked item.
 * Returns a deduplicated plan of { itemId, nextStockMilli } for tracked items.
 */
export function planStockDeduction(
  stockRows: readonly StockDeductionRow[],
  orderLines: readonly OrderLineStockDemand[],
): StockDeductionPlan[] {
  const stockMap = new Map<number, { name: string; remainingStockMilli: number }>();
  const rowMap = new Map<number, StockDeductionRow>();
  for (const row of stockRows) {
    rowMap.set(row.id, row);
  }

  for (const line of orderLines) {
    const row = rowMap.get(line.itemId);
    if (!row || !isStockTracked(row)) {
      continue;
    }
    let state = stockMap.get(line.itemId);
    if (!state) {
      state = { name: row.name, remainingStockMilli: row.stockMilli! };
      stockMap.set(line.itemId, state);
    }
    if (line.qtyMilli > state.remainingStockMilli) {
      throw new PosError(`not enough stock for ${state.name} — please add more stock`);
    }
    state.remainingStockMilli -= line.qtyMilli;
  }

  return Array.from(stockMap.entries()).map(([itemId, state]) => ({
    itemId,
    nextStockMilli: state.remainingStockMilli,
  }));
}
