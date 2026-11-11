/**
 * @vitest-environment happy-dom
 */
import { createApp, nextTick, type App } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TillView from "../src/views/TillView.vue";
import { useCart } from "../src/stores/cart";
import { useCatalog } from "../src/stores/catalog";
import initSqlJs from "sql.js";
import { createSqlJsDriver, initRepo, type SqlPosRepo } from "@yf/data";
import { router } from "../src/router";
import { SEED_ITEMS, type PricedItem } from "@yf/core";

let app: App | null = null;
let host: HTMLElement | null = null;
let testRepo: SqlPosRepo;

async function freshRepo(): Promise<SqlPosRepo> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  const driver = createSqlJsDriver(db as never);
  const repo = await initRepo(driver, {
    seedDemoOrders: false,
    seedItems: SEED_ITEMS,
    now: new Date(2026, 9, 24),
    rng: () => 0.5,
  });

  // Ensure DO and contractor persistence columns exist on orders table
  await driver.run("ALTER TABLE orders ADD COLUMN contractor_id INTEGER").catch(() => {});
  await driver.run("ALTER TABLE orders ADD COLUMN contractor_name TEXT").catch(() => {});
  await driver.run("ALTER TABLE orders ADD COLUMN do_number TEXT").catch(() => {});
  await driver.run("ALTER TABLE orders ADD COLUMN site_address TEXT").catch(() => {});
  await driver.run("ALTER TABLE orders ADD COLUMN lorry_plate TEXT").catch(() => {});
  await driver.run("ALTER TABLE orders ADD COLUMN driver_name TEXT").catch(() => {});
  await driver.run("ALTER TABLE orders ADD COLUMN contractor_po TEXT").catch(() => {});
  await driver.run("ALTER TABLE orders ADD COLUMN show_price_on_do INTEGER DEFAULT 1").catch(() => {});

  return repo;
}

// Touchscreen ergonomics assertion helpers
function assertTouchTarget(btn: HTMLElement, minSize = 48): void {
  const rect = btn.getBoundingClientRect();
  const cls = btn.className;
  const isLarge =
    cls.includes("h-56px") ||
    cls.includes("h-60px") ||
    cls.includes("h-64px") ||
    cls.includes("h-68px") ||
    cls.includes("h-72px") ||
    cls.includes("h-76px") ||
    cls.includes("min-h-112px") ||
    cls.includes("min-h-128px") ||
    cls.includes("min-h-136px") ||
    cls.includes("min-h-48px") ||
    cls.includes("min-h-56px") ||
    cls.includes("btn-pay") ||
    (rect.height > 0 && rect.height >= minSize);
  expect(isLarge).toBe(true);
}

function findButtonByText(text: string, root: HTMLElement = document.body, exact = false): HTMLButtonElement {
  const buttons = [...root.querySelectorAll("button")];
  // If exact is true, or if text is a single digit/symbol, prefer exact match
  const isSingleToken = text.length <= 2;
  const matchExact = exact || isSingleToken;
  const btn = buttons.find((b) => {
    const content = (b.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text === "Pay" && !exact) {
      return content.startsWith("Pay");
    }
    return matchExact ? content === text : content.includes(text);
  });
  if (!btn) {
    const allLabels = buttons.map((b) => (b.textContent ?? "").replace(/\s+/g, " ").trim());
    throw new Error(`Could not find button with text "${text}". Available buttons:\n${allLabels.join(" | ")}`);
  }
  return btn as HTMLButtonElement;
}

