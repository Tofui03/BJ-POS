import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { router } from "../router";
import TopBar from "../components/TopBar.vue";
import SettingsDialog from "../components/SettingsDialog.vue";
import TillView from "../views/TillView.vue";
import { L, MESSAGES, PAY_LABEL, RAW_BILINGUAL_L, type LabelKey } from "../labels";
import { currentLocale, loadLocale, setLocale, type Locale } from "../settings";
import { PAYMENT_UI } from "../payments";
import {
  categoryButtonLabel,
  HARDWARE_CATEGORIES,
  HARDWARE_CATEGORY_I18N,
  type Order,
  type DeliveryOrder,
  type Receipt,
} from "@yf/core";
import { renderReceiptHtml } from "../printing/renderReceiptHtml";
import { renderDeliveryOrderHtml } from "../printing/renderDeliveryOrderHtml";
import { buildDailyWorkbook } from "../report/daily";
import { getRepo } from "../db";

describe("Locale strings (zh, en, ms, bilingual)", () => {
  const originalLocale = currentLocale.value;

  beforeEach(() => {
    setActivePinia(createPinia());
    currentLocale.value = "bi";
  });

  afterEach(() => {
    currentLocale.value = originalLocale;
  });

  describe("1. Reactive L Proxy and Locale Switching", () => {
    it("dynamically switches label translations across zh, en, ms, and bi", () => {
      // 1. Chinese (zh)
      currentLocale.value = "zh";
      expect(L.pay).toBe("结账");
      expect(L.hold).toBe("挂单");
      expect(L.resume).toBe("取单");
      expect(L.clear).toBe("清空");
      expect(L.total).toBe("总计");
      expect(L.cash).toBe("现金");
      expect(L.bank).toBe("银行转账");
      expect(L.credit).toBe("记账");
      expect(L.contractors).toBe("工程商");
      expect(L.contractorDirectory).toBe("工程商名录");
      expect(L.addContractor).toBe("新增工程商");
      expect(L.searchContractor).toBe("搜索工程商");
      expect(L.grossKasar).toBe("毛重");
      expect(L.tareBekas).toBe("皮重");
      expect(L.quickWeight).toBe("快捷重量");

      // 2. English (en)
      currentLocale.value = "en";
      expect(L.pay).toBe("Pay");
      expect(L.hold).toBe("Hold");
      expect(L.resume).toBe("Resume");
      expect(L.clear).toBe("Clear");
      expect(L.total).toBe("Total");
      expect(L.cash).toBe("Cash");
      expect(L.card).toBe("Card");
      expect(L.bank).toBe("Bank Transfer");
      expect(L.credit).toBe("Credit");
      expect(L.contractors).toBe("Contractors");
      expect(L.contractorDirectory).toBe("Contractor Directory");
      expect(L.addContractor).toBe("Add Contractor");
      expect(L.searchContractor).toBe("Search Contractor");
      expect(L.grossKasar).toBe("Gross");
      expect(L.tareBekas).toBe("Tare");
      expect(L.quickWeight).toBe("Quick Weight");

      // 3. Bahasa Melayu (ms)
      currentLocale.value = "ms";
      expect(L.pay).toBe("Bayar");
      expect(L.hold).toBe("Simpan");
      expect(L.resume).toBe("Teruskan");
      expect(L.clear).toBe("Padam");
      expect(L.total).toBe("Jumlah");
      expect(L.cash).toBe("Tunai");
      expect(L.card).toBe("Kad");
      expect(L.bank).toBe("Pindahan Bank");
      expect(L.credit).toBe("Kredit");
      expect(L.contractors).toBe("Kontraktor");
      expect(L.contractorDirectory).toBe("Senarai Kontraktor");
      expect(L.addContractor).toBe("Tambah Kontraktor");
      expect(L.searchContractor).toBe("Cari Kontraktor");
      expect(L.grossKasar).toBe("Kasar");
      expect(L.tareBekas).toBe("Bekas");
      expect(L.quickWeight).toBe("Berat Pantas");

      // 4. Bilingual backward-compatibility (bi)
      currentLocale.value = "bi";
      expect(L.pay).toBe("Pay / Bayar");
      expect(L.hold).toBe("Hold / Simpan");
      expect(L.total).toBe("Total / Jumlah");
      expect(L.contractors).toBe("Contractors / Kontraktor");
      expect(L.contractorDirectory).toBe("Contractor Directory / Senarai Kontraktor");
      expect(L.addContractor).toBe("Add Contractor / Tambah");
      expect(L.grossKasar).toBe("Gross (Kasar)");
      expect(L.tareBekas).toBe("Tare (Bekas)");
    });

    it("verifies dictionary completeness: every key is defined with non-empty strings across all locales", () => {
      const keys = Object.keys(RAW_BILINGUAL_L) as LabelKey[];
      expect(keys.length).toBeGreaterThanOrEqual(160);

      const locales: ("en" | "ms" | "zh")[] = ["en", "ms", "zh"];
      for (const loc of locales) {
        for (const k of keys) {
          const val = MESSAGES[loc][k];
          expect(val, `Locale '${loc}' is missing translation for key '${k}'`).toBeDefined();
          expect(typeof val).toBe("string");
          expect(val.trim().length, `Locale '${loc}' has empty translation for key '${k}'`).toBeGreaterThan(0);
        }
      }
    });

    it("supports Proxy reflection and introspection (Object.keys, 'in' operator, descriptors)", () => {
      expect("pay" in L).toBe(true);
      expect("contractorDirectory" in L).toBe(true);
      expect("nonExistentKey" in L).toBe(false);

      const keys = Object.keys(L);
      expect(keys).toContain("pay");
      expect(keys).toContain("hold");
      expect(keys).toContain("contractors");
      expect(keys).toContain("language");

      const desc = Object.getOwnPropertyDescriptor(L, "pay");
      expect(desc).toBeDefined();
      expect(desc?.enumerable).toBe(true);
    });
  });

  describe("2. Reactive PAY_LABEL and PAYMENT_UI", () => {
    it("dynamically reflects currentLocale in PAY_LABEL and PAYMENT_UI", () => {
      currentLocale.value = "zh";
      expect(PAY_LABEL.Cash).toBe("现金");
      expect(PAY_LABEL.Card).toBe("刷卡");
      expect(PAY_LABEL.Bank).toBe("银行转账");
      expect(PAY_LABEL.QR).toBe("二维码 QR");
      expect(PAY_LABEL.Credit).toBe("记账");

      expect(PAYMENT_UI.Cash.label).toBe("现金");
      expect(PAYMENT_UI.Card.label).toBe("刷卡");
      expect(PAYMENT_UI.Bank.label).toBe("银行转账");
      expect(PAYMENT_UI.QR.label).toBe("二维码 QR");
      expect(PAYMENT_UI.Credit.label).toBe("记账");

      currentLocale.value = "en";
      expect(PAY_LABEL.Cash).toBe("Cash");
      expect(PAY_LABEL.Card).toBe("Card");
      expect(PAY_LABEL.Bank).toBe("Bank Transfer");
      expect(PAY_LABEL.QR).toBe("QR");
      expect(PAY_LABEL.Credit).toBe("Credit");

      expect(PAYMENT_UI.Cash.label).toBe("Cash");
      expect(PAYMENT_UI.Card.label).toBe("Card");
      expect(PAYMENT_UI.Bank.label).toBe("Bank Transfer");
      expect(PAYMENT_UI.QR.label).toBe("QR");
      expect(PAYMENT_UI.Credit.label).toBe("Credit");

      currentLocale.value = "ms";
      expect(PAY_LABEL.Cash).toBe("Tunai");
      expect(PAY_LABEL.Card).toBe("Kad");
      expect(PAY_LABEL.Bank).toBe("Pindahan Bank");
      expect(PAY_LABEL.QR).toBe("QR");
      expect(PAY_LABEL.Credit).toBe("Kredit");

      expect(PAYMENT_UI.Cash.label).toBe("Tunai");
      expect(PAYMENT_UI.Card.label).toBe("Kad");
      expect(PAYMENT_UI.Bank.label).toBe("Pindahan Bank");
      expect(PAYMENT_UI.QR.label).toBe("QR");
      expect(PAYMENT_UI.Credit.label).toBe("Kredit");
    });
  });

  describe("3. Hardware Category Multilingual Support (@yf/core)", () => {
    it("provides Chinese category button labels across all 15+ hardware categories", () => {
      expect(categoryButtonLabel("All", "zh")).toBe("全部");
      expect(categoryButtonLabel("Cement & Brick", "zh")).toBe("洋灰与沙石砖");
      expect(categoryButtonLabel("Board & Wood", "zh")).toBe("木板与木材");
      expect(categoryButtonLabel("Tank, Roof & Gutter", "zh")).toBe("水槽屋顶水笕");
      expect(categoryButtonLabel("Door & Frame", "zh")).toBe("门与门框");
      expect(categoryButtonLabel("Plastic Pipe", "zh")).toBe("塑料水管");
      expect(categoryButtonLabel("Metal Pipe", "zh")).toBe("铁喉白铁管");
      expect(categoryButtonLabel("Fence & Steel", "zh")).toBe("铁丝网与钢材");
      expect(categoryButtonLabel("Lain-lain", "zh")).toBe("杂项");
      expect(categoryButtonLabel("Cement & Sand", "zh")).toBe("洋灰与沙石");
      expect(categoryButtonLabel("Steel & Metal", "zh")).toBe("钢铁五金");
      expect(categoryButtonLabel("Paint & Chemical", "zh")).toBe("油漆与化工");
      expect(categoryButtonLabel("Electrical & Wiring", "zh")).toBe("电器电线");
      expect(categoryButtonLabel("Plumbing & Sanitary", "zh")).toBe("卫浴水暖");
      expect(categoryButtonLabel("Tools & Hardware", "zh")).toBe("工具五金");
      expect(categoryButtonLabel("Roofing & Tiles", "zh")).toBe("屋顶与地砖");
    });

    it("supports en, ms, and bilingual default category button labels", () => {
      expect(categoryButtonLabel("All", "en")).toBe("All");
      expect(categoryButtonLabel("All", "ms")).toBe("Semua");
      expect(categoryButtonLabel("All", "bi")).toBe("All / Semua");
      expect(categoryButtonLabel("All")).toBe("All / Semua");

      expect(categoryButtonLabel("Cement & Brick", "en")).toBe("Cement & Brick");
      expect(categoryButtonLabel("Cement & Brick", "ms")).toBe("Simen & Bata");
      expect(categoryButtonLabel("Cement & Brick", "bi")).toBe("Cement & Brick / Simen & Bata");
    });
  });

  describe("4. Database Persistence: setLocale and loadLocale", () => {
    it("persists locale to SQLite settings and restores it with loadLocale()", async () => {
      const repo = await getRepo();

      await setLocale("zh");
      expect(currentLocale.value).toBe("zh");
      expect(await repo.getSetting("pos.locale")).toBe("zh");

      // Change in memory and restore from DB
      currentLocale.value = "en";
      const loaded = await loadLocale();
      expect(loaded).toBe("zh");
      expect(currentLocale.value).toBe("zh");

      // Switch to ms and verify persistence
      await setLocale("ms");
      expect(currentLocale.value).toBe("ms");
      expect(await repo.getSetting("pos.locale")).toBe("ms");

      // Fallback behavior for invalid locale
      await repo.setSetting("pos.locale", "invalid_locale");
      const fallback = await loadLocale();
      expect(fallback).toBe("en");
      expect(currentLocale.value).toBe("en");
    });
  });

  describe("5. Component SSR Rendering: TopBar & SettingsDialog Language Switchers", () => {
    it("renders TopBar language switcher buttons (中文 / EN / BM)", async () => {
      currentLocale.value = "zh";
      const app = createSSRApp(TopBar, { mode: "till" });
      app.use(createPinia());
      app.use(router);
      const html = await renderToString(app);

      // Language switcher buttons rendered
      expect(html).toContain("中文");
      expect(html).toContain("EN");
      expect(html).toContain("BM");

      // Chinese button active highlight
      expect(html).toMatch(/class="[^"]*bg-ink text-white font-800[^"]*"[^>]*>\s*中文/);
    });

    it("renders SettingsDialog language section and switchers when open", async () => {
      currentLocale.value = "zh";
      const app = createSSRApp(SettingsDialog, { open: true });
      app.use(createPinia());
      app.use(router);
      const html = await renderToString(app);

      // Language header
      expect(html).toContain(L.language);

      // Buttons for each supported language (matching TopBar)
      expect(html).toContain("中文");
      expect(html).toContain("EN");
      expect(html).toContain("BM");
    });
  });

  describe("6. Strict Printing & Export Invariance", () => {
    const mockReceipt: Receipt = {
      storeName: "Borneo Jasa Hardware",
      invNo: "A-20261024-001",
      dateText: "24 Oct 2026 · 10:00 am",
      method: "Cash",
      itemCount: 1,
      lines: [
        {
          name: "PVC Pipe 1 inch",
          qtyText: "2 pcs",
          unitPriceText: "RM 15.50",
          amountText: "RM 31.00",
        },
      ],
      totalText: "RM 31.00",
      paidText: "RM 50.00",
      changeText: "RM 19.00",
      footer: "Thank you!",
    };

    const mockDO: DeliveryOrder = {
      companyId: 1,
      businessDate: "2026-10-24",
      doNumber: "DO-20261024-001",
      invNo: "B-20261024-001",
      dateText: "24/10/2026 10:00",
      storeName: "Borneo Jasa Sdn. Bhd.",
      storeAddress: "Lot 123, Industrial Zone, Keningau",
      contractorName: "Ah Seng Contractor",
      siteAddress: "Tapak Projek Lot 88, Keningau",
      lorryPlate: "SAB 1234 X",
      driverName: "Pak Ali",
      contractorPo: "PO-9999",
      showPriceOnDo: true,
      totalQtyMilli: 2000,
      totalQtyText: "2.000",
      lines: [
        {
          itemNo: 1,
          name: "PVC Pipe 1 inch",
          itemName: "PVC Pipe 1 inch",
          unit: "pcs",
          qtyMilli: 2000,
          qtyText: "2 pcs",
          unitPriceCents: 1550,
          unitPriceText: "RM 15.50",
          lineAmountCents: 3100,
          amountText: "RM 31.00",
        },
      ],
      signatories: {
        issuedBy: "Store / Cashier",
        deliveredBy: "Pak Ali",
        receivedBy: "Site Supervisor",
      },
    };

    const mockOrder: Order = {
      id: 101,
      companyId: 1,
      ts: new Date("2026-10-24T10:00:00+08:00").getTime(),
      businessDate: "2026-10-24",
      invNo: "A-20261024-001",
      method: "Cash",
      totalCents: 3100,
      voidedAt: null,
      items: [
        {
          id: 1,
          itemId: 1,
          name: "PVC Pipe 1 inch",
          image: "",
          unit: "pcs",
          priceCents: 1550,
          qtyMilli: 2000,
          amountCents: 3100,
          tailCount: 0,
          bulkPrice: false,
        },
      ],
    };

    it("strictly preserves commercial English/bilingual format on thermal receipts regardless of currentLocale", () => {
      // Test across zh, ms, and bi
      const testLocales: Locale[] = ["zh", "ms", "bi", "en"];

      for (const loc of testLocales) {
        currentLocale.value = loc;

        const receiptHtml = renderReceiptHtml(mockReceipt, 80);

        // 1. Mandatory commercial headers and fields
        expect(receiptHtml).toContain("Borneo Jasa Hardware");
        expect(receiptHtml).toContain("Receipt #A-20261024-001");
        expect(receiptHtml).toContain("RM 31.00");
        expect(receiptHtml).toContain("Cash");
        expect(receiptHtml).toContain("PVC Pipe 1 inch");

        // 2. CRITICAL: Absolute prohibition of UI Chinese strings leaking onto thermal receipts
        expect(receiptHtml).not.toContain("结账");
        expect(receiptHtml).not.toContain("总计");
        expect(receiptHtml).not.toContain("现金");
        expect(receiptHtml).not.toContain("找零");
      }
    });

    it("strictly preserves commercial format on Delivery Orders regardless of currentLocale", () => {
      const testLocales: Locale[] = ["zh", "ms", "bi", "en"];

      for (const loc of testLocales) {
        currentLocale.value = loc;

        const doHtml = renderDeliveryOrderHtml(mockDO);

        // 1. Mandatory commercial DO headers
        expect(doHtml).toContain("DELIVERY ORDER");
        expect(doHtml).toContain("DO No:");
        expect(doHtml).toContain("STORE COPY");
        expect(doHtml).toContain("CUSTOMER COPY");
        expect(doHtml).toContain("Tapak Projek Lot 88, Keningau");
        expect(doHtml).toContain("Pak Ali");

        // 2. CRITICAL: Absolute prohibition of Chinese UI strings leaking into DO printout
        expect(doHtml).not.toContain("送货单");
        expect(doHtml).not.toContain("存根联");
        expect(doHtml).not.toContain("客户联");
        expect(doHtml).not.toContain("工程商");
      }
    });

    it("strictly preserves daily Excel export workbook sheet structure and headers regardless of currentLocale", () => {
      currentLocale.value = "zh";

      const wb = buildDailyWorkbook([mockOrder], []);
      expect(wb.SheetNames).toContain("HQ Daily");
      expect(wb.SheetNames).toContain("Invoice Items");

      const hqSheet = wb.Sheets["HQ Daily"];
      expect(hqSheet).toBeDefined();

      // Check standard English column headers in row 1 (HQ_DAILY_HEADERS)
      expect(hqSheet!["A1"]?.v).toBe("Name");
      expect(hqSheet!["B1"]?.v).toBe("Date");
      expect(hqSheet!["C1"]?.v).toBe("Inv No");
      expect(hqSheet!["D1"]?.v).toBe("Pay Type");
    });
  });
});
