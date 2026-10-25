<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  buildDeliveryOrder,
  buildReceipt,
  fmtMoney,
  HARDWARE_CATEGORIES,
  HARDWARE_CATEGORY_I18N,
  STORE_ADDRESS,
  toCents,
  toRM,
  unitLabel,
  type HardwareCategory,
  type PaymentMethod,
} from "@yf/core";
import { PauseCircle, PlusCircle, Printer, Trash2, X } from "lucide-vue-next";
import TopBar from "../components/TopBar.vue";
import ProductCard from "../components/ProductCard.vue";
import SpecPickerDialog from "../components/SpecPickerDialog.vue";
import CartLine from "../components/CartLine.vue";
import PayDialog, { type PayCheckoutPayload } from "../components/PayDialog.vue";
import HoldOrdersDialog from "../components/HoldOrdersDialog.vue";
import NumpadDialog from "../components/NumpadDialog.vue";
import LainLainDialog from "../components/LainLainDialog.vue";
import { useCatalog, type ProductGroup } from "../stores/catalog";
import { useCart } from "../stores/cart";
import { useUi } from "../stores/ui";
import { currentCompany } from "../place";
import { printer, printHtml } from "../printing/printer";
import { renderDeliveryOrderHtml } from "../printing/renderDeliveryOrderHtml";
import { getRepo } from "../db";
import { L } from "../labels";
import { currentLocale } from "../settings";
import { shouldAutoTriggerNumpad } from "../interactions";

const catalog = useCatalog();
const cart = useCart();
const ui = useUi();
const payOpen = ref(false);
const holdOpen = ref(false);
const lainLainOpen = ref(false);
const confirmClear = ref(false);

const selectedCategory = ref<HardwareCategory>("All");
const searchQuery = ref("");
const specPickerGroup = ref<ProductGroup | null>(null);

const CATEGORY_COLORS: Record<HardwareCategory, string> = {
  "All": "#1e293b",
  "Cement & Brick": "#c2410c",
  "Board & Wood": "#854d0e",
  "Tank, Roof & Gutter": "#0284c7",
  "Door & Frame": "#7c2d12",
  "Plastic Pipe": "#0d9488",
  "Metal Pipe": "#475569",
  "Fence & Steel": "#4338ca",
  "Lain-lain": "#64748b",
};

function categoryDisplay(cat: HardwareCategory): { primary: string; secondary: string } {
  const loc = currentLocale.value;
  const entry = cat === "All"
    ? { en: "All", bm: "Semua", zh: "全部" }
    : (HARDWARE_CATEGORY_I18N[cat] || { en: String(cat), bm: String(cat), zh: String(cat) });

  if (loc === "zh") {
    return { primary: entry.zh || entry.en, secondary: entry.en };
  }
  if (loc === "ms") {
    return { primary: entry.bm || entry.en, secondary: entry.en };
  }
  return { primary: entry.en, secondary: entry.bm };
}

const filteredGroups = computed<ProductGroup[]>(() => {
  const q = searchQuery.value.trim().toLowerCase();
  const result: ProductGroup[] = [];
  for (const g of catalog.groups) {
    if (selectedCategory.value !== "All" && g.category !== selectedCategory.value) {
      continue;
    }
    if (!q) {
      result.push(g);
      continue;
    }
    if (g.groupName.toLowerCase().includes(q)) {
      result.push(g);
      continue;
    }
    const matchingItems = g.items.filter((it) => it.name.toLowerCase().includes(q));
    if (matchingItems.length > 0) {
      result.push({
        ...g,
        items: matchingItems,
      });
    }
  }
  return result;
});

function groupCartCount(g: ProductGroup): number {
  let count = 0;
  for (const it of g.items) {
    if (cart.lines.some((l) => l.item.id === it.id)) count++;
  }
  return count;
}

function onSelectGroup(g: ProductGroup): void {
  if (g.items.length === 1) {
    addItem(g.items[0]!);
  } else {
    specPickerGroup.value = g;
  }
}

function onPickSpec(item: Parameters<typeof cart.add>[0]): void {
  specPickerGroup.value = null;
  addItem(item);
}

function onAddLainLain(payload: { label: string; priceCents: number; qtyUnits: number; unit?: import("@yf/core").Unit }): void {
  lainLainOpen.value = false;
  cart.addLainLain(payload.label, payload.priceCents, payload.qtyUnits, payload.unit);
}

onMounted(() => void catalog.load());

const active = computed(() => cart.active);
watch(
  () => cart.lines.length,
  (len) => {
    if (len === 0) confirmClear.value = false;
  },
);

