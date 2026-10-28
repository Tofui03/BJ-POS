import type { Order, Period, Stats, PaymentMethod, Unit, Cents, Milli, Repayment, FinancialMetrics } from "./types.js";
import { PAYMENT_METHODS } from "./types.js";

/**
 * Compute the 3 core financial metrics with zero double-counting:
 * 1. 营业额 (Gross Merchandise Sales): 现金/QR/卡/银行销售 + 赊账销售 - 退货 (不含历史欠款回收 repayments).
 * 2. 实收资金 (Realized Inflow): 非赊账销售 + 当日收回的欠款 (repayments).
 * 3. 钱箱应有净现金 (Expected Drawer Cash): 现金销售 + 现金还款 - 现金退货.
 */
export function computeFinancialMetrics(
  orders: Order[],
  repayments: Repayment[] = [],
): FinancialMetrics {
  let grossMerchandiseSalesCents = 0;
  let nonCreditSalesCents = 0;
  let creditSalesCents = 0;
  let cashSalesCents = 0;
  let cashRefundsCents = 0;
  let refundsCount = 0;
  let refundsTotalCents = 0;

  for (const o of orders) {
    if (o.voidedAt != null) continue;
    const isRefund = o.refundOfOrderId != null || o.totalCents < 0;

    grossMerchandiseSalesCents += o.totalCents;

    if (o.method === "Credit") {
      creditSalesCents += o.totalCents;
    } else {
      nonCreditSalesCents += o.totalCents;
    }

    if (o.method === "Cash") {
      if (isRefund) {
        cashRefundsCents += Math.abs(o.totalCents);
      } else {
        cashSalesCents += o.totalCents;
      }
    }

    if (isRefund) {
      refundsCount++;
      refundsTotalCents += Math.abs(o.totalCents);
    }
  }

  let repaymentsTotalCents = 0;
  let cashRepaymentsCents = 0;
  for (const r of repayments) {
    repaymentsTotalCents += r.amountCents;
    if (r.method === "Cash") {
      cashRepaymentsCents += r.amountCents;
    }
  }

  const realizedInflowCents = nonCreditSalesCents + repaymentsTotalCents;
  const expectedDrawerCashCents = cashSalesCents + cashRepaymentsCents - cashRefundsCents;

  return {
    grossMerchandiseSalesCents,
    realizedInflowCents,
    expectedDrawerCashCents,
    refundsCount,
    refundsTotalCents,
    repaymentsCount: repayments.length,
    repaymentsTotalCents,
    nonCreditSalesCents,
    creditSalesCents,
    cashSalesCents,
    cashRepaymentsCents,
    cashRefundsCents,
  };
}

/** A period → [startMs, endMs) window, computed from `now` (injectable for tests). */
export function periodRange(period: Period, now: Date = new Date()): [number, number] {
  if (period === "today") {
    const s = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return [s, s + 86_400_000];
  }
  if (period === "month") {
    const s = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const e = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
    return [s, e];
  }
  return [0, Number.MAX_SAFE_INTEGER]; // "all"
}

/** Aggregate already-fetched orders and repayments into count/total + per-method breakdown. */
export function computeStats(
  orders: Order[],
  period: Period,
  repayments: Repayment[] = [],
): Stats {
  const byMethod = Object.fromEntries(
    PAYMENT_METHODS.map((m) => [m, { count: 0, totalCents: 0 }]),
  ) as Record<PaymentMethod, { count: number; totalCents: number }>;

  // Voided (cancelled) sales never count toward totals.
  let totalCents = 0;
  let count = 0;
  let refundsCount = 0;
  let refundsTotalCents = 0;
  for (const o of orders) {
    if (o.voidedAt != null) continue;
    count++;
    totalCents += o.totalCents;
    const bucket = byMethod[o.method];
    bucket.count++;
    bucket.totalCents += o.totalCents;
    if (o.refundOfOrderId != null || o.totalCents < 0) {
      refundsCount++;
      refundsTotalCents += Math.abs(o.totalCents);
    }
  }

  let repaymentsTotalCents = 0;
  for (const r of repayments) {
    repaymentsTotalCents += r.amountCents;
    totalCents += r.amountCents;
    const bucket = byMethod[r.method];
    if (bucket) {
      bucket.totalCents += r.amountCents;
    }
  }

  return {
    period,
    count,
    totalCents,
    byMethod,
    repaymentsTotalCents,
    repaymentsCount: repayments.length,
    refundsCount,
    refundsTotalCents,
  };
}

/** Per-product roll-up: how much of each item sold and what it earned. */
export interface ItemSale {
  itemId: number;
  name: string;
  image: string;
  unit: Unit;
  qtyMilli: Milli;
  /** total head count ("ekor") sold; 0 for items that don't track tails */
  tailCount: number;
  amountCents: Cents;
  /** number of sale lines this item appeared in */
  lines: number;
}

/**
 * Aggregate order line items into per-product totals, sorted by quantity sold
 * (descending) — so the first entry is the "top seller". Keyed by itemId.
 */
export function aggregateItemSales(orders: Order[]): ItemSale[] {
  const map = new Map<number, ItemSale>();
  for (const o of orders) {
    if (o.voidedAt != null) continue; // cancelled sales sold nothing
    const isRefund = o.refundOfOrderId != null || o.totalCents < 0;
    const sign = isRefund ? -1 : 1;
    for (const l of o.items) {
      const cur = map.get(l.itemId);
      if (cur) {
        cur.qtyMilli += sign * l.qtyMilli;
        cur.tailCount += sign * l.tailCount;
        cur.amountCents += sign * l.amountCents;
        cur.lines += 1;
      } else {
        map.set(l.itemId, {
          itemId: l.itemId,
          name: l.name,
          image: l.image,
          unit: l.unit,
          qtyMilli: sign * l.qtyMilli,
          tailCount: sign * l.tailCount,
          amountCents: sign * l.amountCents,
          lines: 1,
        });
      }
    }
  }
  return [...map.values()]
    .filter((s) => s.qtyMilli > 0 || s.amountCents > 0)
    .sort((a, b) => b.qtyMilli - a.qtyMilli);
}
