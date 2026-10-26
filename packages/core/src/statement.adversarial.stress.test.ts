import { describe, expect, it } from "vitest";
import { PosError } from "./errors.js";
import {
  calculateContractorStatement,
  formatRepaymentRef,
  formatStatementDescription,
  isValidYearMonth,
} from "./statement.js";
import type { Contractor, Order, OrderLine, Repayment } from "./types.js";

const makeLine = (over: Partial<OrderLine> = {}): OrderLine => ({
  id: 1,
  itemId: 101,
  name: "Standard Nail 2-inch",
  image: "",
  unit: "box",
  priceCents: 1500,
  qtyMilli: 1000,
  amountCents: 1500,
  tailCount: 0,
  bulkPrice: false,
  ...over,
});

describe("Milestone 3 Adversarial Statement Math & Refund Stress Suite", () => {
  const contractorAlpha: Contractor = {
    id: 101,
    companyId: 1,
    name: "Alpha Builders Sdn Bhd",
    phone: "018-9998888",
    tin: "C1010101010",
    address: "Lot 42, Industrial Zone, Keningau",
    active: true,
  };

  const contractorBeta: Contractor = {
    id: 102,
    companyId: 1,
    name: "Beta Engineering",
    phone: "019-1112222",
    tin: "C2020202020",
    address: "Jalan Masak, Keningau",
    active: true,
  };

  // Scenario A: Contractor with 0 prior transactions and 0 current transactions
  describe("Scenario A: Dormant / Zero Transaction Contractor", () => {
    it("returns exactly zero balances and empty arrays without throwing", () => {
      const stmt = calculateContractorStatement(contractorAlpha, "2026-10", [], []);
      expect(stmt.contractor.id).toBe(101);
      expect(stmt.yearMonth).toBe("2026-10");
      expect(stmt.broughtForwardCents).toBe(0);
      expect(stmt.monthCreditsCents).toBe(0);
      expect(stmt.monthRepaymentsCents).toBe(0);
      expect(stmt.monthNetCents).toBe(0);
      expect(stmt.closingDebtCents).toBe(0);
      expect(stmt.creditLines).toEqual([]);
      expect(stmt.repaymentLines).toEqual([]);
    });
  });

  // Scenario B: Credit refund order in current month
  describe("Scenario B: Credit Refund Order in Current Month", () => {
    it("decreases monthCreditsCents and closingDebtCents, displaying refund details", () => {
      const saleOrder: Order = {
        id: 1001,
        companyId: 1,
        contractorId: 101,
        contractorName: "Alpha Builders Sdn Bhd",
        ts: new Date("2026-10-05T09:00:00Z").getTime(),
        businessDate: "2026-10-05",
        invNo: "B-0010",
        voidedAt: null,
        method: "Credit",
        totalCents: 100000, // RM 1,000.00
        items: [makeLine({ customName: "Portland Cement", qtyMilli: 10000, amountCents: 100000 })],
      };

      const refundOrder: Order = {
        id: 1002,
        companyId: 1,
        contractorId: 101,
        contractorName: "Alpha Builders Sdn Bhd",
        ts: new Date("2026-10-12T14:30:00Z").getTime(),
        businessDate: "2026-10-12",
        invNo: "B-0011",
        voidedAt: null,
        method: "Credit",
        totalCents: -30000, // Refund RM 300.00
        refundOfOrderId: 1001,
        refundOfInvNo: "B-0010",
        items: [makeLine({ customName: "Portland Cement", qtyMilli: 3000, amountCents: -30000 })],
      };

      const stmt = calculateContractorStatement(
        contractorAlpha,
        "2026-10",
        [saleOrder, refundOrder],
        [],
      );

      expect(stmt.broughtForwardCents).toBe(0);
      // Net month credits = 100000 + (-30000) = 70000 cents (RM 700.00)
      expect(stmt.monthCreditsCents).toBe(70000);
      expect(stmt.monthRepaymentsCents).toBe(0);
      expect(stmt.monthNetCents).toBe(70000);
      expect(stmt.closingDebtCents).toBe(70000);

      expect(stmt.creditLines).toHaveLength(2);
      expect(stmt.creditLines[0]!.amountCents).toBe(100000);
      expect(stmt.creditLines[1]!.amountCents).toBe(-30000);
      expect(stmt.creditLines[1]!.description).toContain("[REFUND / 退货] Ref: B-0010");
    });
  });

  // Scenario C: Credit refund order in prior month
  describe("Scenario C: Credit Refund Order in Prior Month", () => {
    it("accurately rolls forward prior month refunds to reduce broughtForwardCents", () => {
      // Prior month (August 2026): Purchase RM 1,000, Refund RM 400
      const augOrder: Order = {
        id: 901,
        companyId: 1,
        contractorId: 101,
        contractorName: "Alpha Builders Sdn Bhd",
        ts: new Date("2026-08-10T10:00:00Z").getTime(),
        businessDate: "2026-08-10",
        invNo: "B-0001",
        voidedAt: null,
        method: "Credit",
        totalCents: 100000,
        items: [],
      };
      const augRefund: Order = {
        id: 902,
        companyId: 1,
        contractorId: 101,
        contractorName: "Alpha Builders Sdn Bhd",
        ts: new Date("2026-08-20T11:00:00Z").getTime(),
        businessDate: "2026-08-20",
        invNo: "B-0002",
        voidedAt: null,
        method: "Credit",
        totalCents: -40000,
        refundOfOrderId: 901,
        items: [],
      };

      // Current month (September 2026): Purchase RM 250
      const sepOrder: Order = {
        id: 903,
        companyId: 1,
        contractorId: 101,
        contractorName: "Alpha Builders Sdn Bhd",
        ts: new Date("2026-09-05T08:00:00Z").getTime(),
        businessDate: "2026-09-05",
        invNo: "B-0003",
        voidedAt: null,
        method: "Credit",
        totalCents: 25000,
        items: [],
      };

      const stmtSep = calculateContractorStatement(
        contractorAlpha,
        "2026-09",
        [augOrder, augRefund, sepOrder],
        [],
      );

      // Brought forward = 100000 - 40000 = 60000 cents
      expect(stmtSep.broughtForwardCents).toBe(60000);
      expect(stmtSep.monthCreditsCents).toBe(25000);
      expect(stmtSep.closingDebtCents).toBe(85000);

      // Cross check statement for August
      const stmtAug = calculateContractorStatement(
        contractorAlpha,
        "2026-08",
        [augOrder, augRefund, sepOrder],
        [],
      );
      expect(stmtAug.closingDebtCents).toBe(60000);
      expect(stmtSep.broughtForwardCents).toBe(stmtAug.closingDebtCents);
    });
  });

  // Scenario D: Overpayment scenario where repayments exceed debt
  describe("Scenario D: Overpayment / Negative Debt / Credit Balance", () => {
    it("handles overpayments cleanly with negative balances and seamless rollforward", () => {
      // Month 1 (October): Debt of RM 200, Repayment of RM 350 -> Overpayment of RM 150
      const octOrder: Order = {
        id: 201,
        companyId: 1,
        contractorId: 101,
        contractorName: "Alpha Builders Sdn Bhd",
        ts: new Date("2026-10-02T10:00:00Z").getTime(),
        businessDate: "2026-10-02",
        invNo: "B-0021",
        voidedAt: null,
        method: "Credit",
        totalCents: 20000, // RM 200.00
        items: [],
      };
      const octRepayment: Repayment = {
        id: 501,
        companyId: 1,
        contractorId: 101,
        contractorName: "Alpha Builders Sdn Bhd",
        creditId: 1,
        orderId: 201,
        amountCents: 35000, // RM 350.00
        method: "Bank",
        ts: new Date("2026-10-15T15:00:00Z").getTime(),
        businessDate: "2026-10-15",
      };

      const stmtOct = calculateContractorStatement(
        contractorAlpha,
        "2026-10",
        [octOrder],
        [octRepayment],
      );

      expect(stmtOct.broughtForwardCents).toBe(0);
      expect(stmtOct.monthCreditsCents).toBe(20000);
      expect(stmtOct.monthRepaymentsCents).toBe(35000);
      expect(stmtOct.monthNetCents).toBe(-15000); // RM -150.00
      expect(stmtOct.closingDebtCents).toBe(-15000); // Overpaid!
      expect(stmtOct.closingDebtCents).toBe(-15000);

      // Month 2 (November): New purchase of RM 100, no repayment
      const novOrder: Order = {
        id: 202,
        companyId: 1,
        contractorId: 101,
        contractorName: "Alpha Builders Sdn Bhd",
        ts: new Date("2026-11-04T11:00:00Z").getTime(),
        businessDate: "2026-11-04",
        invNo: "B-0022",
        voidedAt: null,
        method: "Credit",
        totalCents: 10000, // RM 100.00
        items: [],
      };

      const stmtNov = calculateContractorStatement(
        contractorAlpha,
        "2026-11",
        [octOrder, novOrder],
        [octRepayment],
      );

      // Opening balance must be -15000 (credit balance brought forward)
      expect(stmtNov.broughtForwardCents).toBe(-15000);
      expect(stmtNov.monthCreditsCents).toBe(10000);
      expect(stmtNov.monthNetCents).toBe(10000);
      // Closing debt = -15000 + 10000 = -5000 cents (still RM 50.00 advance balance)
      expect(stmtNov.closingDebtCents).toBe(-5000);
      expect(stmtNov.broughtForwardCents).toBe(stmtOct.closingDebtCents);
    });
  });

  // Scenario E: Cross-year rollforward boundary (2026-12 to 2027-01)
  describe("Scenario E: Cross-Year Rollforward Boundary (2026-12 to 2027-01)", () => {
    it("preserves exact financial continuity across calendar year boundary", () => {
      const orderDec: Order = {
        id: 301,
        companyId: 1,
        contractorId: 101,
        contractorName: "Alpha Builders Sdn Bhd",
        ts: new Date("2026-12-28T16:00:00Z").getTime(),
        businessDate: "2026-12-28",
        invNo: "B-0099",
        voidedAt: null,
        method: "Credit",
        totalCents: 88000, // RM 880.00
        items: [],
      };
      const repDec: Repayment = {
        id: 601,
        companyId: 1,
        contractorId: 101,
        contractorName: "Alpha Builders Sdn Bhd",
        creditId: 1,
        orderId: 301,
        amountCents: 38000, // RM 380.00
        method: "Cash",
        ts: new Date("2026-12-30T10:00:00Z").getTime(),
        businessDate: "2026-12-30",
      };

      const orderJan: Order = {
        id: 302,
        companyId: 1,
        contractorId: 101,
        contractorName: "Alpha Builders Sdn Bhd",
        ts: new Date("2027-01-05T09:00:00Z").getTime(),
        businessDate: "2027-01-05",
        invNo: "B-0001",
        voidedAt: null,
        method: "Credit",
        totalCents: 50000, // RM 500.00
        items: [],
      };
      const repJan: Repayment = {
        id: 602,
        companyId: 1,
        contractorId: 101,
        contractorName: "Alpha Builders Sdn Bhd",
        creditId: 2,
        orderId: 302,
        amountCents: 20000, // RM 200.00
        method: "Bank",
        ts: new Date("2027-01-18T14:00:00Z").getTime(),
        businessDate: "2027-01-18",
      };

      const orders = [orderDec, orderJan];
      const reps = [repDec, repJan];

      const stmtDec = calculateContractorStatement(contractorAlpha, "2026-12", orders, reps);
      const stmtJan = calculateContractorStatement(contractorAlpha, "2027-01", orders, reps);

      // December: 88000 - 38000 = 50000 closing
      expect(stmtDec.broughtForwardCents).toBe(0);
      expect(stmtDec.monthCreditsCents).toBe(88000);
      expect(stmtDec.monthRepaymentsCents).toBe(38000);
      expect(stmtDec.closingDebtCents).toBe(50000);

      // January: brought forward must equal December closing (50000)
      expect(stmtJan.broughtForwardCents).toBe(50000);
      expect(stmtJan.broughtForwardCents).toBe(stmtDec.closingDebtCents);
      expect(stmtJan.monthCreditsCents).toBe(50000);
      expect(stmtJan.monthRepaymentsCents).toBe(20000);
      expect(stmtJan.monthNetCents).toBe(30000);
      expect(stmtJan.closingDebtCents).toBe(80000);
    });
  });

  // Scenario F: Non-credit orders by contractor
  describe("Scenario F: Non-Credit Orders by Contractor", () => {
    it("strictly excludes Cash, Bank, and QR purchases from credit statement", () => {
      const creditOrder: Order = {
        id: 401,
        companyId: 1,
        contractorId: 101,
        contractorName: "Alpha Builders Sdn Bhd",
        customerType: "contractor",
        ts: new Date("2026-10-02T10:00:00Z").getTime(),
        businessDate: "2026-10-02",
        invNo: "B-0001",
        voidedAt: null,
        method: "Credit",
        totalCents: 15000,
        items: [],
      };
      const cashOrder: Order = {
        id: 402,
        companyId: 1,
        contractorId: 101,
        contractorName: "Alpha Builders Sdn Bhd",
        customerType: "contractor",
        ts: new Date("2026-10-05T11:00:00Z").getTime(),
        businessDate: "2026-10-05",
        invNo: "B-0002",
        voidedAt: null,
        method: "Cash", // Cash purchase
        totalCents: 50000,
        items: [],
      };
      const bankOrder: Order = {
        id: 403,
        companyId: 1,
        contractorId: 101,
        contractorName: "Alpha Builders Sdn Bhd",
        customerType: "contractor",
        ts: new Date("2026-10-08T12:00:00Z").getTime(),
        businessDate: "2026-10-08",
        invNo: "B-0003",
        voidedAt: null,
        method: "Bank", // Bank transfer purchase
        totalCents: 30000,
        items: [],
      };
      const qrOrder: Order = {
        id: 404,
        companyId: 1,
        contractorId: 101,
        contractorName: "Alpha Builders Sdn Bhd",
        customerType: "contractor",
        ts: new Date("2026-10-10T13:00:00Z").getTime(),
        businessDate: "2026-10-10",
        invNo: "B-0004",
        voidedAt: null,
        method: "QR", // QR purchase
        totalCents: 20000,
        items: [],
      };

      const stmt = calculateContractorStatement(
        contractorAlpha,
        "2026-10",
        [creditOrder, cashOrder, bankOrder, qrOrder],
        [],
      );

      // Only the credit order of 15000 must be included
      expect(stmt.creditLines).toHaveLength(1);
      expect(stmt.creditLines[0]!.invoiceNo).toBe("B-0001");
      expect(stmt.monthCreditsCents).toBe(15000);
      expect(stmt.closingDebtCents).toBe(15000);
    });
  });

  // Additional Scenario G: Voided orders exclusion
  describe("Scenario G: Voided Credit Orders", () => {
    it("excludes voided credit orders from both prior and current months", () => {
      const priorVoided: Order = {
        id: 501,
        companyId: 1,
        contractorId: 101,
        contractorName: "Alpha Builders Sdn Bhd",
        ts: new Date("2026-08-01T10:00:00Z").getTime(),
        businessDate: "2026-08-01",
        invNo: "B-0001",
        voidedAt: Date.now(), // Voided
        method: "Credit",
        totalCents: 999999,
        items: [],
      };
      const currentVoided: Order = {
        id: 502,
        companyId: 1,
        contractorId: 101,
        contractorName: "Alpha Builders Sdn Bhd",
        ts: new Date("2026-10-10T10:00:00Z").getTime(),
        businessDate: "2026-10-10",
        invNo: "B-0002",
        voidedAt: Date.now(), // Voided
        method: "Credit",
        totalCents: 888888,
        items: [],
      };
      const validOrder: Order = {
        id: 503,
        companyId: 1,
        contractorId: 101,
        contractorName: "Alpha Builders Sdn Bhd",
        ts: new Date("2026-10-15T10:00:00Z").getTime(),
        businessDate: "2026-10-15",
        invNo: "B-0003",
        voidedAt: null,
        method: "Credit",
        totalCents: 12000,
        items: [],
      };

      const stmt = calculateContractorStatement(
        contractorAlpha,
        "2026-10",
        [priorVoided, currentVoided, validOrder],
        [],
      );

      expect(stmt.broughtForwardCents).toBe(0);
      expect(stmt.monthCreditsCents).toBe(12000);
      expect(stmt.creditLines).toHaveLength(1);
      expect(stmt.creditLines[0]!.invoiceNo).toBe("B-0003");
      expect(stmt.closingDebtCents).toBe(12000);
    });
  });

  // Additional Scenario H: Contractor isolation / cross-contamination prevention
  describe("Scenario H: Zero Cross-Contamination Between Contractors", () => {
    it("completely filters out transactions belonging to other contractors", () => {
      const orderA: Order = {
        id: 601,
        companyId: 1,
        contractorId: 101,
        contractorName: "Alpha Builders Sdn Bhd",
        ts: new Date("2026-10-01T10:00:00Z").getTime(),
        businessDate: "2026-10-01",
        invNo: "B-0001",
        voidedAt: null,
        method: "Credit",
        totalCents: 10000,
        items: [],
      };
      const orderB: Order = {
        id: 602,
        companyId: 1,
        contractorId: 102,
        contractorName: "Beta Engineering",
        ts: new Date("2026-10-02T10:00:00Z").getTime(),
        businessDate: "2026-10-02",
        invNo: "B-0002",
        voidedAt: null,
        method: "Credit",
        totalCents: 77000,
        items: [],
      };
      const repB: Repayment = {
        id: 701,
        companyId: 1,
        contractorId: 102,
        contractorName: "Beta Engineering",
        creditId: 2,
        orderId: 602,
        amountCents: 30000,
        method: "Bank",
        ts: new Date("2026-10-10T10:00:00Z").getTime(),
        businessDate: "2026-10-10",
      };

      const stmtA = calculateContractorStatement(
        contractorAlpha,
        "2026-10",
        [orderA, orderB],
        [repB],
      );

      expect(stmtA.monthCreditsCents).toBe(10000);
      expect(stmtA.monthRepaymentsCents).toBe(0);
      expect(stmtA.closingDebtCents).toBe(10000);
      expect(stmtA.creditLines).toHaveLength(1);
      expect(stmtA.creditLines[0]!.orderId).toBe(601);
      expect(stmtA.repaymentLines).toHaveLength(0);
    });
  });

  // Additional Scenario I: Property test - 24-month continuous rollforward invariant
  describe("Scenario I: 24-Month Temporal Rollforward Invariant Generator", () => {
    it("preserves closingDebt(m-1) === broughtForward(m) across 24 consecutive months", () => {
      const orders: Order[] = [];
      const repayments: Repayment[] = [];
      const months: string[] = [];

      // Generate 24 months from 2025-01 to 2026-12
      for (let y = 2025; y <= 2026; y++) {
        for (let m = 1; m <= 12; m++) {
          const ym = `${y}-${String(m).padStart(2, "0")}`;
          months.push(ym);

          // 2 credit orders per month
          orders.push({
            id: orders.length + 1,
            companyId: 1,
            contractorId: 101,
            contractorName: "Alpha Builders Sdn Bhd",
            ts: new Date(`${ym}-05T10:00:00Z`).getTime(),
            businessDate: `${ym}-05`,
            invNo: `B-${orders.length + 1}`,
            voidedAt: null,
            method: "Credit",
            totalCents: (m * 1000) + 500, // Varied cents
            items: [],
          });
          // 1 refund order in some months
          if (m % 3 === 0) {
            orders.push({
              id: orders.length + 1,
              companyId: 1,
              contractorId: 101,
              contractorName: "Alpha Builders Sdn Bhd",
              ts: new Date(`${ym}-15T12:00:00Z`).getTime(),
              businessDate: `${ym}-15`,
              invNo: `B-${orders.length + 1}`,
              voidedAt: null,
              method: "Credit",
              totalCents: -500,
              refundOfOrderId: orders[orders.length - 1]!.id,
              items: [],
            });
          }
          // 1 repayment per month
          repayments.push({
            id: repayments.length + 1,
            companyId: 1,
            contractorId: 101,
            contractorName: "Alpha Builders Sdn Bhd",
            creditId: 1,
            orderId: 1,
            amountCents: (m * 800) + 200,
            method: "Bank",
            ts: new Date(`${ym}-20T14:00:00Z`).getTime(),
            businessDate: `${ym}-20`,
          });
        }
      }

      let priorClosing = 0;
      for (let i = 0; i < months.length; i++) {
        const ym = months[i]!;
        const stmt = calculateContractorStatement(contractorAlpha, ym, orders, repayments);

        if (i === 0) {
          expect(stmt.broughtForwardCents).toBe(0);
        } else {
          // Absolute core financial invariant
          expect(stmt.broughtForwardCents).toBe(priorClosing);
        }

        // Net arithmetic invariant
        expect(stmt.monthNetCents).toBe(stmt.monthCreditsCents - stmt.monthRepaymentsCents);
        expect(stmt.closingDebtCents).toBe(stmt.broughtForwardCents + stmt.monthNetCents);

        priorClosing = stmt.closingDebtCents;
      }
    });
  });

  // Additional Scenario J: Input validation & sanitization
  describe("Scenario J: Boundary Validation & Formatting", () => {
    it("trims whitespace from valid yearMonth string", () => {
      const stmt = calculateContractorStatement(contractorAlpha, "  2026-10  ", [], []);
      expect(stmt.yearMonth).toBe("2026-10");
    });

    it("rejects invalid year-month patterns with PosError", () => {
      const invalidFormats = [
        "2026-00",
        "2026-13",
        "2026-9",
        "2026/09",
        "26-09",
        "2026-OCT",
        "",
        "   ",
        "null",
      ];
      for (const inv of invalidFormats) {
        expect(() => calculateContractorStatement(contractorAlpha, inv, [], [])).toThrow(PosError);
      }
    });

    it("falls back to localDateStr(ts) when businessDate is null or undefined", () => {
      const fixedTs = new Date("2026-10-15T12:00:00Z").getTime();
      const orderNoBDate: any = {
        id: 888,
        companyId: 1,
        contractorId: 101,
        contractorName: "Alpha Builders Sdn Bhd",
        ts: fixedTs,
        businessDate: undefined,
        invNo: "B-0888",
        voidedAt: null,
        method: "Credit",
        totalCents: 5500,
        items: [],
      };
      const stmt = calculateContractorStatement(contractorAlpha, "2026-10", [orderNoBDate], []);
      expect(stmt.creditLines).toHaveLength(1);
      expect(stmt.monthCreditsCents).toBe(5500);
      expect(stmt.closingDebtCents).toBe(5500);
    });

    it("sorts multiple transactions within the same date deterministically", () => {
      const o1: Order = {
        id: 10,
        companyId: 1,
        contractorId: 101,
        ts: 1000,
        businessDate: "2026-10-10",
        invNo: "B-0010",
        voidedAt: null,
        method: "Credit",
        totalCents: 1000,
        items: [],
      };
      const o2: Order = {
        id: 5,
        companyId: 1,
        contractorId: 101,
        ts: 1000,
        businessDate: "2026-10-10",
        invNo: "B-0005",
        voidedAt: null,
        method: "Credit",
        totalCents: 2000,
        items: [],
      };
      const o3: Order = {
        id: 20,
        companyId: 1,
        contractorId: 101,
        ts: 500,
        businessDate: "2026-10-10",
        invNo: "B-0020",
        voidedAt: null,
        method: "Credit",
        totalCents: 3000,
        items: [],
      };

      const stmt = calculateContractorStatement(contractorAlpha, "2026-10", [o1, o2, o3], []);
      expect(stmt.creditLines.map((l) => l.orderId)).toEqual([20, 5, 10]);
    });
  });
});
