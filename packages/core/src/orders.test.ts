import { describe, it, expect } from "vitest";
import {
  buildOrder,
  formatInvNo,
  formatDoNo,
  determineInvoicePrefix,
  INV_SEQ_START,
  PosError,
  lineDiscountCents,
  orderTotalDiscountCents,
  orderGrossSubtotalCents,
  assertCanVoidOrder,
} from "./orders.js";
import { validateCashierName } from "./types.js";
import type { PricedItem, OrderLine } from "./types.js";

const fish: PricedItem = {
  id: 1, key: "talapia", name: "Talapia", image: "", unit: "kg",
  priceCents: 1800, active: true, tracksTail: true, stockMilli: null, sortOrder: 0,
  tiers: [{ id: 1, itemId: 1, minQtyMilli: 30000, priceCents: 1500 }],
};
const rice: PricedItem = {
  id: 2, key: "rice", name: "Rice", image: "", unit: "kg",
  priceCents: 350, active: true, tracksTail: false, stockMilli: null, sortOrder: 0, tiers: [],
};
const byId = new Map([[1, fish], [2, rice]]);
const resolve = (l: { itemId?: number }) => (l.itemId != null ? byId.get(l.itemId) ?? null : null);

describe("buildOrder", () => {
  it("snapshots the effective price and sums the total", () => {
    const draft = buildOrder(
      { method: "Cash", ts: 1000, lines: [{ itemId: 1, qtyMilli: 30000 }, { itemId: 2, qtyMilli: 2000 }] },
      resolve,
    );
    // fish 30kg @ RM15 = 45000, rice 2kg @ RM3.50 = 700 -> 45700
    expect(draft.totalCents).toBe(45700);
    expect(draft.lines[0]).toMatchObject({ itemId: 1, priceCents: 1500, qtyMilli: 30000 });
    expect(draft.lines[1]).toMatchObject({ itemId: 2, priceCents: 350, qtyMilli: 2000 });
    expect(draft.ts).toBe(1000);
    expect(draft.customerType).toBe("walkin");
  });

  it("rejects an empty order", () => {
    expect(() => buildOrder({ method: "Cash", lines: [] }, resolve)).toThrow(PosError);
  });

  it("rejects a bad payment method", () => {
    expect(() =>
      buildOrder({ method: "Crypto" as never, lines: [{ itemId: 1, qtyMilli: 1000 }] }, resolve),
    ).toThrow(/method must be/);
  });

  it("rejects unknown / inactive items", () => {
    expect(() => buildOrder({ method: "QR", lines: [{ itemId: 99, qtyMilli: 1000 }] }, resolve)).toThrow(
      /unknown or inactive/,
    );
    const inactive = new Map([[1, { ...fish, active: false }]]);
    expect(() =>
      buildOrder({ method: "QR", lines: [{ itemId: 1, qtyMilli: 1000 }] }, (l) =>
        l.itemId != null ? inactive.get(l.itemId) ?? null : null,
      ),
    ).toThrow(/unknown or inactive/);
  });

  it("rejects non-positive quantity", () => {
    expect(() => buildOrder({ method: "QR", lines: [{ itemId: 2, qtyMilli: 0 }] }, resolve)).toThrow(
      /qty must be > 0/,
    );
  });

  it("requires a creditor name for Credit when no contractor info is provided", () => {
    expect(() =>
      buildOrder({ method: "Credit", lines: [{ itemId: 2, qtyMilli: 1000 }] }, resolve),
    ).toThrow(/creditor name is required/);
    const draft = buildOrder(
      { method: "Credit", creditorName: "  Pak Abu  ", lines: [{ itemId: 2, qtyMilli: 1000 }] },
      resolve,
    );
    expect(draft).toMatchObject({ method: "Credit", creditorName: "Pak Abu" });
  });

  it("allows Credit sales when contractorName is supplied even without creditorName", () => {
    const draft = buildOrder(
      {
        method: "Credit",
        contractorName: "Acme Builders Sdn Bhd",
        lines: [{ itemId: 2, qtyMilli: 1000 }],
      },
      resolve,
    );
    expect(draft.method).toBe("Credit");
    expect(draft.creditorName).toBe("Acme Builders Sdn Bhd");
    expect(draft.customerType).toBe("contractor");
  });

  it("supports decoupled Contractor Cash payment without requiring creditorName", () => {
    const draft = buildOrder(
      {
        method: "Cash",
        customerType: "contractor",
        contractorId: 10,
        contractorName: "Mega Construction",
        customerTin: "C1234567890",
        customerAddress: "Lot 42, Industrial Zone",
        customerPhone: "012-3456789",
        lines: [{ itemId: 1, qtyMilli: 1000 }],
      },
      resolve,
    );
    expect(draft.method).toBe("Cash");
    expect(draft.customerType).toBe("contractor");
    expect(draft.contractorId).toBe(10);
    expect(draft.contractorName).toBe("Mega Construction");
    expect(draft.customerTin).toBe("C1234567890");
    expect(draft.customerAddress).toBe("Lot 42, Industrial Zone");
    expect(draft.customerPhone).toBe("012-3456789");
    expect(draft.creditorName).toBeUndefined();
  });

  it("captures Delivery Order (DO) metadata onto draft", () => {
    const draft = buildOrder(
      {
        method: "Cash",
        issueDo: true,
        doNumber: "DO-0042",
        siteAddress: "Site B, Kuala Lumpur",
        lorryPlate: "WXY 1234",
        driverName: "Ah Kow",
        contractorPo: "PO-9988",
        showPriceOnDo: false,
        lines: [{ itemId: 2, qtyMilli: 5000 }],
      },
      resolve,
    );
    expect(draft.issueDo).toBe(true);
    expect(draft.doNumber).toBe("DO-0042");
    expect(draft.doNo).toBe("DO-0042");
    expect(draft.siteAddress).toBe("Site B, Kuala Lumpur");
    expect(draft.lorryPlate).toBe("WXY 1234");
    expect(draft.driverName).toBe("Ah Kow");
    expect(draft.contractorPo).toBe("PO-9988");
    expect(draft.showPriceOnDo).toBe(false);
  });

  it("supports till-side unitPriceCents overrides, recording origPriceCents when discounted, and whole-bill discountCents", () => {
    const draft = buildOrder(
      {
        method: "Cash",
        discountCents: 300,
        lines: [
          // Rice base is 350, overridden to 300 -> origPriceCents = 350, line amount = 600
          { itemId: 2, qtyMilli: 2000, unitPriceCents: 300 },
          // Custom Lain-lain name with overridden price
          { itemId: 2, qtyMilli: 1000, unitPriceCents: 500, customName: "Lain-lain — Skru" },
        ],
      },
      resolve,
    );
    // Subtotal = 600 + 500 = 1100; minus bill discount 300 -> totalCents = 800
    expect(draft.totalCents).toBe(800);
    expect(draft.discountCents).toBe(300);
    expect(draft.lines[0]).toMatchObject({
      itemId: 2,
      priceCents: 300,
      origPriceCents: 350,
      qtyMilli: 2000,
    });
    expect(draft.lines[1]).toMatchObject({
      itemId: 2,
      priceCents: 500,
      customName: "Lain-lain — Skru",
      qtyMilli: 1000,
    });
    expect(draft.lines[1]!.origPriceCents).toBeUndefined();
  });
});

