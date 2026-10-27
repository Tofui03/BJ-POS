import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { router } from "../router";
import TopBar from "../components/TopBar.vue";
import AdminView from "../views/AdminView.vue";
import SettingsDialog from "../components/SettingsDialog.vue";
import SalesView from "../views/SalesView.vue";
import ReportView from "../views/ReportView.vue";
import NumpadDialog from "../components/NumpadDialog.vue";
import LainLainDialog from "../components/LainLainDialog.vue";
import {
  buildOrder,
  calcReverseQuantity,
  deductTare,
  determineInvoicePrefix,
  formatInvNo,
  reversePriceLine,
  toCents,
  type DeliveryOrder,
  type PaymentMethod,
  type PricedItem,
} from "@yf/core";
import { renderDeliveryOrderHtml } from "../printing/renderDeliveryOrderHtml";
import {
  shouldAutoTriggerNumpad,
  determineCheckoutInvoicePrefix,
  shouldCreateCreditDebt,
} from "../interactions";
import { useCart } from "../stores/cart";
import { PAYMENT_UI } from "../payments";
import { L, PAY_LABEL } from "../labels";

const weighableNails: PricedItem = {
  id: 1,
  key: "hw_nails_kg",
  name: "Common Wire Nails 2\"",
  image: "",
  unit: "kg",
  priceCents: 1000,
  active: true,
  tracksTail: false,
  stockMilli: null,
  sortOrder: 1,
  tiers: [
    { id: 1, itemId: 1, minQtyMilli: 30000, priceCents: 800 },
    { id: 2, itemId: 1, minQtyMilli: 50000, priceCents: 700 },
  ],
};

const measurablePipe: PricedItem = {
  id: 2,
  key: "hw_pvc_pipe",
  name: "PVC Pipe Class D 1/2\"",
  image: "",
  unit: "ft",
  priceCents: 200,
  active: true,
  tracksTail: false,
  stockMilli: null,
  sortOrder: 2,
  tiers: [],
};

const measurableSteel: PricedItem = {
  id: 3,
  key: "hw_steel_meter",
  name: "High Tensile Steel Bar Y12",
  image: "",
  unit: "meter",
  priceCents: 2500,
  active: true,
  tracksTail: false,
  stockMilli: null,
  sortOrder: 3,
  tiers: [],
};

const discreteCement: PricedItem = {
  id: 4,
  key: "hw_cement",
  name: "Portland Cement 50 kg",
  image: "",
  unit: "bag",
  priceCents: 1800,
  active: true,
  tracksTail: false,
  stockMilli: null,
  sortOrder: 4,
  tiers: [],
};

const discreteHammer: PricedItem = {
  id: 5,
  key: "hw_hammer",
  name: "Claw Hammer 16 oz",
  image: "",
  unit: "pcs",
  priceCents: 3500,
  active: true,
  tracksTail: false,
  stockMilli: null,
  sortOrder: 5,
  tiers: [],
};

describe("POS UI & Touch Interaction: Auto Numpad Trigger Logic", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("automatically triggers NumpadDialog for kg items immediately on item selection", () => {
    const cart = useCart();
    cart.add(weighableNails);
    expect(cart.lines.length).toBe(1);
    expect(cart.activeUid).not.toBeNull();
    expect(shouldAutoTriggerNumpad(weighableNails.unit)).toBe(true);
  });

  it("automatically triggers NumpadDialog for ft items immediately on item selection", () => {
    const cart = useCart();
    cart.add(measurablePipe);
    expect(cart.lines.length).toBe(1);
    expect(cart.activeUid).not.toBeNull();
    expect(shouldAutoTriggerNumpad(measurablePipe.unit)).toBe(true);
  });

  it("automatically triggers NumpadDialog for meter items immediately on item selection", () => {
    const cart = useCart();
    cart.add(measurableSteel);
    expect(cart.lines.length).toBe(1);
    expect(cart.activeUid).not.toBeNull();
    expect(shouldAutoTriggerNumpad(measurableSteel.unit)).toBe(true);
  });

  it("does not auto-trigger NumpadDialog for discrete count items (bag, pcs, box)", () => {
    const cart = useCart();
    cart.add(discreteCement);
    expect(cart.lines.length).toBe(1);
    expect(shouldAutoTriggerNumpad(discreteCement.unit)).toBe(false);
    expect(shouldAutoTriggerNumpad(discreteHammer.unit)).toBe(false);
    expect(shouldAutoTriggerNumpad("box")).toBe(false);
    expect(shouldAutoTriggerNumpad("roll")).toBe(false);
  });
});

