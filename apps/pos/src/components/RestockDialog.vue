<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  fmtMoney,
  fmtQty,
  fmtQtyUnit,
  isMeasureUnit,
  matchesHardwareSearch,
  type PricedItem,
} from "@yf/core";
import { CheckCircle2, PackagePlus, Plus, Search, X } from "lucide-vue-next";
import { getRepo } from "../db";
import { useCatalog } from "../stores/catalog";
import { useUi } from "../stores/ui";
import { L } from "../labels";

const props = defineProps<{
  open: boolean;
  initialItem?: PricedItem | null;
  items?: PricedItem[];
}>();

const emit = defineEmits<{
  close: [];
  restocked: [updatedItem: PricedItem, addedQtyMilli: number, note?: string];
}>();

const catalog = useCatalog();
const ui = useUi();

const selectedItem = ref<PricedItem | null>(null);
const qtyInputString = ref<string>("");
const supplierNote = ref<string>("");
const searchKeyword = ref<string>("");
const submitting = ref<boolean>(false);
const errorMessage = ref<string | null>(null);

const availableItems = computed<PricedItem[]>(() => {
  return props.items && props.items.length > 0 ? props.items : catalog.items;
});

const matchedItems = computed<PricedItem[]>(() => {
  const kw = searchKeyword.value.trim();
  if (!kw) return availableItems.value.slice(0, 30);
  const lowerKw = kw.toLowerCase();
  return availableItems.value
    .filter(
      (it) =>
        matchesHardwareSearch(it.name, kw) ||
        it.name.toLowerCase().includes(lowerKw) ||
        it.key.toLowerCase().includes(lowerKw),
    )
    .slice(0, 30);
});

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      selectedItem.value = props.initialItem ?? null;
      qtyInputString.value = "";
      supplierNote.value = "";
      searchKeyword.value = "";
      errorMessage.value = null;
      submitting.value = false;
    }
  },
  { immediate: true },
);

watch(
  () => props.initialItem,
  (item) => {
    if (props.open) {
      selectedItem.value = item ?? null;
    }
  },
);

const isWeighable = computed(() => {
  if (!selectedItem.value) return false;
  return isMeasureUnit(selectedItem.value.unit);
});

const QUANTITY_PRESETS = [5, 10, 25, 50, 100] as const;

function applyPreset(preset: number): void {
  const current = Number(qtyInputString.value) || 0;
  const next = current + preset;
  qtyInputString.value = String(next);
  errorMessage.value = null;
}

function clearQty(): void {
  qtyInputString.value = "";
  errorMessage.value = null;
}

function stepQty(delta: number): void {
  const current = Number(qtyInputString.value) || 0;
  const next = Math.max(0, current + delta);
  qtyInputString.value = next > 0 ? String(next) : "";
  errorMessage.value = null;
}

function selectItem(item: PricedItem): void {
  selectedItem.value = item;
  qtyInputString.value = "";
  errorMessage.value = null;
}

function onBarcodeScanned(): void {
  const kw = searchKeyword.value.trim();
  if (!kw) return;
  const lowerKw = kw.toLowerCase();
  const exact = availableItems.value.find(
    (it) => it.key.toLowerCase() === lowerKw || it.name.toLowerCase() === lowerKw,
  );
  if (exact) {
    selectItem(exact);
    return;
  }
  const match = availableItems.value.find(
    (it) => matchesHardwareSearch(it.name, kw) || it.key.toLowerCase().includes(lowerKw),
  );
  if (match) {
    selectItem(match);
  } else if (matchedItems.value.length === 1 && matchedItems.value[0]) {
    selectItem(matchedItems.value[0]);
  } else {
    errorMessage.value = "No item matching: " + searchKeyword.value;
  }
}

const inboundMilli = computed(() => {
  const val = Number(qtyInputString.value);
  if (!Number.isFinite(val) || val <= 0) return 0;
  return Math.round(val * 1000);
});

const currentStockMilli = computed(() => {
  return selectedItem.value?.stockMilli ?? null;
});

const resultingStockMilli = computed(() => {
  if (!selectedItem.value || inboundMilli.value <= 0) return null;
  const current = selectedItem.value.stockMilli ?? 0;
  return current + inboundMilli.value;
});

const isValid = computed(() => {
  if (!selectedItem.value) return false;
  if (inboundMilli.value <= 0) return false;
  const numVal = Number(qtyInputString.value);
  if (!isWeighable.value && !Number.isInteger(numVal)) {
    return false;
  }
  return true;
});

