import {
  computeStats,
  type Order,
  type PaymentMethod,
  type Stats,
  type Unit,
  PAYMENT_METHODS,
} from "@yf/core";

export const METHOD_COLORS: Record<PaymentMethod, { color: string; bg: string; border: string }> = {
  Cash: { color: "#16A34A", bg: "#DCFCE7", border: "#86EFAC" },
  Card: { color: "#2563EB", bg: "#DBEAFE", border: "#93C5FD" },
  QR: { color: "#7C3AED", bg: "#EDE9FE", border: "#C4B5FD" },
  Bank: { color: "#0891B2", bg: "#CFFAFE", border: "#67E8F9" },
  Credit: { color: "#EA580C", bg: "#FFEDD5", border: "#FDBA74" },
};

export const DONUT_RADIUS = 70;
export const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS; // ~439.822971502571

export interface DonutSlice {
  method: PaymentMethod;
  totalCents: number;
  percentage: number; // 0..100
  strokeDasharray: string;
  strokeDashoffset: number;
  color: string;
  arcLength: number;
  isHighlighted: boolean;
  opacity: number;
  strokeWidth: number;
}

export interface DonutResult {
  slices: DonutSlice[];
  hasPositiveSales: boolean;
  totalPositiveCents: number;
}

export interface RealizedCashflowResult {
  nonCreditOrdersCents: number;
  realizedCashInCents: number;
  creditSalesCents: number;
  repaymentsTotalCents: number;
  totalFlowCents: number;
  cashRatioPercent: number;
  creditRatioPercent: number;
}
export type CashflowAnalysis = RealizedCashflowResult;

export interface AggregatedItemRow {
  key: string;
  sku: string;
  itemId?: number;
  name: string;
  unit: Unit;
  qtyMilli: number;
  totalCents: number;
  isNegative: boolean;
  linesCount: number;
  orderIds: string[];
}

export interface AggregatedItemsResult {
  rows: AggregatedItemRow[];
  totalPeriodItemsCount?: number;
  itemSubtotalCents: number;
  orderRevenueCents: number;
  wholeBillDiscountCents: number;
  driftCents: number;
}

export interface ReportReconciliation {
  orderRevenueCents: number;
  itemSubtotalCents: number;
  wholeBillDiscountCents: number;
  netSalesCents: number;
  driftCents: number;
}

/**
 * 1. Computes merchandise order statistics with repayments strictly excluded ([]).
 */
export function computeReportOrderStats(orders: Order[]): Stats {
  return computeStats(orders, "all", []);
}

/**
 * 2. Computes realized cash inflow vs contractor credit balance.
 */
export function computeRealizedCashflow(
  orderStats: Stats,
  repaymentsTotalCents: number,
): RealizedCashflowResult {
  const nonCreditOrdersCents =
    (orderStats.byMethod.Cash?.totalCents ?? 0) +
    (orderStats.byMethod.Card?.totalCents ?? 0) +
    (orderStats.byMethod.QR?.totalCents ?? 0) +
    (orderStats.byMethod.Bank?.totalCents ?? 0);

  const realizedCashInCents = nonCreditOrdersCents + repaymentsTotalCents;
  const creditSalesCents = orderStats.byMethod.Credit?.totalCents ?? 0;
  const totalFlowCents = Math.max(0, realizedCashInCents) + Math.max(0, creditSalesCents);

  let cashRatioPercent = 0;
  let creditRatioPercent = 0;

  if (totalFlowCents > 0) {
    cashRatioPercent = Math.min(
      100,
      Math.max(0, Math.round((Math.max(0, realizedCashInCents) / totalFlowCents) * 100)),
    );
    creditRatioPercent = 100 - cashRatioPercent;
  } else if (realizedCashInCents > 0) {
    cashRatioPercent = 100;
    creditRatioPercent = 0;
  } else if (creditSalesCents > 0) {
    cashRatioPercent = 0;
    creditRatioPercent = 100;
  }

  return {
    nonCreditOrdersCents,
    realizedCashInCents,
    creditSalesCents,
    repaymentsTotalCents,
    totalFlowCents,
    cashRatioPercent,
    creditRatioPercent,
  };
}

/**
 * 3. Computes SVG circle arc strokes for positive revenue payment channels.
 */
export function computeDonutSlices(
  orderStats: Stats,
  activeFilter: PaymentMethod | "All" = "All",
): DonutResult {
  const methods = PAYMENT_METHODS;
  const positiveTotals: Record<PaymentMethod, number> = {
    Cash: Math.max(0, orderStats.byMethod.Cash?.totalCents ?? 0),
    Card: Math.max(0, orderStats.byMethod.Card?.totalCents ?? 0),
    QR: Math.max(0, orderStats.byMethod.QR?.totalCents ?? 0),
    Bank: Math.max(0, orderStats.byMethod.Bank?.totalCents ?? 0),
    Credit: Math.max(0, orderStats.byMethod.Credit?.totalCents ?? 0),
  };

  const totalPositiveCents = Object.values(positiveTotals).reduce((sum, v) => sum + v, 0);

  if (totalPositiveCents <= 0) {
    return {
      slices: [],
      hasPositiveSales: false,
      totalPositiveCents: 0,
    };
  }

  const C = DONUT_CIRCUMFERENCE;
  const slices: DonutSlice[] = [];
  let accumulatedLength = 0;

  for (const m of methods) {
    const totalCents = orderStats.byMethod[m]?.totalCents ?? 0;
    const positiveCents = positiveTotals[m];
    if (positiveCents <= 0) continue;

    const ratio = positiveCents / totalPositiveCents;
    const arcLength = ratio * C;
    const percentage = Math.round(ratio * 1000) / 10;
    const isHighlighted = activeFilter === m;
    const opacity = activeFilter === "All" || activeFilter === m ? 1.0 : 0.28;
    const strokeWidth = activeFilter === m ? 24 : 20;

    slices.push({
      method: m,
      totalCents,
      percentage,
      arcLength,
      isHighlighted,
      opacity,
      strokeWidth,
      strokeDasharray: `${arcLength.toFixed(3)} ${(C - arcLength).toFixed(3)}`,
      strokeDashoffset: accumulatedLength === 0 ? 0 : -accumulatedLength,
      color: METHOD_COLORS[m].color,
    });

    accumulatedLength += arcLength;
  }

  return {
    slices,
    hasPositiveSales: true,
    totalPositiveCents,
  };
}