describe("NumpadDialog: Dual-Tab Interface & Tare Deduction", () => {
  it("computes net weight correctly: Net = max(0, Gross - Tare)", () => {
    // Normal tare deduction: 15.5 kg gross, 0.5 kg tare pail -> 15.0 kg net
    const grossMilli = 15500;
    const tareMilli = 500;
    const netMilli = deductTare(grossMilli, tareMilli);
    expect(netMilli).toBe(15000);
    expect(netMilli / 1000).toBe(15.0);
  });

  it("clamps net weight to zero when tare exceeds gross weight", () => {
    // Tare weight 0.8 kg exceeds Gross reading 0.5 kg -> clamps to 0
    const grossMilli = 500;
    const tareMilli = 800;
    const netMilli = deductTare(grossMilli, tareMilli);
    expect(netMilli).toBe(0);
  });

  it("returns full gross weight when tare is zero", () => {
    const grossMilli = 3250;
    const tareMilli = 0;
    const netMilli = deductTare(grossMilli, tareMilli);
    expect(netMilli).toBe(3250);
    expect(netMilli / 1000).toBe(3.25);
  });

  it("rounds milli-units cleanly without floating-point drift", () => {
    // Gross: 1.234 kg (1234 milli), Tare: 0.123 kg (123 milli)
    const netMilli = deductTare(1234, 123);
    expect(netMilli).toBe(1111);
    expect(netMilli / 1000).toBe(1.111);
  });
});

describe("NumpadDialog: Target RM Budget Reverse Calculation", () => {
  const nailsItem: PricedItem = {
    id: 1,
    key: "hw_nails_kg",
    name: "Common Wire Nails 2\"",
    image: "",
    unit: "kg",
    priceCents: 1000, // RM 10.00 / kg base
    active: true,
    tracksTail: false,
    stockMilli: null,
    sortOrder: 1,
    tiers: [
      { id: 1, itemId: 1, minQtyMilli: 30000, priceCents: 800 }, // RM 8.00 / kg for >= 30 kg
      { id: 2, itemId: 1, minQtyMilli: 50000, priceCents: 700 }, // RM 7.00 / kg for >= 50 kg
    ],

  };

  it("reversely computes target quantity from target RM amount with base rate", () => {
    // Customer asks for "RM 20.00 of nails" at base RM 10.00/kg
    // 2000 cents * 1000 / 1000 cents = 2000 milli = 2.000 kg
    const targetCents = toCents(20.0);
    const result = reversePriceLine(nailsItem, targetCents);
    expect(result.qtyMilli).toBe(2000);
    expect(result.qtyMilli / 1000).toBe(2.0);
    expect(result.unitPriceCents).toBe(1000);
    expect(result.tier).toBeNull();
  });

  it("reversely computes target quantity from target RM amount with odd decimals", () => {
    // Customer asks for "RM 15.50 of nails" at base RM 10.00/kg
    // 1550 cents * 1000 / 1000 cents = 1550 milli = 1.550 kg
    const targetCents = toCents(15.5);
    const result = reversePriceLine(nailsItem, targetCents);
    expect(result.qtyMilli).toBe(1550);
    expect(result.qtyMilli / 1000).toBe(1.55);
  });

  it("dynamically triggers quantity break discount tier when target RM qualifies", () => {
    // RM 240.00 budget:
    // If evaluated at base RM 10.00/kg: 24.0 kg (< 30 kg threshold).
    // If evaluated at tier RM 8.00/kg: 24000 cents * 1000 / 800 cents = 30000 milli = 30.000 kg (Qualifies for tier!).
    const targetCents = toCents(240.0);
    const result = reversePriceLine(nailsItem, targetCents);
    expect(result.qtyMilli).toBe(30000);
    expect(result.qtyMilli / 1000).toBe(30.0);
    expect(result.unitPriceCents).toBe(800);
    expect(result.tier).not.toBeNull();
    expect(result.tier?.minQtyMilli).toBe(30000);
  });

  it("handles zero budget without division by zero errors", () => {
    const result = reversePriceLine(nailsItem, 0);
    expect(result.qtyMilli).toBe(0);
    expect(result.unitPriceCents).toBe(1000);
    expect(result.amountCents).toBe(0);
  });

  it("works with direct unit price cents using calcReverseQuantity", () => {
    // Pipe at RM 2.00 / ft, customer asks for RM 5.00
    // 500 cents * 1000 / 200 cents = 2500 milli = 2.500 ft
    const targetCents = toCents(5.0);
    const qtyMilli = calcReverseQuantity(targetCents, 200);
    expect(qtyMilli).toBe(2500);
    expect(qtyMilli / 1000).toBe(2.5);
  });
});

