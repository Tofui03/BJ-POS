import { describe, expect, it } from "vitest";
import {
  validateContractor,
  validateContractorPatch,
  computeCreditBalance,
  computeContractorBalance,
  computeAllContractorBalances,
} from "./contractors.js";
import {
  validateRepayment,
  validateCanClearCredit,
  allocateRepayment,
} from "./repayments.js";
import { computeStats } from "./stats.js";
import { PosError } from "./orders.js";
import type { Credit, Order, Repayment } from "./types.js";

describe("contractor validation", () => {
  it("validates and normalizes contractor input", () => {
    const res = validateContractor({
      name: "  Ah Meng Enterprise  ",
      phone: " 012-3456789 ",
      tin: " C1234567890 ",
      active: true,
    });
    expect(res).toEqual({
      name: "Ah Meng Enterprise",
      phone: "012-3456789",
      tin: "C1234567890",
      active: true,
    });
  });

  it("applies defaults for optional phone, tin, and active status", () => {
    const res = validateContractor({ name: "Pak Abu" });
    expect(res).toEqual({
      name: "Pak Abu",
      phone: "",
      tin: "",
      active: true,
    });
  });

  it("rejects missing or empty contractor name", () => {
    expect(() => validateContractor({ name: "" })).toThrow(PosError);
    expect(() => validateContractor({ name: "   " })).toThrow(/name is required/);
    expect(() => validateContractor({ name: null as never })).toThrow(/name is required/);
  });

  it("validates contractor patch updates", () => {
    expect(validateContractorPatch({ name: " Ah Meng Renovations " })).toEqual({
      name: "Ah Meng Renovations",
    });
    expect(validateContractorPatch({ phone: " 019-8765432 " })).toEqual({
      phone: "019-8765432",
    });
    expect(validateContractorPatch({ tin: " IG99887766 " })).toEqual({
      tin: "IG99887766",
    });
    expect(validateContractorPatch({ phone: null as never })).toEqual({
      phone: "",
    });
    expect(validateContractorPatch({ tin: null as never })).toEqual({
      tin: "",
    });
    expect(validateContractorPatch({ phone: "" })).toEqual({
      phone: "",
    });
    expect(validateContractorPatch({ active: false })).toEqual({
      active: false,
    });
    expect(validateContractorPatch({ address: " Lot 10, Industrial Park " })).toEqual({
      address: "Lot 10, Industrial Park",
    });
    expect(validateContractorPatch({ address: null as never })).toEqual({
      address: "",
    });
    expect(() => validateContractorPatch({ name: "  " })).toThrow(/cannot be empty/);
  });

  it("validates and preserves address when provided on create", () => {
    const res = validateContractor({
      name: "Syarikat Pembinaan Jaya",
      address: " No 12, Jalan Baru, Keningau ",
    });
    expect(res).toEqual({
      name: "Syarikat Pembinaan Jaya",
      phone: "",
      tin: "",
      address: "No 12, Jalan Baru, Keningau",
      active: true,
    });
  });
});

