import { describe, expect, it } from "vitest";
import { buildReceipt, cleanCompanyRegNo, formatReceiptDate } from "./receipt.js";
import type { Order } from "./types.js";

describe("buildReceipt", () => {
  it("keeps quantity numeric and annotates bulk unit price with the tier threshold", () => {
    const order: Order = {
      id: 1,
      companyId: 1,
      ts: new Date(2026, 5, 23, 10, 30).getTime(),
      businessDate: "2026-06-23",
      invNo: "06-1000",
      voidedAt: null,
      method: "Cash",
      totalCents: 23000,
      items: [
        {
          id: 1,
          itemId: 1,
          name: "Ikan Tilapia",
          image: "",
          unit: "kg",
          priceCents: 2300,
          qtyMilli: 10000,
          amountCents: 23000,
          tailCount: 0,
          bulkPrice: true,
          bulkMinQtyMilli: 10000,
        },
      ],
    };

    const receipt = buildReceipt(order, { storeName: "Yun Fook Trading" });

    expect(receipt.lines[0]).toMatchObject({
      qtyText: "10 kg",
      unitPriceText: "RM 23.00/kg (10kg)",
    });
  });

  it("keeps measured units (kg/ft) annotated and counted units bare", () => {
    const order: Order = {
      id: 2,
      companyId: 1,
      ts: new Date(2026, 5, 23, 10, 30).getTime(),
      businessDate: "2026-06-23",
      invNo: "06-1001",
      voidedAt: null,
      method: "Cash",
      totalCents: 3180,
      items: [
        {
          id: 1, itemId: 1, name: "Nails", image: "", unit: "kg",
          priceCents: 2500, qtyMilli: 1200, amountCents: 3000, tailCount: 0, bulkPrice: false,
        },
        {
          id: 2, itemId: 2, name: "Plywood", image: "", unit: "pcs",
          priceCents: 180, qtyMilli: 1000, amountCents: 180, tailCount: 0, bulkPrice: false,
        },
      ],
    };

    const receipt = buildReceipt(order, { storeName: "Borneo Jasa Sdn. Bhd." });

    expect(receipt.lines[0]).toMatchObject({ name: "Nails", qtyText: "1.2 kg" });
    expect(receipt.lines[1]).toMatchObject({ name: "Plywood", qtyText: "1" });
  });

  it("formats per-line discounts and whole-bill discounts clearly on the receipt", () => {
    const order: Order = {
      id: 5,
      companyId: 1,
      ts: new Date(2026, 5, 23, 10, 30).getTime(),
      businessDate: "2026-06-23",
      invNo: "06-1005",
      voidedAt: null,
      method: "Cash",
      subtotalCents: 11500,
      discountCents: 500,
      totalCents: 11000,
      items: [
        {
          id: 1,
          itemId: 1,
          name: "Cement — 50 kg",
          image: "",
          unit: "bag",
          origPriceCents: 2400,
          priceCents: 2300,
          qtyMilli: 5000,
          amountCents: 11500,
          tailCount: 0,
          bulkPrice: false,
        },
      ],
    };

    const receipt = buildReceipt(order, { storeName: "Borneo Jasa Sdn. Bhd." });
    expect(receipt.lines[0]).toMatchObject({
      name: "Cement — 50 kg",
      unitPriceText: "RM 24.00 → RM 23.00/bag",
      discountText: "Discount -RM 5.00",
      amountText: "RM 115.00",
    });
    // Gross before line discount (500) and bill discount (500) = 12000 (RM 120.00)
    expect(receipt.subtotalText).toBe("RM 120.00");
    expect(receipt.discountText).toBe("-RM 10.00");
    expect(receipt.totalText).toBe("RM 110.00");
  });

  it("carries the creditor name onto the receipt for Credit sales", () => {
    const order: Order = {
      id: 3,
      companyId: 1,
      ts: new Date(2026, 5, 23, 10, 30).getTime(),
      businessDate: "2026-06-23",
      invNo: "06-1002",
      voidedAt: null,
      method: "Credit",
      totalCents: 1000,
      creditorName: "Pak Abu",
      items: [
        {
          id: 1, itemId: 1, name: "Ikan Tilapia", image: "", unit: "kg",
          priceCents: 1000, qtyMilli: 1000, amountCents: 1000, tailCount: 0, bulkPrice: false,
        },
      ],
    };

    const receipt = buildReceipt(order, { storeName: "Yun Fook Trading" });

    expect(receipt.creditorName).toBe("Pak Abu");
  });

  it("leaves creditorName unset for non-Credit sales", () => {
    const order: Order = {
      id: 4,
      companyId: 1,
      ts: new Date(2026, 5, 23, 10, 30).getTime(),
      businessDate: "2026-06-23",
      invNo: "06-1003",
      voidedAt: null,
      method: "Cash",
      totalCents: 1000,
      items: [
        {
          id: 1, itemId: 1, name: "Ikan Tilapia", image: "", unit: "kg",
          priceCents: 1000, qtyMilli: 1000, amountCents: 1000, tailCount: 0, bulkPrice: false,
        },
      ],
    };

    const receipt = buildReceipt(order, { storeName: "Yun Fook Trading" });

    expect(receipt.creditorName).toBeUndefined();
  });

  it("cleans company registration numbers to retain only (227533-X)", () => {
    const order: Order = {
      id: 6,
      companyId: 1,
      ts: 1774281360000,
      businessDate: "2026-03-23",
      invNo: "A-0001",
      voidedAt: null,
      method: "Cash",
      totalCents: 1000,
      items: [],
    };
    const r1 = buildReceipt(order, {
      storeName: "Borneo Jasa Sdn. Bhd.",
      regNo: "199101017221 (227533-X)",
    });
    expect(r1.regNo).toBe("(227533-X)");

    const r2 = buildReceipt(order, {
      storeName: "Borneo Jasa Sdn. Bhd.",
      regNo: "227533-X",
    });
    expect(r2.regNo).toBe("(227533-X)");
  });

  it("calculates totalQtyText across multiple items", () => {
    const order: Order = {
      id: 7,
      companyId: 1,
      ts: 1774281360000,
      businessDate: "2026-03-23",
      invNo: "A-0002",
      voidedAt: null,
      method: "Cash",
      totalCents: 5000,
      items: [
        {
          id: 1, itemId: 1, name: "Cement", image: "", unit: "bag",
          priceCents: 2400, qtyMilli: 2000, amountCents: 4800, tailCount: 0, bulkPrice: false,
        },
        {
          id: 2, itemId: 2, name: "Plywood", image: "", unit: "pcs",
          priceCents: 200, qtyMilli: 1000, amountCents: 200, tailCount: 0, bulkPrice: false,
        },
      ],
    };
    const receipt = buildReceipt(order, { storeName: "Borneo Jasa Sdn. Bhd." });
    expect(receipt.totalQtyText).toBe("3");
  });

  it("handles lowercase 227533-x and whitespace in cleanCompanyRegNo", () => {
    expect(cleanCompanyRegNo("227533-x")).toBe("(227533-X)");
    expect(cleanCompanyRegNo("227533 - X")).toBe("(227533-X)");
    expect(cleanCompanyRegNo(" ( 227533 - x ) ")).toBe("(227533-X)");
    expect(cleanCompanyRegNo(" 199101017221 (227533-x) ")).toBe("(227533-X)");
    expect(cleanCompanyRegNo("(227533-X)")).toBe("(227533-X)");
    expect(cleanCompanyRegNo("")).toBe("");
    expect(cleanCompanyRegNo("   ")).toBe("");
    expect(cleanCompanyRegNo(undefined)).toBe("");
  });

  it("safely formats dates from string ISO, numeric string, Date, or corrupt values in formatReceiptDate", () => {
    expect(formatReceiptDate(new Date(2026, 9, 23, 15, 56))).toBe("23/10/2026 15:56");
    expect(formatReceiptDate("2026-10-23T15:56:00")).toBe("23/10/2026 15:56");
    expect(formatReceiptDate(1774281360000)).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
    expect(formatReceiptDate("")).toBe("");
    expect(formatReceiptDate("   ")).toBe("");
    expect(formatReceiptDate(0)).toBe("");
    expect(formatReceiptDate(-1)).toBe("");
    expect(formatReceiptDate("invalid-date")).toBe("");
    expect(formatReceiptDate(null)).toBe("");
    expect(formatReceiptDate(undefined)).toBe("");
  });

  it("strictly omits contractor in buildReceipt when invNo is an A- walkin sequence", () => {
    const order: Order = {
      id: 8,
      companyId: 1,
      ts: 1774281360000,
      businessDate: "2026-03-23",
      invNo: "A-0001",
      voidedAt: null,
      method: "Cash",
      totalCents: 1000,
      items: [],
      creditorName: "Sneaky Contractor",
    };
    const receipt = buildReceipt(order, {
      storeName: "Borneo Jasa",
      contractor: { name: "Sneaky Contractor", tin: "T123" },
    });
    expect(receipt.contractor).toBeUndefined();
  });

  it("falls back to order.creditorName when opts.contractor has blank/whitespace name", () => {
    const order: Order = {
      id: 9,
      companyId: 1,
      ts: 1774281360000,
      businessDate: "2026-03-23",
      invNo: "B-0001",
      voidedAt: null,
      method: "Credit",
      totalCents: 1000,
      items: [],
      creditorName: "Valid Creditor",
    };
    const receipt = buildReceipt(order, {
      storeName: "Borneo Jasa",
      contractor: { name: "   " },
    });
    expect(receipt.contractor?.name).toBe("Valid Creditor");
  });

  it("maps cashierName from order in buildReceipt", () => {
    const order: Order = {
      id: 10,
      companyId: 1,
      ts: 1774281360000,
      businessDate: "2026-03-23",
      invNo: "A-0002",
      voidedAt: null,
      method: "Cash",
      totalCents: 1000,
      items: [],
      cashierName: "Ah Ming",
    };
    const receipt = buildReceipt(order, { storeName: "Borneo Jasa" });
    expect(receipt.cashierName).toBe("Ah Ming");
  });
});

