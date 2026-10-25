import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import type { Order, OrderLine } from "@yf/core";
import {
  buildDailyExcelB64,
  buildDailyWorkbook,
  HQ_DAILY_HEADERS,
  INVOICE_ITEMS_HEADERS,
  splitNameSpec,
} from "./daily";

const line = (partial: Partial<OrderLine> & Pick<OrderLine, "name" | "qtyMilli" | "amountCents">): OrderLine => ({
  id: partial.id ?? 1,
  itemId: partial.itemId ?? 1,
  name: partial.name,
  image: "",
  unit: partial.unit ?? "pcs",
  priceCents: partial.priceCents ?? partial.amountCents,
  ...(partial.origPriceCents != null ? { origPriceCents: partial.origPriceCents } : {}),
  ...(partial.customName ? { customName: partial.customName } : {}),
  qtyMilli: partial.qtyMilli,
  amountCents: partial.amountCents,
  tailCount: partial.tailCount ?? 0,
  bulkPrice: false,
});

const orders: Order[] = [
  {
    id: 101,
    companyId: 1,
    ts: new Date("2026-08-10T09:15:00+08:00").getTime(),
    businessDate: "2026-08-10",
    invNo: "08-1005",
    method: "Cash",
    totalCents: 6930,
    voidedAt: null,
    items: [
      line({
        name: "Cement — 50 kg",
        unit: "bag",
        qtyMilli: 2000,
        priceCents: 2400,
        amountCents: 4800,
      }),
      line({
        id: 2,
        itemId: 2,
        name: "Plywood — 4 x 8 x 9mm",
        unit: "pcs",
        qtyMilli: 1000,
        priceCents: 2130,
        amountCents: 2130,
      }),
    ],
  },
  {
    id: 102,
    companyId: 1,
    ts: new Date("2026-08-10T10:30:00+08:00").getTime(),
    businessDate: "2026-08-10",
    invNo: "08-1006",
    method: "Credit",
    creditorName: "Ah Meng",
    totalCents: 12000,
    voidedAt: null,
    items: [
      line({
        id: 3,
        itemId: 3,
        name: "GI Pipe — 1 inch",
        unit: "batang",
        qtyMilli: 3000,
        priceCents: 4000,
        amountCents: 12000,
      }),
    ],
  },
  {
    id: 103,
    companyId: 1,
    ts: new Date("2026-08-10T11:00:00+08:00").getTime(),
    businessDate: "2026-08-10",
    invNo: "08-1007",
    method: "QR",
    totalCents: 999,
    voidedAt: Date.now(),
    items: [line({ name: "Voided item", qtyMilli: 1000, amountCents: 999 })],
  },
];

const rowsOf = (workbook: XLSX.WorkBook, name: string): unknown[][] =>
  XLSX.utils.sheet_to_json(workbook.Sheets[name]!, { header: 1, raw: true, defval: "" });

describe("splitNameSpec", () => {
  it("splits em-dash names", () => {
    expect(splitNameSpec("Cement — 50 kg")).toEqual({ item: "Cement", spec: "50 kg" });
  });
});

