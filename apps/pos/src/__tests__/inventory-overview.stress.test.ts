import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { router } from "../router";
import AdminView from "../views/AdminView.vue";
import RestockDialog from "../components/RestockDialog.vue";
import { useCatalog } from "../stores/catalog";
import { L } from "../labels";
import type { PricedItem } from "@yf/core";

const mockItemTracked: PricedItem = {
  id: 101,
  key: "PLY-9MM",
  name: "Plywood 9mm — 4x8 ft",
  image: "",
  unit: "pcs",
  priceCents: 4500,
  active: true,
  tracksTail: false,
  sortOrder: 1,
  stockMilli: 8000, // 8 pcs
  tiers: [],
};

const mockItemUntracked: PricedItem = {
  id: 102,
  key: "SAND-RIV",
  name: "River Sand — Fine",
  image: "",
  unit: "bag",
  priceCents: 1200,
  active: true,
  tracksTail: false,
  sortOrder: 2,
  stockMilli: null, // untracked
  tiers: [],
};

describe("Inventory Overview & Restock Inbound Stress Harness", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe("1. RestockDialog Component Rendering & Ergonomics", () => {
    it("renders pre-selected item mode with stock preview and presets", async () => {
      const app = createSSRApp(RestockDialog, {
        open: true,
        initialItem: mockItemTracked,
        items: [mockItemTracked, mockItemUntracked],
      });
      app.use(createPinia());
      const html = await renderToString(app);

      // Dialog header & item info
      expect(html).toContain(L.quickInbound);
      expect(html).toContain("Plywood 9mm — 4x8 ft");
      expect(html).toContain("PLY-9MM");
      expect(html).toContain(L.currentStock);
      expect(html).toContain("8 pcs");

      // Presets & steppers
      expect(html).toContain("+5");
      expect(html).toContain("+10");
      expect(html).toContain("+25");
      expect(html).toContain("+50");
      expect(html).toContain("+100");
      expect(html).toContain("C");

      // Confirmation button
      expect(html).toContain(L.confirmInbound);
      expect(html).toContain(L.cancel);
    });

    it("renders untracked item with untracked notice in RestockDialog", async () => {
      const app = createSSRApp(RestockDialog, {
        open: true,
        initialItem: mockItemUntracked,
        items: [mockItemTracked, mockItemUntracked],
      });
      app.use(createPinia());
      const html = await renderToString(app);

      expect(html).toContain("River Sand — Fine");
      expect(html).toContain(L.untracked);
      expect(html).toContain("0 (" + L.untracked + ")");
    });

    it("renders item search / scan mode when no initialItem is provided", async () => {
      const app = createSSRApp(RestockDialog, {
        open: true,
        initialItem: null,
        items: [mockItemTracked, mockItemUntracked],
      });
      app.use(createPinia());
      const html = await renderToString(app);

      expect(html).toContain(L.selectItemToRestock);
      expect(html).toContain(L.searchItemOrBarcode);
      expect(html).toContain("Plywood 9mm — 4x8 ft");
      expect(html).toContain("River Sand — Fine");
    });

    it("renders nothing when open is false", async () => {
      const app = createSSRApp(RestockDialog, {
        open: false,
        initialItem: mockItemTracked,
      });
      app.use(createPinia());
      const html = await renderToString(app);

      expect(html).not.toContain(L.quickInbound);
      expect(html).not.toContain("Plywood 9mm");
    });
  });

  describe("2. AdminView Sub-View Switcher & Table Layout", () => {
    it("renders sub-view switcher pills and header actions in AdminView", async () => {
      const app = createSSRApp(AdminView, { section: "items" });
      app.use(createPinia());
      app.use(router);
      const html = await renderToString(app);

      // Section title & switcher tabs
      expect(html).toContain(L.items);
      expect(html).toContain(L.itemCatalog);
      expect(html).toContain(L.inventoryOverview);

      // Header actions
      expect(html).toContain(L.quickInbound);
      expect(html).toContain(L.add);
    });

    it("includes inventory toolbar placeholder and table headers", async () => {
      const app = createSSRApp(AdminView, { section: "items" });
      app.use(createPinia());
      app.use(router);
      const html = await renderToString(app);

      // Search input placeholder and table headers exist in the template
      expect(html).toContain(L.searchPlaceholder);
      expect(html).toContain(L.item);
      expect(html).toContain(L.unit);
      expect(html).toContain(L.price);
      expect(html).toContain(L.actions);
    });
  });

  describe("3. In-Place Catalog Store Reactivity", () => {
    it("updates item stock in-place without reloading entire catalogue", () => {
      const catalog = useCatalog();
      catalog.items = [
        { ...mockItemTracked, stockMilli: 5000 },
        { ...mockItemUntracked, stockMilli: null },
      ];

      expect(catalog.items[0]?.stockMilli).toBe(5000);
      expect(catalog.items[1]?.stockMilli).toBeNull();

      // In-place atomic update
      catalog.updateItemStock(101, 15000);
      expect(catalog.items[0]?.stockMilli).toBe(15000);

      // Progressively onboard untracked item
      catalog.updateItemStock(102, 25000);
      expect(catalog.items[1]?.stockMilli).toBe(25000);
    });
  });
});