function handleClearCart(): void {
  if (cart.lines.length === 0) return;
  if (!confirmClear.value) {
    confirmClear.value = true;
    return;
  }
  cart.clear();
  confirmClear.value = false;
}

function addItem(item: Parameters<typeof cart.add>[0]): void {
  cart.add(item);
  if (shouldAutoTriggerNumpad(item.unit)) {
    if (cart.activeUid != null) {
      openNumpad(cart.activeUid, "qty");
    }
  }
}
function selectLine(uid: number): void {
  cart.select(uid);
}
function stepLine(uid: number, deltaUnits: number): void {
  cart.step(uid, deltaUnits);
}

// numpad: tap any quantity or unit price to type it directly
const numpadUid = ref<number | null>(null);
const numpadMode = ref<"qty" | "price">("qty");
const numpadLine = computed(() =>
  numpadUid.value == null ? null : (cart.lines.find((l) => l.uid === numpadUid.value) ?? null),
);
function openNumpad(uid?: number, mode: "qty" | "price" = "qty"): void {
  const id = uid ?? active.value?.uid ?? null;
  if (id != null) {
    numpadMode.value = mode;
    numpadUid.value = id;
  }
}
function confirmNumpad(value: number): void {
  const line = numpadLine.value;
  if (numpadUid.value != null && line) {
    if (numpadMode.value === "price") {
      cart.setUnitPrice(numpadUid.value, toCents(value));
    } else {
      cart.setQty(numpadUid.value, value);
    }
  }
  numpadUid.value = null;
}
function onResetPriceInNumpad(): void {
  if (numpadUid.value != null) {
    cart.resetUnitPrice(numpadUid.value);
  }
  numpadUid.value = null;
}

function openPay(): void {
  if (cart.totalCents <= 0) return;
  payOpen.value = true;
}

async function reprintLastReceipt(): Promise<void> {
  const order = cart.lastOrder;
  if (!order) return;
  const repo = await getRepo();
  let contractor: { name: string; tin?: string; address?: string; phone?: string } | undefined;
  const cName = order.contractorName ?? order.creditorName;
  if (cName) {
    const matched = await repo.getContractorByName(cName, order.companyId);
    contractor = matched
      ? { name: matched.name, tin: matched.tin, address: matched.address, phone: matched.phone }
      : {
          name: cName,
          tin: order.contractorTin,
          address: order.contractorAddress,
          phone: order.contractorPhone,
        };
  }
  try {
    await printer.print(
      buildReceipt(order, {
        storeName: currentCompany.value.name,
        storeAddress: STORE_ADDRESS,
        ...(contractor ? { contractor } : {}),
      }),
    );
    ui.showToast(`已重印小票 #${order.invNo}`);
  } catch {
    ui.showToast("Printing failed");
  }
}

async function confirm(method: PaymentMethod, options?: PayCheckoutPayload): Promise<void> {
  const repo = await getRepo();

  if (options?.saveAsContractor && options.contractorName?.trim()) {
    try {
      const name = options.contractorName.trim();
      const existing = await repo.getContractorByName(name, currentCompany.value.id);
      if (!existing) {
        await repo.createContractor({
          companyId: currentCompany.value.id,
          name,
          phone: options.contractorPhone ?? "",
          tin: options.contractorTin ?? "",
          address: options.contractorAddress ?? "",
          active: true,
        });
      } else {
        const patch: import("@yf/core").ContractorPatch = {};
        if (!existing.active) patch.active = true;
        if (options.contractorPhone && options.contractorPhone !== existing.phone) patch.phone = options.contractorPhone;
        if (options.contractorTin && options.contractorTin !== existing.tin) patch.tin = options.contractorTin;
        if (options.contractorAddress && options.contractorAddress !== existing.address) patch.address = options.contractorAddress;
        if (Object.keys(patch).length > 0) {
          await repo.updateContractor(existing.id, patch);
        }
      }
    } catch {
      // Ignore conflict
    }
  }

  let order;
  try {
    order = await cart.pay(method, options);
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : "Payment failed");
    return;
  } finally {
    payOpen.value = false;
  }
  if (order) {
    ui.showToast(`Payment complete · ${method} · ${fmtMoney(order.totalCents)}`);
    void catalog.load();

    // Check if DO was requested
    if (order.issueDo || order.doNumber || order.siteAddress || options?.issueDo) {
      try {
        const doModel = buildDeliveryOrder(order, {
          company: {
            name: currentCompany.value.name,
            address: STORE_ADDRESS,
          },
        });
        const doHtml = renderDeliveryOrderHtml(doModel);
        void printHtml(doHtml).catch(() => ui.showToast("DO printing failed"));
      } catch (err) {
        console.error("Failed to render DO HTML", err);
      }
    }

    let contractor: { name: string; tin?: string; address?: string; phone?: string } | undefined;
    const cName = order.contractorName ?? order.creditorName ?? options?.contractorName;
    if (cName) {
      const matched = await repo.getContractorByName(cName, order.companyId);
      contractor = matched
        ? { name: matched.name, tin: matched.tin, address: matched.address, phone: matched.phone }
        : {
            name: cName,
            tin: order.contractorTin ?? options?.contractorTin,
            address: order.contractorAddress ?? options?.contractorAddress,
            phone: order.contractorPhone ?? options?.contractorPhone,
          };
    }

    void printer
      .print(
        buildReceipt(order, {
          storeName: currentCompany.value.name,
          storeAddress: STORE_ADDRESS,
          ...(contractor ? { contractor } : {}),
        }),
      )
      .catch(() => ui.showToast("Printing failed"));
  }
}
</script>

