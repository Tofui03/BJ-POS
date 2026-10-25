import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { router } from "../router";
import TopBar from "../components/TopBar.vue";
import SettingsDialog from "../components/SettingsDialog.vue";
import SalesView from "../views/SalesView.vue";
import ReportView from "../views/ReportView.vue";
import AdminView from "../views/AdminView.vue";
import { L } from "../labels";
import { parseHardwareCsv, type PricedItem } from "@yf/core";

describe("Settings Consolidation, Drive Resend & CSV Invariants", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe("TopBar Settings Button Ergonomics & Accessibility", () => {
    it("renders Settings button directly from 'till' mode alongside Close Day", async () => {
      const app = createSSRApp(TopBar, { mode: "till" });
      app.use(createPinia());
      app.use(router);
      const html = await renderToString(app);

      // Both Close Day and Settings are accessible from cashier's till view
      expect(html).toContain(L.closeDay);
      expect(html).toContain(L.settings);
    });

    it("renders Settings button across all secondary views", async () => {
      const modes = ["sales", "report", "admin", "contractors"] as const;
      for (const mode of modes) {
        const app = createSSRApp(TopBar, { mode });
        app.use(createPinia());
        app.use(router);
        const html = await renderToString(app);

        expect(html).toContain(L.settings);
        expect(html).not.toContain(L.closeDay);
      }
    });
  });

  describe("SettingsDialog Consolidated Layout & Controls", () => {
    it("renders Drive resend button and item catalog CSV controls when open", async () => {
      const app = createSSRApp(SettingsDialog, { open: true });
      app.use(createPinia());
      app.use(router);
      const html = await renderToString(app);

      // Dialog title & printer configuration
      expect(html).toContain(L.settings);
      expect(html).toContain("Receipt paper width");

      // Google Drive consolidated section
      expect(html).toContain("Google Drive Daily Report");
      expect(html).toContain("Upload / Resend Daily Report to Drive");

      // Item Catalog CSV consolidated section
      expect(html).toContain("Item Catalog CSV / Katalog Barangan CSV");
      expect(html).toContain("Import Items CSV");
      expect(html).toContain("Export Items to CSV");
      expect(html).toContain('type="file"');
      expect(html).toContain('accept=".csv"');
    });

    it("does not render contents when open=false", async () => {
      const app = createSSRApp(SettingsDialog, { open: false });
      app.use(createPinia());
      app.use(router);
      const html = await renderToString(app);

      expect(html).not.toContain(L.settings);
      expect(html).not.toContain("Google Drive");
      expect(html).not.toContain("Item Catalog CSV");
    });
  });

  describe("Catalog CSV Generation & Roundtrip Parsing Compatibility", () => {
    it("ensures exported standard CSV format can be parsed cleanly by parseHardwareCsv", () => {
      const sampleItems: PricedItem[] = [
        {
          id: 101,
          key: "hw_cement_50kg",
          name: "Portland Cement — 50 kg",
          image: "",
          unit: "bag",
          priceCents: 2400,
          active: true,
          tracksTail: false,
          stockMilli: null,
          sortOrder: 1,
          tiers: [],
        },
        {
          id: 102,
          key: "hw_pvc_pipe_15mm",
          name: "PVC Pipe 15mm — 6 meter (Class D)",
          image: "",
          unit: "batang",
          priceCents: 1250,
          active: true,
          tracksTail: false,
          stockMilli: null,
          sortOrder: 2,
          tiers: [],
        },
        {
          id: 103,
          key: "hw_wire_nails",
          name: "Wire Nails 2.5\"",
          image: "",
          unit: "kg",
          priceCents: 650,
          active: true,
          tracksTail: false,
          stockMilli: null,
          sortOrder: 3,
          tiers: [],
        },
      ];

      function escapeCsvCell(val: string | number): string {
        const str = String(val ?? "");
        if (/[",\r\n]/.test(str)) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }

      // Generate CSV as implemented in SettingsDialog
      const headers = ["No", "Item Name", "Specification / Size", "Retail Price", "Unit"];
      const rows = sampleItems.map((item, index) => {
        const parts = item.name.split(" — ");
        const rawName = parts[0] || item.name;
        const rawSpec = parts.length > 1 ? parts.slice(1).join(" — ") : "";
        const priceRm = (item.priceCents / 100).toFixed(2);
        return [
          escapeCsvCell(index + 1),
          escapeCsvCell(rawName),
          escapeCsvCell(rawSpec),
          escapeCsvCell(priceRm),
          escapeCsvCell(item.unit),
        ].join(",");
      });
      const generatedCsv = [headers.join(","), ...rows].join("\r\n");

      // Verify header and contents
      expect(generatedCsv).toContain("No,Item Name,Specification / Size,Retail Price,Unit");
      expect(generatedCsv).toContain("1,Portland Cement,50 kg,24.00,bag");
      expect(generatedCsv).toContain("2,PVC Pipe 15mm,6 meter (Class D),12.50,batang");
      expect(generatedCsv).toContain('3,"Wire Nails 2.5""",,6.50,kg');

      // Roundtrip verification: parseHardwareCsv parses this generated CSV
      const parsed = parseHardwareCsv(generatedCsv);
      expect(parsed).toHaveLength(3);

      expect(parsed[0]!.name).toBe("Portland Cement — 50 kg");
      expect(parsed[0]!.unit).toBe("bag");
      expect(parsed[0]!.priceCents).toBe(2400);

      expect(parsed[1]!.name).toBe("PVC Pipe 15mm — 6 meter (Class D)");
      expect(parsed[1]!.unit).toBe("batang");
      expect(parsed[1]!.priceCents).toBe(1250);

      expect(parsed[2]!.name).toBe("Wire Nails 2.5\"");
      expect(parsed[2]!.unit).toBe("kg");
      expect(parsed[2]!.priceCents).toBe(650);
    });

    it("correctly escapes special characters (commas, quotes) in CSV export", () => {
      function escapeCsvCell(val: string | number): string {
        const str = String(val ?? "");
        if (/[",\r\n]/.test(str)) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }

      const itemWithSpecialChars: PricedItem = {
        id: 201,
        key: "hw_special",
        name: "Special Paint, \"Gloss White\" — 5 Litre, Premium",
        image: "",
        unit: "roll",
        priceCents: 8500,
        active: true,
        tracksTail: false,
        stockMilli: null,
        sortOrder: 1,
        tiers: [],
      };

      const parts = itemWithSpecialChars.name.split(" — ");
      const rawName = parts[0] || itemWithSpecialChars.name;
      const rawSpec = parts.length > 1 ? parts.slice(1).join(" — ") : "";
      const priceRm = (itemWithSpecialChars.priceCents / 100).toFixed(2);

      const line = [
        escapeCsvCell(1),
        escapeCsvCell(rawName),
        escapeCsvCell(rawSpec),
        escapeCsvCell(priceRm),
        escapeCsvCell(itemWithSpecialChars.unit),
      ].join(",");

      expect(line).toBe('1,"Special Paint, ""Gloss White""","5 Litre, Premium",85.00,roll');

      const fullCsv = ["No,Item Name,Specification / Size,Retail Price,Unit", line].join("\r\n");
      const parsed = parseHardwareCsv(fullCsv);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]!.name).toBe("Special Paint, \"Gloss White\" — 5 Litre, Premium");
      expect(parsed[0]!.unit).toBe("roll");
      expect(parsed[0]!.priceCents).toBe(8500);
    });
  });

  describe("Verification of Removed Buttons Across Views", () => {
    it("verifies SalesView header no longer contains Download Excel or Resend to Drive", async () => {
      const app = createSSRApp(SalesView);
      app.use(createPinia());
      app.use(router);
      const html = await renderToString(app);

      // Core functionality retained
      expect(html).toContain("查单重印台 / Sales Lookup");

      // Removed buttons
      expect(html).not.toContain(L.downloadExcel);
      expect(html).not.toContain(L.resendDrive);
      expect(html).not.toContain("Download Excel");
      expect(html).not.toContain("Resend to Drive");
    });

    it("verifies ReportView retains Download Excel but removes Resend to Drive", async () => {
      const app = createSSRApp(ReportView);
      app.use(createPinia());
      app.use(router);
      const html = await renderToString(app);

      // Retained for daily accounting exports
      expect(html).toContain(L.downloadExcel);
      expect(html).toContain("老板销售报表 / Owner Sales Report");

      // Removed redundant upload button
      expect(html).not.toContain(L.resendDrive);
      expect(html).not.toContain("Resend to Drive");
    });

    it("verifies AdminView removes Import CSV button from item catalog header", async () => {
      const app = createSSRApp(AdminView, { section: "items" });
      app.use(createPinia());
      app.use(router);
      const html = await renderToString(app);

      // Items actions
      expect(html).toContain(L.items);
      expect(html).toContain(L.add);

      // Import CSV moved to SettingsDialog
      expect(html).not.toContain("Import CSV");
    });
  });
});
