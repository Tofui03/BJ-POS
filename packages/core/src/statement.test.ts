import { describe, expect, it } from "vitest";
import { PosError } from "./errors.js";
import {
  calculateContractorStatement,
  formatRepaymentRef,
  formatStatementDescription,
  isValidYearMonth,
} from "./statement.js";
import type { Contractor, Order, OrderLine, Repayment } from "./types.js";

const line = (over: Partial<OrderLine> = {}): OrderLine => ({
  id: 1,
  itemId: 1,
  name: "Item",
  image: "",
  unit: "each",
  priceCents: 1000,
  qtyMilli: 1000,
  amountCents: 1000,
  tailCount: 0,
  bulkPrice: false,
  ...over,
});

describe("Contractor Monthly Statement Domain Logic", () => {
  const dummyContractor: Contractor = {
    id: 5,
    companyId: 1,
    name: "Chong Construction",
    phone: "012-3456789",
    tin: "C1234567890",
    address: "Lot 8, Industrial Park, Keningau",
    active: true,
  };

  describe("formatStatementDescription", () => {
    it("summarizes items concisely up to 3 items", () => {
      const order: Order = {
        id: 1,
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-05",
        invNo: "B-0001",
        voidedAt: null,
        method: "Credit",
        totalCents: 5000,
        items: [
          line({
            id: 101,
            itemId: 10,
            priceCents: 2000,
            qtyMilli: 2000,
            customName: "Cement 50kg",
            amountCents: 4000,
          }),
          line({
            id: 102,
            itemId: 20,
            priceCents: 1000,
            qtyMilli: 1000,
            customName: "Fine Sand",
            amountCents: 1000,
          }),
        ],
      };
      expect(formatStatementDescription(order)).toBe("Cement 50kg (x2), Fine Sand");
    });

    it("appends +N more when order has more than 3 items", () => {
      const order: Order = {
        id: 2,
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-05",
        invNo: "B-0002",
        voidedAt: null,
        method: "Credit",
        totalCents: 10000,
        items: [
          line({ id: 1, itemId: 1, name: "Item A", priceCents: 1000, qtyMilli: 1000, amountCents: 1000 }),
          line({ id: 2, itemId: 2, name: "Item B", priceCents: 1000, qtyMilli: 1000, amountCents: 1000 }),
          line({ id: 3, itemId: 3, name: "Item C", priceCents: 1000, qtyMilli: 1000, amountCents: 1000 }),
          line({ id: 4, itemId: 4, name: "Item D", priceCents: 1000, qtyMilli: 1000, amountCents: 1000 }),
          line({ id: 5, itemId: 5, name: "Item E", priceCents: 1000, qtyMilli: 1000, amountCents: 1000 }),
        ],
      };
      expect(formatStatementDescription(order)).toBe("Item A, Item B, Item C, +2 more");
    });

    it("prepends order note when note is provided", () => {
      const order: Order = {
        id: 3,
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-05",
        invNo: "B-0003",
        voidedAt: null,
        method: "Credit",
        totalCents: 3000,
        note: "Site B project",
        items: [
          line({ id: 1, itemId: 1, name: "White Paint 5L", priceCents: 3000, qtyMilli: 1000, amountCents: 3000 }),
        ],
      };
      expect(formatStatementDescription(order)).toBe("Site B project — White Paint 5L");
    });

    it("formats refund orders with return notation and original invoice reference", () => {
      const refundOrder: Order = {
        id: 4,
        companyId: 1,
        ts: Date.now(),
        businessDate: "2026-10-08",
        invNo: "B-0004",
        voidedAt: null,
        method: "Credit",
        totalCents: -2000,
        refundOfOrderId: 1,
        refundOfInvNo: "B-0001",
        items: [
          line({ id: 10, itemId: 10, customName: "Cement 50kg", priceCents: 2000, qtyMilli: 1000, amountCents: -2000 }),
        ],
      };
      expect(formatStatementDescription(refundOrder)).toBe("[REFUND / 退货] Ref: B-0001 (Cement 50kg x1)");
    });
  });

  describe("formatRepaymentRef", () => {
    it("formats repayment id into padded voucher reference", () => {
      const rep: Repayment = {
        id: 7,
        companyId: 1,
        creditId: 10,
        orderId: 1,
        amountCents: 5000,
        method: "Bank",
        ts: Date.now(),
        businessDate: "2026-10-10",
      };
      expect(formatRepaymentRef(rep)).toBe("RP-0007");
    });
  });

  describe("isValidYearMonth", () => {
    it("validates valid and rejects invalid year-month formats", () => {
      expect(isValidYearMonth("2026-10")).toBe(true);
      expect(isValidYearMonth("2026-01")).toBe(true);
      expect(isValidYearMonth("2026-12")).toBe(true);

      expect(isValidYearMonth("2026-13")).toBe(false);
      expect(isValidYearMonth("2026-00")).toBe(false);
      expect(isValidYearMonth("2026-1")).toBe(false);
      expect(isValidYearMonth("2026/10")).toBe(false);
      expect(isValidYearMonth("2026-Oct")).toBe(false);
      expect(isValidYearMonth("")).toBe(false);
    });
  });

  describe("calculateContractorStatement", () => {
    it("throws PosError on invalid yearMonth format", () => {
      expect(() =>
        calculateContractorStatement(dummyContractor, "invalid-ym", [], []),
      ).toThrow(PosError);
    });

    it("returns zero balances for dormant contractor with no history", () => {
      const stmt = calculateContractorStatement(dummyContractor, "2026-10", [], []);
      expect(stmt.broughtForwardCents).toBe(0);
      expect(stmt.openingDebtCents).toBe(0);
      expect(stmt.monthCreditsCents).toBe(0);
      expect(stmt.monthRepaymentsCents).toBe(0);
      expect(stmt.monthNetCents).toBe(0);
      expect(stmt.closingDebtCents).toBe(0);
      expect(stmt.totalOutstandingCents).toBe(0);
      expect(stmt.creditLines).toHaveLength(0);
      expect(stmt.repaymentLines).toHaveLength(0);
    });

    it("computes accurate brought forward, month activity, and closing balances", () => {
      // Prior month orders (August & September)
      const priorOrder1: Order = {
        id: 1,
        companyId: 1,
        contractorId: 5,
        contractorName: "Chong Construction",
        ts: new Date("2026-08-15").getTime(),
        businessDate: "2026-08-15",
        invNo: "B-0001",
        voidedAt: null,
        method: "Credit",
        totalCents: 30000, // RM 300.00
        items: [],
      };
      const priorOrder2: Order = {
        id: 2,
        companyId: 1,
        contractorId: 5,
        contractorName: "Chong Construction",
        ts: new Date("2026-09-10").getTime(),
        businessDate: "2026-09-10",
        invNo: "B-0002",
        voidedAt: null,
        method: "Credit",
        totalCents: 20000, // RM 200.00
        items: [],
      };
      // Prior repayments (September)
      const priorRepayment: Repayment = {
        id: 1,
        companyId: 1,
        contractorId: 5,
        contractorName: "Chong Construction",
        creditId: 1,
        orderId: 1,
        amountCents: 15000, // RM 150.00
        method: "Bank",
        ts: new Date("2026-09-20").getTime(),
        businessDate: "2026-09-20",
      };

      // Current month orders (October)
      const currentOrder1: Order = {
        id: 3,
        companyId: 1,
        contractorId: 5,
        contractorName: "Chong Construction",
        ts: new Date("2026-10-02").getTime(),
        businessDate: "2026-10-02",
        invNo: "B-0003",
        voidedAt: null,
        method: "Credit",
        totalCents: 45000, // RM 450.00
        items: [line({ id: 1, itemId: 1, name: "Plywood 12mm", priceCents: 4500, qtyMilli: 10000, amountCents: 45000 })],
      };
      const currentOrder2: Order = {
        id: 4,
        companyId: 1,
        contractorId: 5,
        contractorName: "Chong Construction",
        ts: new Date("2026-10-15").getTime(),
        businessDate: "2026-10-15",
        invNo: "B-0004",
        voidedAt: null,
        method: "Credit",
        totalCents: 15000, // RM 150.00
        items: [line({ id: 2, itemId: 2, name: "Nails 2 inch", priceCents: 1500, qtyMilli: 10000, amountCents: 15000 })],
      };

      // Current month repayment (October)
      const currentRepayment: Repayment = {
        id: 2,
        companyId: 1,
        contractorId: 5,
        contractorName: "Chong Construction",
        creditId: 2,
        orderId: 2,
        amountCents: 20000, // RM 200.00
        method: "Cash",
        ts: new Date("2026-10-18").getTime(),
        businessDate: "2026-10-18",
        notes: "Part payment for plywood",
        cashierName: "Alice",
      };

      const orders = [priorOrder1, priorOrder2, currentOrder1, currentOrder2];
      const repayments = [priorRepayment, currentRepayment];

      const stmt = calculateContractorStatement(dummyContractor, "2026-10", orders, repayments);

      // Prior balance: RM 300 + RM 200 - RM 150 = RM 350.00 (35000 cents)
      expect(stmt.broughtForwardCents).toBe(35000);
      expect(stmt.openingDebtCents).toBe(35000);

      // Current month credits: RM 450 + RM 150 = RM 600.00 (60000 cents)
      expect(stmt.monthCreditsCents).toBe(60000);
      expect(stmt.creditLines).toHaveLength(2);
      expect(stmt.creditLines[0]!.invoiceNo).toBe("B-0003");
      expect(stmt.creditLines[1]!.invoiceNo).toBe("B-0004");

      // Current month repayments: RM 200.00 (20000 cents)
      expect(stmt.monthRepaymentsCents).toBe(20000);
      expect(stmt.repaymentLines).toHaveLength(1);
      expect(stmt.repaymentLines[0]!.receiptNo).toBe("RP-0002");
      expect(stmt.repaymentLines[0]!.cashierName).toBe("Alice");

      // Net movement: RM 600 - RM 200 = RM 400.00 (40000 cents)
      expect(stmt.monthNetCents).toBe(40000);

      // Closing debt: RM 350 + RM 400 = RM 750.00 (75000 cents)
      expect(stmt.closingDebtCents).toBe(75000);
      expect(stmt.totalOutstandingCents).toBe(75000);
    });

    it("satisfies temporal rollforward continuity across consecutive months", () => {
      const orderAug: Order = {
        id: 1,
        companyId: 1,
        contractorId: 5,
        ts: new Date("2026-08-10").getTime(),
        businessDate: "2026-08-10",
        invNo: "B-0001",
        voidedAt: null,
        method: "Credit",
        totalCents: 50000,
        items: [],
      };
      const repAug: Repayment = {
        id: 1,
        companyId: 1,
        contractorId: 5,
        creditId: 1,
        orderId: 1,
        amountCents: 20000,
        method: "Cash",
        ts: new Date("2026-08-25").getTime(),
        businessDate: "2026-08-25",
      };
      const orderSep: Order = {
        id: 2,
        companyId: 1,
        contractorId: 5,
        ts: new Date("2026-09-05").getTime(),
        businessDate: "2026-09-05",
        invNo: "B-0002",
        voidedAt: null,
        method: "Credit",
        totalCents: 30000,
        items: [],
      };

      const orders = [orderAug, orderSep];
      const repayments = [repAug];

      const stmtAug = calculateContractorStatement(dummyContractor, "2026-08", orders, repayments);
      const stmtSep = calculateContractorStatement(dummyContractor, "2026-09", orders, repayments);

      // Closing balance of August MUST equal Brought Forward of September
      expect(stmtAug.closingDebtCents).toBe(30000);
      expect(stmtSep.broughtForwardCents).toBe(stmtAug.closingDebtCents);
      expect(stmtSep.closingDebtCents).toBe(60000);
    });

    it("algebraically handles credit refund orders in past and current months", () => {
      const priorOrder: Order = {
        id: 1,
        companyId: 1,
        contractorId: 5,
        ts: new Date("2026-08-10").getTime(),
        businessDate: "2026-08-10",
        invNo: "B-0001",
        voidedAt: null,
        method: "Credit",
        totalCents: 40000,
        items: [],
      };
      const priorRefund: Order = {
        id: 2,
        companyId: 1,
        contractorId: 5,
        ts: new Date("2026-08-12").getTime(),
        businessDate: "2026-08-12",
        invNo: "B-0002",
        voidedAt: null,
        method: "Credit",
        totalCents: -10000, // Credit refund of RM 100
        refundOfOrderId: 1,
        items: [],
      };

      const currentOrder: Order = {
        id: 3,
        companyId: 1,
        contractorId: 5,
        ts: new Date("2026-09-05").getTime(),
        businessDate: "2026-09-05",
        invNo: "B-0003",
        voidedAt: null,
        method: "Credit",
        totalCents: 50000,
        items: [],
      };
      const currentRefund: Order = {
        id: 4,
        companyId: 1,
        contractorId: 5,
        ts: new Date("2026-09-15").getTime(),
        businessDate: "2026-09-15",
        invNo: "B-0004",
        voidedAt: null,
        method: "Credit",
        totalCents: -5000, // Credit refund of RM 50
        refundOfOrderId: 3,
        items: [],
      };

      const orders = [priorOrder, priorRefund, currentOrder, currentRefund];
      const stmt = calculateContractorStatement(dummyContractor, "2026-09", orders, []);

      // Brought forward = 40000 - 10000 = 30000
      expect(stmt.broughtForwardCents).toBe(30000);

      // Current month credits = 50000 - 5000 = 45000
      expect(stmt.monthCreditsCents).toBe(45000);
      expect(stmt.creditLines).toHaveLength(2);
      expect(stmt.creditLines[1]!.amountCents).toBe(-5000);

      // Closing balance = 30000 + 45000 = 75000
      expect(stmt.closingDebtCents).toBe(75000);
    });

    it("strictly excludes voided orders and non-credit payment methods", () => {
      const normalCreditOrder: Order = {
        id: 1,
        companyId: 1,
        contractorId: 5,
        ts: new Date("2026-10-01").getTime(),
        businessDate: "2026-10-01",
        invNo: "B-0001",
        voidedAt: null,
        method: "Credit",
        totalCents: 20000,
        items: [],
      };
      const voidedCreditOrder: Order = {
        id: 2,
        companyId: 1,
        contractorId: 5,
        ts: new Date("2026-10-05").getTime(),
        businessDate: "2026-10-05",
        invNo: "B-0002",
        voidedAt: Date.now(), // VOIDED!
        method: "Credit",
        totalCents: 99999,
        items: [],
      };
      const cashOrderForContractor: Order = {
        id: 3,
        companyId: 1,
        contractorId: 5,
        ts: new Date("2026-10-08").getTime(),
        businessDate: "2026-10-08",
        invNo: "B-0003",
        voidedAt: null,
        method: "Cash", // Cash purchase by contractor - no credit debt!
        totalCents: 50000,
        items: [],
      };

      const stmt = calculateContractorStatement(
        dummyContractor,
        "2026-10",
        [normalCreditOrder, voidedCreditOrder, cashOrderForContractor],
        [],
      );

      expect(stmt.creditLines).toHaveLength(1);
      expect(stmt.creditLines[0]!.invoiceNo).toBe("B-0001");
      expect(stmt.monthCreditsCents).toBe(20000);
      expect(stmt.closingDebtCents).toBe(20000);
    });

    it("ignores future transactions occurring after target yearMonth", () => {
      const orderCurrent: Order = {
        id: 1,
        companyId: 1,
        contractorId: 5,
        ts: new Date("2026-10-10").getTime(),
        businessDate: "2026-10-10",
        invNo: "B-0001",
        voidedAt: null,
        method: "Credit",
        totalCents: 25000,
        items: [],
      };
      const orderFuture: Order = {
        id: 2,
        companyId: 1,
        contractorId: 5,
        ts: new Date("2026-11-05").getTime(),
        businessDate: "2026-11-05",
        invNo: "B-0002",
        voidedAt: null,
        method: "Credit",
        totalCents: 90000,
        items: [],
      };
      const repFuture: Repayment = {
        id: 1,
        companyId: 1,
        contractorId: 5,
        creditId: 1,
        orderId: 1,
        amountCents: 20000,
        method: "Bank",
        ts: new Date("2026-11-10").getTime(),
        businessDate: "2026-11-10",
      };

      const stmt = calculateContractorStatement(
        dummyContractor,
        "2026-10",
        [orderCurrent, orderFuture],
        [repFuture],
      );

      expect(stmt.creditLines).toHaveLength(1);
      expect(stmt.repaymentLines).toHaveLength(0);
      expect(stmt.monthCreditsCents).toBe(25000);
      expect(stmt.closingDebtCents).toBe(25000);
    });

    it("matches contractor by name case-insensitively when contractorId is missing", () => {
      const orderLegacy: Order = {
        id: 1,
        companyId: 1,
        contractorName: " chong construction ",
        ts: new Date("2026-10-12").getTime(),
        businessDate: "2026-10-12",
        invNo: "B-0001",
        voidedAt: null,
        method: "Credit",
        totalCents: 18000,
        items: [],
      };
      const repLegacy: Repayment = {
        id: 1,
        companyId: 1,
        contractorName: "CHONG CONSTRUCTION",
        creditId: 1,
        orderId: 1,
        amountCents: 8000,
        method: "QR",
        ts: new Date("2026-10-20").getTime(),
        businessDate: "2026-10-20",
      };

      const stmt = calculateContractorStatement(
        dummyContractor,
        "2026-10",
        [orderLegacy],
        [repLegacy],
      );

      expect(stmt.creditLines).toHaveLength(1);
      expect(stmt.repaymentLines).toHaveLength(1);
      expect(stmt.closingDebtCents).toBe(10000);
    });
  });
});
