import { beforeEach, describe, expect, it } from "vitest";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { createPinia, setActivePinia } from "pinia";
import initSqlJs from "sql.js";
import {
  calcReverseQuantity,
  deductTare,
  reversePriceLine,
  lineAmount,
  toCents,
  toMilli,
  buildReceipt,
  buildDeliveryOrder,
  createOrder,
  type PricedItem,
  type Order,
  type Unit,
  PosError,
} from "@yf/core";
import { createSqlJsDriver, initRepo, SqlPosRepo } from "@yf/data";
import NumpadDialog from "../components/NumpadDialog.vue";
import LainLainDialog from "../components/LainLainDialog.vue";
import { useCart } from "../stores/cart";
import { renderReceiptHtml } from "../printing/renderReceiptHtml";
import { renderDeliveryOrderHtml } from "../printing/renderDeliveryOrderHtml";

async function freshRepo(): Promise<SqlPosRepo> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  const driver = createSqlJsDriver(db as never);
  return initRepo(driver, {
    seedDemoOrders: false,
    now: new Date("2026-10-24T12:00:00+08:00"),
    rng: () => 0.5,
  });
}

describe("Empirical Weighing Presets, Reverse Calculations & Multi-Unit Cart Stress", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe("Section 1: Quick Preset Values and Arithmetic Precision Under Extreme Tare/Gross Values", () => {
    it("empirically verifies all 5 kg quick presets under varied container tare weights", () => {
      const kgPresets = [
        { label: "100g", valKg: 0.1, milli: 100 },
        { label: "250g", valKg: 0.25, milli: 250 },
        { label: "500g", valKg: 0.5, milli: 500 },
        { label: "1 kg", valKg: 1.0, milli: 1000 },
        { label: "5 kg", valKg: 5.0, milli: 5000 },
      ];

      for (const preset of kgPresets) {
        expect(toMilli(preset.valKg)).toBe(preset.milli);

        // 1. Tare = 0
        expect(deductTare(preset.milli, 0)).toBe(preset.milli);

        // 2. Tare = 50g (0.050 kg)
        const tare50 = 50;
        const expectedNet50 = Math.max(0, preset.milli - tare50);
        expect(deductTare(preset.milli, tare50)).toBe(expectedNet50);

        // 3. Tare = gross (identical weight) -> net must be exactly 0
        expect(deductTare(preset.milli, preset.milli)).toBe(0);

        // 4. Extreme Tare > Gross -> must clamp cleanly to 0 without underflow/negative
        expect(deductTare(preset.milli, preset.milli + 500)).toBe(0);
        expect(deductTare(preset.milli, 999999)).toBe(0);
      }
    });

    it("verifies length presets (1, 3, 5, 10, 20) for ft and meter units", () => {
      const lengthPresets = [1, 3, 5, 10, 20];
      for (const len of lengthPresets) {
        const milli = toMilli(len);
        expect(milli).toBe(len * 1000);
        // Length does not have tare deduction in practice, tare is 0
        expect(deductTare(milli, 0)).toBe(milli);
      }
    });

    it("stress-tests extreme boundary weights (1 gram to 50 tonnes)", () => {
      // 1 gram (1 milli)
      expect(deductTare(1, 0)).toBe(1);
      expect(deductTare(1, 1)).toBe(0);
      expect(deductTare(1, 2)).toBe(0);

      // Sub-milligram rounding behavior in toMilli
      expect(toMilli(0.0004)).toBe(0);
      expect(toMilli(0.0005)).toBe(1);
      expect(toMilli(0.0006)).toBe(1);
      expect(toMilli(0.001)).toBe(1);

      // Extreme high gross: 50,000 kg (50 tonnes = 50,000,000 milli)
      const bigGrossMilli = 50_000_000;
      const bigTareMilli = 35_400; // 35.4 kg tare
      expect(deductTare(bigGrossMilli, bigTareMilli)).toBe(49_964_600);

      // 99,999.999 kg gross
      const maxGrossMilli = 99_999_999;
      expect(deductTare(maxGrossMilli, 1)).toBe(99_999_998);
    });

    it("runs an oracle generator sweep across 1,000 fractional gross/tare combinations to verify ZERO floating point drift", () => {
      // Floating point in JS: 0.1 + 0.2 !== 0.3.
      // We verify that toMilli + deductTare round-trips with absolute integer precision.
      const step = 0.017; // irregular step to trigger binary float representation anomalies
      for (let g = 0.05; g <= 5.0; g += step) {
        for (let t = 0; t <= 1.5; t += 0.25) {
          const grossKg = Number(g.toFixed(3));
          const tareKg = Number(t.toFixed(3));

          const grossMilli = toMilli(grossKg);
          const tareMilli = toMilli(tareKg);

          const netMilli = deductTare(grossMilli, tareMilli);

          // Oracle comparison using exact integer math
          const oracleExpected = Math.max(0, grossMilli - tareMilli);
          expect(netMilli).toBe(oracleExpected);

          // Rounding back to kg
          const netKg = netMilli / 1000;
          expect(netKg).toBeGreaterThanOrEqual(0);
          expect(toMilli(netKg)).toBe(netMilli);
        }
      }
    });

    it("verifies NumpadDialog UI rendering with presets and senior ergonomics", async () => {
      const app = createSSRApp(NumpadDialog, {
        open: true,
        title: "Paku Simen (Cement Nails)",
        unit: "kg",
        initial: 1.0,
      });
      const html = await renderToString(app);

      // Presets container and buttons
      expect(html).toContain("Quick Weight:");
      expect(html).toContain("100g");
      expect(html).toContain("250g");
      expect(html).toContain("500g");
      expect(html).toContain("1 kg");
      expect(html).toContain("5 kg");

      // Senior ergonomics: minimum 48px height for touch accuracy
      expect(html).toContain("h-48px");
      expect(html).toContain("min-h-48px");
    });
  });

  describe("Section 2: Reverse Budget Calculations with Fractional Amounts, Irregular Unit Prices & Edge Budgets", () => {
    it("handles irregular unit prices RM 3.33/kg and RM 17.89/kg accurately", () => {
      const price333 = toCents(3.33); // 333 cents/kg
      const price1789 = toCents(17.89); // 1789 cents/kg

      expect(price333).toBe(333);
      expect(price1789).toBe(1789);

      // Target RM 10.00 with RM 3.33/kg
      // 1000 cents * 1000 / 333 cents = 3003.003... -> 3003 milli
      const q1 = calcReverseQuantity(toCents(10.0), price333);
      expect(q1).toBe(3003);
      // Forward calculation verifies that 3003 milli @ 333 cents yields 1000 cents (RM 10.00)
      expect(lineAmount(price333, q1)).toBe(1000);

      // Target RM 50.00 with RM 17.89/kg
      // 5000 * 1000 / 1789 = 2794.857... -> 2795 milli
      const q2 = calcReverseQuantity(toCents(50.0), price1789);
      expect(q2).toBe(2795);
      expect(lineAmount(price1789, q2)).toBe(5000);

      // Target RM 2.00 with RM 3.33/kg
      // 200 * 1000 / 333 = 600.600... -> 601 milli
      const q3 = calcReverseQuantity(toCents(2.0), price333);
      expect(q3).toBe(601);
      expect(lineAmount(price333, q3)).toBe(200);

      // Target RM 17.89 with RM 17.89/kg -> exactly 1000 milli (1.000 kg)
      const q4 = calcReverseQuantity(toCents(17.89), price1789);
      expect(q4).toBe(1000);
      expect(lineAmount(price1789, q4)).toBe(1789);
    });

    it("evaluates edge budgets (RM 0.00, RM 0.01, RM 0.05, RM 50,000.00)", () => {
      const unitPrice = 1250; // RM 12.50 / kg

      // Budget 0 -> 0 milli
      expect(calcReverseQuantity(0, unitPrice)).toBe(0);

      // Budget RM 0.01 (1 cent)
      // 1 * 1000 / 1250 = 0.8 -> rounds up to 1 milli
      const q1Cent = calcReverseQuantity(1, unitPrice);
      expect(q1Cent).toBe(1);
      expect(lineAmount(unitPrice, q1Cent)).toBe(1); // 1250 * 1 / 1000 = 1.25 -> 1 cent

      // Budget RM 0.05 (5 cents)
      // 5 * 1000 / 1250 = 4 milli
      const q5Cent = calcReverseQuantity(5, unitPrice);
      expect(q5Cent).toBe(4);
      expect(lineAmount(unitPrice, q5Cent)).toBe(5);

      // High budget: RM 50,000.00 (5,000,000 cents)
      // 5,000,000 * 1000 / 1250 = 4,000,000 milli = 4,000 kg (4 tonnes)
      const qBig = calcReverseQuantity(5_000_000, unitPrice);
      expect(qBig).toBe(4_000_000);
      expect(lineAmount(unitPrice, qBig)).toBe(5_000_000);
    });

    it("enforces mathematical error bounds across a randomized oracle sweep", () => {
      // For any budget B and unit price P, reversing to quantity Q and calculating
      // line total A = lineAmount(P, Q) must differ from B by at most ceil(P / 2000) cents
      // (less than or equal to 0.5 gram monetary worth).
      const testPrices = [33, 100, 333, 750, 1289, 1789, 2500, 4999, 9999];
      const testBudgets = [1, 5, 10, 25, 99, 250, 500, 1234, 3000, 7777, 10000, 50000];

      for (const p of testPrices) {
        for (const b of testBudgets) {
          const q = calcReverseQuantity(b, p);
          const computedTotal = lineAmount(p, q);
          const maxAllowedDiff = Math.max(1, Math.ceil(p / 2000));
          const actualDiff = Math.abs(computedTotal - b);
          expect(actualDiff).toBeLessThanOrEqual(maxAllowedDiff);
        }
      }
    });

    it("verifies reversePriceLine with quantity-break discount tiers", () => {
      const tieredItem: PricedItem = {
        id: 77,
        key: "wire_mesh",
        name: "Wire Mesh",
        image: "",
        unit: "kg",
        priceCents: 2500, // RM 25.00 base
        active: true,
        tracksTail: false,
        stockMilli: null,
        sortOrder: 1,
        tiers: [
          { id: 1, itemId: 77, minQtyMilli: 10000, priceCents: 2000 }, // >= 10 kg -> RM 20.00
          { id: 2, itemId: 77, minQtyMilli: 25000, priceCents: 1800 }, // >= 25 kg -> RM 18.00
        ],
      };

      // 1. Budget RM 199.00 -> does not qualify for Tier 1 (19900/2000 = 9950 < 10000)
      // Falls back to base RM 25.00: 19900 * 1000 / 2500 = 7960 milli
      const res1 = reversePriceLine(tieredItem, 19900);
      expect(res1.qtyMilli).toBe(7960);
      expect(res1.unitPriceCents).toBe(2500);
      expect(res1.tier).toBeNull();
      expect(res1.lineAmountCents).toBe(19900);

      // 2. Budget RM 200.00 -> 20000 * 1000 / 2000 = 10000 milli. Exactly qualifies for Tier 1!
      const res2 = reversePriceLine(tieredItem, 20000);
      expect(res2.qtyMilli).toBe(10000);
      expect(res2.unitPriceCents).toBe(2000);
      expect(res2.tier).not.toBeNull();
      expect(res2.tier?.minQtyMilli).toBe(10000);
      expect(res2.lineAmountCents).toBe(20000);

      // 3. Budget RM 450.00 -> 45000 * 1000 / 1800 = 25000 milli. Exactly qualifies for Tier 2!
      const res3 = reversePriceLine(tieredItem, 45000);
      expect(res3.qtyMilli).toBe(25000);
      expect(res3.unitPriceCents).toBe(1800);
      expect(res3.tier?.minQtyMilli).toBe(25000);
      expect(res3.lineAmountCents).toBe(45000);

      // 4. Budget 0 -> 0 qty
      const res0 = reversePriceLine(tieredItem, 0);
      expect(res0.qtyMilli).toBe(0);
      expect(res0.lineAmountCents).toBe(0);
    });

    it("rejects invalid/negative arguments defensively", () => {
      expect(() => calcReverseQuantity(-10, 1000)).toThrow(PosError);
      expect(() => calcReverseQuantity(1000, 0)).toThrow(PosError);
      expect(() => calcReverseQuantity(1000, -500)).toThrow(PosError);
      expect(() => calcReverseQuantity(1000, NaN)).toThrow(PosError);
      expect(() => reversePriceLine({ id: 1 } as never, -50)).toThrow(PosError);
    });
  });

  describe("Section 3: Lain-Lain Multi-Unit Cart Additions Across pcs, kg, ft, meter & Hold/Recall Cycles", () => {
    it("adds multi-unit Lain-lain items with fractional quantities and verifies cart totals", () => {
      const cart = useCart();
      cart.clear();

      // 1. pcs: 7 pcs @ RM 1.50
      cart.addLainLain("Paku Payung", 150, 7, "pcs");
      // 2. kg: 0.375 kg @ RM 24.80
      cart.addLainLain("Dawai Halus", 2480, 0.375, "kg");
      // 3. ft: 12.5 ft @ RM 0.80
      cart.addLainLain("Paip PVC 1/2\"", 80, 12.5, "ft");
      // 4. meter: 33.333 meter @ RM 4.50
      cart.addLainLain("Hos Getah", 450, 33.333, "meter");

      expect(cart.lines).toHaveLength(4);

      // Check line 1 (pcs)
      const l1 = cart.lines[0]!;
      expect(l1.item.unit).toBe("pcs");
      expect(l1.qtyMilli).toBe(7000);
      expect(l1.customPriceCents).toBe(150);
      expect(cart.amountCentsOf(l1)).toBe(1050); // 7 * 1.50 = 10.50

      // Check line 2 (kg)
      const l2 = cart.lines[1]!;
      expect(l2.item.unit).toBe("kg");
      expect(l2.qtyMilli).toBe(375);
      expect(l2.customPriceCents).toBe(2480);
      // 2480 * 375 / 1000 = 930 cents = RM 9.30
      expect(cart.amountCentsOf(l2)).toBe(930);

      // Check line 3 (ft)
      const l3 = cart.lines[2]!;
      expect(l3.item.unit).toBe("ft");
      expect(l3.qtyMilli).toBe(12500);
      expect(l3.customPriceCents).toBe(80);
      // 80 * 12500 / 1000 = 1000 cents = RM 10.00
      expect(cart.amountCentsOf(l3)).toBe(1000);

      // Check line 4 (meter)
      const l4 = cart.lines[3]!;
      expect(l4.item.unit).toBe("meter");
      expect(l4.qtyMilli).toBe(33333);
      expect(l4.customPriceCents).toBe(450);
      // 450 * 33333 / 1000 = 14999.85 -> 15000 cents = RM 150.00
      expect(cart.amountCentsOf(l4)).toBe(15000);

      // Subtotal: 1050 + 930 + 1000 + 15000 = 17980 cents (RM 179.80)
      expect(cart.linesSubtotalCents).toBe(17980);
      expect(cart.totalCents).toBe(17980);

      // Alias amountCentsOf vs amountOf
      expect(cart.amountCentsOf(l1)).toBe(cart.amountOf(l1));
      expect(cart.amountCentsOf(l2)).toBe(cart.amountOf(l2));
      expect(cart.amountCentsOf(l3)).toBe(cart.amountOf(l3));
      expect(cart.amountCentsOf(l4)).toBe(cart.amountOf(l4));
    });

    it("verifies cart hold and recall cycles preserve decimal quantities and distinct units without data corruption", () => {
      const cart = useCart();
      cart.clear();

      cart.addLainLain("Item A (kg)", 1200, 1.25, "kg");
      cart.addLainLain("Item B (meter)", 850, 4.75, "meter");
      cart.addLainLain("Item C (ft)", 210, 10.0, "ft");
      cart.addLainLain("Item D (pcs)", 50, 20, "pcs");

      const originalTotal = cart.totalCents;
      expect(cart.lines).toHaveLength(4);

      // 1. Hold current cart
      const held = cart.holdCurrent("Site 123 Materials");
      expect(held).not.toBeNull();
      expect(cart.lines).toHaveLength(0); // Cart is cleared
      expect(cart.totalCents).toBe(0);

      // 2. Attempt resume when cart has an active item -> must be blocked
      cart.addLainLain("Interfering Item", 100, 1, "pcs");
      const blockResult = cart.resumeHeld(held!.id);
      expect(blockResult).toEqual({ blocked: true, reason: "cart_not_empty" });
      expect(cart.lines).toHaveLength(1);

      // Clear active cart to unblock resume
      cart.clear();

      // 3. Resume in swap mode
      const swapResult = cart.resumeHeld(held!.id, "swap");
      expect(swapResult).not.toBeNull();
      expect((swapResult as { resumed: unknown }).resumed).toBeDefined();

      // Verify all 4 lines are intact with preserved units and precision
      expect(cart.lines).toHaveLength(4);
      expect(cart.lines[0]!.item.unit).toBe("kg");
      expect(cart.lines[0]!.qtyMilli).toBe(1250);
      expect(cart.lines[0]!.customPriceCents).toBe(1200);

      expect(cart.lines[1]!.item.unit).toBe("meter");
      expect(cart.lines[1]!.qtyMilli).toBe(4750);
      expect(cart.lines[1]!.customPriceCents).toBe(850);

      expect(cart.lines[2]!.item.unit).toBe("ft");
      expect(cart.lines[2]!.qtyMilli).toBe(10000);
      expect(cart.lines[2]!.customPriceCents).toBe(210);

      expect(cart.lines[3]!.item.unit).toBe("pcs");
      expect(cart.lines[3]!.qtyMilli).toBe(20000);
      expect(cart.lines[3]!.customPriceCents).toBe(50);

      expect(cart.totalCents).toBe(originalTotal);

      // 4. Hold again and resume in merge mode to verify Lain-Lain lines do not merge into each other
      const held2 = cart.holdCurrent("Site 123 Re-Hold");
      expect(held2).not.toBeNull();
      expect(cart.lines).toHaveLength(0);

      const mergeResult = cart.resumeHeld(held2!.id, "merge");
      expect(mergeResult).not.toBeNull();
      // Lain-Lain items have customName or customPrice, so they remain discrete and NEVER merge
      expect(cart.lines).toHaveLength(4);
      expect(cart.totalCents).toBe(originalTotal);
    });

    it("empirically verifies SQLite database persistence and hydration of multi-unit lines", async () => {
      const repo = await freshRepo();

      // Create an order containing multi-unit lines directly via domain createOrder
      const orderDraft = {
        method: "Cash" as const,
        companyId: 1,
        businessDate: "2026-10-24",
        customerType: "walkin" as const,
        discountCents: 0,
        lines: [
          {
            itemId: 0,
            key: "hw_lain_lain",
            qtyMilli: 2500, // 2.500 kg
            unit: "kg" as Unit,
            unitPriceCents: 1600, // RM 16.00/kg
            customName: "Loose Gravel",
          },
          {
            itemId: 0,
            key: "hw_lain_lain",
            qtyMilli: 15750, // 15.750 meter
            unit: "meter" as Unit,
            unitPriceCents: 320, // RM 3.20/meter
            customName: "Water Pipe",
          },
          {
            itemId: 0,
            key: "hw_lain_lain",
            qtyMilli: 8250, // 8.250 ft
            unit: "ft" as Unit,
            unitPriceCents: 150, // RM 1.50/ft
            customName: "Steel Rod",
          },
          {
            itemId: 0,
            key: "hw_lain_lain",
            qtyMilli: 10000, // 10 pcs
            unit: "pcs" as Unit,
            unitPriceCents: 80, // RM 0.80/pc
            customName: "Screws Pack",
          },
        ],
      };

      const order = await createOrder(repo, orderDraft);
      expect(order.id).toBeGreaterThan(0);
      expect(order.invNo).toBe("A-0001");

      // Verify lines returned by createOrder
      expect(order.items).toHaveLength(4);
      expect(order.items[0]!.unit).toBe("kg");
      expect(order.items[1]!.unit).toBe("meter");
      expect(order.items[2]!.unit).toBe("ft");
      expect(order.items[3]!.unit).toBe("pcs");

      // Now query fresh from SQLite repo to verify hydration from disk/SQL
      const fetchedOrder = await repo.getOrder(order.id);
      expect(fetchedOrder).not.toBeNull();
      expect(fetchedOrder!.items).toHaveLength(4);

      const [f1, f2, f3, f4] = fetchedOrder!.items;
      expect(f1!.name).toBe("Loose Gravel");
      expect(f1!.unit).toBe("kg");
      expect(f1!.qtyMilli).toBe(2500);
      expect(f1!.priceCents).toBe(1600);
      expect(f1!.amountCents).toBe(4000); // 2.5 * 16.00 = 40.00

      expect(f2!.name).toBe("Water Pipe");
      expect(f2!.unit).toBe("meter");
      expect(f2!.qtyMilli).toBe(15750);
      expect(f2!.priceCents).toBe(320);
      expect(f2!.amountCents).toBe(5040); // 15.75 * 3.20 = 50.40

      expect(f3!.name).toBe("Steel Rod");
      expect(f3!.unit).toBe("ft");
      expect(f3!.qtyMilli).toBe(8250);
      expect(f3!.priceCents).toBe(150);
      expect(f3!.amountCents).toBe(1238); // 8.25 * 1.50 = 12.375 -> 12.38

      expect(f4!.name).toBe("Screws Pack");
      expect(f4!.unit).toBe("pcs");
      expect(f4!.qtyMilli).toBe(10000);
      expect(f4!.priceCents).toBe(80);
      expect(f4!.amountCents).toBe(800);

      // Verify thermal receipt generation from fetched DB order
      const receiptDraft = buildReceipt(fetchedOrder!, { storeName: "YFT Hardware" });
      expect(receiptDraft.lines).toHaveLength(4);
      expect(receiptDraft.lines[0]!.qtyText).toBe("2.5 kg");
      expect(receiptDraft.lines[1]!.qtyText).toBe("15.75 meter");
      expect(receiptDraft.lines[2]!.qtyText).toBe("8.25 ft");
      expect(receiptDraft.lines[3]!.qtyText).toBe("10");

      const receiptHtml = renderReceiptHtml(receiptDraft);
      expect(receiptHtml).toContain("Loose Gravel");
      expect(receiptHtml).toContain("2.5 kg");
      expect(receiptHtml).toContain("15.75 meter");
      expect(receiptHtml).toContain("Screws Pack");
      expect(receiptHtml).toContain(">10<");

      // Verify Delivery Order generation
      const doDraft = buildDeliveryOrder(fetchedOrder!, { storeName: "YFT Hardware" });
      const doHtml = renderDeliveryOrderHtml(doDraft);
      expect(doHtml).toContain("2.5 kg");
      expect(doHtml).toContain("15.75 meter");
      expect(doHtml).toContain("8.25 ft");
    });
  });
});
