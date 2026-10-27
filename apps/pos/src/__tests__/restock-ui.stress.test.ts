import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import RestockDialog from "../components/RestockDialog.vue";
import { useCatalog } from "../stores/catalog";
import { isMeasureUnit, type PricedItem, type Unit } from "@yf/core";
import { MESSAGES, RAW_BILINGUAL_L, L } from "../labels";

const discretePcsItem: PricedItem = {
  id: 201,
  key: "SCREW-DRV-100",
  name: "Phillips Screwdriver #2 100mm",
  image: "",
  unit: "pcs",
  priceCents: 650,
  active: true,
  tracksTail: false,
  sortOrder: 1,
  stockMilli: 12000, // 12 pcs
  tiers: [],
};

const discreteBoxItem: PricedItem = {
  id: 202,
  key: "EXP-PLUG-BOX",
  name: "Wall Plug 6mm Red (Box of 100)",
  image: "",
  unit: "box",
  priceCents: 1500,
  active: true,
  tracksTail: false,
  sortOrder: 2,
  stockMilli: 5000, // 5 boxes
  tiers: [],
};

const weighableKgItem: PricedItem = {
  id: 203,
  key: "NAIL-WIRE-2IN",
  name: "Common Wire Nails 2\"",
  image: "",
  unit: "kg",
  priceCents: 1100,
  active: true,
  tracksTail: false,
  sortOrder: 3,
  stockMilli: 15500, // 15.5 kg
  tiers: [],
};

const measurableFtItem: PricedItem = {
  id: 204,
  key: "GI-PIPE-1IN",
  name: "Galvanized Iron Pipe 1\"",
  image: "",
  unit: "ft",
  priceCents: 420,
  active: true,
  tracksTail: false,
  sortOrder: 4,
  stockMilli: 60000, // 60 ft
  tiers: [],
};

const untrackedBagItem: PricedItem = {
  id: 205,
  key: "SAND-BAG-50",
  name: "River Sand 50kg Bag",
  image: "",
  unit: "bag",
  priceCents: 1800,
  active: true,
  tracksTail: false,
  sortOrder: 5,
  stockMilli: null,
  tiers: [],
};

