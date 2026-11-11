<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  fmtMoney,
  fmtQty,
  HARDWARE_CATEGORIES,
  LAIN_LAIN_KEY,
  categoryButtonLabel,
  matchesHardwareSearch,
  splitItemName,
  toCents,
  toRM,
  unitLabel,
  type HardwareCategory,
  type PaymentMethod,
} from "@yf/core";
import {
  ChevronRight,
  FileText,
  PauseCircle,
  Pencil,
  PlusCircle,
  Printer,
  Search,
  ShoppingBag,
  X,
} from "lucide-vue-next";
import TopBar from "../components/TopBar.vue";
import SpecPickerDialog from "../components/SpecPickerDialog.vue";
import PayDialog, { type PayCheckoutPayload } from "../components/PayDialog.vue";
import HoldOrdersDialog from "../components/HoldOrdersDialog.vue";
import NumpadDialog from "../components/NumpadDialog.vue";
import KeyboardDialog from "../components/KeyboardDialog.vue";
import { useCatalog, type ProductGroup } from "../stores/catalog";
import { useCart } from "../stores/cart";
import { useUi } from "../stores/ui";
import { currentCompany } from "../place";
import { getRepo } from "../db";
import { L } from "../labels";
import { shouldAutoTriggerNumpad } from "../interactions";
import { printDeliveryOrder, printOrderReceipt } from "../printing/printDocuments";

const catalog = useCatalog();
const cart = useCart();
const ui = useUi();
const payOpen = ref(false);
let paying = false;
const holdOpen = ref(false);
const noteOpen = ref(false);
const searchOpen = ref(false);
const confirmClear = ref(false);

const selectedCategory = ref<HardwareCategory>("All");
const searchQuery = ref("");
const specPickerGroup = ref<ProductGroup | null>(null);

function groupPriceText(g: ProductGroup): string {
  if (g.items.length === 1) {
    const only = g.items[0]!;
    return `${fmtMoney(only.priceCents)}`;
  }
  if (g.minPriceCents === g.maxPriceCents) {
    return fmtMoney(g.minPriceCents);
  }
  return `${fmtMoney(g.minPriceCents)}`;
}

function groupUnitText(g: ProductGroup): string {
  if (g.items.length === 1) {
    return `/ ${unitLabel(g.items[0]!.unit)}`;
  }
  if (g.minPriceCents !== g.maxPriceCents) {
    return "up";
  }
  return `/ ${unitLabel(g.items[0]?.unit ?? "pcs")}`;
}

function groupSingleSpec(g: ProductGroup): string {
  if (g.items.length !== 1) return "";
  return splitItemName(g.items[0]!.name).specLabel;
}

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

function categoryCount(cat: HardwareCategory): number {
  if (cat === "All") return catalog.groups.length;
  return catalog.groups.filter((g) => g.category === cat).length;
}