describe("formatInvNo", () => {
  it("formats walk-in (A-0001) and contractor (B-0001) invoice numbers", () => {
    expect(formatInvNo("A", INV_SEQ_START)).toBe("A-0001");
    expect(formatInvNo("A", 42)).toBe("A-0042");
    expect(formatInvNo("B", INV_SEQ_START)).toBe("B-0001");
    expect(formatInvNo("B", 100)).toBe("B-0100");
  });

  it("supports date and prefix arguments for flexible sequence generation", () => {
    expect(formatInvNo("2026-08-10", 1, "A")).toBe("A-0001");
    expect(formatInvNo("2026-08-10", 2, "B")).toBe("B-0002");
    expect(formatInvNo("2026-08-10", 1)).toBe("A-0001");
  });

  it("handles adversarial inputs: lowercase prefixes, sequence 0, floats, and large numbers", () => {
    expect(formatInvNo("b", 1)).toBe("B-0001");
    expect(formatInvNo("a", 1)).toBe("A-0001");
    expect(formatInvNo("2026-08-10", 1, "b")).toBe("B-0001");
    expect(formatInvNo("A", 0)).toBe("A-0001");
    expect(formatInvNo("A", 5.9)).toBe("A-0005");
    expect(formatInvNo("B", 10000)).toBe("B-10000");
    expect(formatInvNo("B-", 7)).toBe("B-0007");
    expect(formatInvNo("2026-08-10", 3, "credit")).toBe("B-0003");
    expect(formatInvNo("2026-08-10", 3, "UNKNOWN")).toBe("A-0003");
    expect(formatInvNo("A", NaN)).toBe("A-0001");
    expect(formatInvNo("B", Infinity)).toBe("B-0001");
    expect(formatInvNo("B", -99)).toBe("B-0001");
  });
});