<template>
  <TopBar mode="till" />

  <h1 class="sr-only">Till / Kaunter</h1>

  <!-- 15.6" Full HD (1920 × 1080) Fixed 3-Column Ergonomic Layout -->
  <div class="flex-1 flex min-h-0 bg-ground">
    <!-- 1. Left Category Rail (Fixed 252px width, Zero Scroll, 10px Semantic Accent Bars) -->
    <aside class="w-252px flex-none flex flex-col justify-between gap-8px px-10px pb-10px pt-6px min-h-0 select-none">
      <div class="flex flex-col gap-8px">
        <button
          v-for="cat in HARDWARE_CATEGORIES"
          :key="cat"
          type="button"
          class="relative h-68px min-h-68px px-14px py-8px rounded-8px text-left cursor-pointer press flex flex-col justify-center transition-colors border border-border"
          :style="{
            borderLeftWidth: '10px',
            borderLeftStyle: 'solid',
            borderLeftColor: CATEGORY_COLORS[cat] || '#1e293b',
          }"
          :class="
            selectedCategory === cat
              ? 'bg-surface border-ink shadow-sm'
              : 'bg-[#fafaf9] hover:bg-surface text-ink'
          "
          @click="selectedCategory = cat"
        >
          <span class="text-16px font-800 leading-tight text-ink truncate">
            {{ categoryDisplay(cat).primary }}
          </span>
          <span class="text-13px font-600 leading-tight text-muted truncate mt-2px">
            {{ categoryDisplay(cat).secondary }}
          </span>
        </button>
      </div>

      <!-- Pinned Bottom Quick-Add: + Lain-lain -->
      <button
        type="button"
        class="h-68px min-h-68px px-14px py-8px rounded-8px text-left cursor-pointer press flex items-center gap-12px flex-none border border-border bg-[#fafaf9] hover:bg-surface transition-colors"
        style="border-left-width: 10px; border-left-style: solid; border-left-color: #6d28d9"
        @click="lainLainOpen = true"
      >
        <PlusCircle class="w-24px h-24px text-[#6d28d9] flex-none" />
        <div class="min-w-0 flex flex-col">
          <span class="text-16px font-800 text-ink leading-tight">+ Lain-lain</span>
          <span class="text-12px font-600 text-muted leading-tight mt-2px">杂项 · 快速输入价钱</span>
        </div>
      </button>
    </aside>

    <!-- Inset White Work Sheet (Center Grid + Right Cart) -->
    <div
      class="flex-1 flex bg-surface border border-border rounded-12px mr-10px mb-10px overflow-hidden min-h-0 min-w-0"
    >
      <!-- 2. Center Product Grid (flex-1, ~1128px width) -->
      <div class="flex-1 flex flex-col gap-14px p-16px min-w-0 min-h-0 border-r border-border">
        <!-- Large Search Bar (64px height) with Big Clear Button -->
        <div class="flex items-center gap-10px flex-none">
          <div class="relative flex-1">
            <input
              v-model="searchQuery"
              type="text"
              :placeholder="L.searchPlaceholder || '输入商品名称或规格数字 (如: 12, 4寸, Plywood)...'"
              class="w-full h-64px px-18px rounded-10px border-2 border-border focus:border-ink bg-surface text-18px font-700 text-ink outline-none transition-colors"
            />
          </div>
          <button
            v-if="searchQuery"
            type="button"
            class="h-64px px-20px rounded-10px border-2 border-negative bg-[#fee2e2] text-negative text-16px font-800 cursor-pointer press flex items-center gap-6px flex-none hover:bg-negative hover:text-white transition-colors"
            @click="searchQuery = ''"
          >
            <X class="w-20px h-20px flex-none" />
            <span>{{ L.clear }}</span>
          </button>
        </div>

        <!-- 4-Column Product Cards Grid (12px gap, 132px card height) -->
        <div
          class="product-grid flex-1 min-h-0 grid grid-cols-4 gap-12px overflow-y-auto content-start pr-2px"
          style="grid-auto-rows: 132px"
        >
          <ProductCard
            v-for="group in filteredGroups"
            :key="group.groupName"
            :group="group"
            :in-cart-count="groupCartCount(group)"
            @select="onSelectGroup(group)"
          />
        </div>
      </div>

      <!-- 3. Right Current Sale (Cart) Panel (Fixed 540px width) -->
      <div class="cart-pane w-540px flex-none flex flex-col bg-surface min-h-0">
        <!-- Cart Header -->
        <div class="flex items-center justify-between gap-8px px-16px py-14px border-b border-border flex-none">
          <div class="flex items-center gap-8px min-w-0">
            <span class="text-18px font-800 text-ink whitespace-nowrap">{{ L.currentSale }}</span>
            <span
              v-if="cart.activeHoldLabel"
              class="px-8px py-3px rounded-4px bg-[#fffbeb] border border-[#fde68a] text-13px font-700 text-warning truncate"
            >
              {{ cart.activeHoldLabel }}
            </span>
          </div>
          <div class="flex items-center gap-6px flex-none">
            <!-- Quick Reprint Last Receipt Button -->
            <button
              v-if="cart.lastOrder"
              type="button"
              class="press h-46px px-12px rounded-6px border border-border bg-surface text-14px font-700 text-ink cursor-pointer flex items-center gap-6px hover:border-ink"
              :title="L.reprintLast || '重印上一单'"
              @click="reprintLastReceipt"
            >
              <Printer class="w-16px h-16px text-muted flex-none" />
              <span>{{ L.reprintLast || "重印上一单" }}</span>
            </button>

            <!-- Held Orders Button -->
            <button
              type="button"
              class="press h-46px px-12px rounded-6px border text-14px font-700 cursor-pointer flex items-center gap-6px num"
              :class="
                cart.heldOrders.length > 0
                  ? 'bg-[#fffbeb] border-warning text-warning font-800'
                  : 'bg-surface border-border text-muted hover:border-control'
              "
              @click="holdOpen = true"
            >
              <PauseCircle class="w-16px h-16px flex-none" />
              <span>{{ L.held }}</span>
              <span class="font-800">({{ cart.heldOrders.length }})</span>
            </button>

            <!-- Clear Cart Button -->
            <button
              v-if="cart.lines.length > 0"
              type="button"
              class="press h-46px px-12px rounded-6px border text-14px font-700 cursor-pointer flex items-center gap-6px"
              :class="
                confirmClear
                  ? 'bg-negative border-negative text-white'
                  : 'bg-surface border-border text-muted hover:text-ink'
              "
              @click="handleClearCart"
            >
              <Trash2 class="w-15px h-15px flex-none" />
              <span>{{ confirmClear ? "Confirm?" : L.clear }}</span>
            </button>
          </div>
        </div>

        <!-- Column Headers -->
        <div
          v-if="cart.lines.length"
          class="flex items-center justify-between px-16px py-6px border-b border-borderSoft bg-panel/50 text-13px font-700 text-muted flex-none"
        >
          <span>{{ L.item }}</span>
          <span>{{ L.qty }} / {{ L.amount }}</span>
        </div>

        <!-- Cart Lines List (Rock-solid rows, No expandable trays) -->
        <div class="flex-1 overflow-y-auto p-12px flex flex-col gap-8px min-h-0">
          <div
            v-if="cart.lines.length === 0"
            class="flex-1 flex flex-col items-center justify-center gap-14px text-muted py-40px text-center"
          >
            <div class="text-18px font-700 text-muted">{{ L.tapToStart }}</div>
            <div class="flex flex-wrap gap-10px justify-center">
              <button
                type="button"
                class="min-h-52px px-18px rounded-6px border border-ink bg-surface text-15px font-700 text-ink cursor-pointer press inline-flex items-center gap-8px"
                @click="lainLainOpen = true"
              >
                <PlusCircle class="w-18px h-18px" />
                <span>{{ L.lainLain }}</span>
              </button>
              <button
                v-if="cart.heldOrders.length > 0"
                type="button"
                class="min-h-52px px-18px rounded-6px border border-warning bg-[#fffbeb] text-15px font-800 text-warning cursor-pointer press inline-flex items-center gap-8px num"
                @click="holdOpen = true"
              >
                <PauseCircle class="w-18px h-18px" />
                <span>{{ L.held }} ({{ cart.heldOrders.length }})</span>
              </button>
            </div>
          </div>

          <CartLine
            v-for="line in cart.lines"
            :key="line.uid"
            :line="line"
            :active="line.uid === cart.activeUid"
            :amount-cents="cart.amountOf(line)"
            @select="selectLine(line.uid)"
            @step="(d) => stepLine(line.uid, d)"
            @edit="openNumpad(line.uid, 'qty')"
            @edit-price="openNumpad(line.uid, 'price')"
            @reset-price="cart.resetUnitPrice(line.uid)"
            @remove="cart.remove(line.uid)"
          />
        </div>

        <!-- Checkout Footer: Subtotal / Discount / Loud Total RM / Hold + Green Pay Button -->
        <div class="px-16px py-16px border-t border-border bg-surface flex-none">
          <div
            v-if="cart.totalDiscountCents > 0"
            class="flex items-center justify-between text-14px font-700 text-muted mb-8px num"
          >
            <span>{{ L.subtotal }}: {{ fmtMoney(cart.grossSubtotalCents) }}</span>
            <span class="text-negative font-800">{{ L.discount }}: -{{ fmtMoney(cart.totalDiscountCents) }}</span>
          </div>

          <div class="flex items-baseline justify-between mb-14px">
            <span class="text-16px font-700 text-muted">{{ L.total }}</span>
            <span class="text-36px font-800 text-ink leading-none whitespace-nowrap num">
              {{ fmtMoney(cart.totalCents) }}
            </span>
          </div>

          <div class="flex gap-10px">
            <button
              v-if="cart.lines.length > 0"
              type="button"
              class="press h-68px px-20px rounded-8px border-2 border-control bg-surface text-17px font-800 text-ink cursor-pointer flex-none whitespace-nowrap inline-flex items-center gap-8px hover:border-ink"
              :title="L.hold"
              @click="holdOpen = true"
            >
              <PauseCircle class="w-20px h-20px text-muted" />
              <span>{{ L.hold }}</span>
            </button>
            <button
              type="button"
              class="btn-pay flex-1 h-68px text-22px font-800 rounded-8px"
              :disabled="cart.totalCents <= 0"
              @click="openPay"
            >
              {{ L.pay }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <SpecPickerDialog
    :group="specPickerGroup"
    @pick="onPickSpec"
    @close="specPickerGroup = null"
  />

  <LainLainDialog
    :open="lainLainOpen"
    @add="onAddLainLain"
    @close="lainLainOpen = false"
  />

  <HoldOrdersDialog
    :open="holdOpen"
    @close="holdOpen = false"
  />

  <PayDialog
    :open="payOpen"
    :lines-subtotal-cents="cart.linesSubtotalCents"
    :gross-subtotal-cents="cart.grossSubtotalCents"
    :total-discount-cents="cart.totalDiscountCents"
    :bill-discount-cents="cart.billDiscountCents"
    :total-cents="cart.totalCents"
    @confirm="confirm"
    @set-final-total="cart.setFinalTotal"
    @set-bill-discount="cart.setBillDiscount"
    @clear-bill-discount="cart.clearBillDiscount"
    @close="payOpen = false"
  />

  <NumpadDialog
    :open="numpadLine !== null"
    :title="`${numpadLine ? cart.displayNameOf(numpadLine) : ''} — ${numpadMode === 'price' ? L.unitPrice : L.qty}`"
    :unit="numpadMode === 'price' ? undefined : unitLabel(numpadLine?.item.unit ?? 'pcs')"
    :money="numpadMode === 'price'"
    :initial="numpadLine ? (numpadMode === 'price' ? toRM(cart.unitCentsOf(numpadLine)) : numpadLine.qtyMilli / 1000) : 0"
    :item="numpadLine?.item"
    :unit-price-cents="numpadLine ? cart.unitCentsOf(numpadLine) : undefined"
    @confirm="confirmNumpad"
    @reset-price="onResetPriceInNumpad"
    @close="numpadUid = null"
  />
</template>

<style scoped>
@media (max-width: 1180px) {
  .cart-pane {
    width: 440px;
  }
}
</style>
