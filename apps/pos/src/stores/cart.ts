import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import {
  createOrder,
  effectiveUnitPrice,
  appliedTier,
  lineAmount,
  toMilli,
  LAIN_LAIN_KEY,
  type Order,
  type PaymentMethod,
  type PricedItem,
  type Unit,
} from "@yf/core";
import { getRepo } from "../db";
import { currentCompany } from "../place";
import { currentBusinessDate } from "../business";
import { useCatalog } from "./catalog";
import { useCashier } from "./cashier";
import { shouldCreateCreditDebt } from "../interactions";

export interface CartLine {
  uid: number;
  item: PricedItem;
  qtyMilli: number;
  /** head count ("ekor") — legacy field kept at 0 for compatibility */
  tailCount: number;
  /** Cashier-overridden unit price in cents (when set, overrides catalogue/tier price) */
  customPriceCents?: number;
  /** Custom line display name (used for Lain-lain / ad-hoc items) */
  customName?: string;
}

export interface HeldOrderLine {
  itemId: number;
  itemSnapshot: PricedItem;
  qtyMilli: number;
  tailCount: number;
  customPriceCents?: number;
  customName?: string;
}

export interface HeldOrder {
  id: string;
  companyId: number;
  label: string;
  createdAt: number;
  lines: HeldOrderLine[];
  billDiscountCents?: number;
  totalCents: number;
}

export interface PayOptions {
  creditorName?: string;
  customerType?: "walkin" | "contractor";
  contractorId?: number | null;
  contractorName?: string;
  contractorTin?: string;
  customerTin?: string;
  contractorAddress?: string;
  customerAddress?: string;
  contractorPhone?: string;
  customerPhone?: string;
  issueDo?: boolean;
  doNumber?: string;
  doNo?: string;
  siteAddress?: string;
  lorryPlate?: string;
  driverName?: string;
  contractorPo?: string;
  showPriceOnDo?: boolean;
  cashierName?: string;
}

const HELD_STORAGE_KEY = "borneo-jasa-held-orders-v1";