describe("formatDoNo", () => {
  it("formats Delivery Order running numbers correctly", () => {
    expect(formatDoNo(1)).toBe("DO-0001");
    expect(formatDoNo(42)).toBe("DO-0042");
    expect(formatDoNo(9999)).toBe("DO-9999");
    expect(formatDoNo(10000)).toBe("DO-10000");
  });

  it("handles boundary and non-integer sequence numbers safely", () => {
    expect(formatDoNo(0)).toBe("DO-0001");
    expect(formatDoNo(-10)).toBe("DO-0001");
    expect(formatDoNo(NaN)).toBe("DO-0001");
    expect(formatDoNo(Infinity)).toBe("DO-0001");
    expect(formatDoNo(7.9)).toBe("DO-0007");
  });
});

describe("determineInvoicePrefix", () => {
  it("returns A for anonymous walk-in sales", () => {
    expect(determineInvoicePrefix({ customerType: "walkin", method: "Cash" })).toBe("A");
    expect(determineInvoicePrefix({ customerType: "walkin", method: "Bank" })).toBe("A");
    expect(determineInvoicePrefix({ customerType: "walkin", method: "QR" })).toBe("A");
    expect(determineInvoicePrefix({})).toBe("A");
  });

  it("returns B for contractor sales across all payment methods", () => {
    expect(determineInvoicePrefix({ customerType: "contractor", method: "Cash" })).toBe("B");
    expect(determineInvoicePrefix({ customerType: "contractor", method: "Bank" })).toBe("B");
    expect(determineInvoicePrefix({ customerType: "contractor", method: "QR" })).toBe("B");
    expect(determineInvoicePrefix({ customerType: "contractor", method: "Credit" })).toBe("B");
  });

  it("returns B whenever contractor information or credit is present", () => {
    expect(determineInvoicePrefix({ method: "Credit" })).toBe("B");
    expect(determineInvoicePrefix({ contractorName: "Syarikat Maju", method: "Cash" })).toBe("B");
    expect(determineInvoicePrefix({ contractorId: 5, method: "Cash" })).toBe("B");
    expect(determineInvoicePrefix({ creditorName: "Ah Hock", method: "Cash" })).toBe("B");
  });

  it("keeps an explicit walk-in on A even when a contractor id or name is still attached", () => {
    expect(
      determineInvoicePrefix({
        customerType: "walkin",
        method: "Cash",
        contractorId: 5,
        contractorName: "Syarikat Maju",
      }),
    ).toBe("A");
    const draft = buildOrder(
      {
        method: "Cash",
        customerType: "walkin",
        contractorId: 5,
        contractorName: "Syarikat Maju",
        contractorTin: "C123",
        lines: [{ itemId: 1, qtyMilli: 1000 }],
      },
      resolve,
    );
    expect(draft.customerType).toBe("walkin");
    expect(draft.contractorId).toBeUndefined();
    expect(draft.contractorName).toBeUndefined();
    expect(determineInvoicePrefix(draft)).toBe("A");
  });
});

describe("discount and subtotal calculations", () => {
  const sampleLine = (overrides: Partial<OrderLine> = {}): OrderLine => ({
    id: 1,
    itemId: 10,
    name: "Item 1",
    image: "",
    unit: "pcs",
    priceCents: 2000,
    origPriceCents: 2500,
    qtyMilli: 2000, // 2 pcs
    amountCents: 4000,
    tailCount: 0,
    bulkPrice: false,
    ...overrides,
  });

  describe("lineDiscountCents", () => {
    it("calculates discount when origPriceCents > priceCents", () => {
      // orig 2500 * 2 = 5000; charged = 4000; discount = 1000
      const line = sampleLine({ origPriceCents: 2500, priceCents: 2000, qtyMilli: 2000, amountCents: 4000 });
      expect(lineDiscountCents(line)).toBe(1000);
    });

    it("returns 0 when origPriceCents is null or undefined", () => {
      const line = sampleLine({ origPriceCents: null });
      expect(lineDiscountCents(line)).toBe(0);
    });

    it("returns 0 when origPriceCents <= priceCents", () => {
      const lineSame = sampleLine({ origPriceCents: 2000, priceCents: 2000 });
      expect(lineDiscountCents(lineSame)).toBe(0);
      const lineLower = sampleLine({ origPriceCents: 1800, priceCents: 2000 });
      expect(lineDiscountCents(lineLower)).toBe(0);
    });

    it("handles measured unit discount accurately", () => {
      // 1.25 kg @ RM 28.00 (orig) = 3500 cents; charged @ RM 24.00 = 3000 cents; discount = 500 cents
      const line = sampleLine({
        unit: "kg",
        qtyMilli: 1250,
        origPriceCents: 2800,
        priceCents: 2400,
        amountCents: 3000,
      });
      expect(lineDiscountCents(line)).toBe(500);
    });
  });

  describe("orderTotalDiscountCents & orderGrossSubtotalCents", () => {
    it("sums all line discounts plus whole-order discount", () => {
      const line1 = sampleLine({ origPriceCents: 2500, priceCents: 2000, qtyMilli: 2000, amountCents: 4000 }); // 1000
      const line2 = sampleLine({ origPriceCents: 1500, priceCents: 1200, qtyMilli: 1000, amountCents: 1200 }); // 300
      const line3 = sampleLine({ origPriceCents: null, priceCents: 500, qtyMilli: 1000, amountCents: 500 }); // 0

      const order = {
        totalCents: 5500,
        discountCents: 200,
        items: [line1, line2, line3],
      };

      // line discounts = 1000 + 300 = 1300; order discount = 200 -> total = 1500
      expect(orderTotalDiscountCents(order)).toBe(1500);
      // gross subtotal = 5500 + 1500 = 7000
      expect(orderGrossSubtotalCents(order)).toBe(7000);
    });

    it("returns zero discount when no discounts apply", () => {
      const line = sampleLine({ origPriceCents: null, priceCents: 1000, qtyMilli: 1000, amountCents: 1000 });
      const order = {
        totalCents: 1000,
        items: [line],
      };
      expect(orderTotalDiscountCents(order)).toBe(0);
      expect(orderGrossSubtotalCents(order)).toBe(1000);
    });
  });
});