describe("PayDialog: Customer Decoupling & Checkout Selection", () => {
  const itemMap = new Map<number, PricedItem>([[weighableNails.id, weighableNails]]);
  const resolver = (line: { itemId?: number }) => itemMap.get(line.itemId ?? 0) ?? null;

  it("Walk-in selection defaults to zero-friction A-sequence invoice", () => {
    const prefix = determineCheckoutInvoicePrefix("walkin");
    expect(prefix).toBe("A");

    const draft = buildOrder(
      {
        method: "Cash",
        customerType: "walkin",
        lines: [{ itemId: weighableNails.id, qtyMilli: 1000 }],
      },
      resolver,
    );
    expect(draft.customerType).toBe("walkin");
    expect(determineInvoicePrefix(draft)).toBe("A");
    expect(formatInvNo(prefix, 1)).toBe("A-0001");
  });

  it("Contractor selection generates B-sequence invoice", () => {
    const prefix = determineCheckoutInvoicePrefix("contractor", "Ah Seng Construction");
    expect(prefix).toBe("B");

    const draft = buildOrder(
      {
        method: "Cash",
        customerType: "contractor",
        contractorName: "Ah Seng Construction",
        lines: [{ itemId: weighableNails.id, qtyMilli: 1000 }],
      },
      resolver,
    );
    expect(draft.customerType).toBe("contractor");
    expect(draft.contractorName).toBe("Ah Seng Construction");
    expect(determineInvoicePrefix(draft)).toBe("B");
    expect(formatInvNo(prefix, 1)).toBe("B-0001");
  });

  it("Contractor paying with Cash/Card/QR/Bank should NOT generate credit debt", () => {
    expect(shouldCreateCreditDebt("Cash")).toBe(false);
    expect(shouldCreateCreditDebt("Card")).toBe(false);
    expect(shouldCreateCreditDebt("QR")).toBe(false);
    expect(shouldCreateCreditDebt("Bank")).toBe(false);

    for (const method of ["Cash", "Card", "QR", "Bank"] as PaymentMethod[]) {
      const draft = buildOrder(
        {
          method,
          customerType: "contractor",
          contractorName: "Ah Seng Construction",
          lines: [{ itemId: weighableNails.id, qtyMilli: 1000 }],
        },
        resolver,
      );
      expect(shouldCreateCreditDebt(draft.method)).toBe(false);
    }
  });

  it("Contractor paying with Credit generates both B-invoice and credit debt", () => {
    expect(shouldCreateCreditDebt("Credit")).toBe(true);

    const draft = buildOrder(
      {
        method: "Credit",
        customerType: "contractor",
        contractorName: "Ah Seng Construction",
        lines: [{ itemId: weighableNails.id, qtyMilli: 1000 }],
      },
      resolver,
    );
    expect(shouldCreateCreditDebt(draft.method)).toBe(true);
    expect(determineInvoicePrefix(draft)).toBe("B");
    expect(draft.contractorName).toBe("Ah Seng Construction");
  });
});