const filteredGroups = computed<ProductGroup[]>(() => {
  const q = searchQuery.value.trim();
  const result: ProductGroup[] = [];
  for (const g of catalog.groups) {
    if (!q && selectedCategory.value !== "All" && g.category !== selectedCategory.value) {
      continue;
    }
    if (!q) {
      result.push(g);
      continue;
    }
    const matchingItems = g.items.filter((it) => matchesHardwareSearch(it.name, q));
    if (matchingItems.length > 0) {
      const prices = matchingItems.map((i) => i.priceCents);
      result.push({
        ...g,
        items: matchingItems,
        minPriceCents: Math.min(...prices),
        maxPriceCents: Math.max(...prices),
      });
    } else if (matchesHardwareSearch(g.groupName, q)) {
      result.push(g);
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

function addCustomItem(): void {
  const uid = cart.addCustomLine();
  openNumpad(uid, "price");
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

function parkSale(): void {
  if (cart.lines.length === 0) return;
  const held = cart.holdCurrent("");
  if (held) ui.showToast(`Parked ${fmtMoney(held.totalCents)}`);
}

let pendingAutoNumpadUid: number | null = null;

function addItem(item: Parameters<typeof cart.add>[0]): void {
  cart.add(item);
  if (shouldAutoTriggerNumpad(item.unit)) {
    if (cart.activeUid != null) {
      pendingAutoNumpadUid = cart.activeUid;
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
function dropEmptyCustomLine(uid: number | null): void {
  const line = cart.lines.find((l) => l.uid === uid);
  if (line && line.item.key === LAIN_LAIN_KEY && line.customPriceCents === 0) cart.remove(line.uid);
}
function closeNumpad(): void {
  if (pendingAutoNumpadUid != null && pendingAutoNumpadUid === numpadUid.value) {
    cart.remove(pendingAutoNumpadUid);
    pendingAutoNumpadUid = null;
  }
  dropEmptyCustomLine(numpadUid.value);
  numpadUid.value = null;
}
function confirmNumpad(value: number): void {
  pendingAutoNumpadUid = null;
  const line = numpadLine.value;
  if (numpadUid.value != null && line) {
    if (numpadMode.value === "price") {
      cart.setUnitPrice(numpadUid.value, toCents(value));
      if (toCents(value) <= 0) dropEmptyCustomLine(numpadUid.value);
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
  try {
    await printOrderReceipt(order);
    ui.showToast(`${L.reprintReceiptSuccess} #${order.invNo}`);
  } catch {
    ui.showToast("Printing failed");
  }
}

async function confirm(method: PaymentMethod, options?: PayCheckoutPayload): Promise<void> {
  if (paying) return;
  paying = true;
  let order: Awaited<ReturnType<typeof cart.pay>> = null;
  try {
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
          if (options.contractorPhone && options.contractorPhone !== existing.phone)
            patch.phone = options.contractorPhone;
          if (options.contractorTin && options.contractorTin !== existing.tin)
            patch.tin = options.contractorTin;
          if (options.contractorAddress && options.contractorAddress !== existing.address)
            patch.address = options.contractorAddress;
          if (Object.keys(patch).length > 0) {
            await repo.updateContractor(existing.id, patch);
          }
        }
      } catch {
        // Ignore conflict
      }
    }

    try {
      order = await cart.pay(method, options);
    } catch (e) {
      console.error("Cart.pay failed with exception:", e);
      ui.showToast(e instanceof Error ? e.message : "Payment failed");
      return;
    }
  } finally {
    paying = false;
    payOpen.value = false;
  }
  if (order) {
    const paid = order.totalCents;
    const tender = options?.tenderCents;
    if (method === "Credit") {
      ui.showToast(`On credit ${fmtMoney(paid)}`);
    } else if (method === "Cash" && tender != null && tender > paid) {
      ui.showToast(`Change ${fmtMoney(tender - paid)}`);
    } else {
      ui.showToast(`Paid ${fmtMoney(paid)}`);
    }
    void catalog.load();

    if (order.issueDo || order.doNumber || order.siteAddress || options?.issueDo) {
      void printDeliveryOrder(order).catch(() => ui.showToast("DO printing failed"));
    }

    void printOrderReceipt(order).catch(() => ui.showToast("Printing failed"));
  }
}
</script>

<template>
  <h1 class="sr-only">Till</h1>

  <!-- Main 2-Column Split: Left (TopBar + Top Categories Bar + Tactile Product Grid) | Right (100vh Full-Height Current Sale Receipt) -->
  <div class="flex-1 flex min-h-0 bg-[#E6E4DD] select-none">
    <!-- LEFT COLUMN: TopBar + Top Category Ribbon + Search + 3D Tactile Product Cards -->
    <div class="flex-1 flex flex-col min-w-0 min-h-0">
      <div class="flex-none border-b border-[#D6D3C9]">
        <TopBar mode="till" />
      </div>

      <!-- Top Horizontal Category Bar (All categories + Custom item visible without horizontal scroll trap) -->
      <div
        class="flex items-center flex-wrap gap-6px px-14px py-8px bg-white border-b border-[#D6D3C9] flex-none"
      >
        <button
          v-for="cat in HARDWARE_CATEGORIES"
          :key="cat"
          type="button"
          class="cat-btn h-48px min-h-48px px-12px rounded-full text-14px cursor-pointer flex items-center gap-6px flex-none transition-all active:translate-y-1px"
          :class="
            selectedCategory === cat
              ? 'bg-[#18181B] text-white font-700 shadow-sm'
              : 'bg-[#F4F3EF] hover:bg-[#E7E5DE] text-[#27272A] font-600'
          "
          @click="selectedCategory = cat"
        >
          <span
            class="w-9px h-9px rounded-full flex-none"
            :style="{ backgroundColor: CATEGORY_COLORS[cat] || '#1e293b' }"
          />
          <span class="whitespace-nowrap">{{ categoryButtonLabel(cat) }}</span>
          <span
            v-if="categoryCount(cat) > 0"
            class="text-12px num"
            :class="selectedCategory === cat ? 'text-white/80' : 'text-[#71717A]'"
          >
            {{ categoryCount(cat) }}
          </span>
        </button>

        <button
          type="button"
          class="h-48px min-h-48px px-14px rounded-full bg-[#F3E8FF] hover:bg-[#E9D5FF] text-[#6B21A8] text-14px font-700 cursor-pointer flex items-center gap-6px flex-none ml-auto active:translate-y-1px"
          @click="addCustomItem"
        >
          <PlusCircle class="w-16px h-16px flex-none" />
          <span class="whitespace-nowrap">Custom item</span>
        </button>
      </div>

      <!-- Product Catalog Area: Search + 3D Tactile Keycap Grid -->
      <div class="flex-1 flex flex-col gap-12px p-14px min-w-0 min-h-0">
        <!-- Search Input Row -->
        <div class="flex items-center gap-10px flex-none">
          <button
            type="button"
            class="relative flex-1 h-60px pl-52px pr-18px rounded-12px bg-white text-18px font-600 text-left cursor-pointer shadow-[inset_0_2px_4px_rgba(0,0,0,0.06),0_1px_0_rgba(255,255,255,0.8)] border border-[#D4D2CA]"
            @click="searchOpen = true"
          >
            <Search
              class="absolute left-18px top-1/2 -translate-y-1/2 w-22px h-22px text-[#71717A] pointer-events-none"
            />
            <span v-if="searchQuery" class="text-[#18181B] font-700">{{ searchQuery }}</span>
            <span v-else class="text-[#71717A]">{{ L.search }}</span>
          </button>
          <button
            v-if="searchQuery"
            type="button"
            class="h-60px px-20px rounded-12px bg-[#FEE2E2] text-[#DC2626] text-16px font-700 cursor-pointer flex items-center gap-6px flex-none shadow-[0_3px_0_#FCA5A5] active:translate-y-1px"
            @click="searchQuery = ''"
          >
            <X class="w-20px h-20px flex-none" />
            <span>{{ L.clear }}</span>
          </button>
        </div>

        <!-- 3D Tactile Product Cards Grid (Screenshot 1 Style) -->
        <div
          v-if="filteredGroups.length > 0"
          class="product-grid flex-1 min-h-0 grid gap-12px overflow-y-auto content-start pr-4px pb-8px"
          style="grid-template-columns: repeat(auto-fill, minmax(236px, 1fr)); grid-auto-rows: 152px"
        >
          <button
            v-for="group in filteredGroups"
            :key="group.groupName"
            type="button"
            class="group relative h-full min-h-0 rounded-12px p-14px flex flex-col justify-between text-left cursor-pointer transition-all active:translate-y-2px"
            :class="
              groupCartCount(group) > 0
                ? 'bg-[#FFFBEB] border-2 border-[#18181B] shadow-[0_4px_0_#18181B]'
                : 'bg-white border border-[#DCDAD2] shadow-[0_4px_0_#C8C5BC] hover:border-[#A1A1AA]'
            "
            @click="onSelectGroup(group)"
          >
            <!-- Top: Product Title & Active Count Badge -->
            <div class="w-full flex items-start justify-between gap-8px min-w-0">
              <div class="min-w-0 flex-1">
                <div class="text-19px font-600 text-[#18181B] leading-snug line-clamp-2 tracking-tight">
                  {{ group.groupName }}
                </div>
                <div
                  v-if="groupSingleSpec(group)"
                  class="text-15px font-500 text-[#52525B] leading-tight mt-3px"
                >
                  {{ groupSingleSpec(group) }}
                </div>
              </div>

              <span
                v-if="groupCartCount(group) > 0"
                class="flex-none bg-[#18181B] text-white text-15px font-800 leading-none px-9px py-6px rounded-8px num shadow-sm"
              >
                ×{{ groupCartCount(group) }}
              </span>
            </div>

            <!-- Bottom: Tabular Hero Price + Spec Pill -->
            <div class="w-full flex items-baseline justify-between gap-6px pt-8px mt-auto border-t border-[#F0EFEA]">
              <div class="flex items-baseline gap-4px min-w-0">
                <span class="text-23px font-800 text-[#18181B] leading-none num tracking-tight">
                  {{ groupPriceText(group) }}
                </span>
                <span class="text-13px font-500 text-[#71717A] truncate">
                  {{ groupUnitText(group) }}
                </span>
              </div>

              <span
                v-if="group.items.length > 1"
                class="flex-none inline-flex items-center gap-2px bg-[#F4F4F5] text-[#3F3F46] text-13px font-600 leading-none px-8px py-5px rounded-6px num"
              >
                <span>{{ group.items.length }} {{ L.sizes }}</span>
                <ChevronRight class="w-13px h-13px text-[#71717A]" />
              </span>
            </div>
          </button>
        </div>

        <div
          v-else
          class="flex-1 flex flex-col items-center justify-center gap-16px text-center p-32px rounded-12px bg-white/60 border border-dashed border-[#C8C5BC]"
        >
          <Search class="w-36px h-36px text-[#71717A]" />
          <span class="text-20px font-700 text-[#18181B]">{{ L.emptySearchPrompt }}</span>
          <div class="flex items-center gap-12px mt-4px">
            <button
              type="button"
              class="h-56px px-20px rounded-8px bg-[#18181B] text-white text-16px font-700 cursor-pointer"
              @click="addCustomItem"
            >
              Custom item
            </button>
            <button
              type="button"
              class="h-56px px-18px rounded-8px bg-white border border-[#D4D2CA] text-16px font-700 text-[#18181B] cursor-pointer"
              @click="searchQuery = ''"
            >
              {{ L.clear }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- RIGHT COLUMN: Full-Height Current Sale Receipt Pane (Stretches Top to Bottom) -->
    <div
      class="cart-pane h-full flex-none flex flex-col bg-[#FFFDF9] border-l border-[#D6D3C9] shadow-[-4px_0_16px_rgba(0,0,0,0.04)] overflow-hidden min-h-0 w-480px"
    >
      <!-- Receipt Header -->
      <div
        class="flex items-center justify-between gap-6px px-16px py-12px border-b-2 border-dashed border-[#D6D3C9] flex-none"
      >
        <div class="flex items-center gap-6px min-w-0 flex-1">
          <span class="text-15px font-800 uppercase tracking-wider text-[#18181B] whitespace-nowrap">
            {{ L.currentSale }}
          </span>
          <span
            v-if="cart.activeHoldLabel"
            class="px-6px py-2px rounded-4px bg-[#FFFBEB] border border-[#FDE68A] text-11px font-700 text-[#B45309] truncate"
          >
            {{ cart.activeHoldLabel }}
          </span>
        </div>

        <div class="flex items-center gap-6px flex-none">
          <button
            v-if="cart.lastOrder"
            type="button"
            class="h-44px px-10px rounded-6px bg-[#F4F3EF] hover:bg-[#E7E5DE] active:translate-y-1px text-13px font-700 text-[#18181B] cursor-pointer flex items-center gap-4px whitespace-nowrap transition-transform"
            :title="L.reprintLast"
            @click="reprintLastReceipt"
          >
            <Printer class="w-14px h-14px text-[#52525B]" />
            <span>{{ L.reprintLast }}</span>
          </button>

          <button
            type="button"
            class="h-44px px-10px rounded-6px text-13px font-700 cursor-pointer flex items-center gap-4px whitespace-nowrap active:translate-y-1px transition-transform"
            :class="
              cart.orderNote
                ? 'bg-[#18181B] text-white'
                : 'bg-[#F4F3EF] hover:bg-[#E7E5DE] text-[#18181B]'
            "
            @click="noteOpen = true"
          >
            <FileText class="w-14px h-14px" />
            <span class="max-w-70px truncate">{{ cart.orderNote || L.note }}</span>
          </button>

          <button
            type="button"
            class="h-44px px-10px rounded-6px text-13px font-700 cursor-pointer flex items-center gap-4px whitespace-nowrap num active:translate-y-1px transition-transform"
            :class="
              cart.heldOrders.length > 0
                ? 'bg-[#FEF3C7] text-[#B45309]'
                : 'bg-[#F4F3EF] hover:bg-[#E7E5DE] text-[#18181B]'
            "
            @click="holdOpen = true"
          >
            <PauseCircle class="w-14px h-14px" />
            <span>{{ L.held }} ({{ cart.heldOrders.length }})</span>
          </button>

          <button
            v-if="cart.lines.length > 0"
            type="button"
            class="h-44px px-10px rounded-6px text-13px font-700 cursor-pointer whitespace-nowrap active:translate-y-1px transition-transform"
            :class="
              confirmClear
                ? 'bg-[#DC2626] text-white'
                : 'bg-[#FEE2E2] hover:bg-[#FECACA] text-[#DC2626]'
            "
            @click="handleClearCart"
          >
            {{ confirmClear ? L.cancelSale : L.clear }}
          </button>
        </div>
      </div>

      <!-- Receipt Lines Area (Dashed Dividers, Screenshot 3 Style) -->
      <div class="flex-1 overflow-y-auto divide-y divide-dashed divide-[#E5E3DC] px-18px min-h-0">
        <div
          v-if="cart.lines.length === 0"
          class="h-full flex flex-col items-center justify-center text-[#A1A1AA] gap-10px py-40px text-center"
        >
          <ShoppingBag class="w-36px h-36px stroke-1.5" />
          <span class="text-16px font-600 text-[#71717A]">{{ L.tapToStart }}</span>
        </div>

        <div
          v-for="line in cart.lines"
          :key="line.uid"
          class="py-14px -mx-8px px-8px rounded-8px flex flex-col gap-10px transition-colors"
          :class="line.uid === cart.activeUid ? 'bg-[#FAF8F1]' : ''"
          @click="selectLine(line.uid)"
        >
          <div class="flex items-baseline justify-between gap-8px">
            <span class="text-17px font-600 text-[#18181B] leading-snug">
              {{ cart.displayNameOf(line) }}
            </span>
            <span class="text-20px font-800 text-[#18181B] num flex-none">
              {{ fmtMoney(cart.amountOf(line)) }}
            </span>
          </div>

          <div class="flex items-center justify-between gap-8px">
            <button
              type="button"
              class="h-56px min-h-48px px-12px rounded-8px text-15px font-600 cursor-pointer num flex items-center gap-6px transition-colors"
              :class="
                line.customPriceCents != null
                  ? 'bg-[#FFFBEB] border border-[#F59E0B] text-[#B45309]'
                  : 'bg-[#F4F3EF] hover:bg-[#E7E5DE] text-[#52525B]'
              "
              @click.stop="openNumpad(line.uid, 'price')"
            >
              <span>{{ fmtMoney(cart.unitCentsOf(line)) }} / {{ unitLabel(line.item.unit) }}</span>
              <Pencil class="w-13px h-13px opacity-50 flex-none" />
            </button>

            <div class="flex items-center gap-6px">
              <button
                type="button"
                class="w-56px h-56px min-h-48px rounded-8px bg-[#F4F3EF] hover:bg-[#E7E5DE] text-22px font-700 text-[#18181B] flex items-center justify-center cursor-pointer active:translate-y-1px"
                @click.stop="stepLine(line.uid, -1)"
              >
                −
              </button>
              <button
                type="button"
                class="min-w-68px h-56px min-h-48px px-12px rounded-8px bg-white border border-[#18181B] text-18px font-800 text-[#18181B] num flex items-center justify-center cursor-pointer"
                @click.stop="openNumpad(line.uid, 'qty')"
              >
                <span>{{ fmtQty(line.qtyMilli) }}</span>
              </button>
              <button
                type="button"
                class="w-56px h-56px min-h-48px rounded-8px bg-[#F4F3EF] hover:bg-[#E7E5DE] text-22px font-700 text-[#18181B] flex items-center justify-center cursor-pointer active:translate-y-1px"
                @click.stop="stepLine(line.uid, 1)"
              >
                +
              </button>
              <button
                type="button"
                class="w-56px h-56px min-h-48px rounded-8px bg-[#F4F3EF] hover:bg-[#FEE2E2] text-[#A1A1AA] hover:text-[#DC2626] flex items-center justify-center cursor-pointer active:translate-y-1px"
                :aria-label="L.clear"
                @click.stop="cart.remove(line.uid)"
              >
                <X class="w-20px h-20px" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Receipt Footer (TOTAL + Park + Green Pay Button) -->
      <div class="p-18px bg-[#F4F3EF] border-t-2 border-[#18181B] flex flex-col gap-12px flex-none">
        <div
          v-if="cart.totalDiscountCents > 0"
          class="flex items-center justify-between text-14px font-700 text-[#52525B] num"
        >
          <span>{{ L.subtotal }}: {{ fmtMoney(cart.grossSubtotalCents) }}</span>
          <span class="text-[#DC2626] font-800">{{ L.discount }}: -{{ fmtMoney(cart.totalDiscountCents) }}</span>
        </div>

        <div class="flex items-baseline justify-between">
          <span class="text-15px font-700 uppercase tracking-wider text-[#52525B]">{{ L.total }}</span>
          <span class="text-38px font-900 text-[#18181B] num leading-none">
            {{ fmtMoney(cart.totalCents) }}
          </span>
        </div>

        <div class="flex gap-12px">
          <button
            v-if="cart.lines.length > 0"
            type="button"
            class="h-64px px-20px rounded-8px bg-white border border-[#18181B] text-17px font-700 text-[#18181B] cursor-pointer flex items-center gap-8px active:translate-y-2px shadow-[0_3px_0_#C8C5BC] hover:bg-[#FAFAF9] transition-all"
            @click="parkSale"
          >
            <PauseCircle class="w-18px h-18px" />
            <span>{{ L.hold }}</span>
          </button>
          <button
            type="button"
            class="btn-pay flex-1 h-64px rounded-8px text-22px font-800 flex items-center justify-center gap-8px cursor-pointer transition-all active:translate-y-2px"
            :class="cart.totalCents > 0 ? 'shadow-[0_4px_0_#14532D] active:shadow-[0_1px_0_#14532D]' : 'opacity-40 cursor-not-allowed shadow-none'"
            :disabled="cart.totalCents <= 0"
            @click="openPay"
          >
            <span>{{ L.pay }}</span>
            <span v-if="cart.totalCents > 0" class="text-18px num font-mono">({{ fmtMoney(cart.totalCents) }})</span>
          </button>
        </div>
      </div>
    </div>
  </div>

  <SpecPickerDialog
    :group="specPickerGroup"
    @pick="onPickSpec"
    @close="specPickerGroup = null"
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
    @close="closeNumpad"
  />

  <KeyboardDialog
    :open="noteOpen"
    title="Note"
    :initial="cart.orderNote"
    @confirm="((val: string) => { cart.orderNote = val.trim(); noteOpen = false; })"
    @close="noteOpen = false"
  />

  <KeyboardDialog
    :open="searchOpen"
    title="Search"
    :initial="searchQuery"
    @confirm="((val: string) => { searchQuery = val; searchOpen = false; })"
    @close="searchOpen = false"
  />
</template>