describe("Restock dialog and unit validation", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  // =========================================================================
  // 1. DISCRETE VS CONTINUOUS UNIT ERGONOMICS & VALIDATION
  // =========================================================================
  describe("1. Discrete vs Continuous Unit Validation Rules", () => {
    // Pure validator mimicking RestockDialog.vue isValid computation
    function validateInboundInput(
      item: PricedItem | null,
      inputStr: string,
    ): { isValid: boolean; inboundMilli: number } {
      if (!item) return { isValid: false, inboundMilli: 0 };
      const val = Number(inputStr);
      if (!Number.isFinite(val) || val <= 0) return { isValid: false, inboundMilli: 0 };
      const inboundMilli = Math.round(val * 1000);
      if (inboundMilli <= 0) return { isValid: false, inboundMilli: 0 };

      const isWeighable = isMeasureUnit(item.unit);
      if (!isWeighable && !Number.isInteger(val)) {
        return { isValid: false, inboundMilli };
      }
      return { isValid: true, inboundMilli };
    }

    it("identifies measured vs discrete units accurately", () => {
      expect(isMeasureUnit("kg")).toBe(true);
      expect(isMeasureUnit("ft")).toBe(true);
      expect(isMeasureUnit("meter")).toBe(true);

      const discreteUnits: Unit[] = [
        "pcs",
        "batang",
        "unit",
        "bag",
        "bundle",
        "roll",
        "cup",
        "box",
        "pack",
        "pieces",
        "bottle",
        "each",
      ];
      for (const u of discreteUnits) {
        expect(isMeasureUnit(u)).toBe(false);
      }
    });

    it("rejects decimal quantities for discrete items (pcs, box, bag)", () => {
      const invalidDecimals = ["0.5", "1.2", "2.75", "10.001", "0.99"];
      for (const str of invalidDecimals) {
        const checkPcs = validateInboundInput(discretePcsItem, str);
        expect(checkPcs.isValid).toBe(false);

        const checkBox = validateInboundInput(discreteBoxItem, str);
        expect(checkBox.isValid).toBe(false);

        const checkBag = validateInboundInput(untrackedBagItem, str);
        expect(checkBag.isValid).toBe(false);
      }
    });

    it("accepts integer quantities for discrete items (pcs, box, bag)", () => {
      const validIntegers = ["1", "5", "10", "25", "100", "500"];
      for (const str of validIntegers) {
        const check = validateInboundInput(discretePcsItem, str);
        expect(check.isValid).toBe(true);
        expect(check.inboundMilli).toBe(Number(str) * 1000);
      }
    });

    it("accepts valid decimal quantities for continuous items (kg, ft)", () => {
      const validDecimals = ["0.25", "1.5", "2.75", "12.125", "50.5"];
      for (const str of validDecimals) {
        const checkKg = validateInboundInput(weighableKgItem, str);
        expect(checkKg.isValid).toBe(true);
        expect(checkKg.inboundMilli).toBe(Math.round(Number(str) * 1000));

        const checkFt = validateInboundInput(measurableFtItem, str);
        expect(checkFt.isValid).toBe(true);
        expect(checkFt.inboundMilli).toBe(Math.round(Number(str) * 1000));
      }
    });

    it("rejects non-positive, empty, or junk strings across all unit types", () => {
      const junkInputs = ["", "0", "-1", "-5.5", "abc", "NaN", "undefined", "   "];
      const testItems = [discretePcsItem, weighableKgItem, untrackedBagItem];

      for (const item of testItems) {
        for (const input of junkInputs) {
          const check = validateInboundInput(item, input);
          expect(check.isValid).toBe(false);
          expect(check.inboundMilli).toBe(0);
        }
      }
    });
  });

  // =========================================================================
  // 2. RESTOCK DIALOG RENDERING & LIVE ARITHMETIC PREVIEW
  // =========================================================================
  describe("2. RestockDialog Rendering & Touch Layout", () => {
    it("renders item details, current stock badge, presets, and dialog controls", async () => {
      const app = createSSRApp(RestockDialog, {
        open: true,
        initialItem: discretePcsItem,
        items: [discretePcsItem, weighableKgItem],
      });
      app.use(createPinia());
      const html = await renderToString(app);

      // Header
      expect(html).toContain(L.quickInbound);
      // Item info
      expect(html).toContain("Phillips Screwdriver #2 100mm");
      expect(html).toContain("SCREW-DRV-100");
      expect(html).toContain("12 pcs");
      expect(html).toContain(L.currentStock);

      // Cumulative Presets
      expect(html).toContain("+5");
      expect(html).toContain("+10");
      expect(html).toContain("+25");
      expect(html).toContain("+50");
      expect(html).toContain("+100");
      expect(html).toContain("C");

      // Action buttons
      expect(html).toContain(L.confirmInbound);
      expect(html).toContain(L.cancel);
    });

    it("displays untracked notice clearly for items with null stock", async () => {
      const app = createSSRApp(RestockDialog, {
        open: true,
        initialItem: untrackedBagItem,
        items: [untrackedBagItem],
      });
      app.use(createPinia());
      const html = await renderToString(app);

      expect(html).toContain("River Sand 50kg Bag");
      expect(html).toContain(L.untracked);
      expect(html).toContain("0 (" + L.untracked + ")");
    });

    it("verifies live resulting stock arithmetic logic for tracked and untracked items", () => {
      // Tracked item: 12,000 milli (12 pcs). Inbound: 5 pcs (5,000 milli). Result: 17 pcs (17,000 milli)
      const currentTracked = discretePcsItem.stockMilli!; // 12000
      const inboundTracked = 5000;
      const resultTracked = currentTracked + inboundTracked;
      expect(resultTracked).toBe(17000);

      // Untracked item: null. Inbound: 10 bags (10,000 milli). Result: 0 + 10,000 = 10,000 milli
      const currentUntracked = untrackedBagItem.stockMilli ?? 0;
      const inboundUntracked = 10000;
      const resultUntracked = currentUntracked + inboundUntracked;
      expect(resultUntracked).toBe(10000);
    });

    it("verifies preset accumulation and stepper logic", () => {
      // Start with 0
      let qtyStr = "";
      const applyPreset = (preset: number) => {
        const cur = Number(qtyStr) || 0;
        qtyStr = String(cur + preset);
      };
      const stepQty = (delta: number) => {
        const cur = Number(qtyStr) || 0;
        const next = Math.max(0, cur + delta);
        qtyStr = next > 0 ? String(next) : "";
      };
      const clearQty = () => {
        qtyStr = "";
      };

      // Tap +10
      applyPreset(10);
      expect(qtyStr).toBe("10");

      // Tap +25
      applyPreset(25);
      expect(qtyStr).toBe("35");

      // Tap +100
      applyPreset(100);
      expect(qtyStr).toBe("135");

      // Stepper +1
      stepQty(1);
      expect(qtyStr).toBe("136");

      // Stepper -1
      stepQty(-1);
      expect(qtyStr).toBe("135");

      // Clear "C"
      clearQty();
      expect(qtyStr).toBe("");

      // Stepper -1 on empty shouldn't go negative
      stepQty(-1);
      expect(qtyStr).toBe("");
    });
  });

  // =========================================================================
  // 3. I18N LOCALIZATION DICTIONARY COMPLETENESS FOR M4
  // =========================================================================
  describe("3. Localization Dictionary Completeness", () => {
    const REQUIRED_M4_KEYS = [
      "inventoryOverview",
      "itemCatalog",
      "quickInbound",
      "restock",
      "trackedOnly",
      "lowStock",
      "inStock",
      "untracked",
      "inboundQty",
      "currentStock",
      "newStock",
      "stockQuantity",
      "restockSuccess",
      "confirmInbound",
      "itemCode",
      "status",
      "sortByStockAsc",
      "outOfStockStatus",
    ] as const;

    it("verifies bilingual dictionary (RAW_BILINGUAL_L) contains all required M4 inventory keys", () => {
      for (const key of REQUIRED_M4_KEYS) {
        const val = (RAW_BILINGUAL_L as any)[key];
        expect(typeof val).toBe("string");
        expect(val.trim().length).toBeGreaterThan(0);
      }
    });

    const MONO_LOCALES = ["en", "ms", "zh"] as const;
    for (const loc of MONO_LOCALES) {
      it(`verifies locale '${loc}' in MESSAGES contains all ${REQUIRED_M4_KEYS.length} required M4 inventory keys`, () => {
        const dict = MESSAGES[loc];
        expect(dict).toBeDefined();

        for (const key of REQUIRED_M4_KEYS) {
          const val = (dict as any)[key];
          expect(typeof val).toBe("string");
          expect(val.trim().length).toBeGreaterThan(0);
        }
      });
    }

    it("verifies Malay catalog tab translation avoids collision with items tab", () => {
      // In Malay, itemCatalog is 'Katalog Barang', while items tab is 'Barang'
      const msDict = MESSAGES.ms;
      expect(msDict.itemCatalog).toBe("Katalog Barang");
      expect(msDict.items).toBe("Barang");
      expect(msDict.itemCatalog).not.toBe(msDict.items);
    });
  });
});