describe("repayment domain logic", () => {
  it("validates valid repayment inputs", () => {
    const res = validateRepayment({
      creditId: 5,
      amountCents: 15000,
      method: "Cash",
      ts: 1700000000000,
      businessDate: "2026-08-15",
      notes: " Partial payment ",
    });
    expect(res).toEqual({
      companyId: 1,
      creditId: 5,
      contractorId: null,
      amountCents: 15000,
      method: "Cash",
      ts: 1700000000000,
      businessDate: "2026-08-15",
      notes: "Partial payment",
    });
  });

  it("accepts Bank as valid payment method", () => {
    const res = validateRepayment({
      creditId: 3,
      method: "Bank",
    });
    expect(res.method).toBe("Bank");
  });

  it("accepts QR as valid payment method", () => {
    const res = validateRepayment({
      creditId: 3,
      method: "QR",
    });
    expect(res.method).toBe("QR");
  });

  it("rejects invalid payment methods", () => {
    expect(() =>
      validateRepayment({ creditId: 1, method: "Credit" as never }),
    ).toThrow(/method must be one of: Cash, Bank, QR/);
    expect(() =>
      validateRepayment({ creditId: 1, method: "Cheque" as never }),
    ).toThrow(/method must be one of: Cash, Bank, QR/);
  });

  it("rejects non-positive repayment amounts", () => {
    expect(() =>
      validateRepayment({ creditId: 1, amountCents: 0, method: "Cash" }),
    ).toThrow(/positive integer/);
    expect(() =>
      validateRepayment({ creditId: 1, amountCents: -500, method: "Cash" }),
    ).toThrow(/positive integer/);
    expect(() =>
      validateRepayment({ creditId: 1, amountCents: 12.5, method: "Cash" }),
    ).toThrow(/positive integer/);
  });

  it("validates credit settleability", () => {
    const openCredit: Credit = {
      id: 1,
      companyId: 1,
      orderId: 10,
      invNo: "08-1001",
      name: "Ah Meng",
      amountCents: 5000,
      date: 1000,
      clearedAt: null,
    };
    expect(() => validateCanClearCredit(openCredit)).not.toThrow();

    const clearedCredit: Credit = {
      ...openCredit,
      clearedAt: 2000,
    };
    expect(() => validateCanClearCredit(clearedCredit)).toThrow(/already cleared/);
  });

  it("allocates repayments across outstanding credits in FIFO order", () => {
    const credits: Credit[] = [
      { id: 1, companyId: 1, orderId: 101, invNo: "08-1001", name: "Ah Meng", amountCents: 3000, date: 1000, clearedAt: null },
      { id: 2, companyId: 1, orderId: 102, invNo: "08-1002", name: "Ah Meng", amountCents: 5000, date: 2000, clearedAt: null },
      { id: 3, companyId: 1, orderId: 103, invNo: "08-1003", name: "Ah Meng", amountCents: 2000, date: 3000, clearedAt: null },
    ];

    // Allocate 6000 cents: pays credit 1 (3000) fully, credit 2 (3000/5000) partially
    const result = allocateRepayment(6000, credits);
    expect(result.totalAppliedCents).toBe(6000);
    expect(result.remainingCents).toBe(0);
    expect(result.allocations).toEqual([
      { creditId: 1, orderId: 101, amountCents: 3000, fullyCleared: true },
      { creditId: 2, orderId: 102, amountCents: 3000, fullyCleared: false },
    ]);
  });
});

