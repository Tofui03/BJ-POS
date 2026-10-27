import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { router } from "../router";
import AdminView from "../views/AdminView.vue";
import { useCatalog } from "../stores/catalog";
import { getRepo } from "../db";
import { L } from "../labels";
import {
  compareStockAscending,
  DEFAULT_LOW_STOCK_THRESHOLD_MILLI,
  filterStockItems,
  formatStockQty,
  getStockStatus,
  isLowStock,
  isStockTracked,
  type Item,
  type PricedItem,
} from "@yf/core";

// Comprehensive edge-case items fixture
const edgeItems: PricedItem[] = [
  {
    id: 1,
    key: "REB-12",
    name: "Steel Rebar 12mm",
    image: "",
    unit: "pcs",
    priceCents: 2400,
    active: true,
    tracksTail: false,
    sortOrder: 1,
    stockMilli: -5000, // severe negative stock (-5 pcs)
    tiers: [],
  },
  {
    id: 2,
    key: "REB-10",
    name: "Steel Rebar 10mm",
    image: "",
    unit: "pcs",
    priceCents: 1800,
    active: true,
    tracksTail: false,
    sortOrder: 2,
    stockMilli: -200, // mild negative stock (-0.2 pcs)
    tiers: [],
  },
  {
    id: 3,
    key: "NLS-01-SP",
    name: "Nails 1-inch [Special]",
    image: "",
    unit: "box",
    priceCents: 1500,
    active: true,
    tracksTail: false,
    sortOrder: 3,
    stockMilli: 0, // out of stock
    tiers: [],
  },
  {
    id: 4,
    key: "CEM-PORT",
    name: "Cement (Portland) 50kg",
    image: "",
    unit: "bag",
    priceCents: 2200,
    active: true,
    tracksTail: false,
    sortOrder: 4,
    stockMilli: 1000, // low stock (1 bag)
    tiers: [],
  },
  {
    id: 5,
    key: "PVC-ELB-90",
    name: "PVC Elbow 90° (1/2\")",
    image: "",
    unit: "pcs",
    priceCents: 350,
    active: true,
    tracksTail: false,
    sortOrder: 5,
    stockMilli: 5000, // exactly at threshold (5 pcs)
    tiers: [],
  },
  {
    id: 6,
    key: "PNT-RED+THN",
    name: "Paint Red + Thinner",
    image: "",
    unit: "bottle",
    priceCents: 4500,
    active: true,
    tracksTail: false,
    sortOrder: 6,
    stockMilli: 5001, // just 1 milli above threshold (5.001 bottles)
    tiers: [],
  },
  {
    id: 7,
    key: "TMB-2X4",
    name: "Timber 2x4 (Treated)",
    image: "",
    unit: "pcs",
    priceCents: 3200,
    active: true,
    tracksTail: false,
    sortOrder: 7,
    stockMilli: 100000, // high stock (100 pcs)
    tiers: [],
  },
  {
    id: 8,
    key: "SND-RIV",
    name: "River Sand (Fine)",
    image: "",
    unit: "bag",
    priceCents: 800,
    active: true,
    tracksTail: false,
    sortOrder: 8,
    stockMilli: null, // untracked
    tiers: [],
  },
  {
    id: 9,
    key: "ADH-TAPE",
    name: "Adhesive Tape 2\"",
    image: "",
    unit: "roll",
    priceCents: 450,
    active: true,
    tracksTail: false,
    sortOrder: 9,
    stockMilli: null, // untracked
    tiers: [],
  },
  {
    id: 10,
    key: "NLS-02",
    name: "Nails 2-inch",
    image: "",
    unit: "box",
    priceCents: 1600,
    active: true,
    tracksTail: false,
    sortOrder: 10,
    stockMilli: 0, // identical stock to item 3 (0), tests name tie-break
    tiers: [],
  },
  {
    id: 11,
    key: "CJK-CMT",
    name: "水泥 50kg (Cement)",
    image: "",
    unit: "bag",
    priceCents: 2100,
    active: true,
    tracksTail: false,
    sortOrder: 11,
    stockMilli: 3000, // low stock with CJK characters
    tiers: [],
  },
];

