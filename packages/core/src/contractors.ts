import { PosError } from "./orders.js";
import type { ContractorInput, ContractorPatch, Credit } from "./types.js";

/** Validate contractor create input. Throws PosError on invalid data. */
export function validateContractor(input: ContractorInput): {
  name: string;
  phone: string;
  tin: string;
  address?: string;
  active: boolean;
} {
  if (!input || typeof input.name !== "string" || !input.name.trim()) {
    throw new PosError("contractor name is required");
  }
  const name = input.name.trim();
  const phone = input.phone != null ? String(input.phone).trim() : "";
  const tin = input.tin != null ? String(input.tin).trim() : "";
  const active = input.active ?? true;
  const address = input.address != null ? String(input.address).trim() : undefined;
  return {
    name,
    phone,
    tin,
    ...(address !== undefined ? { address } : {}),
    active,
  };
}

/** Validate contractor update patch. Throws PosError on invalid data. */
export function validateContractorPatch(patch: ContractorPatch): {
  name?: string;
  phone?: string;
  tin?: string;
  address?: string;
  active?: boolean;
} {
  if (!patch) return {};
  const res: { name?: string; phone?: string; tin?: string; address?: string; active?: boolean } = {};
  if (patch.name !== undefined) {
    if (typeof patch.name !== "string" || !patch.name.trim()) {
      throw new PosError("contractor name cannot be empty");
    }
    res.name = patch.name.trim();
  }
  if (patch.phone !== undefined) {
    res.phone = patch.phone != null ? String(patch.phone).trim() : "";
  }
  if (patch.tin !== undefined) {
    res.tin = patch.tin != null ? String(patch.tin).trim() : "";
  }
  if (patch.address !== undefined) {
    res.address = patch.address != null ? String(patch.address).trim() : "";
  }
  if (patch.active !== undefined) {
    res.active = Boolean(patch.active);
  }
  return res;
}

export interface CreditBalanceSummary {
  totalCreditCents: number;
  clearedCents: number;
  outstandingCents: number;
  creditCount: number;
  outstandingCount: number;
}

export interface ContractorBalanceSummary extends CreditBalanceSummary {
  contractorName: string;
}

/** Compute aggregate credit and outstanding balance for a collection of credits. */
export function computeCreditBalance(credits: Credit[]): CreditBalanceSummary {
  let totalCreditCents = 0;
  let clearedCents = 0;
  let outstandingCents = 0;
  let outstandingCount = 0;

  for (const c of credits) {
    totalCreditCents += c.amountCents;
    if (c.clearedAt != null) {
      clearedCents += c.amountCents;
    } else {
      outstandingCents += c.amountCents;
      outstandingCount += 1;
    }
  }

  return {
    totalCreditCents,
    clearedCents,
    outstandingCents,
    creditCount: credits.length,
    outstandingCount,
  };
}

/** Compute balance summary for a specific contractor name (case-insensitive trim match). */
export function computeContractorBalance(contractorName: string, credits: Credit[]): ContractorBalanceSummary {
  const target = contractorName.trim().toLowerCase();
  const matched = credits.filter((c) => c.name.trim().toLowerCase() === target);
  const summary = computeCreditBalance(matched);
  return {
    contractorName: contractorName.trim(),
    ...summary,
  };
}

/** Group credits by creditor name (case-insensitive) and compute balance summary per contractor. */
export function computeAllContractorBalances(credits: Credit[]): Map<string, ContractorBalanceSummary> {
  const groups = new Map<string, { displayName: string; list: Credit[] }>();
  for (const c of credits) {
    const rawName = c.name.trim();
    const key = rawName.toLowerCase();
    const group = groups.get(key);
    if (group) {
      group.list.push(c);
    } else {
      groups.set(key, { displayName: rawName, list: [c] });
    }
  }

  const result = new Map<string, ContractorBalanceSummary>();
  for (const [, { displayName, list }] of groups) {
    result.set(displayName, computeContractorBalance(displayName, list));
  }
  return result;
}
