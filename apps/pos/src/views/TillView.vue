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
import { PauseCircle, PlusCircle, Trash2, X } from "lucide-vue-next";
import TopBar from "../components/TopBar.vue";
import ProductCard from "../components/ProductCard.vue";
import SpecPickerDialog from "../components/SpecPickerDialog.vue";
import TextInput from "../components/TextInput.vue";
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

function categoryLines(cat: HardwareCategory): { en: string; bm: string } {
  if (cat === "All") return { en: "All", bm: "Semua" };
  return HARDWARE_CATEGORY_I18N[cat];
}

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

function openPay(): void {
  if (cart.totalCents <= 0) return;
  payOpen.value = true;
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

  <!-- Tinted L-Frame (--ground) + Inset White Sheet (--surface) -->
  <div class="flex-1 flex min-h-0 bg-ground">
    <!-- Left Category Rail (Fixed 216px width on --ground, two-line bilingual buttons, no rainbow) -->
    <aside class="w-216px flex-none flex flex-col justify-between gap-8px px-10px pb-10px pt-2px min-h-0 select-none">
      <div class="flex-1 overflow-y-auto flex flex-col gap-6px pr-2px">
        <button
          v-for="cat in HARDWARE_CATEGORIES"
          :key="cat"
          type="button"
          class="relative min-h-56px px-12px py-6px rounded-6px text-left cursor-pointer press flex flex-col justify-center transition-colors"
          :class="
            selectedCategory === cat
              ? 'bg-surface border-1.5 border-ink text-ink font-700'
              : 'bg-transparent border border-transparent hover:bg-surface/60 text-ink'
          "
          @click="selectedCategory = cat"
        >
          <span
            v-if="selectedCategory === cat"
            class="absolute left-0 top-6px bottom-6px w-4px rounded-r-2px bg-ink"
          />
          <span class="text-15px font-700 leading-tight text-ink truncate">
            {{ categoryDisplay(cat).primary }}
          </span>
          <span class="text-13px font-500 leading-tight text-muted truncate mt-2px">
            {{ categoryDisplay(cat).secondary }}
          </span>
        </button>
      </div>

      <!-- Pinned Bottom Quick-Add: + Lain-lain (opens LainLainDialog.vue) -->
      <button
        type="button"
        class="min-h-60px px-12px py-8px rounded-8px border-1.5 border-dashed border-ink bg-surface text-left cursor-pointer press flex items-center gap-10px flex-none"
        @click="lainLainOpen = true"
      >
        <PlusCircle class="w-22px h-22px text-ink flex-none" />
        <div class="min-w-0 flex flex-col">
          <span class="text-15px font-800 text-ink leading-tight">+ Lain-lain</span>
          <span class="text-12px font-600 text-muted leading-tight mt-2px">Barang Lain · Taip Harga</span>
        </div>
      </button>
    </aside>

    <!-- Inset White Work Sheet -->
    <div
      class="flex-1 flex bg-surface border border-border rounded-12px mr-8px mb-8px overflow-hidden min-h-0 min-w-0"
    >
      <!-- Center Product Grid (flex-1) -->
      <div class="flex-1 flex flex-col gap-12px p-14px min-w-0 min-h-0 border-r border-border">
        <!-- Search Toolbar -->
        <div class="flex items-center gap-8px flex-none">
          <TextInput
            v-model="searchQuery"
            :title="L.search"
            :placeholder="L.searchPlaceholder"
            class="flex-1"
          />
          <button
            v-if="searchQuery"
            type="button"
            class="pill-btn h-52px px-16px text-15px flex items-center gap-6px flex-none"
            @click="searchQuery = ''"
          >
            <X class="w-16px h-16px text-muted" />
            <span>{{ L.clear }}</span>
          </button>
        </div>

        <!-- Product Cards Grid (3-col on 1024px, 4-col on >=1280px) -->
        <div
          class="product-grid flex-1 min-h-0 grid grid-cols-3 xl:grid-cols-4 gap-10px overflow-y-auto content-start pr-2px"
          style="grid-auto-rows: 112px"
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

      <!-- Right Current Sale Panel (Fixed 440px width on >=1150px, 400px on 1024px) -->
      <div class="cart-pane w-440px flex-none flex flex-col bg-surface min-h-0">
        <!-- Cart Header -->
        <div class="flex items-center justify-between gap-8px px-16px py-12px border-b border-border flex-none">
          <div class="flex items-center gap-8px min-w-0">
            <span class="text-17px font-800 text-ink whitespace-nowrap">{{ L.currentSale }}</span>
            <span
              v-if="cart.activeHoldLabel"
              class="px-8px py-3px rounded-4px bg-[#fffbeb] border border-[#fde68a] text-13px font-700 text-warning truncate"
            >
              {{ cart.activeHoldLabel }}
            </span>
          </div>
          <div class="flex items-center gap-6px flex-none">
            <button
              type="button"
              class="press h-46px px-12px rounded-6px border text-14px font-700 cursor-pointer flex items-center gap-6px num"
              :class="
                cart.heldOrders.length > 0
                  ? 'bg-[#fffbeb] border-warning text-warning font-800'
                  : 'bg-surface border-border text-muted'
              "
              @click="holdOpen = true"
            >
              <PauseCircle class="w-16px h-16px flex-none" />
              <span>{{ L.held }}</span>
              <span class="font-800">({{ cart.heldOrders.length }})</span>
            </button>

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
          class="flex items-center justify-between px-16px py-6px border-b border-borderSoft bg-panel/50 text-12px font-700 text-faint flex-none"
        >
          <span>{{ L.item }}</span>
          <span>{{ L.qty }} / {{ L.amount }}</span>
        </div>

        <!-- Cart Lines List -->
        <div class="flex-1 overflow-y-auto p-12px flex flex-col gap-8px min-h-0">
          <div
            v-if="cart.lines.length === 0"
            class="flex-1 flex flex-col items-center justify-center gap-14px text-muted py-40px text-center"
          >
            <div class="text-17px font-700 text-muted">{{ L.tapToStart }}</div>
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
        <div class="px-16px py-14px border-t border-border bg-surface flex-none">
          <div
            v-if="cart.totalDiscountCents > 0"
            class="flex items-center justify-between text-14px font-700 text-muted mb-6px num"
          >
            <span>{{ L.subtotal }}: {{ fmtMoney(cart.grossSubtotalCents) }}</span>
            <span class="text-negative font-800">{{ L.discount }}: -{{ fmtMoney(cart.totalDiscountCents) }}</span>
          </div>

          <div class="flex items-baseline justify-between mb-12px">
            <span class="text-16px font-700 text-muted">{{ L.total }}</span>
            <span class="text-32px font-800 text-ink leading-none whitespace-nowrap num">
              {{ fmtMoney(cart.totalCents) }}
            </span>
          </div>

          <div class="flex gap-10px">
            <button
              v-if="cart.lines.length > 0"
              type="button"
              class="press h-60px px-16px rounded-6px border border-control bg-surface text-16px font-700 text-ink cursor-pointer flex-none whitespace-nowrap inline-flex items-center gap-8px"
              :title="L.hold"
              @click="holdOpen = true"
            >
              <PauseCircle class="w-18px h-18px text-muted" />
              <span>{{ L.hold }}</span>
            </button>
            <button
              type="button"
              class="btn-pay flex-1 h-60px text-20px"
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
    @close="numpadUid = null"
  />

</template>

<style scoped>
@media (max-width: 1180px) {
  .cart-pane {
    width: 396px;
  }
}
</style>
