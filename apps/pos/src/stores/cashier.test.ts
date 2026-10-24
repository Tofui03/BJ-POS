import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { Order, Receipt } from "@yf/core";
import { useCashier } from "./cashier";
import { renderReceiptHtml } from "../printing/renderReceiptHtml";
import { buildDailyWorkbook } from "../report/daily";
import * as XLSX from "xlsx";

class MockStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

const mockSessionStorage = new MockStorage();
Object.defineProperty(globalThis, "sessionStorage", {
  value: mockSessionStorage,
  writable: true,
});

describe("useCashier Store", () => {
  beforeEach(() => {
    sessionStorage.clear();
    setActivePinia(createPinia());
  });

  it("initializes with empty currentCashier when sessionStorage is empty", () => {
    const store = useCashier();
    expect(store.currentCashier).toBe("");
  });

  it("initializes currentCashier from sessionStorage if present", () => {
    sessionStorage.setItem("pos.cashier", "Ah Ming");
    const store = useCashier();
    expect(store.currentCashier).toBe("Ah Ming");
  });

  it("sets and sanitizes currentCashier and synchronizes with sessionStorage", async () => {
    const store = useCashier();
    store.setCashier("  Siti Nur  ");
    expect(store.currentCashier).toBe("Siti Nur");
    // Watcher is asynchronous in Vue
    await new Promise((r) => setTimeout(r, 10));
    expect(sessionStorage.getItem("pos.cashier")).toBe("Siti Nur");
  });

  it("throws PosError when attempting to set an empty cashier name", () => {
    const store = useCashier();
    expect(() => store.setCashier("   ")).toThrow("cashier name cannot be empty");
  });

  it("adds a new cashier, adds to list, and sets as active", async () => {
    const store = useCashier();
    const result = await store.addCashier("  Uncle Tan  ");
    expect(result).toBe("Uncle Tan");
    expect(store.currentCashier).toBe("Uncle Tan");
    expect(store.cashiers).toContain("Uncle Tan");
  });

  it("does not duplicate cashier names in list", async () => {
    const store = useCashier();
    await store.addCashier("Ah Ming");
    await store.addCashier(" Ah Ming ");
    expect(store.cashiers.filter((c) => c === "Ah Ming")).toHaveLength(1);
  });

  it("toggles dialog open and close states", () => {
    const store = useCashier();
    expect(store.showDialog).toBe(false);
    store.openDialog();
    expect(store.showDialog).toBe(true);
    store.closeDialog();
    expect(store.showDialog).toBe(false);
  });
});

describe("Cashier Shift Handoff & Flow", () => {
  beforeEach(() => {
    sessionStorage.clear();
    setActivePinia(createPinia());
  });

  it("handles shift handover between cashiers", () => {
    const cashierStore = useCashier();
    cashierStore.setCashier("Ah Ming");
    expect(cashierStore.currentCashier).toBe("Ah Ming");

    // Cashier shifts to Siti
    cashierStore.setCashier("Siti");
    expect(cashierStore.currentCashier).toBe("Siti");
  });
});

describe("Cashier Audit Print & Report Display", () => {
  it("renders Cashier on thermal receipt when present", () => {
    const receipt: Receipt = {
      storeName: "Borneo Jasa Sdn. Bhd.",
      invNo: "A-0001",
      dateText: "24/10/2026 14:00",
      method: "Cash",
      itemCount: 1,
      lines: [
        {
          name: "Cement",
          qtyText: "1 bag",
          unitPriceText: "RM 24.00",
          amountText: "RM 24.00",
        },
      ],
      totalText: "RM 24.00",
      cashierName: "Ah Ming",
      footer: "Thank you!",
    };

    const html = renderReceiptHtml(receipt);
    expect(html).toContain("Cashier: Ah Ming");
    expect(html).toContain("Receipt #A-0001");
  });

  it("omits Cashier line on thermal receipt when cashierName is absent", () => {
    const receipt: Receipt = {
      storeName: "Borneo Jasa Sdn. Bhd.",
      invNo: "A-0002",
      dateText: "24/10/2026 14:00",
      method: "Cash",
      itemCount: 1,
      lines: [],
      totalText: "RM 0.00",
      footer: "Thank you!",
    };

    const html = renderReceiptHtml(receipt);
    expect(html).not.toContain("Cashier:");
  });

  it("includes cashier name in daily Excel report remarks", () => {
    const orderWithCashier: Order = {
      id: 201,
      companyId: 1,
      ts: Date.now(),
      businessDate: "2026-10-24",
      invNo: "A-0001",
      method: "Cash",
      cashierName: "Siti",
      totalCents: 5000,
      voidedAt: null,
      items: [
        {
          id: 1,
          itemId: 1,
          name: "Plywood",
          image: "",
          unit: "pcs",
          priceCents: 5000,
          qtyMilli: 1000,
          amountCents: 5000,
          tailCount: 0,
          bulkPrice: false,
        },
      ],
    };

    const workbook = buildDailyWorkbook([orderWithCashier]);
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets["HQ Daily"]!, {
      header: 1,
      raw: true,
      defval: "",
    }) as unknown[][];

    // Header is row 0, data is row 1. Column index 8 is Remarks.
    expect(rows[1]?.[8]).toBe("Cashier: Siti");
  });
});
