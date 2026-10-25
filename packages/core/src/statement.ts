import { PosError } from "./errors.js";
import { localDateStr } from "./closeday.js";
import { fmtQty } from "./money.js";
import type {
  Cents,
  Contractor,
  ContractorMonthlyStatement,
  Order,
  Repayment,
  StatementCreditLine,
  StatementRepaymentLine,
} from "./types.js";

/** Format items or order note into a concise single-line summary for statement ledger display. */
export function formatStatementDescription(order: Order): string {
  if (order.refundOfOrderId != null) {
    const ref = order.refundOfInvNo ? `Ref: ${order.refundOfInvNo}` : `Ref #${order.refundOfOrderId}`;
    const itemsPart = order.items && order.items.length > 0
      ? ` (${order.items.map((i) => `${i.customName || i.name} x${fmtQty(i.qtyMilli)}`).join(", ")})`
      : "";
    return `[REFUND / 退货] ${ref}${itemsPart}`;
  }

  if (order.items && order.items.length > 0) {
    const maxListed = 3;
    const summaries = order.items.slice(0, maxListed).map((i) => {
      const name = i.customName || i.name;
      const count = i.qtyMilli / 1000;
      const qtyStr = count !== 1 ? ` (x${fmtQty(i.qtyMilli)})` : "";
      return `${name}${qtyStr}`;
    });
    if (order.items.length > maxListed) {
      summaries.push(`+${order.items.length - maxListed} more`);
    }
    const baseSummary = summaries.join(", ");
    return order.note?.trim() ? `${order.note.trim()} — ${baseSummary}` : baseSummary;
  }

  return order.note?.trim() || "Credit Sale";
}

/** Format repayment voucher identifier (e.g. RP-0042). */
export function formatRepaymentRef(repayment: Repayment): string {
  return `RP-${String(repayment.id).padStart(4, "0")}`;
}

/** Validate YYYY-MM year-month string. */
export function isValidYearMonth(ym: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(ym.trim());
}

/** Pure functional calculation of a contractor monthly statement. */
export function calculateContractorStatement(
  contractor: Contractor,
  yearMonth: string,
  creditOrders: Order[],
  repayments: Repayment[],
): ContractorMonthlyStatement {
  if (!isValidYearMonth(yearMonth)) {
    throw new PosError(`invalid yearMonth format: "${yearMonth}", expected YYYY-MM`);
  }
  const targetMonth = yearMonth.trim();
  const contractorNameNorm = contractor.name.trim().toLowerCase();

  // Filter orders: must not be voided, must be Credit method, must match contractor
  const eligibleOrders = creditOrders.filter((o) => {
    if (o.voidedAt != null) return false;
    if (o.method !== "Credit") return false;
    if (o.contractorId != null && contractor.id != null) {
      return o.contractorId === contractor.id;
    }
    const orderName = (o.contractorName ?? o.creditorName)?.trim().toLowerCase();
    return orderName === contractorNameNorm;
  });

  // Filter repayments: must match contractor
  const eligibleRepayments = repayments.filter((r) => {
    if (r.contractorId != null && contractor.id != null) {
      return r.contractorId === contractor.id;
    }
    const repName = (r.contractorName ?? (r as any).creditorName)?.trim().toLowerCase();
    return repName === contractorNameNorm;
  });

  let priorOrdersCents = 0;
  const monthOrders: Order[] = [];

  for (const o of eligibleOrders) {
    const bDate = o.businessDate?.trim() || localDateStr(o.ts);
    const m = bDate.slice(0, 7);
    if (m < targetMonth) {
      priorOrdersCents += o.totalCents;
    } else if (m === targetMonth) {
      monthOrders.push(o);
    }
  }

  let priorRepaymentsCents = 0;
  const monthReps: Repayment[] = [];

  for (const r of eligibleRepayments) {
    const bDate = r.businessDate?.trim() || localDateStr(r.ts);
    const m = bDate.slice(0, 7);
    if (m < targetMonth) {
      priorRepaymentsCents += r.amountCents;
    } else if (m === targetMonth) {
      monthReps.push(r);
    }
  }

  // Brought forward calculation
  const broughtForwardCents = priorOrdersCents - priorRepaymentsCents;

  // Chronological sort for monthly orders
  monthOrders.sort((a, b) => {
    const dateA = a.businessDate || localDateStr(a.ts);
    const dateB = b.businessDate || localDateStr(b.ts);
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    if (a.ts !== b.ts) return a.ts - b.ts;
    return a.id - b.id;
  });

  let monthCreditsCents = 0;
  const creditLines: StatementCreditLine[] = monthOrders.map((o) => {
    monthCreditsCents += o.totalCents;
    return {
      id: o.id,
      orderId: o.id,
      date: o.businessDate || localDateStr(o.ts),
      invoiceNo: o.invNo,
      description: formatStatementDescription(o),
      amountCents: o.totalCents,
      doNo: o.doNumber || o.doNo || null,
      note: o.note || null,
      itemCount: o.items?.length ?? 0,
    };
  });

  // Chronological sort for monthly repayments
  monthReps.sort((a, b) => {
    const dateA = a.businessDate || localDateStr(a.ts);
    const dateB = b.businessDate || localDateStr(b.ts);
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    if (a.ts !== b.ts) return a.ts - b.ts;
    return a.id - b.id;
  });

  let monthRepaymentsCents = 0;
  const repaymentLines: StatementRepaymentLine[] = monthReps.map((r) => {
    monthRepaymentsCents += r.amountCents;
    return {
      id: r.id,
      date: r.businessDate || localDateStr(r.ts),
      receiptNo: formatRepaymentRef(r),
      method: r.method,
      amountCents: r.amountCents,
      notes: r.notes ?? null,
      cashierName: r.cashierName ?? null,
    };
  });

  const monthNetCents = monthCreditsCents - monthRepaymentsCents;
  const closingDebtCents = broughtForwardCents + monthNetCents;

  return {
    contractor,
    yearMonth: targetMonth,
    broughtForwardCents,
    openingDebtCents: broughtForwardCents,
    creditLines,
    monthlyLines: creditLines,
    repaymentLines,
    monthlyRepayments: repaymentLines,
    repayments: repaymentLines,
    monthCreditsCents,
    monthRepaymentsCents,
    monthNetCents,
    closingDebtCents,
    totalOutstandingCents: closingDebtCents,
  };
}
