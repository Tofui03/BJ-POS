import { localDateStr } from "./closeday.js";
import { PosError } from "./orders.js";
import { REPAYMENT_METHODS, type Credit, type RepaymentInput, type RepaymentMethod } from "./types.js";

export interface ValidatedRepayment {
  companyId: number;
  creditId: number;
  contractorId?: number | null;
  amountCents?: number;
  method: RepaymentMethod;
  ts: number;
  businessDate: string;
  notes?: string;
  cashierName?: string | null;
}

/** Validate repayment input data. Throws PosError on invalid inputs. */
export function validateRepayment(input: RepaymentInput): ValidatedRepayment {
  if (!input || typeof input !== "object") {
    throw new PosError("repayment input is required");
  }
  if (!REPAYMENT_METHODS.includes(input.method)) {
    throw new PosError(`repayment method must be one of: ${REPAYMENT_METHODS.join(", ")}`);
  }
  if (!Number.isInteger(input.creditId) || input.creditId <= 0) {
    throw new PosError("a valid creditId is required for repayment");
  }
  if (input.amountCents != null) {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new PosError("repayment amount must be a positive integer in cents");
    }
  }

  const ts = input.ts ?? Date.now();
  const businessDate = input.businessDate ?? localDateStr(ts);
  const companyId = input.companyId ?? 1;

  return {
    companyId,
    creditId: input.creditId,
    contractorId: input.contractorId ?? null,
    amountCents: input.amountCents,
    method: input.method,
    ts,
    businessDate,
    ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
    ...(input.cashierName !== undefined ? { cashierName: input.cashierName?.trim() || null } : {}),
  };
}

/** Check that a credit can be settled (i.e. is currently outstanding). */
export function validateCanClearCredit(credit: Credit): void {
  if (credit.clearedAt != null) {
    throw new PosError(`credit #${credit.id} is already cleared`);
  }
}

export interface CreditAllocation {
  creditId: number;
  orderId: number;
  amountCents: number;
  fullyCleared: boolean;
}

export interface RepaymentAllocationResult {
  allocations: CreditAllocation[];
  totalAppliedCents: number;
  remainingCents: number;
}

/**
 * Greedily allocate a lump-sum repayment against outstanding credits (FIFO order by date).
 */
export function allocateRepayment(
  repaymentAmountCents: number,
  outstandingCredits: Credit[],
): RepaymentAllocationResult {
  if (!Number.isInteger(repaymentAmountCents) || repaymentAmountCents <= 0) {
    throw new PosError("repayment amount must be a positive integer in cents");
  }

  const sorted = [...outstandingCredits]
    .filter((c) => c.clearedAt == null)
    .sort((a, b) => a.date - b.date || a.id - b.id);

  let unallocated = repaymentAmountCents;
  let totalApplied = 0;
  const allocations: CreditAllocation[] = [];

  for (const c of sorted) {
    if (unallocated <= 0) break;
    const toApply = Math.min(unallocated, c.amountCents);
    const fullyCleared = toApply >= c.amountCents;
    allocations.push({
      creditId: c.id,
      orderId: c.orderId,
      amountCents: toApply,
      fullyCleared,
    });
    unallocated -= toApply;
    totalApplied += toApply;
  }

  return {
    allocations,
    totalAppliedCents: totalApplied,
    remainingCents: unallocated,
  };
}