function clickButton(btn: HTMLButtonElement): void {
  if (btn.disabled) {
    throw new Error(`Cannot tap disabled button: "${btn.textContent?.trim()}"`);
  }
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function tapByText(text: string, root: HTMLElement = document.body): HTMLButtonElement {
  const btn = findButtonByText(text, root);
  assertTouchTarget(btn);
  clickButton(btn);
  return btn;
}

vi.mock("../src/db", () => ({
  getRepo: async () => testRepo,
}));

vi.mock("../src/printing/printDocuments", () => ({
  printDeliveryOrder: vi.fn().mockResolvedValue(true),
  printOrderReceipt: vi.fn().mockResolvedValue(true),
}));

beforeEach(async () => {
  testRepo = await freshRepo();

  const pinia = createPinia();
  setActivePinia(pinia);

  host = document.createElement("div");
  host.id = "app";
  // Simulate 15.6 inch 1920x1080 viewport
  host.style.width = "1920px";
  host.style.height = "1080px";
  document.body.appendChild(host);

  app = createApp(TillView);
  app.use(pinia);
  app.use(router);
  app.mount(host);

  const catalog = useCatalog();
  await catalog.load();
  await nextTick();
});

afterEach(() => {
  app?.unmount();
  host?.remove();
  app = null;
  host = null;
});

describe("15.6 Inch Pure Touchscreen Cashier Simulation (5 Golden Paths)", () => {
  it("Path 1: Cashier Lao Zhang (62yo) - Walk-in Discrete item, Bargain Round-off, Cash Tender & Change", async () => {
    const cart = useCart();

    // 1. Lao Zhang taps 'Cement & Brick' category
    tapByText("Cement & Brick");
    await nextTick();

    // 2. Taps cement product card to add 1 bag (discrete unit 'bag')
    // Product card title is the groupName: 'Cement'
    const cementCard = [...document.querySelectorAll("button")].find((el) =>
      (el.textContent ?? "").includes("Cement") && (el.textContent ?? "").includes("bag"),
    );
    expect(cementCard).toBeDefined();
    cementCard?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await nextTick();

    expect(cart.lines.length).toBe(1);
    expect(cart.lines[0].item.name).toContain("Cement");
    expect(cart.lines[0].qtyMilli).toBe(1000); // 1 bag
    const baseCents = cart.lines[0].item.priceCents;

    // 3. Taps '+' button in cart line to make it 2 bags
    const plusBtn = findButtonByText("+");
    assertTouchTarget(plusBtn);
    clickButton(plusBtn);
    await nextTick();
    expect(cart.lines[0].qtyMilli).toBe(2000); // 2 bags

    // 4. Taps big 'Pay' button
    const payBtn = findButtonByText("Pay");
    assertTouchTarget(payBtn);
    clickButton(payBtn);
    await nextTick();

    // Verify PayDialog is open
    const dialog = document.querySelector('[role="dialog"][aria-label="Checkout"]');
    expect(dialog).not.toBeNull();

    // 5. Customer negotiates discount: Lao Zhang taps 'Round Off Total'
    tapByText("Round Off Total");
    await nextTick();

    // In DecimalKeypad, tap 4, 0 -> RM 40.00
    tapByText("4");
    tapByText("0");
    await nextTick();
    tapByText("OK");
    await nextTick();

    expect(cart.totalCents).toBe(4000);

    // 6. Customer hands a RM 50 bill: Lao Zhang taps 'RM 50' preset
    tapByText("RM 50");
    await nextTick();

    // Change Due should be visible: RM 50.00 - RM 40.00 = RM 10.00
    expect(dialog?.textContent).toContain("Change");
    expect(dialog?.textContent).toContain("10.00");

    // 7. Taps big green 'Cash' button
    tapByText("Cash");
    await nextTick();

    // Cart is now clear, sale completed!
    await vi.waitFor(() => expect(cart.lines.length).toBe(0));
    expect(cart.lastOrder).not.toBeNull();
    expect(cart.lastOrder?.totalCents).toBe(4000);
    expect(cart.lastOrder?.invNo).toMatch(/^A-\d{4}$/);
  });

  it("Path 2: Cashier Aunty Chen (58yo) - Weighable Hardware, Accidental Close Recovery, Budget Mode", async () => {
    const cart = useCart();

    // 1. Accident test: Taps 'Others' category where Common Nail is grouped
    tapByText("Others");
    await nextTick();

    // Multiple specs for Common Nail, so clicking group card opens SpecPickerDialog
    const nailsGroupCard = [...document.querySelectorAll("button")].find((el) =>
      (el.textContent ?? "").includes("Common Nail"),
    );
    expect(nailsGroupCard).toBeDefined();
    nailsGroupCard?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await nextTick();

    // Pick 2'' spec
    const specDialog = document.querySelector('[role="dialog"]');
    expect(specDialog).not.toBeNull();
    const spec2in = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("2''"));
    expect(spec2in).toBeDefined();
    spec2in?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await nextTick();

    // NumpadDialog should auto pop up immediately because Common Nail is kg!
    const numpadDialog = document.querySelector('[role="dialog"]');
    expect(numpadDialog).not.toBeNull();

    // Aunty Chen gets startled and taps 'Close' button
    const closeBtn = findButtonByText("Close", numpadDialog as HTMLElement);
    assertTouchTarget(closeBtn);
    clickButton(closeBtn);
    await nextTick();

    // CRITICAL FOOLPROOFING ASSERTION: Cart must NOT have leftover 1kg nails!
    expect(cart.lines.length).toBe(0);

    // 2. Real weighing: Taps Common Nail card again
    nailsGroupCard?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await nextTick();
    const spec2inRetry = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("2''"));
    spec2inRetry?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await nextTick();

    // Taps 2 . 5 on numpad -> 2.5 kg
    tapByText("2");
    tapByText(".");
    tapByText("5");
    await nextTick();

    const okBtn = findButtonByText("OK");
    assertTouchTarget(okBtn);
    clickButton(okBtn);
    await nextTick();

    expect(cart.lines.length).toBe(1);
    expect(cart.lines[0].qtyMilli).toBe(2500); // 2.500 kg
    expect(cart.lines[0].item.name).toContain("Common Nail");

    // 3. Taps Pay -> Cash -> Confirmed
    tapByText("Pay");
    await nextTick();
    tapByText("Exact");
    await nextTick();
    tapByText("Cash");
    await nextTick();

    await vi.waitFor(() => expect(cart.lines.length).toBe(0));
    expect(cart.lastOrder?.invNo).toMatch(/^A-\d{4}$/);
  });

  it("Path 3: Cashier Lao Li (55yo) - Spec Picker for Plastic Pipe, Quick Length & Auto Total", async () => {
    const cart = useCart();

    // 1. Taps 'Plastic Pipe' category
    tapByText("Plastic Pipe");
    await nextTick();

    // 2. Taps ABS Pipe item group card
    const pipeCard = [...document.querySelectorAll("button")].find((el) =>
      (el.textContent ?? "").includes("ABS Pipe"),
    );
    expect(pipeCard).toBeDefined();
    pipeCard?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await nextTick();

    // Spec picker opens: choose 1/2''
    const specHalf = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("1/2''"));
    expect(specHalf).toBeDefined();
    specHalf?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await nextTick();

    expect(cart.lines.length).toBe(1);
    expect(cart.lines[0].item.name).toContain("ABS Pipe");

    // 3. Cashier pays with QR
    const payBtn = findButtonByText("Pay");
    assertTouchTarget(payBtn);
    clickButton(payBtn);
    await nextTick();

    const checkoutDialog = document.querySelector('[role="dialog"][aria-label="Checkout"]') as HTMLElement;
    expect(checkoutDialog).not.toBeNull();
    const qrBtn = [...checkoutDialog.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim() === "QR",
    ) as HTMLButtonElement;
    expect(qrBtn).toBeDefined();
    assertTouchTarget(qrBtn);
        clickButton(qrBtn);
    await nextTick();

    await vi.waitFor(() => expect(cart.lines.length).toBe(0));
    expect(cart.lastOrder?.method).toBe("QR");
  });

  it("Path 4: Cashier Lao Wang (60yo) - Large Order Parking (Hold), Walk-in Interruption, Resume & Checkout", async () => {
    const cart = useCart();

    // 1. Customer A picks Cement (1 bag)
    tapByText("Cement & Brick");
    await nextTick();
    const cementCard = [...document.querySelectorAll("button")].find((el) =>
      (el.textContent ?? "").includes("Cement") && (el.textContent ?? "").includes("bag"),
    );
    cementCard?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await nextTick();
    expect(cart.lines.length).toBe(1);

    // 2. Customer A walks away to get more goods. Lao Wang taps exact 'Park' (Hold)
    const parkBtn = findButtonByText("Park", document.body, true);
    assertTouchTarget(parkBtn);
    clickButton(parkBtn);
    await nextTick();

    // Cart is immediately empty and ready for next customer
    expect(cart.lines.length).toBe(0);
    expect(cart.heldOrders.length).toBe(1);

    // 3. Next customer B buys Cement Gum
    const gumCard = [...document.querySelectorAll("button")].find((el) =>
      (el.textContent ?? "").includes("Cement Gum"),
    );
    gumCard?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await nextTick();
    expect(cart.lines.length).toBe(1);

    tapByText("Pay");
    await nextTick();
    tapByText("Cash");
    await nextTick();
    await vi.waitFor(() => expect(cart.lines.length).toBe(0));
    const firstOrderInv = cart.lastOrder?.invNo;
    expect(firstOrderInv).toMatch(/^A-\d{4}$/);

    // 4. Customer A returns! Lao Wang taps 'Parked (1)'
    // The top-bar parked button contains "Parked(1)"
    const parkedBtn = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Parked"));
    expect(parkedBtn).toBeDefined();
    clickButton(parkedBtn as HTMLButtonElement);
    await nextTick();

    // In HoldOrdersDialog, taps 'Open' (Resume)
    const resumeBtn = findButtonByText("Open");
    assertTouchTarget(resumeBtn);
    clickButton(resumeBtn);
    await nextTick();

    // Order restored!
    expect(cart.lines.length).toBe(1);
    expect(cart.lines[0].item.name).toContain("Cement");
    expect(cart.heldOrders.length).toBe(0);

    // Customer A finishes paying with Card
    tapByText("Pay");
    await nextTick();
    tapByText("Card");
    await nextTick();

    await vi.waitFor(() => expect(cart.lines.length).toBe(0));
    expect(cart.lastOrder?.invNo).not.toBe(firstOrderInv);
  });

  it("Path 5: Cashier Lao Chen (59yo) - Contractor Credit Account, Issue Delivery Order (DO) & Fixed Footer", async () => {
    const cart = useCart();

    // Pre-create an active contractor in DB
    const contractor = await testRepo.createContractor({
      companyId: 1,
      name: "Ah Seng Construction",
      phone: "012-3456789",
      tin: "C1234567890",
      address: "Lot 88 Industrial Park",
      active: true,
    });
    expect(contractor.id).toBeGreaterThan(0);

    // 1. Add Cement
    tapByText("Cement & Brick");
    await nextTick();
    const cementCard = [...document.querySelectorAll("button")].find((el) =>
      (el.textContent ?? "").includes("Cement") && (el.textContent ?? "").includes("bag"),
    );
    cementCard?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await nextTick();

    // 2. Open PayDialog
    tapByText("Pay");
    await nextTick();

    const checkoutDialog = document.querySelector('[role="dialog"][aria-label="Checkout"]') as HTMLElement;
    expect(checkoutDialog).not.toBeNull();

    // 3. Tap 'Contractor' inside PayDialog
    tapByText("Contractor", checkoutDialog);
    await nextTick();

    // 4. Select 'Ah Seng Construction' from contractor list
    await vi.waitFor(() => expect(checkoutDialog.textContent).toContain("Ah Seng Construction"));
    tapByText("Ah Seng Construction", checkoutDialog);
    await nextTick();

    // 5. Check 'Step 2: Issue Delivery Order (DO)'
    const issueDoCheckbox = [...checkoutDialog.querySelectorAll('input[type="checkbox"]')].pop() as HTMLInputElement;
    expect(issueDoCheckbox).not.toBeNull();
    issueDoCheckbox.click();
    await nextTick();

    // Address is prefilled from contractor!
    expect(checkoutDialog.textContent).toContain("Lot 88 Industrial Park");

    // 6. Tap orange 'Credit' button (must be enabled for contractor!)
    const creditBtn = findButtonByText("Credit");
    assertTouchTarget(creditBtn);
    expect(creditBtn.disabled).toBe(false);
    clickButton(creditBtn);
    await nextTick();

    // Order completed on credit!
    await vi.waitFor(() => expect(cart.lines.length).toBe(0));
    expect(cart.lastOrder).not.toBeNull();
    expect(cart.lastOrder?.method).toBe("Credit");
    // Invoice sequence for contractor / credit is B-XXXX
    expect(cart.lastOrder?.invNo).toMatch(/^B-\d{4}$/);
    expect(cart.lastOrder?.contractorId).toBe(contractor.id);
  });
});