async function confirmRestock(): Promise<void> {
  if (!isValid.value || !selectedItem.value || submitting.value) return;

  submitting.value = true;
  errorMessage.value = null;

  try {
    const repo = await getRepo();
    const note = supplierNote.value.trim() || undefined;
    const updated = await repo.restockItem(selectedItem.value.id, inboundMilli.value, note);

    catalog.updateItemStock(updated.id, updated.stockMilli!);
    ui.showToast(
      `${L.restockSuccess}: +${fmtQty(inboundMilli.value)} ${updated.unit} ${updated.name}`,
      2500,
    );
    emit("restocked", updated, inboundMilli.value, note);
    emit("close");
  } catch (err: any) {
    errorMessage.value = err instanceof Error ? err.message : "Restock failed";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 bg-[rgba(10,10,10,.55)] flex items-center justify-center p-16px z-90 select-none"
    @click.self="$emit('close')"
  >
    <div
      class="w-560px max-w-full bg-surface rounded-12px border border-border shadow-2xl flex flex-col overflow-hidden max-h-[94vh]"
    >
      <!-- Modal Header -->
      <div
        class="px-20px py-16px border-b border-border bg-panel flex items-center justify-between flex-none"
      >
        <div class="flex items-center gap-10px">
          <PackagePlus class="w-22px h-22px text-ink" />
          <h2 class="m-0 text-18px font-800 text-ink">
            {{ L.quickInbound }}
          </h2>
        </div>
        <button
          type="button"
          class="pill-btn w-40px h-40px p-0 inline-flex items-center justify-center text-muted hover:text-ink cursor-pointer"
          @click="$emit('close')"
        >
          <X class="w-20px h-20px" />
        </button>
      </div>

      <!-- Modal Body -->
      <div class="p-20px flex-1 overflow-y-auto flex flex-col gap-16px">
        <!-- Step 1: Item Search / Scan (when no item is selected) -->
        <div v-if="!selectedItem" class="flex flex-col gap-12px">
          <div class="text-14px font-700 text-muted">
            {{ L.selectItemToRestock }}
          </div>
          <div class="relative">
            <input
              v-model="searchKeyword"
              type="text"
              autofocus
              class="w-full h-52px px-16px text-16px font-700 rounded-8px border border-border bg-surface text-ink focus:border-ink outline-none"
              :placeholder="L.searchItemOrBarcode"
              @keydown.enter="onBarcodeScanned"
            />
          </div>

          <!-- Matching Items List -->
          <div
            class="flex flex-col gap-6px max-h-300px overflow-y-auto border border-border rounded-8px p-6px bg-panel"
          >
            <div
              v-for="it in matchedItems"
              :key="it.id"
              class="p-12px rounded-6px border border-transparent hover:border-border hover:bg-surface cursor-pointer flex items-center justify-between"
              @click="selectItem(it)"
            >
              <div>
                <div class="text-15px font-800 text-ink">{{ it.name }}</div>
                <div class="text-12px font-600 text-muted mono">
                  SKU: {{ it.key }} · {{ it.unit }}
                </div>
              </div>
              <div class="text-right">
                <div
                  class="text-14px font-700"
                  :class="
                    it.stockMilli == null
                      ? 'text-muted'
                      : it.stockMilli <= 0
                      ? 'text-terracotta'
                      : 'text-ink'
                  "
                >
                  {{
                    it.stockMilli == null
                      ? L.untracked
                      : fmtQtyUnit(it.stockMilli, it.unit)
                  }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Step 2: Restock Entry (when item is selected) -->
        <template v-else>
          <!-- Selected Item Info Card -->
          <div
            class="p-14px rounded-8px border border-border bg-panel flex items-start justify-between"
          >
            <div>
              <div class="text-17px font-800 text-ink">{{ selectedItem.name }}</div>
              <div class="text-13px font-600 text-muted mono mt-2px">
                SKU: {{ selectedItem.key }} · {{ selectedItem.unit }} ·
                {{ fmtMoney(selectedItem.priceCents) }}
              </div>
            </div>
            <div class="flex flex-col items-end gap-4px">
              <span
                class="px-8px py-3px rounded-4px text-12px font-800"
                :class="
                  selectedItem.stockMilli == null
                    ? 'bg-border text-muted'
                    : selectedItem.stockMilli <= 0
                    ? 'bg-terracotta/15 text-terracotta'
                    : 'bg-emerald-100 text-emerald-800'
                "
              >
                {{
                  selectedItem.stockMilli == null
                    ? L.untracked
                    : `${L.currentStock}: ${fmtQtyUnit(
                        selectedItem.stockMilli,
                        selectedItem.unit,
                      )}`
                }}
              </span>
              <button
                v-if="!initialItem"
                type="button"
                class="text-12px font-700 text-muted hover:text-ink hover:underline cursor-pointer bg-transparent border-none p-0 mt-2px"
                @click="selectedItem = null"
              >
                {{ L.switchItem }}
              </button>
            </div>
          </div>

          <!-- Inbound Quantity Input & Steppers -->
          <div class="flex flex-col gap-8px">
            <label class="text-14px font-800 text-ink">
              {{ L.inboundQty }} ({{ selectedItem.unit }})
            </label>
            <div class="flex items-center gap-8px">
              <button
                type="button"
                class="w-54px h-56px rounded-8px border-2 border-border bg-surface text-20px font-800 text-ink press cursor-pointer flex items-center justify-center"
                @click="stepQty(-1)"
              >
                -1
              </button>
              <div class="flex-1 relative">
                <input
                  v-model="qtyInputString"
                  type="number"
                  step="any"
                  min="0"
                  class="w-full h-56px px-16px text-center text-24px font-800 rounded-8px border-2 border-border bg-surface text-ink focus:border-ink outline-none num"
                  placeholder="0"
                />
                <span
                  class="absolute right-14px top-1/2 -translate-y-1/2 text-14px font-700 text-muted uppercase"
                >
                  {{ selectedItem.unit }}
                </span>
              </div>
              <button
                type="button"
                class="w-54px h-56px rounded-8px border-2 border-border bg-surface text-20px font-800 text-ink press cursor-pointer flex items-center justify-center"
                @click="stepQty(1)"
              >
                +1
              </button>
            </div>
          </div>

          <!-- Quick Presets (+5, +10, +25, +50, +100, Clear) -->
          <div class="flex flex-col gap-6px">
            <div class="text-12px font-700 text-muted uppercase tracking-wider">
              {{ L.quickPresets }}
            </div>
            <div class="grid grid-cols-6 gap-8px">
              <button
                v-for="p in QUANTITY_PRESETS"
                :key="p"
                type="button"
                class="h-50px rounded-8px border-2 border-border bg-surface hover:border-ink text-16px font-800 text-ink press cursor-pointer flex items-center justify-center transition-colors num"
                @click="applyPreset(p)"
              >
                +{{ p }}
              </button>
              <button
                type="button"
                class="h-50px rounded-8px border-2 border-border bg-panel hover:border-muted text-15px font-800 text-muted press cursor-pointer flex items-center justify-center"
                @click="clearQty"
              >
                C
              </button>
            </div>
          </div>

          <!-- Resulting Stock Arithmetic Preview Box -->
          <div
            class="p-14px rounded-8px border-2 border-dashed border-border bg-panel flex flex-col gap-6px num"
          >
            <div class="flex items-center justify-between text-14px font-700 text-muted">
              <span>{{ L.currentStock }}:</span>
              <span>
                {{
                  selectedItem.stockMilli == null
                    ? `0 (${L.untracked})`
                    : fmtQtyUnit(selectedItem.stockMilli, selectedItem.unit)
                }}
              </span>
            </div>
            <div class="flex items-center justify-between text-14px font-700 text-emerald-700">
              <span>+ {{ L.inboundAddition }}:</span>
              <span>+{{ fmtQty(inboundMilli) }} {{ selectedItem.unit }}</span>
            </div>
            <div class="h-1px bg-border my-2px"></div>
            <div class="flex items-center justify-between text-16px font-800 text-ink">
              <span>{{ L.resultingStock }}:</span>
              <span
                class="text-18px font-800"
                :class="resultingStockMilli != null ? 'text-ink' : 'text-muted'"
              >
                {{
                  resultingStockMilli != null
                    ? fmtQtyUnit(resultingStockMilli, selectedItem.unit)
                    : "—"
                }}
              </span>
            </div>
            <div
              v-if="selectedItem.stockMilli == null && inboundMilli > 0"
              class="text-12px font-600 text-muted mt-4px"
            >
              * {{ L.inboundStock }}: {{ L.trackedOnly }}
            </div>
          </div>

          <!-- Supplier Note / Reference DO -->
          <div>
            <label class="block text-13px font-700 text-muted mb-4px">
              {{ L.supplierNote }}
            </label>
            <input
              v-model="supplierNote"
              type="text"
              class="w-full h-46px px-14px text-15px font-600 rounded-8px border border-border bg-surface text-ink focus:border-ink outline-none"
              placeholder="e.g. DO-8812 / Lian Seng Hardware"
            />
          </div>

          <!-- Error notice if any -->
          <div
            v-if="errorMessage"
            class="text-13px font-700 text-terracotta bg-terracotta/10 p-10px rounded-6px"
          >
            {{ errorMessage }}
          </div>
        </template>
      </div>

      <!-- Modal Footer -->
      <div
        class="px-20px py-16px border-t border-border bg-panel grid grid-cols-2 gap-12px flex-none"
      >
        <button
          type="button"
          class="h-52px btn-ghost text-16px font-700 text-muted cursor-pointer"
          :disabled="submitting"
          @click="$emit('close')"
        >
          {{ L.cancel }}
        </button>
        <button
          type="button"
          class="h-52px btn-pay text-17px font-800 flex items-center justify-center gap-6px cursor-pointer"
          :disabled="!isValid || submitting"
          @click="confirmRestock"
        >
          <CheckCircle2 class="w-18px h-18px" />
          <span>{{
            submitting
              ? "..."
              : `${L.confirmInbound} (+${fmtQty(inboundMilli)})`
          }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