function loadStoredHolds(): HeldOrder[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(HELD_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveStoredHolds(list: HeldOrder[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(HELD_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // ignore storage quota errors
  }
}

export const useCart = defineStore("cart", () => {
  const lines = ref<CartLine[]>([]);
  const activeUid = ref<number | null>(null);
  const activeHoldLabel = ref<string | null>(null);
  const billDiscountCents = ref<number>(0);
  const allHeldOrders = ref<HeldOrder[]>(loadStoredHolds());
  let nextUid = 1;
  let holdSeq = allHeldOrders.value.length + 1;

  watch(
    allHeldOrders,
    (val) => {
      saveStoredHolds(val);
    },
    { deep: true },
  );

  const heldOrders = computed(() =>
    allHeldOrders.value.filter((h) => h.companyId === currentCompany.value.id),
  );

  const active = computed(() => lines.value.find((l) => l.uid === activeUid.value) ?? null);

  /** Display name for a cart line (prefers customName for Lain-lain items). */
  const displayNameOf = (l: CartLine): string => l.customName?.trim() || l.item.name;

  /** Catalogue unit price in cents before manual cashier override. */
  const origUnitCentsOf = (l: CartLine): number =>
    l.item.priceCents > 0 ? effectiveUnitPrice(l.item, l.qtyMilli) : (l.customPriceCents ?? 0);

  /** Effective unit price in cents (respects manual cashier override). */
  const unitCentsOf = (l: CartLine): number =>
    l.customPriceCents !== undefined ? l.customPriceCents : effectiveUnitPrice(l.item, l.qtyMilli);

  /** Effective line total in cents. */
  const amountOf = (l: CartLine): number => lineAmount(unitCentsOf(l), l.qtyMilli);

  /** Line discount in cents when cashier lowered unit price below catalogue price. */
  const lineDiscountCentsOf = (l: CartLine): number => {
    const orig = origUnitCentsOf(l);
    const curr = unitCentsOf(l);
    if (l.item.priceCents > 0 && curr < orig) {
      return Math.max(0, lineAmount(orig, l.qtyMilli) - amountOf(l));
    }
    return 0;
  };

  /** True when the line has an overridden price different from catalogue price. */
  const hasCustomPrice = (l: CartLine): boolean =>
    l.customPriceCents !== undefined && l.customPriceCents !== l.item.priceCents;

  /** True when a line discount or quantity tier discount is active on this line. */
  const discounted = (l: CartLine): boolean =>
    lineDiscountCentsOf(l) > 0 || appliedTier(l.item, l.qtyMilli) !== null;

  /** Sum of line amounts (after per-line price overrides, before whole-bill discount). */
  const linesSubtotalCents = computed(() => lines.value.reduce((a, l) => a + amountOf(l), 0));

  /** Sum of all per-line discounts in cents. */
  const lineDiscountsTotalCents = computed(() =>
    lines.value.reduce((a, l) => a + lineDiscountCentsOf(l), 0),
  );

  /** Gross subtotal before both line discounts and whole-bill discount. */
  const grossSubtotalCents = computed(
    () => linesSubtotalCents.value + lineDiscountsTotalCents.value,
  );

  /** Whole-bill discount clamped to linesSubtotalCents. */
  const effectiveBillDiscountCents = computed(() =>
    Math.min(Math.max(0, billDiscountCents.value), linesSubtotalCents.value),
  );

  /** Combined discount (line discounts + whole-bill discount) in cents. */
  const totalDiscountCents = computed(
    () => lineDiscountsTotalCents.value + effectiveBillDiscountCents.value,
  );

  /** Final payable total in cents. */
  const totalCents = computed(() =>
    Math.max(0, linesSubtotalCents.value - effectiveBillDiscountCents.value),
  );

  function add(item: PricedItem): void {
    // Only merge into an existing line if it's a normal catalogue line without a custom name or custom price
    const ex = lines.value.find(
      (l) =>
        l.item.id === item.id &&
        l.item.key !== LAIN_LAIN_KEY &&
        !l.customName &&
        l.customPriceCents === undefined,
    );
    if (ex) {
      ex.qtyMilli += 1000;
      activeUid.value = ex.uid;
    } else {
      const uid = nextUid++;
      lines.value.push({ uid, item, qtyMilli: 1000, tailCount: 0 });
      activeUid.value = uid;
    }
  }

  /** Add an ad-hoc / Lain-lain line with custom label, unit price, quantity, and unit. */
  function addLainLain(
    label: string,
    priceCents: number,
    qtyUnits = 1,
    unit: Unit = "pcs",
  ): void {
    const cleanPrice = Math.max(0, Math.round(priceCents));
    if (cleanPrice <= 0) return;
    const cleanLabel = label.trim() || "Lain-lain";
    const cleanQtyMilli = Math.max(1, toMilli(qtyUnits));
    const effectiveUnit: Unit = unit || "pcs";
    const existingCatalogItem = catalog.items.find((i) => i.key === LAIN_LAIN_KEY);
    const lainItem: PricedItem = existingCatalogItem
      ? { ...existingCatalogItem, unit: effectiveUnit }
      : {
          id: 0,
          key: LAIN_LAIN_KEY,
          name: "Lain-lain",
          image: "",
          unit: effectiveUnit,
          priceCents: 0,
          active: true,
          tracksTail: false,
          stockMilli: null,
          sortOrder: 999999,
          tiers: [],
        };
    const uid = nextUid++;
    lines.value.push({
      uid,
      item: lainItem,
      qtyMilli: cleanQtyMilli,
      tailCount: 0,
      customPriceCents: cleanPrice,
      customName: cleanLabel,
    });
    activeUid.value = uid;
  }

  /** Override the unit price of a specific cart line in cents. */
  function setUnitPrice(uid: number, priceCents: number): void {
    const l = lines.value.find((x) => x.uid === uid);
    if (!l) return;
    activeUid.value = uid;
    l.customPriceCents = Math.max(0, Math.round(priceCents));
  }

  /** Reset a cart line's unit price back to the catalogue price. */
  function resetUnitPrice(uid: number): void {
    const l = lines.value.find((x) => x.uid === uid);
    if (!l || l.item.key === LAIN_LAIN_KEY) return;
    activeUid.value = uid;
    delete l.customPriceCents;
  }

  /** Set the whole-bill discount directly in cents. */
  function setBillDiscount(cents: number): void {
    billDiscountCents.value = Math.max(
      0,
      Math.min(linesSubtotalCents.value, Math.round(cents)),
    );
  }

  /** Set the final payable bill total in cents (computes whole-bill discount automatically). */
  function setFinalTotal(finalCents: number): void {
    const target = Math.max(0, Math.round(finalCents));
    billDiscountCents.value = Math.max(0, linesSubtotalCents.value - target);
  }

  function clearBillDiscount(): void {
    billDiscountCents.value = 0;
  }

  /** Adjust the active line by `deltaUnits` (e.g. 1, 5, 10, -1). */
  function adjust(deltaUnits: number): boolean {
    const l = active.value;
    if (!l) return false;
    l.qtyMilli = Math.max(0, l.qtyMilli + Math.round(deltaUnits * 1000));
    return false;
  }

  /** Step a specific line (used by the per-line +/- buttons), making it active. */
  function step(uid: number, deltaUnits: number): boolean {
    const l = lines.value.find((x) => x.uid === uid);
    if (!l) return false;
    activeUid.value = uid;
    l.qtyMilli = Math.max(0, l.qtyMilli + Math.round(deltaUnits * 1000));
    return false;
  }

  /** Set a line's quantity to an absolute value in units (from the numpad). */
  function setQty(uid: number, units: number): void {
    const l = lines.value.find((x) => x.uid === uid);
    if (!l) return;
    activeUid.value = uid;
    l.qtyMilli = Math.max(0, toMilli(units));
  }

  function adjustTail(delta: number): void {
    const l = active.value;
    if (!l) return;
    l.tailCount = Math.max(0, l.tailCount + Math.round(delta));
  }

  function stepTail(uid: number, delta: number): void {
    const l = lines.value.find((x) => x.uid === uid);
    if (!l) return;
    activeUid.value = uid;
    l.tailCount = Math.max(0, l.tailCount + Math.round(delta));
  }

  function setTail(uid: number, count: number): void {
    const l = lines.value.find((x) => x.uid === uid);
    if (!l) return;
    activeUid.value = uid;
    l.tailCount = Math.max(0, Math.round(count));
  }

  const missingTail = computed(() => null);

  function remove(uid: number): void {
    lines.value = lines.value.filter((l) => l.uid !== uid);
    if (activeUid.value === uid) {
      activeUid.value = lines.value.at(-1)?.uid ?? null;
    }
    if (lines.value.length === 0) {
      billDiscountCents.value = 0;
    }
  }

  function select(uid: number): void {
    activeUid.value = uid;
  }

  function clear(): void {
    lines.value = [];
    activeUid.value = null;
    activeHoldLabel.value = null;
    billDiscountCents.value = 0;
  }

  /**
   * Park (hold) the current cart lines under `customLabel` (or an auto-generated
   * "Hold #N" label) and clear the active cart for the next customer.
   */
  function holdCurrent(customLabel?: string): HeldOrder | null {
    const validLines = lines.value.filter((l) => l.qtyMilli > 0);
    if (validLines.length === 0) return null;
    const label =
      customLabel?.trim() ||
      activeHoldLabel.value?.trim() ||
      `Hold #${holdSeq++}`;
    const held: HeldOrder = {
      id: `hold_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      companyId: currentCompany.value.id,
      label,
      createdAt: Date.now(),
      billDiscountCents: effectiveBillDiscountCents.value,
      totalCents: totalCents.value,
      lines: validLines.map((l) => ({
        itemId: l.item.id,
        itemSnapshot: l.item,
        qtyMilli: l.qtyMilli,
        tailCount: l.tailCount,
        ...(l.customPriceCents !== undefined ? { customPriceCents: l.customPriceCents } : {}),
        ...(l.customName ? { customName: l.customName } : {}),
      })),
    };
    allHeldOrders.value = [held, ...allHeldOrders.value];
    clear();
    return held;
  }

  /**
   * Resume a held order into the active cart.
   * Blocked while the current cart has any lines — cashier must clear or pay first.
   */
  function resumeHeld(
    holdId: string,
    mode: "swap" | "merge" = "swap",
  ): { resumed: HeldOrder; blocked?: false } | { blocked: true; reason: "cart_not_empty" } | null {
    if (lines.value.length > 0) {
      return { blocked: true, reason: "cart_not_empty" };
    }
    const idx = allHeldOrders.value.findIndex((h) => h.id === holdId);
    if (idx < 0) return null;
    const target = allHeldOrders.value[idx]!;
    allHeldOrders.value = allHeldOrders.value.filter((h) => h.id !== holdId);

    const byId = new Map(catalog.items.map((i) => [i.id, i]));
    if (mode === "swap") {
      lines.value = target.lines.map((hl) => {
        const baseItem = (hl.itemId > 0 ? byId.get(hl.itemId) : undefined) ?? hl.itemSnapshot;
        const item =
          baseItem.key === LAIN_LAIN_KEY && hl.itemSnapshot.unit
            ? { ...baseItem, unit: hl.itemSnapshot.unit }
            : baseItem;
        return {
          uid: nextUid++,
          item,
          qtyMilli: hl.qtyMilli,
          tailCount: hl.tailCount,
          ...(hl.customPriceCents !== undefined ? { customPriceCents: hl.customPriceCents } : {}),
          ...(hl.customName ? { customName: hl.customName } : {}),
        };
      });
      billDiscountCents.value = target.billDiscountCents ?? 0;
      activeUid.value = lines.value.at(-1)?.uid ?? null;
      activeHoldLabel.value = target.label;
    } else {
      for (const hl of target.lines) {
        const baseLiveItem = (hl.itemId > 0 ? byId.get(hl.itemId) : undefined) ?? hl.itemSnapshot;
        const liveItem =
          baseLiveItem.key === LAIN_LAIN_KEY && hl.itemSnapshot.unit
            ? { ...baseLiveItem, unit: hl.itemSnapshot.unit }
            : baseLiveItem;
        const existing =
          !hl.customName && hl.customPriceCents === undefined && liveItem.key !== LAIN_LAIN_KEY
            ? lines.value.find(
                (l) =>
                  l.item.id === liveItem.id &&
                  !l.customName &&
                  l.customPriceCents === undefined,
              )
            : undefined;
        if (existing) {
          existing.qtyMilli += hl.qtyMilli;
          activeUid.value = existing.uid;
        } else {
          const uid = nextUid++;
          lines.value.push({
            uid,
            item: liveItem,
            qtyMilli: hl.qtyMilli,
            tailCount: hl.tailCount,
            ...(hl.customPriceCents !== undefined ? { customPriceCents: hl.customPriceCents } : {}),
            ...(hl.customName ? { customName: hl.customName } : {}),
          });
          activeUid.value = uid;
        }
      }
      billDiscountCents.value += target.billDiscountCents ?? 0;
      if (!activeHoldLabel.value) activeHoldLabel.value = target.label;
    }
    return { resumed: target };
  }

  /** Discard a held order without restoring it. */
  function discardHeld(holdId: string): void {
    allHeldOrders.value = allHeldOrders.value.filter((h) => h.id !== holdId);
  }

  watch(() => currentCompany.value.id, clear);

  const catalog = useCatalog();
  watch(
    () => catalog.items,
    (fresh) => {
      const byId = new Map(fresh.map((i) => [i.id, i]));
      for (const l of lines.value) {
        const updated = byId.get(l.item.id);
        if (updated) l.item = updated;
      }
    },
  );

  async function pay(
    method: PaymentMethod,
    creditorNameOrOptions?: string | PayOptions,
  ): Promise<Order | null> {
    const payable = lines.value.filter((l) => l.qtyMilli > 0);
    if (payable.length === 0 || totalCents.value <= 0) return null;
    const opts: PayOptions =
      typeof creditorNameOrOptions === "string"
        ? { creditorName: creditorNameOrOptions }
        : creditorNameOrOptions ?? {};

    const effectiveCreditor = opts.creditorName?.trim() || opts.contractorName?.trim();
    if (shouldCreateCreditDebt(method) && !effectiveCreditor) return null;

    const repo = await getRepo();
    const businessDate = await currentBusinessDate(currentCompany.value.id);
    const cashierStore = useCashier();
    const cashierName = opts.cashierName || cashierStore.currentCashier || undefined;
    const order = await createOrder(repo, {
      method,
      companyId: currentCompany.value.id,
      businessDate,
      discountCents: effectiveBillDiscountCents.value,
      ...opts,
      ...(cashierName ? { cashierName } : {}),
      ...(shouldCreateCreditDebt(method) ? { creditorName: effectiveCreditor } : {}),
      lines: payable.map((l) => ({
        itemId: l.item.id,
        key: l.item.key,
        qtyMilli: l.qtyMilli,
        unit: l.item.unit,
        ...(l.customPriceCents !== undefined ? { unitPriceCents: l.customPriceCents } : {}),
        ...(l.customName ? { customName: l.customName } : {}),
      })),
    });
    clear();
    return order;
  }


  return {
    lines,
    activeUid,
    active,
    linesSubtotalCents,
    grossSubtotalCents,
    lineDiscountsTotalCents,
    billDiscountCents: effectiveBillDiscountCents,
    totalDiscountCents,
    totalCents,
    missingTail,
    heldOrders,
    activeHoldLabel,
    displayNameOf,
    origUnitCentsOf,
    unitCentsOf,
    amountOf,
    amountCentsOf: amountOf,
    lineDiscountCentsOf,
    hasCustomPrice,
    discounted,
    add,
    addLainLain,
    setUnitPrice,
    resetUnitPrice,
    setBillDiscount,
    setFinalTotal,
    clearBillDiscount,
    adjust,
    step,
    setQty,
    adjustTail,
    stepTail,
    setTail,
    remove,
    select,
    clear,
    holdCurrent,
    resumeHeld,
    discardHeld,
    pay,
  };
});