describe("balance calculation", () => {
  const credits: Credit[] = [
    { id: 1, companyId: 1, orderId: 10, invNo: "08-1001", name: "Ah Meng", amountCents: 10000, date: 1000, clearedAt: null },
    { id: 2, companyId: 1, orderId: 11, invNo: "08-1002", name: "Ah Meng", amountCents: 4000, date: 2000, clearedAt: 3000 },
    { id: 3, companyId: 1, orderId: 12, invNo: "08-1003", name: "Pak Abu", amountCents: 8000, date: 1500, clearedAt: null },
    { id: 4, companyId: 1, orderId: 13, invNo: "08-1004", name: "Pak Abu", amountCents: 2000, date: 2500, clearedAt: 4000 },
  ];

  it("calculates aggregate balance across all credits", () => {
    const summary = computeCreditBalance(credits);
    expect(summary).toEqual({
      totalCreditCents: 24000,
      clearedCents: 6000,
      outstandingCents: 18000,
      creditCount: 4,
      outstandingCount: 2,
    });
  });

  it("calculates contractor balance with case and whitespace insensitivity", () => {
    const meng = computeContractorBalance(" ah meng ", credits);
    expect(meng).toEqual({
      contractorName: "ah meng",
      totalCreditCents: 14000,
      clearedCents: 4000,
      outstandingCents: 10000,
      creditCount: 2,
      outstandingCount: 1,
    });

    const abu = computeContractorBalance("Pak Abu", credits);
    expect(abu.outstandingCents).toBe(8000);
    expect(abu.clearedCents).toBe(2000);
  });

  it("groups all contractor balances correctly", () => {
    const map = computeAllContractorBalances(credits);
    expect(map.size).toBe(2);
    expect(map.get("Ah Meng")?.outstandingCents).toBe(10000);
    expect(map.get("Pak Abu")?.outstandingCents).toBe(8000);
  });

  it("collapses mixed case-variant credits under a single contractor balance", () => {
    const mixedCaseCredits: Credit[] = [
      { id: 1, companyId: 1, orderId: 1, invNo: "08-1001", name: "Ah Meng", amountCents: 5000, date: 1000, clearedAt: null },
      { id: 2, companyId: 1, orderId: 2, invNo: "08-1002", name: "ah meng", amountCents: 3000, date: 2000, clearedAt: null },
      { id: 3, companyId: 1, orderId: 3, invNo: "08-1003", name: "AH MENG ", amountCents: 2000, date: 3000, clearedAt: 4000 },
    ];
    const map = computeAllContractorBalances(mixedCaseCredits);
    expect(map.size).toBe(1);
    const summary = [...map.values()][0]!;
    expect(summary.totalCreditCents).toBe(10000);
    expect(summary.outstandingCents).toBe(8000);
    expect(summary.clearedCents).toBe(2000);
    expect(summary.creditCount).toBe(3);
    expect(summary.outstandingCount).toBe(2);
  });
});

describe("daily sales revenue with repayments", () => {
  const dayOrders: Order[] = [
    {
      id: 1,
      companyId: 1,
      ts: 1000,
      businessDate: "2026-08-15",
      invNo: "08-1001",
      method: "Cash",
      totalCents: 5000,
      voidedAt: null,
      items: [],
    },
    {
      id: 2,
      companyId: 1,
      ts: 2000,
      businessDate: "2026-08-15",
      invNo: "08-1002",
      method: "Credit",
      creditorName: "Ah Meng",
      totalCents: 8000,
      voidedAt: null,
      items: [],
    },
  ];

  const repayments: Repayment[] = [
    {
      id: 1,
      companyId: 1,
      creditId: 99, // Past credit from earlier business date
      orderId: 90,
      amountCents: 7500,
      method: "Cash",
      ts: 3000,
      businessDate: "2026-08-15",
    },
    {
      id: 2,
      companyId: 1,
      creditId: 98,
      orderId: 89,
      amountCents: 4500,
      method: "Bank",
      ts: 4000,
      businessDate: "2026-08-15",
    },
  ];

  it("reflects collected repayment funds in daily sales totals without altering order counts", () => {
    const withoutRepayments = computeStats(dayOrders, "today");
    expect(withoutRepayments.totalCents).toBe(13000);
    expect(withoutRepayments.byMethod.Cash.totalCents).toBe(5000);
    expect(withoutRepayments.byMethod.Bank.totalCents).toBe(0);

    const withRepayments = computeStats(dayOrders, "today", repayments);
    // Total revenue reflects sales (13000) + repayments (7500 + 4500 = 12000) = 25000
    expect(withRepayments.totalCents).toBe(25000);
    expect(withRepayments.repaymentsTotalCents).toBe(12000);
    expect(withRepayments.repaymentsCount).toBe(2);
    // Cash bucket reflects initial Cash sale (5000) + Cash repayment (7500) = 12500
    expect(withRepayments.byMethod.Cash.totalCents).toBe(12500);
    // Bank bucket reflects Bank repayment (4500)
    expect(withRepayments.byMethod.Bank.totalCents).toBe(4500);
    // Order sales count remains 2 (repayments don't inflate invoice sales count)
    expect(withRepayments.count).toBe(2);
  });
});
