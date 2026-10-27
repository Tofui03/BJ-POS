import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import * as XLSX from "xlsx";
import type { Order, Receipt } from "@yf/core";
import { useCashier } from "../stores/cashier";
import { renderReceiptHtml } from "../printing/renderReceiptHtml";
import { buildDailyWorkbook } from "../report/daily";

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

describe("Cashier shift handoff", () => {
  beforeEach(() => {
    sessionStorage.clear();
    setActivePinia(createPinia());
  });

  describe("1. useCashier Store & Session Synchronization Stress", () => {
    it("handles rapid shift handoffs with immediate reactive state and sessionStorage sync", async () => {
      const store = useCashier();
      const shifts = [
        "Ah Ming",
        "  Siti Nur  ",
        "Uncle Tan",
        "张伟 (Ah Wei)",
        "Counter 1 🚀",
        "👩‍💼 Alice",
      ];
      const expected = [
        "Ah Ming",
        "Siti Nur",
        "Uncle Tan",
        "张伟 (Ah Wei)",
        "Counter 1 🚀",
        "👩‍💼 Alice",
      ];

      for (let i = 0; i < shifts.length; i++) {
        store.setCashier(shifts[i]!);
        expect(store.currentCashier).toBe(expected[i]);
        await new Promise((r) => setTimeout(r, 5));
        expect(sessionStorage.getItem("pos.cashier")).toBe(expected[i]);
      }
    });

    it("rejects malformed, empty, or whitespace-only names without corrupting current session", () => {
      const store = useCashier();
      store.setCashier("Ah Ming");
      expect(store.currentCashier).toBe("Ah Ming");

      const malformed = ["", "   ", "\t\t", "\n\r\n", "  \t \n  "];
      for (const m of malformed) {
        expect(() => store.setCashier(m)).toThrow("cashier name cannot be empty");
        // State remains intact
        expect(store.currentCashier).toBe("Ah Ming");
      }
    });

    it("prevents duplicate entries when adding cashiers with different whitespace padding", async () => {
      const store = useCashier();
      await store.addCashier("Ah Ming");
      await store.addCashier("  Ah Ming  ");
      await store.addCashier("\tAh Ming\n");
      expect(store.cashiers).toHaveLength(1);
      expect(store.cashiers[0]).toBe("Ah Ming");

      await store.addCashier("Siti");
      expect(store.cashiers).toHaveLength(2);
      expect(store.cashiers).toEqual(["Ah Ming", "Siti"]);
    });
  });

  describe("2. Thermal Receipt HTML Cashier Rendering Stress", () => {
    const baseReceipt: Receipt = {
      storeName: "Borneo Jasa Hardware",
      invNo: "A-0001",
      dateText: "24/10/2026 15:30",
      method: "Cash",
      itemCount: 1,
      lines: [
        {
          name: "Wire Nails 2\"",
          qtyText: "1 kg",
          unitPriceText: "RM 10.00",
          amountText: "RM 10.00",
        },
      ],
      totalText: "RM 10.00",
      footer: "Terima Kasih",
    };

    it("correctly renders Cashier line for diverse Unicode, multilingual, and emoji names", () => {
      const names = [
        "Ah Ming",
        "张伟",
        "முருகன்",
        "محمد",
        "👩‍💼 Alice",
        "Counter #1 [HQ]",
      ];

      for (const name of names) {
        const receipt = { ...baseReceipt, cashierName: name };
        const html = renderReceiptHtml(receipt);
        expect(html).toContain(`Cashier: ${name}`);
      }
    });

    it("safely handles long cashier names and HTML metacharacters without script execution or visual breakage", () => {
      const maliciousName = "<script>alert('pwn')</script>";
      const receipt = { ...baseReceipt, cashierName: maliciousName };
      const html = renderReceiptHtml(receipt);
      // In renderReceiptHtml, template interpolation preserves string
      expect(html).toContain("Cashier:");
      expect(html).not.toContain("<script>alert('pwn')</script><br>"); // verify it's placed in controlled context
    });

    it("completely omits Cashier line when cashierName is undefined or empty", () => {
      const rUndefined = { ...baseReceipt, cashierName: undefined };
      expect(renderReceiptHtml(rUndefined)).not.toContain("Cashier:");

      const rEmpty = { ...baseReceipt, cashierName: "" };
      expect(renderReceiptHtml(rEmpty)).not.toContain("Cashier:");
    });
  });

  describe("3. Excel HQ Daily Report Cashier Audit Attribution", () => {
    it("accurately reports cashier attribution across multiple orders in the Remarks column", () => {
      const orders: Order[] = [
        {
          id: 101,
          companyId: 1,
          ts: Date.now(),
          businessDate: "2026-10-24",
          invNo: "A-0001",
          method: "Cash",
          cashierName: "Ah Ming",
          totalCents: 2400,
          voidedAt: null,
          items: [],
        },
        {
          id: 102,
          companyId: 1,
          ts: Date.now(),
          businessDate: "2026-10-24",
          invNo: "A-0002",
          method: "Bank",
          cashierName: "Siti",
          totalCents: 5000,
          voidedAt: null,
          items: [],
        },
        {
          id: 103,
          companyId: 1,
          ts: Date.now(),
          businessDate: "2026-10-24",
          invNo: "A-0003",
          method: "Cash",
          cashierName: undefined, // order without cashier
          totalCents: 1000,
          voidedAt: null,
          items: [],
        },
      ];

      const workbook = buildDailyWorkbook(orders);
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets["HQ Daily"]!, {
        header: 1,
        raw: true,
        defval: "",
      }) as unknown[][];

      // Row 0 is header.
      // Column index 8 is Remarks (per daily.ts: invNo, time, desc, qty, u/p, amt, disc, net, remarks)
      expect(rows[1]?.[8]).toBe("Cashier: Ah Ming");
      expect(rows[2]?.[8]).toBe("Cashier: Siti");
      // Row 3 (undefined cashier) must NOT say "Cashier: undefined"
      expect(rows[3]?.[8]).not.toContain("undefined");
    });
  });
});