describe("daily Excel workbook (template v6 — Borneo Jasa)", () => {
  it("emits only HQ Daily and Invoice Items", () => {
    const workbook = buildDailyWorkbook(orders);
    expect(workbook.SheetNames).toEqual(["HQ Daily", "Invoice Items"]);
  });

  it("lists non-voided sales on HQ Daily with subtotal, discount, amount, and credit columns", () => {
    const workbook = buildDailyWorkbook(orders);
    const list = rowsOf(workbook, "HQ Daily");
    expect(list[0]).toEqual([...HQ_DAILY_HEADERS]);
    expect(list[1]).toEqual(["", "2026-08-10", "08-1005", "Cash", 69.3, "", 69.3, "", ""]);
    expect(list[2]).toEqual(["Ah Meng", "2026-08-10", "08-1006", "Credit", 120, "", 120, 120, ""]);
    expect(list[3]?.[0]).toBe("TOTAL");
    expect(workbook.Sheets["HQ Daily"]!["E4"]?.f).toBe("SUM(E2:E3)");
    expect(workbook.Sheets["HQ Daily"]!["F4"]?.f).toBe("SUM(F2:F3)");
    expect(workbook.Sheets["HQ Daily"]!["G4"]?.f).toBe("SUM(G2:G3)");
    expect(workbook.Sheets["HQ Daily"]!["H4"]?.f).toBe("SUM(H2:H3)");
    // Voided sale is excluded entirely.
    expect(list.flat()).not.toContain("08-1007");
  });

  it("expands each line onto Invoice Items with spec, orig price, discount, and credit flag", () => {
    const workbook = buildDailyWorkbook(orders);
    const items = rowsOf(workbook, "Invoice Items");
    expect(items[0]).toEqual([...INVOICE_ITEMS_HEADERS]);
    expect(items[1]).toEqual(["08-1005", "Cement", "50 kg", "bag", 2, 24, 24, "", 48, ""]);
    expect(items[2]).toEqual(["08-1005", "Plywood", "4 x 8 x 9mm", "pcs", 1, 21.3, 21.3, "", 21.3, ""]);
    expect(items[3]).toEqual(["08-1006", "GI Pipe", "1 inch", "batang", 3, 40, 40, "", 120, "Y"]);
    expect(workbook.Sheets["Invoice Items"]!["H5"]?.f).toBe("SUM(H2:H4)");
    expect(workbook.Sheets["Invoice Items"]!["I5"]?.f).toBe("SUM(I2:I4)");
  });

  it("tracks line discounts and whole-bill discounts in HQ Daily and Invoice Items", () => {
    const discountedOrder: Order = {
      id: 200,
      companyId: 1,
      ts: new Date("2026-08-10T14:00:00+08:00").getTime(),
      businessDate: "2026-08-10",
      invNo: "08-1008",
      method: "Cash",
      discountCents: 300,
      totalCents: 4500,
      voidedAt: null,
      items: [
        line({
          name: "Cement — 50 kg",
          unit: "bag",
          qtyMilli: 2000,
          origPriceCents: 2600,
          priceCents: 2400,
          amountCents: 4800,
        }),
      ],
    };
    const workbook = buildDailyWorkbook([discountedOrder]);
    const list = rowsOf(workbook, "HQ Daily");
    // Line discount = (26 - 24)*2 = 4.00, Bill discount = 3.00 -> Total discount = 7.00, Gross subtotal = 52.00, Final = 45.00
    expect(list[1]).toEqual(["", "2026-08-10", "08-1008", "Cash", 52, 7, 45, "", ""]);
    const items = rowsOf(workbook, "Invoice Items");
    expect(items[1]).toEqual(["08-1008", "Cement", "50 kg", "bag", 2, 26, 24, 4, 48, ""]);
  });

  it("writes a valid xlsx attachment", () => {
    const workbook = XLSX.read(buildDailyExcelB64(orders), { type: "base64" });
    expect(workbook.SheetNames).toEqual(["HQ Daily", "Invoice Items"]);
  });

  it("keeps an empty-sales workbook usable with zero footer totals", () => {
    const workbook = buildDailyWorkbook([]);
    const list = workbook.Sheets["HQ Daily"]!;
    expect(rowsOf(workbook, "HQ Daily")).toEqual([
      [...HQ_DAILY_HEADERS],
      ["TOTAL", "", "", "", 0, 0, 0, 0, ""],
    ]);
    expect(list["E2"]?.v).toBe(0);
    expect(list["E2"]?.f).toBeUndefined();
  });

  it("includes debt repayment lines in HQ Daily without corrupting sales lines", () => {
    const repayment = {
      id: 1,
      companyId: 1,
      creditId: 50,
      orderId: 102,
      contractorName: "Ah Meng",
      amountCents: 5000,
      method: "Cash" as const,
      ts: new Date("2026-08-10T15:00:00+08:00").getTime(),
      businessDate: "2026-08-10",
      notes: "Cash repayment",
    };
    const workbook = buildDailyWorkbook(orders, [repayment]);
    const list = rowsOf(workbook, "HQ Daily");
    expect(list[3]).toEqual(["Ah Meng", "2026-08-10", "RP-1", "Cash", 50, "", 50, "", "Repayment: Cash repayment"]);
    expect(list[4]?.[0]).toBe("TOTAL");
    expect(workbook.Sheets["HQ Daily"]!["G5"]?.f).toBe("SUM(G2:G4)");
  });

  it("formats QR, Card, and Bank orders and repayments in HQ Daily sheet", () => {
    const qrOrder: Order = {
      id: 300,
      companyId: 1,
      ts: new Date("2026-08-10T16:00:00+08:00").getTime(),
      businessDate: "2026-08-10",
      invNo: "08-1009",
      method: "QR",
      totalCents: 4500,
      voidedAt: null,
      items: [
        line({
          name: "Plywood — 4 x 8 x 9mm",
          unit: "pcs",
          qtyMilli: 1000,
          priceCents: 4500,
          amountCents: 4500,
        }),
      ],
    };
    const cardRepayment = {
      id: 2,
      companyId: 1,
      creditId: 51,
      orderId: 102,
      contractorName: "Pak Abu",
      amountCents: 3000,
      method: "Card" as const,
      ts: new Date("2026-08-10T16:30:00+08:00").getTime(),
      businessDate: "2026-08-10",
      notes: "Card payment",
    };
    const bankRepayment = {
      id: 3,
      companyId: 1,
      creditId: 52,
      orderId: 103,
      contractorName: "Ah Meng",
      amountCents: 5000,
      method: "Bank" as const,
      ts: new Date("2026-08-10T17:00:00+08:00").getTime(),
      businessDate: "2026-08-10",
      notes: "Online transfer",
    };
    const workbook = buildDailyWorkbook([qrOrder], [cardRepayment, bankRepayment]);
    const list = rowsOf(workbook, "HQ Daily");
    expect(list[1]).toEqual(["", "2026-08-10", "08-1009", "QR", 45, "", 45, "", ""]);
    expect(list[2]).toEqual(["Pak Abu", "2026-08-10", "RP-2", "Card", 30, "", 30, "", "Repayment: Card payment"]);
    expect(list[3]).toEqual(["Ah Meng", "2026-08-10", "RP-3", "Bank Transfer", 50, "", 50, "", "Repayment: Online transfer"]);
  });
});