describe("assertCanVoidOrder", () => {
  it("returns noop if order is already voided", () => {
    expect(
      assertCanVoidOrder({
        voidedAt: 123456789,
        creditClearedAt: null,
        hasClearedCredit: false,
        hasRepayment: false,
      }),
    ).toBe("noop");
  });

  it("returns ok for a normal active unvoided order", () => {
    expect(
      assertCanVoidOrder({
        voidedAt: null,
        creditClearedAt: null,
        hasClearedCredit: false,
        hasRepayment: false,
      }),
    ).toBe("ok");
  });

  it("throws PosError if order credit is cleared", () => {
    expect(() =>
      assertCanVoidOrder({
        voidedAt: null,
        creditClearedAt: 123456789,
        hasClearedCredit: false,
        hasRepayment: false,
      }),
    ).toThrow("cannot void a credit order that has already been settled");
  });

  it("throws PosError if hasClearedCredit is true", () => {
    expect(() =>
      assertCanVoidOrder({
        voidedAt: null,
        creditClearedAt: null,
        hasClearedCredit: true,
        hasRepayment: false,
      }),
    ).toThrow("cannot void a credit order that has already been settled");
  });

  it("throws PosError if hasRepayment is true", () => {
    expect(() =>
      assertCanVoidOrder({
        voidedAt: null,
        creditClearedAt: null,
        hasClearedCredit: false,
        hasRepayment: true,
      }),
    ).toThrow("cannot void a credit order that has already been settled");
  });
});

describe("validateCashierName", () => {
  it("accepts a valid cashier name and trims surrounding spaces", () => {
    expect(validateCashierName("Ah Ming")).toBe("Ah Ming");
    expect(validateCashierName("   Siti Nur   ")).toBe("Siti Nur");
  });

  it("throws PosError when name is empty string", () => {
    expect(() => validateCashierName("")).toThrow("cashier name cannot be empty");
    expect(() => validateCashierName("")).toThrow(PosError);
  });

  it("throws PosError when name contains only whitespace", () => {
    expect(() => validateCashierName("    ")).toThrow("cashier name cannot be empty");
    expect(() => validateCashierName("\t\n ")).toThrow(PosError);
  });

  it("throws PosError when name is null or undefined", () => {
    expect(() => validateCashierName(null as unknown as string)).toThrow("cashier name cannot be empty");
    expect(() => validateCashierName(undefined as unknown as string)).toThrow("cashier name cannot be empty");
  });
});

describe("buildOrder - cashier audit", () => {
  it("sanitizes and stores cashierName when provided", () => {
    const draft = buildOrder(
      {
        method: "Cash",
        cashierName: "  Ah Ming  ",
        lines: [{ itemId: 1, qtyMilli: 1000 }],
      },
      resolve,
    );
    expect(draft.cashierName).toBe("Ah Ming");
  });

  it("omits cashierName when not provided", () => {
    const draft = buildOrder(
      {
        method: "Cash",
        lines: [{ itemId: 1, qtyMilli: 1000 }],
      },
      resolve,
    );
    expect(draft.cashierName).toBeUndefined();
  });

  it("throws PosError when whitespace-only cashierName is provided", () => {
    expect(() =>
      buildOrder(
        {
          method: "Cash",
          cashierName: "   ",
          lines: [{ itemId: 1, qtyMilli: 1000 }],
        },
        resolve,
      ),
    ).toThrow("cashier name cannot be empty");
  });
});
