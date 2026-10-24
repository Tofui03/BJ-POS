import Decimal from "decimal.js";
import type { Cents, Milli, PriceTier, PricedItem } from "./types.js";
import { lineAmount } from "./money.js";
import { PosError } from "./errors.js";

// Quantity-break pricing. Example: Talapia is RM18/kg, but a tier
// { minQtyMilli: 30000, priceCents: 1500 } drops it to RM15/kg once the line
// reaches 30 kg. The *highest* qualifying tier wins, so tiers can be listed in
// any order. The base item price applies below the lowest tier.

/** Sort tiers ascending by threshold (defensive — callers may pass any order). */
const byThreshold = (a: PriceTier, b: PriceTier): number =>
  a.minQtyMilli - b.minQtyMilli;

/** The unit price (cents) charged for `qtyMilli` of this item, after tiers. */
export function effectiveUnitPrice(item: PricedItem, qtyMilli: Milli): Cents {
  let price = item.priceCents;
  for (const tier of [...item.tiers].sort(byThreshold)) {
    if (qtyMilli >= tier.minQtyMilli) price = tier.priceCents;
  }
  return price;
}

/** The applied tier (if any) — handy for showing "discount applied" in the UI. */
export function appliedTier(item: PricedItem, qtyMilli: Milli): PriceTier | null {
  let applied: PriceTier | null = null;
  for (const tier of [...item.tiers].sort(byThreshold)) {
    if (qtyMilli >= tier.minQtyMilli) applied = tier;
  }
  return applied;
}

/** Effective unit price + line total for a quantity of an item. */
export function priceLine(
  item: PricedItem,
  qtyMilli: Milli,
): { unitCents: Cents; amountCents: Cents; tier: PriceTier | null } {
  const unitCents = effectiveUnitPrice(item, qtyMilli);
  return {
    unitCents,
    amountCents: lineAmount(unitCents, qtyMilli),
    tier: appliedTier(item, qtyMilli),
  };
}

export interface ReversePriceLineResult {
  qtyMilli: Milli;
  unitPriceCents: Cents;
  unitCents: Cents;
  lineAmountCents: Cents;
  amountCents: Cents;
  tier: PriceTier | null;
}

/**
 * Reverse calculation: computes target quantity in milli-units from target amount in cents
 * and unit price in cents per 1.000 unit (1000 milli-units).
 *
 * Formula: targetAmountCents * 1000 / unitPriceCents with ROUND_HALF_UP.
 * Zero float precision loss via Decimal.js.
 *
 * Throws PosError if unitPriceCents <= 0 or targetAmountCents < 0.
 */
export function calcReverseQuantity(targetAmountCents: Cents, unitPriceCents: Cents): Milli {
  if (!Number.isFinite(unitPriceCents) || unitPriceCents <= 0) {
    throw new PosError("unit price must be positive for reverse quantity calculation");
  }
  if (!Number.isFinite(targetAmountCents) || targetAmountCents < 0) {
    throw new PosError("target amount cannot be negative");
  }
  if (targetAmountCents === 0) return 0;
  return new Decimal(targetAmountCents)
    .mul(1000)
    .div(unitPriceCents)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
}

/**
 * Reverse calculate quantity and effective unit price for a target budget, taking
 * quantity-break discount tiers into account.
 * Evaluates tiers in descending threshold order to find the highest qualifying discount tier.
 */
export function reversePriceLine(
  item: PricedItem,
  targetAmountCents: Cents,
): ReversePriceLineResult {
  if (!Number.isFinite(targetAmountCents) || targetAmountCents < 0) {
    throw new PosError("target amount cannot be negative");
  }
  if (targetAmountCents === 0) {
    return {
      qtyMilli: 0,
      unitPriceCents: item.priceCents,
      unitCents: item.priceCents,
      lineAmountCents: 0,
      amountCents: 0,
      tier: null,
    };
  }

  // Sort tiers descending by threshold (highest quantity break first)
  const descendingTiers = [...item.tiers].sort((a, b) => b.minQtyMilli - a.minQtyMilli);
  let qualifyingTier: PriceTier | null = null;
  let targetUnitPrice = item.priceCents;
  let targetQtyMilli = 0;

  for (const tier of descendingTiers) {
    if (tier.priceCents <= 0) continue;
    const tentativeQty = calcReverseQuantity(targetAmountCents, tier.priceCents);
    if (tentativeQty >= tier.minQtyMilli) {
      qualifyingTier = tier;
      targetUnitPrice = tier.priceCents;
      targetQtyMilli = tentativeQty;
      break;
    }
  }

  if (!qualifyingTier) {
    targetUnitPrice = item.priceCents;
    targetQtyMilli = calcReverseQuantity(targetAmountCents, item.priceCents);
  }

  const effectiveAmountCents = lineAmount(targetUnitPrice, targetQtyMilli);

  return {
    qtyMilli: targetQtyMilli,
    unitPriceCents: targetUnitPrice,
    unitCents: targetUnitPrice,
    lineAmountCents: effectiveAmountCents,
    amountCents: effectiveAmountCents,
    tier: qualifyingTier,
  };
}