describe("Inventory filtering and list state", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe("1. filterStockItems Complex Combinations & Edge Cases", () => {
    it("handles Tracked Only filter, strictly excluding untracked items", () => {
      const filtered = filterStockItems(edgeItems, { trackedOnly: true });
      const ids = filtered.map((i) => i.id);

      // Tracked items (including negative stock and zero stock) must be present
      expect(ids).toContain(1); // -5000
      expect(ids).toContain(2); // -200
      expect(ids).toContain(3); // 0
      expect(ids).toContain(4); // 1000
      expect(ids).toContain(5); // 5000
      expect(ids).toContain(6); // 5001
      expect(ids).toContain(7); // 100000
      expect(ids).toContain(10); // 0
      expect(ids).toContain(11); // 3000

      // Untracked items must be completely absent
      expect(ids).not.toContain(8); // null
      expect(ids).not.toContain(9); // null
      expect(filtered.length).toBe(9);
    });

    it("handles Low Stock filter (<= 5000 milli), including negative and zero stock items, excluding untracked", () => {
      const filtered = filterStockItems(edgeItems, { lowStockOnly: true });
      const ids = filtered.map((i) => i.id);

      // Low stock: -5000, -200, 0, 1000, 5000, 0, 3000
      expect(ids).toContain(1);
      expect(ids).toContain(2);
      expect(ids).toContain(3);
      expect(ids).toContain(4);
      expect(ids).toContain(5);
      expect(ids).toContain(10);
      expect(ids).toContain(11);

      // Excluded: 5001 (> threshold), 100000 (> threshold), and null (untracked)
      expect(ids).not.toContain(6);
      expect(ids).not.toContain(7);
      expect(ids).not.toContain(8);
      expect(ids).not.toContain(9);
      expect(filtered.length).toBe(7);
    });

    it("combines Tracked Only + Low Stock", () => {
      const filtered = filterStockItems(edgeItems, {
        trackedOnly: true,
        lowStockOnly: true,
      });
      const ids = filtered.map((i) => i.id);
      expect(ids).toEqual([1, 2, 3, 4, 5, 10, 11]);
    });

    it("supports custom lowStockThresholdMilli and thresholdMilli", () => {
      // Threshold = 1000 milli (only <= 1000: items 1, 2, 3, 4, 10)
      const withCustom = filterStockItems(edgeItems, {
        lowStockOnly: true,
        thresholdMilli: 1000,
      });
      expect(withCustom.map((i) => i.id)).toEqual([1, 2, 3, 4, 10]);

      // Same with lowStockThresholdMilli alias
      const withAlias = filterStockItems(edgeItems, {
        lowStockOnly: true,
        lowStockThresholdMilli: 1000,
      });
      expect(withAlias.map((i) => i.id)).toEqual([1, 2, 3, 4, 10]);
    });

    it("handles search queries with regex special characters without throwing regex syntax error", () => {
      // Test regex characters: [, ], (, ), +, *, ?, \, ^, $, ., ", ', /
      const queries = [
        { q: "[Special]", expectedId: 3 },
        { q: "90° (1/2\")", expectedId: 5 },
        { q: "Red + Thinner", expectedId: 6 },
        { q: "2x4", expectedId: 7 },
        { q: "REB-12", expectedId: 1 },
        { q: "NLS-01", expectedId: 3 },
      ];

      for (const { q, expectedId } of queries) {
        expect(() => filterStockItems(edgeItems, { search: q })).not.toThrow();
        const res = filterStockItems(edgeItems, { search: q });
        expect(res.some((i) => i.id === expectedId)).toBe(true);
      }
    });

    it("handles potential regex-injection strings safely and treats them as literal substrings", () => {
      const injectionQueries = [".*", "\\d+", "[a-z]+", "(.*)", "^$", ".*+?^${}()|[]\\"];
      for (const q of injectionQueries) {
        expect(() => filterStockItems(edgeItems, { search: q })).not.toThrow();
        const res = filterStockItems(edgeItems, { search: q });
        // Since no item contains ".*" or "\\d+", res should be empty without crash
        expect(Array.isArray(res)).toBe(true);
      }
    });

    it("handles CJK and Unicode search keywords", () => {
      const res = filterStockItems(edgeItems, { search: "水泥" });
      expect(res.map((i) => i.id)).toEqual([4, 11]);
    });

    it("handles whitespace trimming and case insensitivity in search", () => {
      const res = filterStockItems(edgeItems, { search: "   sTeEl rEbAr   " });
      expect(res.map((i) => i.id)).toEqual([1, 2]);
    });

    it("handles empty or whitespace-only search string as no-op", () => {
      const resEmpty = filterStockItems(edgeItems, { search: "" });
      expect(resEmpty.length).toBe(edgeItems.length);

      const resWhitespace = filterStockItems(edgeItems, { search: "   " });
      expect(resWhitespace.length).toBe(edgeItems.length);
    });

    it("handles non-matching search returning empty array", () => {
      const res = filterStockItems(edgeItems, { search: "non-existent-hardware-widget-xyz" });
      expect(res).toEqual([]);
    });
  });

  describe("2. Ascending Stock Sort Order & Deterministic Tie-Breaking", () => {
    it("orders: negative stock -> zero -> positive low stock -> high stock -> untracked at the end", () => {
      const sorted = filterStockItems(edgeItems, { sortAscending: true });
      const stockSeq = sorted.map((i) => i.stockMilli);

      // Verify that tracked items come first in strictly ascending order
      const trackedItems = sorted.filter((i) => i.stockMilli != null);
      const untrackedItems = sorted.filter((i) => i.stockMilli == null);

      expect(trackedItems.length).toBe(9);
      expect(untrackedItems.length).toBe(2);

      // Check stock sequence for tracked items
      expect(trackedItems.map((i) => i.stockMilli)).toEqual([
        -5000, -200, 0, 0, 1000, 3000, 5000, 5001, 100000,
      ]);

      // Untracked items must strictly be at the end
      expect(stockSeq[stockSeq.length - 2]).toBeNull();
      expect(stockSeq[stockSeq.length - 1]).toBeNull();
    });

    it("breaks ties deterministically by name localeCompare then by id", () => {
      // Items 3 and 10 both have stockMilli = 0
      // Item 3: "Nails 1-inch [Special]"
      // Item 10: "Nails 2-inch"
      // "Nails 1-inch [Special]" comes before "Nails 2-inch"
      const zerosOnly = edgeItems.filter((i) => i.stockMilli === 0);
      const sortedZeros = [...zerosOnly].reverse().sort(compareStockAscending);
      expect(sortedZeros[0]?.id).toBe(3);
      expect(sortedZeros[1]?.id).toBe(10);

      // Untracked items 8 and 9 both have stockMilli = null
      // Item 8: "River Sand (Fine)"
      // Item 9: "Adhesive Tape 2\""
      // "Adhesive Tape 2\"" comes before "River Sand (Fine)"
      const untrackedOnly = edgeItems.filter((i) => i.stockMilli == null);
      const sortedUntracked = [...untrackedOnly].sort(compareStockAscending);
      expect(sortedUntracked[0]?.id).toBe(9);
      expect(sortedUntracked[1]?.id).toBe(8);

      // Tie with identical stock AND identical name -> breaks by ID
      const twinA: Item = {
        id: 50,
        key: "TWIN-A",
        name: "Twin Item",
        image: "",
        unit: "pcs",
        priceCents: 100,
        active: true,
        tracksTail: false,
        sortOrder: 1,
        stockMilli: 2500,
      };
      const twinB: Item = {
        id: 20,
        key: "TWIN-B",
        name: "Twin Item",
        image: "",
        unit: "pcs",
        priceCents: 100,
        active: true,
        tracksTail: false,
        sortOrder: 2,
        stockMilli: 2500,
      };
      const sortedTwins = [twinA, twinB].sort(compareStockAscending);
      expect(sortedTwins[0]?.id).toBe(20); // smaller id first
      expect(sortedTwins[1]?.id).toBe(50);
    });

    it("combines search, lowStockOnly, trackedOnly, and sortAscending simultaneously", () => {
      // Search "rebar" with lowStockOnly: true, sortAscending: true
      const result = filterStockItems(edgeItems, {
        search: "rebar",
        lowStockOnly: true,
        trackedOnly: true,
        sortAscending: true,
      });

      expect(result.map((i) => i.id)).toEqual([1, 2]); // -5000 before -200
      expect(result[0]?.stockMilli).toBe(-5000);
      expect(result[1]?.stockMilli).toBe(-200);
    });

    it("supports sortAsc boolean flag as alias for sortAscending", () => {
      const res = filterStockItems(edgeItems, { sortAsc: true });
      expect(res.map((i) => i.id)[0]).toBe(1); // Item 1 with -5000 stock is first
    });
  });

  describe("3. Item Edit Safety in AdminView & Repository Layer", () => {
    it("preserves positive stockMilli when updating item details via repo.updateItem", async () => {
      const repo = await getRepo();

      // Create an item with stock
      const created = await repo.createItem({
        key: `STK-TEST-${Date.now()}`,
        name: "Safety Item Test",
        unit: "pcs",
        image: "",
        priceCents: 5000,
        tracksTail: false,
        stockMilli: 17500, // 17.5 pcs
      });

      expect(created.stockMilli).toBe(17500);

      // Perform update without specifying stockMilli (as saveEdit does in AdminView)
      const updated = await repo.updateItem(created.id, {
        name: "Safety Item Test Renamed",
        unit: "box",
        priceCents: 6500,
        active: true,
        tracksTail: false,
      });

      // stockMilli MUST be strictly preserved
      expect(updated.stockMilli).toBe(17500);
      expect(updated.name).toBe("Safety Item Test Renamed");
      expect(updated.unit).toBe("box");
      expect(updated.priceCents).toBe(6500);

      // Verify persistence from database query
      const fetched = await repo.getItem(created.id);
      expect(fetched?.stockMilli).toBe(17500);
    });

    it("preserves negative stockMilli when updating item details", async () => {
      const repo = await getRepo();

      const created = await repo.createItem({
        key: `NEG-TEST-${Date.now()}`,
        name: "Negative Stock Item",
        unit: "kg",
        image: "",
        priceCents: 1200,
        tracksTail: false,
        stockMilli: -3500, // -3.5 kg
      });

      expect(created.stockMilli).toBe(-3500);

      const updated = await repo.updateItem(created.id, {
        name: "Negative Stock Item Price Change",
        priceCents: 1500,
        unit: "kg",
        active: true,
        tracksTail: false,
      });

      expect(updated.stockMilli).toBe(-3500);
      const fetched = await repo.getItem(created.id);
      expect(fetched?.stockMilli).toBe(-3500);
    });

    it("preserves zero stockMilli when updating item details", async () => {
      const repo = await getRepo();

      const created = await repo.createItem({
        key: `ZERO-TEST-${Date.now()}`,
        name: "Zero Stock Item",
        unit: "pcs",
        image: "",
        priceCents: 300,
        tracksTail: false,
        stockMilli: 0,
      });

      expect(created.stockMilli).toBe(0);

      const updated = await repo.updateItem(created.id, {
        name: "Zero Stock Item Updated",
        priceCents: 350,
        unit: "pcs",
        active: true,
        tracksTail: false,
      });

      expect(updated.stockMilli).toBe(0);
      const fetched = await repo.getItem(created.id);
      expect(fetched?.stockMilli).toBe(0);
    });

    it("preserves untracked (null) stockMilli when updating item details", async () => {
      const repo = await getRepo();

      const created = await repo.createItem({
        key: `UNTRK-TEST-${Date.now()}`,
        name: "Untracked Item",
        unit: "bag",
        image: "",
        priceCents: 900,
        tracksTail: false,
        stockMilli: null,
      });

      expect(created.stockMilli).toBeNull();

      const updated = await repo.updateItem(created.id, {
        name: "Untracked Item Updated",
        priceCents: 950,
        unit: "bag",
        active: true,
        tracksTail: false,
      });

      expect(updated.stockMilli).toBeNull();
      const fetched = await repo.getItem(created.id);
      expect(fetched?.stockMilli).toBeNull();
    });

    it("only resets stockMilli when explicitly provided as null in the patch", async () => {
      const repo = await getRepo();

      const created = await repo.createItem({
        key: `EXP-UNTRK-${Date.now()}`,
        name: "To Untrack",
        unit: "pcs",
        image: "",
        priceCents: 1000,
        tracksTail: false,
        stockMilli: 8000,
      });

      expect(created.stockMilli).toBe(8000);

      // Explicit patch with stockMilli: null
      const updated = await repo.updateItem(created.id, {
        stockMilli: null,
      });

      expect(updated.stockMilli).toBeNull();
    });
  });

  describe("4. formatStockQty Edge Cases", () => {
    it("handles zero, negative, fractional, and untracked quantities correctly", () => {
      expect(formatStockQty(null)).toBe("—");
      expect(formatStockQty(0)).toBe("0");
      expect(formatStockQty(-5000)).toBe("-5");
      expect(formatStockQty(-200)).toBe("-0.2");
      expect(formatStockQty(1250)).toBe("1.25");
      expect(formatStockQty(1000)).toBe("1");
      expect(formatStockQty(100000)).toBe("100");
    });
  });

  describe("5. AdminView SSR Component Rendering & Inventory Toggles", () => {
    it("renders AdminView catalogue tab switcher and header actions", async () => {
      await router.push("/item");
      const app = createSSRApp(AdminView, { section: "items" });
      app.use(createPinia());
      app.use(router);
      const html = await renderToString(app);

      // Section title & switcher tabs
      expect(html).toContain(L.items);
      expect(html).toContain(L.itemCatalog);
      expect(html).toContain(L.inventoryOverview);
      expect(html).toContain(L.quickInbound);
    });

    it("renders AdminView inventory overview sub-view when tab=inventory", async () => {
      await router.push("/item?tab=inventory");
      const app = createSSRApp(AdminView, { section: "items" });
      app.use(createPinia());
      app.use(router);
      const html = await renderToString(app);

      // Inventory overview toolbar controls
      expect(html).toContain(L.trackedOnly);
      expect(html).toContain(L.lowStock);
      expect(html).toContain(L.sortByStockAsc);
      expect(html).toContain(L.quickInbound);
      expect(html).toContain(L.currentStock);
      expect(html).toContain(L.status);
      expect(html).toContain(L.actions);
    });
  });
});
