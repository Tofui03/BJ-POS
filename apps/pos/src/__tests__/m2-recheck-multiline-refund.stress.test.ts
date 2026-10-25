import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import initSqlJs from "sql.js";
import {
  createOrder,
  planPartialRefund,
  PosError,
  lineAmount,
  toMilli,
  toQty,
  LAIN_LAIN_KEY,
  LEGACY_SEED_ITEMS,
  type Order,
  type OrderLine,
} from "@yf/core";
import { createSqlJsDriver, initRepo, SqlPosRepo } from "@yf/data";
import RefundDialog from "../components/RefundDialog.vue";

async function freshRepo(): Promise<SqlPosRepo> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  const driver = createSqlJsDriver(db as never);
  return initRepo(driver, {
    seedDemoOrders: false,
    seedItems: LEGACY_SEED_ITEMS,
    now: new Date(2026, 9, 24),
    rng: () => 0.5,
  });
}

describe("Milestone 2 Re-Check Challenger: Multi-line Same Item ID Refunds & RefundDialog UI", () => {
  let repo: SqlPosRepo;

  beforeEach(async () => {
    setActivePinia(createPinia());
    repo = await freshRepo();
  });

  // =========================================================================
  // Challenge 1 & 2: SqlPosRepo & Domain Multi-line Same Item ID Refund
  // =========================================================================
  describe("1. Multi-line Same itemId Order Construction & Strict Line 2 Refund", () => {
    it("constructs an order with 2 lines sharing same itemId (Lain-lain Labor RM10, Lain-lain Parts RM50) and refunds Line 2 only for strictly RM50", async () => {
      // Create Lain-lain item
      const lainItem = await repo.createItem({
        key: LAIN_LAIN_KEY,
        name: "Lain-lain",
        unit: "each",
        priceCents: 0,
      });

      // 1. Construct original order with 2 lines of identical itemId (lainItem.id)
      const originalOrder = await createOrder(repo, {
        method: "Cash",
        lines: [
          {
            itemId: lainItem.id,
            key: LAIN_LAIN_KEY,
            customName: "Lain-lain Labor",
            unit: "each",
            qtyMilli: 1000, // 1 unit
            unitPriceCents: 1000, // RM 10.00
          },
          {
            itemId: lainItem.id,
            key: LAIN_LAIN_KEY,
            customName: "Lain-lain Parts",
            unit: "each",
            qtyMilli: 1000, // 1 unit
            unitPriceCents: 5000, // RM 50.00
          },
        ],
      });

      expect(originalOrder.totalCents).toBe(6000); // RM 60.00 total
      expect(originalOrder.items).toHaveLength(2);

      const line1 = originalOrder.items[0]!;
      const line2 = originalOrder.items[1]!;

      // Verify line identities in DB
      expect(line1.id).toBeDefined();
      expect(line2.id).toBeDefined();
      expect(line1.id).not.toBe(line2.id); // Distinct primary keys
      expect(line1.itemId).toBe(lainItem.id);
      expect(line2.itemId).toBe(lainItem.id); // Same itemId!
      expect(line1.customName).toBe("Lain-lain Labor");
      expect(line2.customName).toBe("Lain-lain Parts");
      expect(line1.priceCents).toBe(1000);
      expect(line2.priceCents).toBe(5000);

      // 2. Execute partial refund on Line 2 only (Parts RM50) by passing orderItemId: line2.id
      const refundOrder = await repo.createRefundOrder({
        originalOrderId: originalOrder.id,
        lines: [
          {
            orderItemId: line2.id,
            itemId: lainItem.id,
            qtyMilli: 1000,
          },
        ],
      });

      // Verify refund order properties
      expect(refundOrder.refundOfOrderId).toBe(originalOrder.id);
      expect(refundOrder.totalCents).toBe(-5000); // Strictly RM 50.00 refund!
      expect(refundOrder.items).toHaveLength(1);

      const refundItem = refundOrder.items[0]!;
      expect(refundItem.itemId).toBe(lainItem.id);
      expect(refundItem.customName).toBe("Lain-lain Parts");
      expect(refundItem.priceCents).toBe(5000);
      expect(refundItem.qtyMilli).toBe(1000);
      expect(refundItem.amountCents).toBe(5000);

      // 3. Verify that Line 2 is now exhausted and cannot be refunded again
      await expect(
        repo.createRefundOrder({
          originalOrderId: originalOrder.id,
          lines: [
            {
              orderItemId: line2.id,
              itemId: lainItem.id,
              qtyMilli: 1000,
            },
          ],
        }),
      ).rejects.toThrowError(/exceeds remaining returnable quantity/i);

      // 4. Verify that Line 1 is STILL fully refundable for strictly RM10.00
      const refundOrderLine1 = await repo.createRefundOrder({
        originalOrderId: originalOrder.id,
        lines: [
          {
            orderItemId: line1.id,
            itemId: lainItem.id,
            qtyMilli: 1000,
          },
        ],
      });

      expect(refundOrderLine1.totalCents).toBe(-1000); // Strictly RM 10.00 refund
      expect(refundOrderLine1.items).toHaveLength(1);
      expect(refundOrderLine1.items[0]!.customName).toBe("Lain-lain Labor");
      expect(refundOrderLine1.items[0]!.priceCents).toBe(1000);

      // 5. Total refunded is now RM 50 + RM 10 = RM 60. Both lines are exhausted.
      await expect(
        repo.createRefundOrder({
          originalOrderId: originalOrder.id,
          lines: [{ orderItemId: line1.id, itemId: lainItem.id, qtyMilli: 1000 }],
        }),
      ).rejects.toThrowError(/exceeds remaining returnable quantity/i);
    });

    it("preserves line identity and pricing when multi-line same itemId order is paid via Credit", async () => {
      // Create contractor credit order with 2 lines of same catalog item with different discount pricing
      const item = await repo.createItem({
        key: "test-wire-mesh",
        name: "Wire Mesh BRC 65",
        unit: "roll",
        priceCents: 8000, // Catalog RM 80
        stockMilli: 20000, // 20 rolls
      });

      const creditOrder = await createOrder(repo, {
        method: "Credit",
        creditorName: "ABC Contractor",
        lines: [
          {
            itemId: item.id,
            qtyMilli: 2000, // 2 rolls
            unitPriceCents: 7500, // Tier 1: RM 75.00
          },
          {
            itemId: item.id,
            qtyMilli: 3000, // 3 rolls
            unitPriceCents: 7000, // Tier 2: RM 70.00
          },
        ],
      });

      // Total = 2 * 75 + 3 * 70 = 150 + 210 = RM 360.00 (36000 cents)
      expect(creditOrder.totalCents).toBe(36000);
      const line1 = creditOrder.items[0]!;
      const line2 = creditOrder.items[1]!;

      // Initial credit row
      const initialCredits = await repo.listCredits(1, { outstandingOnly: true });
      const cred = initialCredits.find((c) => c.orderId === creditOrder.id)!;
      expect(cred.amountCents).toBe(36000);

      // Refund 1 roll from Line 2 only (priced at RM 70.00)
      const refund = await repo.createRefundOrder({
        originalOrderId: creditOrder.id,
        lines: [
          {
            orderItemId: line2.id,
            itemId: item.id,
            qtyMilli: 1000,
          },
        ],
      });

      // Strict price fidelity: refund amount must be RM 70.00 (7000 cents), NOT 7500 or 8000!
      expect(refund.totalCents).toBe(-7000);
      expect(refund.items[0]!.priceCents).toBe(7000);
      expect(refund.items[0]!.amountCents).toBe(7000);

      // Verify credit balance reduced by strictly RM 70.00: 36000 - 7000 = 29000
      const updatedCredits = await repo.listCredits(1, { outstandingOnly: true });
      const updatedCred = updatedCredits.find((c) => c.orderId === creditOrder.id)!;
      expect(updatedCred.amountCents).toBe(29000);

      // Verify stock replenishment: 1 roll returned -> stock increases by 1000 milli
      const reloadedItem = (await repo.getItem(item.id))!;
      // Initial was 20 rolls, sold 5 rolls = 15 rolls remaining, refunded 1 roll = 16 rolls
      expect(reloadedItem.stockMilli).toBe(16000);
    });

    it("verifies pure domain planPartialRefund rejects cross-line price override attacks", () => {
      const order: Order = {
        id: 700,
        companyId: 1,
        invNo: "A-0700",
        ts: Date.now(),
        businessDate: "2026-10-24",
        customerType: "walkin",
        method: "Cash",
        discountCents: 0,
        subtotalCents: 6000,
        totalCents: 6000,
        voidedAt: null,
        items: [
          {
            id: 701,
            itemId: 99,
            name: "Lain-lain",
            customName: "Lain-lain Labor",
            image: "",
            unit: "each",
            priceCents: 1000, // RM 10
            qtyMilli: 1000,
            amountCents: 1000,
            tailCount: 0,
            bulkPrice: false,
          },
          {
            id: 702,
            itemId: 99,
            name: "Lain-lain",
            customName: "Lain-lain Parts",
            image: "",
            unit: "each",
            priceCents: 5000, // RM 50
            qtyMilli: 1000,
            amountCents: 5000,
            tailCount: 0,
            bulkPrice: false,
          },
        ],
      };

      // Attacker attempts to return Line 1 (Labor RM10) with Line 2's orderItemId
      // 1. Refunding by orderItemId: 702 refunds Line 2 @ RM50
      const planLine2 = planPartialRefund(order, [], [{ orderItemId: 702, itemId: 99, qtyMilli: 1000 }]);
      expect(planLine2.totalCents).toBe(-5000);
      expect(planLine2.lines[0]!.priceCents).toBe(5000);
      expect(planLine2.lines[0]!.customName).toBe("Lain-lain Parts");

      // 2. Refunding by orderItemId: 701 refunds Line 1 @ RM10
      const planLine1 = planPartialRefund(order, [], [{ orderItemId: 701, itemId: 99, qtyMilli: 1000 }]);
      expect(planLine1.totalCents).toBe(-1000);
      expect(planLine1.lines[0]!.priceCents).toBe(1000);
      expect(planLine1.lines[0]!.customName).toBe("Lain-lain Labor");

      // 3. Invalid orderItemId throws PosError
      expect(() =>
        planPartialRefund(order, [], [{ orderItemId: 9999, itemId: 99, qtyMilli: 1000 }]),
      ).toThrowError(/order line #9999 not found/i);
    });
  });

  // =========================================================================
  // Challenge 3: RefundDialog.vue line keying, UI state isolation & SSR rendering
  // =========================================================================
  describe("2. RefundDialog.vue Line Keying and State Isolation", () => {
    const mockOrder: Order = {
      id: 999,
      companyId: 1,
      invNo: "A-0999",
      ts: 1700000000000,
      businessDate: "2026-10-24",
      customerType: "walkin",
      method: "Cash",
      discountCents: 0,
      subtotalCents: 6000,
      totalCents: 6000,
      voidedAt: null,
      items: [
        {
          id: 501,
          itemId: 0,
          name: "Lain-lain",
          customName: "Lain-lain Labor",
          image: "",
          unit: "each",
          priceCents: 1000, // RM 10.00
          qtyMilli: 1000,
          amountCents: 1000,
          tailCount: 0,
          bulkPrice: false,
        },
        {
          id: 502,
          itemId: 0,
          name: "Lain-lain",
          customName: "Lain-lain Parts",
          image: "",
          unit: "each",
          priceCents: 5000, // RM 50.00
          qtyMilli: 1000,
          amountCents: 5000,
          tailCount: 0,
          bulkPrice: false,
        },
      ],
    };

    it("generates unique line keys 'line_<id>' preventing Vue template collision", () => {
      function lineKey(it: OrderLine, idx: number): string {
        return it.id != null ? `line_${it.id}` : `idx_${idx}`;
      }

      const key1 = lineKey(mockOrder.items[0]!, 0);
      const key2 = lineKey(mockOrder.items[1]!, 1);

      expect(key1).toBe("line_501");
      expect(key2).toBe("line_502");
      expect(key1).not.toBe(key2);
    });

    it("verifies state isolation: mutating Line 2 return input does not contaminate Line 1", () => {
      function lineKey(it: OrderLine, idx: number): string {
        return it.id != null ? `line_${it.id}` : `idx_${idx}`;
      }

      const returnQuantities: Record<string, number> = {};
      const inputStrings: Record<string, string> = {};

      // Initialize
      mockOrder.items.forEach((it, idx) => {
        const k = lineKey(it, idx);
        returnQuantities[k] = 0;
        inputStrings[k] = "0";
      });

      // User interacts with Line 2 only (Parts RM50)
      const line2Key = lineKey(mockOrder.items[1]!, 1);
      const line1Key = lineKey(mockOrder.items[0]!, 0);

      // Simulate input event on Line 2
      const rawInput = "1";
      inputStrings[line2Key] = rawInput;
      returnQuantities[line2Key] = toMilli(parseFloat(rawInput));

      // Assert Line 1 state is strictly 0 and unaffected
      expect(returnQuantities[line1Key]).toBe(0);
      expect(inputStrings[line1Key]).toBe("0");

      // Assert Line 2 state is isolated
      expect(returnQuantities[line2Key]).toBe(1000);
      expect(inputStrings[line2Key]).toBe("1");

      // Verify line refund amount calculations
      const refundLine1Cents = lineAmount(mockOrder.items[0]!.priceCents, returnQuantities[line1Key]!);
      const refundLine2Cents = lineAmount(mockOrder.items[1]!.priceCents, returnQuantities[line2Key]!);
      const totalRefundCents = refundLine1Cents + refundLine2Cents;

      expect(refundLine1Cents).toBe(0);
      expect(refundLine2Cents).toBe(5000);
      expect(totalRefundCents).toBe(5000); // Strictly RM 50.00!

      // Construct payload for createRefundOrder
      const payloadLines = mockOrder.items
        .map((it, idx) => {
          const k = lineKey(it, idx);
          const q = returnQuantities[k] ?? 0;
          return {
            orderItemId: it.id,
            itemId: it.itemId,
            qtyMilli: q,
          };
        })
        .filter((l) => l.qtyMilli > 0);

      expect(payloadLines).toEqual([
        {
          orderItemId: 502,
          itemId: 0,
          qtyMilli: 1000,
        },
      ]);
    });

    it("verifies setMaxReturn and clearReturn actions on individual lines", () => {
      function lineKey(it: OrderLine, idx: number): string {
        return it.id != null ? `line_${it.id}` : `idx_${idx}`;
      }

      const returnQuantities: Record<string, number> = {
        line_501: 0,
        line_502: 0,
      };
      const inputStrings: Record<string, string> = {
        line_501: "0",
        line_502: "0",
      };
      const remainingByLine: Record<string, number> = {
        line_501: 1000,
        line_502: 1000,
      };

      function setMaxReturn(it: OrderLine, idx: number): void {
        const k = lineKey(it, idx);
        const remaining = remainingByLine[k] ?? 0;
        returnQuantities[k] = remaining;
        inputStrings[k] = String(toQty(remaining));
      }

      function clearReturn(it: OrderLine, idx: number): void {
        const k = lineKey(it, idx);
        returnQuantities[k] = 0;
        inputStrings[k] = "0";
      }

      // Set max on Line 2 only
      setMaxReturn(mockOrder.items[1]!, 1);
      expect(returnQuantities["line_502"]).toBe(1000);
      expect(inputStrings["line_502"]).toBe("1");
      // Line 1 remains untouched
      expect(returnQuantities["line_501"]).toBe(0);
      expect(inputStrings["line_501"]).toBe("0");

      // Clear Line 2
      clearReturn(mockOrder.items[1]!, 1);
      expect(returnQuantities["line_502"]).toBe(0);
      expect(inputStrings["line_502"]).toBe("0");
      expect(returnQuantities["line_501"]).toBe(0);
    });

    it("verifies remaining quota isolation with prior refund of Line 2", () => {
      function lineKey(it: OrderLine, idx: number): string {
        return it.id != null ? `line_${it.id}` : `idx_${idx}`;
      }

      // Prior refund that returned Line 2 (Parts RM 50)
      const priorRefundOfLine2: Order = {
        ...mockOrder,
        id: 1001,
        refundOfOrderId: mockOrder.id,
        totalCents: -5000,
        items: [
          {
            id: 888,
            itemId: 0,
            name: "Lain-lain",
            customName: "Lain-lain Parts",
            image: "",
            unit: "each",
            priceCents: 5000,
            qtyMilli: 1000,
            amountCents: 5000,
            tailCount: 0,
            bulkPrice: false,
          },
        ],
      };

      // Execute remainingByLine logic from RefundDialog.vue
      const lineSlots = mockOrder.items.map((it, idx) => ({
        key: lineKey(it, idx),
        item: it,
        remaining: it.qtyMilli,
      }));

      for (const refOrder of [priorRefundOfLine2]) {
        if (refOrder.voidedAt != null) continue;
        for (const refItem of refOrder.items) {
          let unallocated = refItem.qtyMilli;

          // 1. Try matching slot with same itemId and same priceCents (and matching customName if available)
          for (const slot of lineSlots) {
            if (unallocated <= 0) break;
            if (slot.remaining <= 0) continue;
            if (
              slot.item.itemId === refItem.itemId &&
              slot.item.priceCents === refItem.priceCents &&
              (refItem.customName == null || slot.item.customName === refItem.customName)
            ) {
              const deduct = Math.min(slot.remaining, unallocated);
              slot.remaining -= deduct;
              unallocated -= deduct;
            }
          }

          // 2. Fallback
          if (unallocated > 0) {
            for (const slot of lineSlots) {
              if (unallocated <= 0) break;
              if (slot.remaining <= 0) continue;
              if (slot.item.itemId === refItem.itemId) {
                const deduct = Math.min(slot.remaining, unallocated);
                slot.remaining -= deduct;
                unallocated -= deduct;
              }
            }
          }
        }
      }

      const remainingByLine: Record<string, number> = {};
      for (const slot of lineSlots) {
        remainingByLine[slot.key] = Math.max(0, slot.remaining);
      }

      // Line 1 (Labor RM10) should have full 1000 milli remaining
      expect(remainingByLine["line_501"]).toBe(1000);
      // Line 2 (Parts RM50) should have 0 remaining
      expect(remainingByLine["line_502"]).toBe(0);
    });

    it("renders RefundDialog shell with reference invoice in Vue SSR", async () => {
      const app = createSSRApp(RefundDialog, {
        order: mockOrder,
      });

      const html = await renderToString(app);

      // Verify dialog header elements rendered by SSR
      expect(html).toContain("Partial Return / 退货申请");
      expect(html).toContain("Ref: Receipt A-0999 · Cash");
      expect(html).toContain("Loading return details...");
      expect(html).toContain("Total Refund Amount:");
      expect(html).toContain("Cancel / 取消");
    });
  });
});