describe("Delivery Order (DO) Flow & HTML Rendering", () => {
  const sampleDo: DeliveryOrder = {
    companyId: 1,
    businessDate: "2026-10-23",
    doNumber: "DO-0001",
    invNo: "B-0001",
    dateText: "23/10/2026 15:00",
    storeName: "Borneo Jasa Sdn. Bhd.",
    storeNameCn: "婆罗洲贸易有限公司",
    storeAddress: "Lot 12, Kolombong Industrial Estate, 88450 Kota Kinabalu, Sabah",
    regNo: "(227533-X)",
    tel: "088-385555",
    contractorName: "Ah Seng Construction",
    contractorTin: "C1234567890",
    contractorAddress: "Lot 42, Telipok Industrial Park, Sabah",
    contractorPhone: "012-3456789",
    siteAddress: "Tapak Projek Vista Minintod, Penampang",
    lorryPlate: "SABAH 8888",
    driverName: "Pak Mat",
    contractorPo: "PO-AS-2026-9921",
    showPriceOnDo: true,
    totalQtyMilli: 45500,
    totalQtyText: "45.500",
    lines: [
      {
        itemNo: 1,
        name: "Common Wire Nails 2\"",
        itemName: "Common Wire Nails 2\"",
        unit: "kg",
        qtyMilli: 15500,
        qtyText: "15.5 kg",
        unitPriceCents: 1000,
        unitPriceText: "RM 10.00/kg",
        lineAmountCents: 15500,
        amountText: "RM 155.00",
      },
      {
        itemNo: 2,
        name: "PVC Pipe Class D 1/2\"",
        itemName: "PVC Pipe Class D 1/2\"",
        unit: "ft",
        qtyMilli: 30000,
        qtyText: "30 ft",
        unitPriceCents: 200,
        unitPriceText: "RM 2.00/ft",
        lineAmountCents: 6000,
        amountText: "RM 60.00",
      },
    ],
    subtotalCents: 21500,
    subtotalText: "RM 215.00",
    totalAmountCents: 21500,
    totalText: "RM 215.00",
    signatories: {
      issuedBy: "Cashier Wong",
      deliveredBy: "Pak Mat",
      receivedBy: "Site Supervisor",
    },
  };

  it("renders dual-copy Store Copy and Customer Copy", () => {
    const html = renderDeliveryOrderHtml(sampleDo);
    expect(html).toContain("STORE COPY");
    expect(html).toContain("CUSTOMER COPY");
    expect(html).toContain("DO-0001");
    expect(html).toContain("Tapak Projek Vista Minintod, Penampang");
    expect(html).toContain("SABAH 8888");
    expect(html).toContain("Pak Mat");
  });

  it("renders 3 signature blocks on each copy", () => {
    const html = renderDeliveryOrderHtml(sampleDo);
    const issuedCount = (html.match(/ISSUED BY/gi) || []).length;
    const deliveredCount = (html.match(/DELIVERED BY/gi) || []).length;
    const receivedCount = (html.match(/RECEIVED BY/gi) || []).length;
    expect(issuedCount).toBe(2);
    expect(deliveredCount).toBe(2);
    expect(receivedCount).toBe(2);
  });

  it("suppresses prices when showPriceOnDo is false", () => {
    const hiddenDo: DeliveryOrder = {
      ...sampleDo,
      showPriceOnDo: false,
    };
    const html = renderDeliveryOrderHtml(hiddenDo);
    expect(html).not.toContain("U/P (RM)");
    expect(html).not.toContain("AMOUNT (RM)");
    expect(html).not.toContain("RM 155.00");
    expect(html).not.toContain("RM 215.00");
    // Descriptions and quantities remain
    expect(html).toContain("Common Wire Nails 2&quot;");
    expect(html).toContain("15.5 kg");
  });
});