/**
 * Resolves the whole-bill discount (or discount clawback) for an order.
 * - For forward sales: uses o.discountCents ?? 0.
 * - For refund orders: uses o.discountCents if explicitly set (> 0);
 *   otherwise derives the allocated clawback if returned lines exceed net refund.
 */
function getOrderDiscountCents(o: Order, isRefund: boolean): number {
  if (o.discountCents != null && o.discountCents > 0) {
    return o.discountCents;
  }
  if (isRefund && o.items && o.items.length > 0) {
    const grossCents = o.items.reduce((sum, li) => sum + li.amountCents, 0);
    const netRefundCents = Math.abs(o.totalCents);
    if (grossCents > netRefundCents) {
      return grossCents - netRefundCents;
    }
  }
  return o.discountCents ?? 0;
}

/**
 * 4. Aggregates item sales rows with refund deduction and reconciliation.
 */
export function aggregateFilteredItems(
  orders: Order[],
  filterMethod: PaymentMethod | "All",
  searchQuery: string = "",
  sortBy: "revenue" | "qty" = "revenue",
): AggregatedItemsResult {
  const activeOrders = orders.filter((o) => {
    if (o.voidedAt != null) return false;
    if (filterMethod !== "All" && o.method !== filterMethod) return false;
    return true;
  });

  const map = new Map<string, AggregatedItemRow>();
  let wholeBillDiscountCents = 0;

  for (const o of activeOrders) {
    const isRefund = o.refundOfOrderId != null || o.totalCents < 0;
    const sign = isRefund ? -1 : 1;
    const orderIdStr = String(o.id || o.invNo);

    // Sum order discount with proper refund/sale sign
    const disc = getOrderDiscountCents(o, isRefund);
    wholeBillDiscountCents += sign * disc;

    for (const li of o.items) {
      const displayName = li.customName?.trim() || li.name;
      const isCustom = Boolean(li.customName?.trim()) || li.name === "Lain-lain" || li.itemId == null;
      const key = isCustom
        ? `name:${displayName}:${li.unit}`
        : `id:${li.itemId}:${li.unit}`;

      let row = map.get(key);
      if (!row) {
        row = {
          key,
          sku: li.itemId != null ? String(li.itemId) : "-",
          itemId: li.itemId,
          name: displayName,
          unit: li.unit,
          qtyMilli: 0,
          totalCents: 0,
          isNegative: false,
          linesCount: 0,
          orderIds: [],
        };
        map.set(key, row);
      }

      row.qtyMilli += sign * li.qtyMilli;
      row.totalCents += sign * li.amountCents;
      row.linesCount += 1;
      if (!row.orderIds.includes(orderIdStr)) {
        row.orderIds.push(orderIdStr);
      }
    }
  }

  // Preserve pure refund items (do not drop negative rows)
  let rows = [...map.values()].filter((r) => r.qtyMilli !== 0 || r.totalCents !== 0);

  for (const r of rows) {
    r.isNegative = r.totalCents < 0 || r.qtyMilli < 0;
  }

  // Exact cross-column reconciliation values calculated prior to textual presentation search
  const itemSubtotalCents = rows.reduce((sum, r) => sum + r.totalCents, 0);
  const orderRevenueCents = activeOrders.reduce((sum, o) => sum + o.totalCents, 0);
  const netSalesCents = itemSubtotalCents - wholeBillDiscountCents;
  const driftCents = orderRevenueCents - netSalesCents;

  // Search filter
  const totalPeriodItemsCount = rows.length;
  const q = searchQuery.trim().toLowerCase();
  if (q) {
    rows = rows.filter((r) => r.name.toLowerCase().includes(q));
  }

  // Sorting
  rows.sort((a, b) => {
    if (sortBy === "qty") {
      return b.qtyMilli - a.qtyMilli;
    }
    return b.totalCents - a.totalCents;
  });

  return {
    rows,
    totalPeriodItemsCount,
    itemSubtotalCents,
    orderRevenueCents,
    wholeBillDiscountCents,
    driftCents,
  };
}

/**
 * 5. Reconciles item subtotals and discounts against order revenue.
 */
export function reconcileColumns(
  orderRevenueCents: number,
  itemSubtotalCents: number,
  wholeBillDiscountCents: number,
): ReportReconciliation {
  const netSalesCents = itemSubtotalCents - wholeBillDiscountCents;
  const driftCents = orderRevenueCents - netSalesCents;
  return {
    orderRevenueCents,
    itemSubtotalCents,
    wholeBillDiscountCents,
    netSalesCents,
    driftCents,
  };
}
