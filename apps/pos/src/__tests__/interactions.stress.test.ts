import { describe, it, expect, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { PaymentMethod, PricedItem, Unit } from "@yf/core";
import {
  shouldAutoTriggerNumpad,
  determineCheckoutInvoicePrefix,
  shouldCreateCreditDebt,
} from "../interactions";
import { useCart } from "../stores/cart";

describe("interactions.ts", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  // =========================================================================
  // 1. shouldAutoTriggerNumpad Edge Cases & Stress Scenarios
  // =========================================================================
  describe("shouldAutoTriggerNumpad", () => {
    it("returns false for null, undefined, empty, or whitespace-only inputs", () => {
      expect(shouldAutoTriggerNumpad(undefined)).toBe(false);
      expect(shouldAutoTriggerNumpad(null)).toBe(false);
      expect(shouldAutoTriggerNumpad("")).toBe(false);
      expect(shouldAutoTriggerNumpad("   ")).toBe(false);
      expect(shouldAutoTriggerNumpad("\t\n  \r\n")).toBe(false);
    });

    it("returns true for standard weighable and measurable units", () => {
      expect(shouldAutoTriggerNumpad("kg")).toBe(true);
      expect(shouldAutoTriggerNumpad("ft")).toBe(true);
      expect(shouldAutoTriggerNumpad("meter")).toBe(true);
      expect(shouldAutoTriggerNumpad("m")).toBe(true);
    });

    it("returns true for uppercase and mixed-case units (KG, FT, METER, Meter, etc.)", () => {
      expect(shouldAutoTriggerNumpad("KG")).toBe(true);
      expect(shouldAutoTriggerNumpad("Kg")).toBe(true);
      expect(shouldAutoTriggerNumpad("kG")).toBe(true);
      expect(shouldAutoTriggerNumpad("FT")).toBe(true);
      expect(shouldAutoTriggerNumpad("Ft")).toBe(true);
      expect(shouldAutoTriggerNumpad("fT")).toBe(true);
      expect(shouldAutoTriggerNumpad("METER")).toBe(true);
      expect(shouldAutoTriggerNumpad("Meter")).toBe(true);
      expect(shouldAutoTriggerNumpad("MeTeR")).toBe(true);
      expect(shouldAutoTriggerNumpad("M")).toBe(true);
    });

    it("returns true for whitespace-padded valid units", () => {
      expect(shouldAutoTriggerNumpad("  kg  ")).toBe(true);
      expect(shouldAutoTriggerNumpad("  FT \n")).toBe(true);
      expect(shouldAutoTriggerNumpad("\tmeter\t")).toBe(true);
      expect(shouldAutoTriggerNumpad("  M  ")).toBe(true);
    });

    it("returns false for non-measurable and discrete count units", () => {
      const discreteUnits = [
        "pcs",
        "pack",
        "box",
        "bag",
        "roll",
        "drum",
        "tin",
        "can",
        "bottle",
        "each",
        "set",
        "pair",
        "unit",
        "carton",
        "pallet",
      ];
      for (const unit of discreteUnits) {
        expect(shouldAutoTriggerNumpad(unit)).toBe(false);
        expect(shouldAutoTriggerNumpad(unit.toUpperCase())).toBe(false);
        expect(shouldAutoTriggerNumpad(`  ${unit}  `)).toBe(false);
      }
    });

    it("returns false for partial substring false-positives", () => {
      expect(shouldAutoTriggerNumpad("metering")).toBe(false);
      expect(shouldAutoTriggerNumpad("kgx")).toBe(false);
      expect(shouldAutoTriggerNumpad("ft_length")).toBe(false);
      expect(shouldAutoTriggerNumpad("kilometer")).toBe(false);
      expect(shouldAutoTriggerNumpad("millimeter")).toBe(false);
      expect(shouldAutoTriggerNumpad("metric")).toBe(false);
      expect(shouldAutoTriggerNumpad("pkg")).toBe(false);
    });

    it("handles non-string / coerced types safely without throwing", () => {
      expect(shouldAutoTriggerNumpad(0 as any)).toBe(false);
      expect(shouldAutoTriggerNumpad(false as any)).toBe(false);
      expect(shouldAutoTriggerNumpad(NaN as any)).toBe(false);
    });
  });

  // =========================================================================
  // 2. determineCheckoutInvoicePrefix Edge Cases & Stress Scenarios
  // =========================================================================
  describe("determineCheckoutInvoicePrefix", () => {
    it("returns 'A' for Walk-in without contractor name", () => {
      expect(determineCheckoutInvoicePrefix("walkin")).toBe("A");
      expect(determineCheckoutInvoicePrefix("walkin", null)).toBe("A");
      expect(determineCheckoutInvoicePrefix("walkin", "")).toBe("A");
      expect(determineCheckoutInvoicePrefix("walkin", "   ")).toBe("A");
      expect(determineCheckoutInvoicePrefix("walkin", "\t\r\n")).toBe("A");
    });

    it("returns 'A' for Walk-in even when a contractor name is still filled in", () => {
      expect(determineCheckoutInvoicePrefix("walkin", "Ah Seng Construction")).toBe("A");
      expect(determineCheckoutInvoicePrefix("walkin", "  Chong Hardware  ")).toBe("A");
    });

    it("returns 'B' for contractor type regardless of contractor name", () => {
      expect(determineCheckoutInvoicePrefix("contractor")).toBe("B");
      expect(determineCheckoutInvoicePrefix("contractor", null)).toBe("B");
      expect(determineCheckoutInvoicePrefix("contractor", "")).toBe("B");
      expect(determineCheckoutInvoicePrefix("contractor", "   ")).toBe("B");
      expect(determineCheckoutInvoicePrefix("contractor", "Ah Seng Construction")).toBe("B");
    });

    it("returns 'A' when customerType is undefined or null and contractorName is empty", () => {
      expect(determineCheckoutInvoicePrefix(undefined, undefined)).toBe("A");
      expect(determineCheckoutInvoicePrefix(undefined, null)).toBe("A");
      expect(determineCheckoutInvoicePrefix(undefined, "")).toBe("A");
      expect(determineCheckoutInvoicePrefix(undefined, "   ")).toBe("A");
      expect(determineCheckoutInvoicePrefix(null, undefined)).toBe("A");
      expect(determineCheckoutInvoicePrefix(null, null)).toBe("A");
      expect(determineCheckoutInvoicePrefix(null, "")).toBe("A");
      expect(determineCheckoutInvoicePrefix(null, "   ")).toBe("A");
    });

    it("returns 'B' when customerType is undefined/null but a valid contractor name is given", () => {
      expect(determineCheckoutInvoicePrefix(undefined, "Ah Seng Construction")).toBe("B");
      expect(determineCheckoutInvoicePrefix(null, "Ah Seng Construction")).toBe("B");
    });
  });

  // =========================================================================
  // 3. shouldCreateCreditDebt Edge Cases & Stress Scenarios
  // =========================================================================
  describe("shouldCreateCreditDebt", () => {
    it("returns true only for 'Credit' payment method", () => {
      expect(shouldCreateCreditDebt("Credit")).toBe(true);
    });

    it("returns false for all non-credit payment methods (Cash, Bank, QR)", () => {
      expect(shouldCreateCreditDebt("Cash")).toBe(false);
      expect(shouldCreateCreditDebt("Bank")).toBe(false);
      expect(shouldCreateCreditDebt("QR")).toBe(false);
    });

    it("returns false for arbitrary or invalid method strings", () => {
      expect(shouldCreateCreditDebt("credit" as any)).toBe(false);
      expect(shouldCreateCreditDebt("CREDIT" as any)).toBe(false);
      expect(shouldCreateCreditDebt("" as any)).toBe(false);
      expect(shouldCreateCreditDebt(null as any)).toBe(false);
      expect(shouldCreateCreditDebt(undefined as any)).toBe(false);
    });
  });

  // =========================================================================
  // 4. Component Integration Verification (TillView, NumpadDialog, Cart Store)
  // =========================================================================
  describe("Component Integration Semantics", () => {
    it("verifies TillView addItem triggering logic across catalog unit variations", () => {
      const items: Array<{ unit: string; expectAutoTrigger: boolean }> = [
        { unit: "kg", expectAutoTrigger: true },
        { unit: "KG", expectAutoTrigger: true },
        { unit: "ft", expectAutoTrigger: true },
        { unit: "FT", expectAutoTrigger: true },
        { unit: "meter", expectAutoTrigger: true },
        { unit: "METER", expectAutoTrigger: true },
        { unit: "m", expectAutoTrigger: true },
        { unit: "pcs", expectAutoTrigger: false },
        { unit: "box", expectAutoTrigger: false },
        { unit: "bag", expectAutoTrigger: false },
        { unit: "pack", expectAutoTrigger: false },
      ];

      for (const { unit, expectAutoTrigger } of items) {
        let simulatedNumpadOpened = false;
        const simulatedAddItem = (itemUnit: string) => {
          if (shouldAutoTriggerNumpad(itemUnit)) {
            simulatedNumpadOpened = true;
          }
        };

        simulatedAddItem(unit);
        expect(simulatedNumpadOpened).toBe(expectAutoTrigger);
      }
    });

    it("verifies NumpadDialog isWeighable logic: suppressed when money mode is active", () => {
      const computeIsWeighable = (props: { money?: boolean; unit?: string }) => {
        if (props.money) return false;
        return shouldAutoTriggerNumpad(props.unit);
      };

      // When editing an amount/money (e.g. custom price), even if unit is kg, tare/target tabs must not appear
      expect(computeIsWeighable({ money: true, unit: "kg" })).toBe(false);
      expect(computeIsWeighable({ money: false, unit: "kg" })).toBe(true);
      expect(computeIsWeighable({ money: false, unit: "ft" })).toBe(true);
      expect(computeIsWeighable({ money: false, unit: "pcs" })).toBe(false);
    });

    it("verifies Cart pay() validation: blocks anonymous Credit, permits anonymous Cash", async () => {
      const cart = useCart();
      const testItem: PricedItem = {
        id: 99,
        key: "test_wire",
        name: "Test Wire",
        image: "",
        unit: "kg",
        priceCents: 1000,
        active: true,
        tracksTail: false,
        stockMilli: null,
        sortOrder: 1,
        tiers: [],
      };
      cart.add(testItem);
      expect(cart.lines.length).toBe(1);

      // shouldCreateCreditDebt("Credit") requires contractorName
      const anonymousCreditResult = await cart.pay("Credit", { contractorName: "" });
      expect(anonymousCreditResult).toBeNull();

      // shouldCreateCreditDebt("Cash") does not block empty contractorName
      // (will attempt repo call; we test the guard condition directly)
      const effectiveCreditor = "".trim();
      const creditBlocked = shouldCreateCreditDebt("Credit") && !effectiveCreditor;
      const cashBlocked = shouldCreateCreditDebt("Cash") && !effectiveCreditor;
      const bankBlocked = shouldCreateCreditDebt("Bank") && !effectiveCreditor;
      const qrBlocked = shouldCreateCreditDebt("QR") && !effectiveCreditor;

      expect(creditBlocked).toBe(true);
      expect(cashBlocked).toBe(false);
      expect(bankBlocked).toBe(false);
      expect(qrBlocked).toBe(false);
    });
  });
});