describe("Payment Method Upgrade (Distinct Card, QR, and Bank Transfer)", () => {
  it("displays distinct payment methods in labels and PAYMENT_UI", () => {
    expect(L.qr).toBe("QR");
    expect(PAY_LABEL.QR).toBe("QR");
    expect(PAYMENT_UI.QR.label).toBe("QR");

    expect(L.card).toBe("Card / Kad");
    expect(PAY_LABEL.Card).toBe("Card / Kad");
    expect(PAYMENT_UI.Card.label).toBe("Card / Kad");

    expect(L.bank).toBe("Bank Transfer");
    expect(PAY_LABEL.Bank).toBe("Bank Transfer");
    expect(PAYMENT_UI.Bank.label).toBe("Bank Transfer");
  });
});

describe("Contractor navigation", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe("Vue Router Route Configuration", () => {
    it("registers /contractors route with dedicated section prop", () => {
      const routes = router.getRoutes();
      const contractorRoute = routes.find((r) => r.path === "/contractors");
      expect(contractorRoute).toBeDefined();
      expect(contractorRoute?.name).toBe("contractors");
      expect(contractorRoute?.props.default).toEqual({ section: "contractors" });
    });

    it("registers /item route with items section prop", () => {
      const routes = router.getRoutes();
      const itemRoute = routes.find((r) => r.path === "/item");
      expect(itemRoute).toBeDefined();
      expect(itemRoute?.name).toBe("admin");
      expect(itemRoute?.props.default).toEqual({ section: "items" });
    });

    it("resolves /contractors route properly", () => {
      const resolved = router.resolve("/contractors");
      expect(resolved.name).toBe("contractors");
      expect(resolved.path).toBe("/contractors");
    });
  });

  describe("TopBar Navigation Rendering", () => {
    it("renders Contractors button in 'till' mode", async () => {
      const app = createSSRApp(TopBar, { mode: "till" });
      app.use(createPinia());
      app.use(router);
      const html = await renderToString(app);

      expect(html).toContain("Contractors / Kontraktor");
      expect(html).toContain(L.history);
      expect(html).toContain(L.items);
      expect(html).not.toContain(L.till);
    });

    it("renders Contractors button with active highlight in 'contractors' mode", async () => {
      const app = createSSRApp(TopBar, { mode: "contractors" });
      app.use(createPinia());
      app.use(router);
      const html = await renderToString(app);

      expect(html).toContain("Contractors / Kontraktor");
      expect(html).toContain("border-ink bg-ink text-white");
      expect(html).toContain(L.till);
      expect(html).toContain(L.history);
      expect(html).not.toContain(L.report);
      expect(html).toContain(L.items);
    });

    it("renders Contractors button with normal style in 'admin' mode", async () => {
      const app = createSSRApp(TopBar, { mode: "admin" });
      app.use(createPinia());
      app.use(router);
      const html = await renderToString(app);

      expect(html).toContain("Contractors / Kontraktor");
      expect(html).toContain("border-border bg-surface text-ink");
      expect(html).toContain(L.till);
      expect(html).toContain(L.history);
      expect(html).not.toContain(L.report);
      // Items button is hidden in admin mode
      expect(html).not.toContain(`<span>${L.items}</span>`);
    });

    it("renders Contractors button in 'sales' and 'report' modes", async () => {
      for (const m of ["sales", "report"] as const) {
        const app = createSSRApp(TopBar, { mode: m });
        app.use(createPinia());
        app.use(router);
        const html = await renderToString(app);
        expect(html).toContain("Contractors / Kontraktor");
      }
    });
  });

  describe("AdminView Dedicated Section Rendering", () => {
    it("renders dedicated contractors directory and hides internal tab switcher when section='contractors'", async () => {
      const app = createSSRApp(AdminView, { section: "contractors" });
      app.use(createPinia());
      app.use(router);
      const html = await renderToString(app);

      // Dedicated contractor content rendered
      expect(html).toContain("Contractor Directory / Senarai Kontraktor");
      expect(html).toContain("Add Contractor");
      // Tab switcher hidden
      expect(html).not.toContain("Barangan");
      // Product catalogue actions not rendered
      expect(html).not.toContain("Import CSV");
    });

    it("renders dedicated items catalog and hides internal tab switcher when section='items'", async () => {
      const app = createSSRApp(AdminView, { section: "items" });
      app.use(createPinia());
      app.use(router);
      const html = await renderToString(app);

      // Catalogue content rendered
      expect(html).not.toContain("Import CSV");
      expect(html).toContain(L.items);
      // Tab switcher hidden
      expect(html).not.toContain("Barangan");
      // Contractor directory not rendered
      expect(html).not.toContain("Contractor Directory / Senarai Kontraktor");
      expect(html).not.toContain("Add Contractor");
    });
  });
});

