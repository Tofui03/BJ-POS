import { PosError } from "./errors.js";
import { matchesHardwareSearch } from "./hardware-catalog.js";
import { assertPositiveMilli } from "./money.js";
import type { Item, Milli, StockFilterOptions, StockStatus } from "./types.js";

// An item opts into stock tracking by having a non-null stockMilli; null means
// "don't track" and sells without limit. Countable units hold whole counts
// (5 cups = 5000), kg items hold weight (12.5 kg = 12500) — either way sales
// deduct the sold qtyMilli. Independent of Ekor: a tail-tracking fish can also
// track stock, and its head count never touches the stock figure.

type Stockable = Pick<Item, "stockMilli">;

/** Default threshold in milli-units (5,000 milli = 5.000 units). */
export const DEFAULT_LOW_STOCK_THRESHOLD_MILLI: Milli = 5000;

/** True when sales of this item deduct (and are capped by) its stock. */
export function isStockTracked(item: Stockable): boolean {
  return item.stockMilli != null;
}

/** Milli-units still sellable; Infinity when the item isn't tracked. */
export function stockLeftMilli(item: Stockable): Milli {
  return isStockTracked(item) ? Math.max(0, item.stockMilli!) : Number.POSITIVE_INFINITY;
}

/**
 * Checks whether an item is low on stock (stockMilli <= thresholdMilli).
 * Untracked items (stockMilli == null) sell without limit and return false.
 */
export function isLowStock(
  item: Stockable,
  thresholdMilli: number = DEFAULT_LOW_STOCK_THRESHOLD_MILLI,
): boolean {
  if (!isStockTracked(item)) return false;
  return item.stockMilli! <= thresholdMilli;
}

/**
 * Classifies an item's inventory status:
 * - "untracked": stockMilli is null
 * - "out_of_stock": tracked and stockMilli <= 0
 * - "low_stock": tracked and 0 < stockMilli <= thresholdMilli
 * - "in_stock": tracked and stockMilli > thresholdMilli
 */
export function getStockStatus(
  item: Stockable,
  thresholdMilli: number = DEFAULT_LOW_STOCK_THRESHOLD_MILLI,
): StockStatus {
  if (!isStockTracked(item)) return "untracked";
  const stock = item.stockMilli!;
  if (stock <= 0) return "out_of_stock";
  if (stock <= thresholdMilli) return "low_stock";
  return "in_stock";
}

/**
 * Comparator for sorting items by stock quantity in ascending order.
 * Tracked items appear first (lowest stock first, e.g. -500, 0, 1000, 5000).
 * Untracked items (null) appear at the end.
 * Ties break deterministically by name, then id.
 */
export function compareStockAscending<
  T extends { stockMilli: number | null; name?: string; id?: number },
>(a: T, b: T): number {
  const aTracked = isStockTracked(a);
  const bTracked = isStockTracked(b);

  if (aTracked && bTracked) {
    const diff = (a.stockMilli ?? 0) - (b.stockMilli ?? 0);
    if (diff !== 0) return diff;
    if (a.name && b.name) {
      const nameDiff = a.name.localeCompare(b.name);
      if (nameDiff !== 0) return nameDiff;
    }
    return (a.id ?? 0) - (b.id ?? 0);
  }
  if (aTracked && !bTracked) return -1;
  if (!aTracked && bTracked) return 1;
  if (a.name && b.name) {
    const nameDiff = a.name.localeCompare(b.name);
    if (nameDiff !== 0) return nameDiff;
  }
  return (a.id ?? 0) - (b.id ?? 0);
}

/**
 * Pure domain filter and sorter for item inventory overview.
 */
export function filterStockItems<T extends Item>(
  items: readonly T[],
  options?: StockFilterOptions,
): T[] {
  if (!options) return [...items];

  const searchKeyword = options.search?.trim().toLowerCase();
  const threshold =
    options.thresholdMilli ??
    options.lowStockThresholdMilli ??
    DEFAULT_LOW_STOCK_THRESHOLD_MILLI;

  let result = items.filter((item) => {
    if (options.trackedOnly && !isStockTracked(item)) {
      return false;
    }
    if (options.lowStockOnly && !isLowStock(item, threshold)) {
      return false;
    }
    if (searchKeyword) {
      const matchName =
        item.name.toLowerCase().includes(searchKeyword) ||
        matchesHardwareSearch(item.name, searchKeyword);
      const matchKey = item.key.toLowerCase().includes(searchKeyword);
      if (!matchName && !matchKey) return false;
    }
    return true;
  });

  if (options.sortAscending || options.sortAsc) {
    result = [...result].sort(compareStockAscending);
  }

  return result;
}

/**
 * Formats a stock quantity in milli-units to a human-readable string.
 * Returns "—" for untracked items (null).
 */
export function formatStockQty(stockMilli: number | null): string {
  if (stockMilli == null) return "—";
  const val = stockMilli / 1000;
  return Number.isInteger(val) ? val.toLocaleString() : val.toFixed(3).replace(/\.?0+$/, "");
}

/** Validate inbound restock quantity; throws PosError if <= 0 or not an integer. */
export function assertValidRestockQuantity(addQtyMilli: number): asserts addQtyMilli is Milli {
  assertPositiveMilli(addQtyMilli, "restock quantity");
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