describe("Weighing presets and Lain-lain", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe("NumpadDialog presets", () => {
    it("renders quick weight presets (100g, 250g, 500g, 1 kg, 5 kg) when unit is kg", async () => {
      const app = createSSRApp(NumpadDialog, {
        open: true,
        title: "Loose Nails 2\" — Qty",
        unit: "kg",
        initial: 1.0,
      });
      const html = await renderToString(app);

      expect(html).toContain("Quick Weight:");
      expect(html).toContain("100g");
      expect(html).toContain("250g");
      expect(html).toContain("500g");
      expect(html).toContain("1 kg");
      expect(html).toContain("5 kg");
      // Touch target >= 48px
      expect(html).toContain("min-h-48px");
      expect(html).toContain("border-2");
    });

    it("renders quick length presets (1, 3, 5, 10, 20) when unit is ft or meter", async () => {
      for (const unit of ["ft", "meter"] as const) {
        const app = createSSRApp(NumpadDialog, {
          open: true,
          title: `PVC Conduit — ${unit}`,
          unit,
          initial: 1.0,
        });
        const html = await renderToString(app);

        expect(html).toContain("Quick Length:");
        expect(html).toContain(">1<");
        expect(html).toContain(">3<");
        expect(html).toContain(">5<");
        expect(html).toContain(">10<");
        expect(html).toContain(">20<");
        expect(html).toContain("min-h-48px");
      }
    });

    it("renders dual-mode switcher for weighable/measurable items with unit price", async () => {
      const app = createSSRApp(NumpadDialog, {
        open: true,
        title: "Steel Bar",
        unit: "kg",
        unitPriceCents: 1000,
        initial: 1.0,
      });
      const html = await renderToString(app);

      expect(html).toContain("按重量/长度输入");
      expect(html).toContain("按客人给的钱算");
    });
  });

  describe("LainLainDialog Component Fast Hardware Entry", () => {
    it("renders 6 category tags with senior-friendly buttons", async () => {
      const app = createSSRApp(LainLainDialog, { open: true });
      const html = await renderToString(app);

      expect(html).toContain("选择快捷类型 / Pilih Kategori:");
      expect(html).toContain("杂项 Lain-lain");
      expect(html).toContain("螺丝 Skru");
      expect(html).toContain("铁钉 Paku");
      expect(html).toContain("人工 Upah");
      expect(html).toContain("车油 Tambang");
      expect(html).toContain("切割 Potong");
    });

    it("renders save-to-catalog toggle and calculator add button", async () => {
      const app = createSSRApp(LainLainDialog, { open: true });
      const html = await renderToString(app);

      expect(html).toContain("顺便存入商品库，下次直接点 / Simpan ke senarai barang");
      expect(html).toContain("加入账单");
    });

    it("adds kg and meter decimal quantities to cart via cart.addLainLain", () => {
      const cart = useCart();

      // Add 2.75 kg nails at RM 6.00/kg (600 cents)
      cart.addLainLain("Paku Payung", 600, 2.75, "kg");
      expect(cart.lines).toHaveLength(1);
      const line1 = cart.lines[0]!;
      expect(line1.item.unit).toBe("kg");
      expect(line1.qtyMilli).toBe(2750);
      expect(line1.customPriceCents).toBe(600);
      expect(cart.amountOf(line1)).toBe(1650); // 2.75 * 6.00 = 16.50 (1650 cents)

      // Add 12.5 meters cable at RM 3.20/meter (320 cents)
      cart.addLainLain("Wayar Elektrik", 320, 12.5, "meter");
      expect(cart.lines).toHaveLength(2);
      const line2 = cart.lines[1]!;
      expect(line2.item.unit).toBe("meter");
      expect(line2.qtyMilli).toBe(12500);
      expect(cart.amountOf(line2)).toBe(4000); // 12.5 * 3.20 = 40.00 (4000 cents)

      expect(cart.totalCents).toBe(5650);
    });
  });
});

describe("Settings: Google Drive and catalog CSV", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe("TopBar Settings Button Availability Across All Modes", () => {
    it("renders Settings button in 'till' mode", async () => {
      const app = createSSRApp(TopBar, { mode: "till" });
      app.use(createPinia());
      app.use(router);
      const html = await renderToString(app);

      expect(html).toContain(L.settings);
      expect(html).toContain(L.closeDay);
    });

    it("renders Settings button across 'sales', 'admin', 'report', 'contractors' modes", async () => {
      for (const m of ["sales", "admin", "report", "contractors"] as const) {
        const app = createSSRApp(TopBar, { mode: m });
        app.use(createPinia());
        app.use(router);
        const html = await renderToString(app);

        expect(html).toContain(L.settings);
      }
    });
  });

  describe("SettingsDialog Consolidated Drive Resend & CSV Management", () => {
    it("contains Drive upload/resend button, CSV import, and CSV export", async () => {
      const app = createSSRApp(SettingsDialog, { open: true });
      app.use(createPinia());
      app.use(router);
      const html = await renderToString(app);

      // Google Drive resend button
      expect(html).toContain("Upload / Resend Daily Report to Drive");
      expect(html).toContain("Google Drive Daily Report");

      // Item Catalog CSV import and export
      expect(html).toContain("Item Catalog CSV / Katalog Barangan CSV");
      expect(html).toContain("Import Items CSV");
      expect(html).toContain("Export Items to CSV");
      expect(html).toContain('accept=".csv"');
    });
  });

  describe("Redundant Button Cleanup Across Views", () => {
    it("SalesView no longer renders Download Excel or Resend to Drive buttons", async () => {
      const app = createSSRApp(SalesView);
      app.use(createPinia());
      app.use(router);
      const html = await renderToString(app);

      expect(html).not.toContain(L.downloadExcel);
      expect(html).not.toContain(L.resendDrive);
      expect(html).not.toContain("Download Excel");
      expect(html).not.toContain("Resend to Drive");
    });

    it("ReportView retains Download Excel but no longer renders Resend to Drive button", async () => {
      const app = createSSRApp(ReportView);
      app.use(createPinia());
      app.use(router);
      const html = await renderToString(app);

      // Retains Download Excel
      expect(html).toContain(L.downloadExcel);

      // Does NOT render Resend to Drive
      expect(html).not.toContain(L.resendDrive);
      expect(html).not.toContain("Resend to Drive");
    });

    it("AdminView no longer renders Import CSV button", async () => {
      for (const sec of ["items", "contractors"] as const) {
        const app = createSSRApp(AdminView, { section: sec });
        app.use(createPinia());
        app.use(router);
        const html = await renderToString(app);

        expect(html).not.toContain("Import CSV");
      }
    });
  });
});



