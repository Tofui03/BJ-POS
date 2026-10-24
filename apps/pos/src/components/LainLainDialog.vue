<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import {
  calcReverseQuantity,
  isMeasureUnit,
  lineAmount,
  toCents,
  toMilli,
  type Unit,
} from "@yf/core";
import { L, LAIN_LAIN_TAGS } from "../labels";
import TextInput from "./TextInput.vue";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  add: [payload: { label: string; priceCents: number; qtyUnits: number; unit?: Unit }];
  close: [];
}>();

const UNITS: readonly Unit[] = ["pcs", "kg", "ft", "meter"] as const;
const selectedUnit = ref<Unit>("pcs");

const selectedTag = ref<string>(LAIN_LAIN_TAGS[0]);
const customLabel = ref("");
const effectiveLabel = computed(() => customLabel.value.trim() || selectedTag.value || "Lain-lain");

// Calculation mode: direct quantity vs target RM budget
const calcMode = ref<"direct" | "budget">("direct");

// Active field for keypad input
const activeInput = ref<"price" | "qty" | "targetRm">("price");

const priceEntry = ref("");
const qtyEntry = ref("1");
const targetRmEntry = ref("");

const replacePrice = ref(true);
const replaceQty = ref(true);
const replaceTargetRm = ref(true);

const priceCents = computed(() => toCents(Number(priceEntry.value) || 0));
const targetRmCents = computed(() => toCents(Number(targetRmEntry.value) || 0));

const qtyUnits = computed(() => {
  const q = Number(qtyEntry.value);
  return Number.isFinite(q) && q > 0 ? q : 0;
});

const lineTotalCents = computed(() => {
  if (priceCents.value <= 0 || qtyUnits.value <= 0) return 0;
  return lineAmount(priceCents.value, toMilli(qtyUnits.value));
});

const isLengthUnit = computed(
  () =>
    selectedUnit.value === "ft" ||
    selectedUnit.value === "meter",
);

// Presets for quick weight/length/budget
const KG_PRESETS = [
  { label: "100g", val: 0.1 },
  { label: "250g", val: 0.25 },
  { label: "500g", val: 0.5 },
  { label: "1 kg", val: 1 },
  { label: "5 kg", val: 5 },
];

const LENGTH_PRESETS = [
  { label: "1", val: 1 },
  { label: "3", val: 3 },
  { label: "5", val: 5 },
  { label: "10", val: 10 },
  { label: "20", val: 20 },
];

const BUDGET_PRESETS = [2, 5, 10, 20, 50];

function selectTag(tag: string): void {
  selectedTag.value = tag;
  customLabel.value = "";
}

function setUnit(u: Unit): void {
  selectedUnit.value = u;
}

function setCalcMode(m: "direct" | "budget"): void {
  calcMode.value = m;
  if (m === "budget") {
    activeInput.value = "targetRm";
    if (priceCents.value > 0 && targetRmCents.value > 0) {
      updateReverseQty();
    }
  } else {
    activeInput.value = "qty";
  }
}

function updateReverseQty(): void {
  if (priceCents.value <= 0 || targetRmCents.value <= 0) return;
  try {
    const milli = calcReverseQuantity(targetRmCents.value, priceCents.value);
    const q = milli / 1000;
    qtyEntry.value = String(q);
    replaceQty.value = false;
  } catch {
    // ignore invalid reverse calculation
  }
}

function setBudgetPreset(rm: number): void {
  targetRmEntry.value = String(rm);
  replaceTargetRm.value = false;
  activeInput.value = "targetRm";
  updateReverseQty();
}

function setQtyPreset(val: number): void {
  qtyEntry.value = String(val);
  replaceQty.value = false;
  activeInput.value = "qty";
}

function stepQty(delta: number): void {
  const current = Number(qtyEntry.value) || 0;
  let next: number;
  if (selectedUnit.value === "pcs") {
    next = Math.max(1, Math.round(current + delta));
  } else {
    next = Math.max(0.01, Number((current + delta * (current >= 1 ? 1 : 0.1)).toFixed(3)));
  }
  qtyEntry.value = String(next);
  replaceQty.value = false;
}

const KEYS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "⌫"];

function tapKey(k: string): void {
  if (activeInput.value === "price") {
    if (k === "⌫") {
      priceEntry.value = priceEntry.value.slice(0, -1);
      replacePrice.value = false;
    } else {
      if (replacePrice.value) {
        priceEntry.value = "";
        replacePrice.value = false;
      }
      if (k === ".") {
        if (priceEntry.value.includes(".")) return;
        if (priceEntry.value === "") priceEntry.value = "0";
      }
      priceEntry.value += k;
    }
    if (calcMode.value === "budget") {
      updateReverseQty();
    }
    return;
  }

  if (activeInput.value === "qty") {
    if (k === "⌫") {
      qtyEntry.value = qtyEntry.value.slice(0, -1);
      replaceQty.value = false;
    } else {
      if (replaceQty.value) {
        qtyEntry.value = "";
        replaceQty.value = false;
      }
      if (k === ".") {
        if (qtyEntry.value.includes(".")) return;
        if (qtyEntry.value === "") qtyEntry.value = "0";
      }
      qtyEntry.value += k;
    }
    return;
  }

  if (activeInput.value === "targetRm") {
    if (k === "⌫") {
      targetRmEntry.value = targetRmEntry.value.slice(0, -1);
      replaceTargetRm.value = false;
    } else {
      if (replaceTargetRm.value) {
        targetRmEntry.value = "";
        replaceTargetRm.value = false;
      }
      if (k === ".") {
        if (targetRmEntry.value.includes(".")) return;
        if (targetRmEntry.value === "") targetRmEntry.value = "0";
      }
      targetRmEntry.value += k;
    }
    updateReverseQty();
    return;
  }
}

function clearActive(): void {
  if (activeInput.value === "price") {
    priceEntry.value = "";
    replacePrice.value = false;
    if (calcMode.value === "budget") updateReverseQty();
  } else if (activeInput.value === "qty") {
    qtyEntry.value = "1";
    replaceQty.value = true;
  } else if (activeInput.value === "targetRm") {
    targetRmEntry.value = "";
    replaceTargetRm.value = false;
    updateReverseQty();
  }
}

function submit(): void {
  if (priceCents.value <= 0 || qtyUnits.value <= 0) return;
  emit("add", {
    label: effectiveLabel.value,
    priceCents: priceCents.value,
    qtyUnits: qtyUnits.value,
    unit: selectedUnit.value,
  });
}

function onKeydown(e: KeyboardEvent): void {
  if (/^[0-9.]$/.test(e.key)) tapKey(e.key);
  else if (e.key === "Backspace") tapKey("⌫");
  else if (e.key === "Enter" && priceCents.value > 0 && qtyUnits.value > 0) submit();
  else if (e.key === "Escape") emit("close");
  else return;
  e.preventDefault();
}

watch(
  () => props.open,
  (o) => {
    if (o) {
      selectedTag.value = LAIN_LAIN_TAGS[0];
      customLabel.value = "";
      selectedUnit.value = "pcs";
      calcMode.value = "direct";
      activeInput.value = "price";
      priceEntry.value = "";
      qtyEntry.value = "1";
      targetRmEntry.value = "";
      replacePrice.value = true;
      replaceQty.value = true;
      replaceTargetRm.value = true;
      window.addEventListener("keydown", onKeydown);
    } else {
      window.removeEventListener("keydown", onKeydown);
    }
  },
);
onUnmounted(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 bg-[rgba(10,10,10,.45)] flex items-center justify-center p-20px z-80"
    @click.self="emit('close')"
  >
      <div
        class="w-800px max-w-full bg-surface rounded-8px border border-border flex flex-col overflow-hidden"
        style="max-height: 95vh"
      >
        <header class="px-24px py-16px border-b border-border flex items-center justify-between gap-12px">
          <div>
            <h2 class="m-0 text-22px font-700 text-ink">{{ L.lainLainTitle }}</h2>
            <div class="text-14px font-500 text-muted">{{ effectiveLabel }}</div>
          </div>
          <button
            type="button"
            class="h-52px px-16px rounded-6px border border-border bg-surface text-16px font-700 text-ink cursor-pointer press"
            @click="emit('close')"
          >
            {{ L.close }}
          </button>
        </header>

        <div class="p-20px grid grid-cols-1 md:grid-cols-2 gap-20px overflow-y-auto flex-1 min-h-0">
          <!-- Left column: quick tags + custom name + unit selector + qty/target calculation -->
          <div class="flex flex-col gap-14px">
            <div>
              <div class="text-14px font-700 text-muted mb-8px">{{ L.quickTag }}</div>
              <div class="grid grid-cols-2 gap-8px">
                <button
                  v-for="tag in LAIN_LAIN_TAGS"
                  :key="tag"
                  type="button"
                  class="min-h-50px px-12px rounded-6px border text-15px font-700 text-left cursor-pointer press"
                  :class="
                    !customLabel.trim() && selectedTag === tag
                      ? 'bg-ink text-white border-ink'
                      : 'bg-tile text-ink border-border'
                  "
                  @click="selectTag(tag)"
                >
                  {{ tag }}
                </button>
              </div>
            </div>

            <div>
              <div class="text-14px font-700 text-muted mb-6px">{{ L.item }}</div>
              <TextInput
                v-model="customLabel"
                :title="L.lainLainTitle"
                :placeholder="selectedTag"
              />
            </div>

            <!-- Unit Selector -->
            <div>
              <div class="text-14px font-700 text-muted mb-6px">Unit (Satuan)</div>
              <div class="grid grid-cols-4 gap-6px">
                <button
                  v-for="u in UNITS"
                  :key="u"
                  type="button"
                  class="min-h-48px py-8px px-8px rounded-6px border-2 text-15px font-800 text-center cursor-pointer press flex items-center justify-center transition-colors num"
                  :class="
                    selectedUnit === u
                      ? 'bg-ink text-white border-ink'
                      : 'bg-tile text-ink border-border hover:border-control'
                  "
                  @click="setUnit(u)"
                >
                  {{ u }}
                </button>
              </div>
            </div>

            <!-- Calculation Mode Switcher: Direct Qty vs Target RM Budget -->
            <div>
              <div class="text-14px font-700 text-muted mb-6px">Pricing Mode</div>
              <div class="grid grid-cols-2 gap-6px">
                <button
                  type="button"
                  class="min-h-48px py-8px px-12px rounded-6px border-2 text-14px font-800 cursor-pointer press transition-colors"
                  :class="
                    calcMode === 'direct'
                      ? 'bg-ink text-white border-ink'
                      : 'bg-tile text-ink border-border hover:border-control'
                  "
                  @click="setCalcMode('direct')"
                >
                  Direct Quantity
                </button>
                <button
                  type="button"
                  class="min-h-48px py-8px px-12px rounded-6px border-2 text-14px font-800 cursor-pointer press transition-colors"
                  :class="
                    calcMode === 'budget'
                      ? 'bg-ink text-white border-ink'
                      : 'bg-tile text-ink border-border hover:border-control'
                  "
                  @click="setCalcMode('budget')"
                >
                  Target RM Budget
                </button>
              </div>
            </div>

            <!-- Mode 1: Direct Quantity Controls -->
            <div v-if="calcMode === 'direct'">
              <div class="text-14px font-700 text-muted mb-6px">{{ L.quantity }} ({{ selectedUnit }})</div>
              <div class="flex items-center gap-10px">
                <button
                  type="button"
                  class="adj-btn w-56px h-56px text-26px"
                  @click="stepQty(-1)"
                >−</button>
                <div
                  class="flex-1 h-56px flex items-center justify-center rounded-6px border-2 text-26px font-800 num cursor-pointer press"
                  :class="
                    activeInput === 'qty'
                      ? 'border-ink bg-surface text-ink shadow-sm'
                      : 'border-border bg-panel text-ink hover:border-control'
                  "
                  @click="activeInput = 'qty'"
                >
                  {{ qtyEntry || "0" }} <span class="text-16px font-700 text-muted ml-6px">{{ selectedUnit }}</span>
                </div>
                <button
                  type="button"
                  class="adj-btn w-56px h-56px text-26px"
                  @click="stepQty(1)"
                >+</button>
              </div>

              <!-- Quick Presets for kg or ft/meter -->
              <div v-if="selectedUnit === 'kg'" class="mt-8px">
                <div class="text-11px font-700 text-muted uppercase mb-4px">Quick Weight:</div>
                <div class="grid grid-cols-5 gap-6px">
                  <button
                    v-for="p in KG_PRESETS"
                    :key="p.label"
                    type="button"
                    class="h-44px rounded-6px border-2 border-border bg-surface text-13px font-800 text-ink hover:border-ink cursor-pointer press num"
                    @click="setQtyPreset(p.val)"
                  >
                    {{ p.label }}
                  </button>
                </div>
              </div>
              <div v-else-if="isLengthUnit" class="mt-8px">
                <div class="text-11px font-700 text-muted uppercase mb-4px">Quick Length:</div>
                <div class="grid grid-cols-5 gap-6px">
                  <button
                    v-for="p in LENGTH_PRESETS"
                    :key="p.label"
                    type="button"
                    class="h-44px rounded-6px border-2 border-border bg-surface text-13px font-800 text-ink hover:border-ink cursor-pointer press num"
                    @click="setQtyPreset(p.val)"
                  >
                    {{ p.label }}
                  </button>
                </div>
              </div>
            </div>

            <!-- Mode 2: Target RM Budget Reverse Calculation Controls -->
            <div v-else>
              <div class="text-14px font-700 text-muted mb-6px">Quick RM Presets</div>
              <div class="grid grid-cols-5 gap-6px">
                <button
                  v-for="b in BUDGET_PRESETS"
                  :key="b"
                  type="button"
                  class="h-44px rounded-6px border-2 border-border bg-surface text-13px font-800 text-ink hover:border-ink cursor-pointer press num"
                  @click="setBudgetPreset(b)"
                >
                  RM {{ b }}
                </button>
              </div>

              <!-- Computed Result Banner -->
              <div class="mt-10px bg-panel rounded-8px p-12px border border-border flex flex-col gap-4px num">
                <div class="flex items-baseline justify-between">
                  <span class="text-12px font-700 text-muted uppercase">Computed Quantity:</span>
                  <span class="text-24px font-800 text-ink">
                    {{ qtyUnits.toFixed(3) }} <span class="text-14px font-700 text-muted">{{ selectedUnit }}</span>
                  </span>
                </div>
                <div class="text-11px font-600 text-muted border-t border-borderSoft pt-4px">
                  RM {{ targetRmEntry || "0" }} ÷ RM {{ (priceCents / 100).toFixed(2) }}/{{ selectedUnit }}
                  <span v-if="priceCents <= 0" class="text-terracotta ml-4px">(Enter unit price first)</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Right column: Unit price + Active input display + numpad -->
          <div class="flex flex-col gap-10px">
            <!-- Unit Price Input Card -->
            <div
              class="p-10px rounded-8px border-2 cursor-pointer press flex flex-col transition-all"
              :class="
                activeInput === 'price'
                  ? 'border-ink bg-surface shadow-sm'
                  : 'border-border bg-panel hover:border-control'
              "
              @click="activeInput = 'price'"
            >
              <div class="flex items-center justify-between text-11px font-700 text-muted uppercase">
                <span>Unit Price / Harga Seunit (per {{ selectedUnit }})</span>
                <span v-if="activeInput === 'price'" class="text-positive font-800">● Typing Price</span>
              </div>
              <div class="flex items-baseline justify-between mt-2px">
                <span class="text-16px font-700 text-muted">RM</span>
                <span class="text-32px font-800 text-terracotta leading-none num">
                  {{ priceEntry || "0.00" }}
                </span>
              </div>
            </div>

            <!-- Active Target RM Card (in budget mode) -->
            <div
              v-if="calcMode === 'budget'"
              class="p-10px rounded-8px border-2 cursor-pointer press flex flex-col transition-all"
              :class="
                activeInput === 'targetRm'
                  ? 'border-ink bg-surface shadow-sm'
                  : 'border-border bg-panel hover:border-control'
              "
              @click="activeInput = 'targetRm'"
            >
              <div class="flex items-center justify-between text-11px font-700 text-muted uppercase">
                <span>Target RM Budget / Bajet RM</span>
                <span v-if="activeInput === 'targetRm'" class="text-positive font-800">● Typing Budget</span>
              </div>
              <div class="flex items-baseline justify-between mt-2px">
                <span class="text-16px font-700 text-muted">RM</span>
                <span class="text-32px font-800 text-ink leading-none num">
                  {{ targetRmEntry || "0.00" }}
                </span>
              </div>
            </div>

            <!-- Active Quantity Card (in direct mode) -->
            <div
              v-else
              class="p-10px rounded-8px border-2 cursor-pointer press flex flex-col transition-all"
              :class="
                activeInput === 'qty'
                  ? 'border-ink bg-surface shadow-sm'
                  : 'border-border bg-panel hover:border-control'
              "
              @click="activeInput = 'qty'"
            >
              <div class="flex items-center justify-between text-11px font-700 text-muted uppercase">
                <span>Direct Quantity / Kuantiti</span>
                <span v-if="activeInput === 'qty'" class="text-positive font-800">● Typing Qty</span>
              </div>
              <div class="flex items-baseline justify-between mt-2px">
                <span class="text-32px font-800 text-ink leading-none num">
                  {{ qtyEntry || "0" }}
                </span>
                <span class="text-16px font-700 text-muted">{{ selectedUnit }}</span>
              </div>
            </div>

            <!-- Total Line Summary -->
            <div class="bg-panel rounded-6px p-8px px-12px border border-border flex items-baseline justify-between text-13px font-700">
              <span class="text-muted uppercase">Total / Jumlah:</span>
              <span class="text-22px font-800 text-ink num">
                RM {{ (lineTotalCents / 100).toFixed(2) }}
              </span>
            </div>

            <!-- Keypad -->
            <div class="grid grid-cols-3 gap-8px">
              <button
                v-for="k in KEYS"
                :key="k"
                type="button"
                class="h-54px rounded-6px border-2 text-24px font-800 cursor-pointer press num"
                :class="
                  k === '⌫'
                    ? 'border-ink bg-ink text-white'
                    : 'border-border bg-tile text-ink hover:border-control'
                "
                @click="tapKey(k)"
              >
                {{ k }}
              </button>
            </div>
          </div>
        </div>

        <footer class="px-20px py-16px border-t border-border bg-surface flex items-center gap-12px">
          <button
            type="button"
            class="h-56px px-20px btn-ghost text-16px font-700"
            @click="clearActive"
          >
            {{ L.clear }}
          </button>
          <button
            type="button"
            class="h-56px px-20px btn-ghost text-16px text-muted font-700"
            @click="emit('close')"
          >
            {{ L.cancel }}
          </button>
          <button
            type="button"
            class="btn-pay flex-1 h-56px text-20px font-800"
            :disabled="priceCents <= 0 || qtyUnits <= 0"
            @click="submit"
          >
            {{ L.add }}
          </button>
        </footer>
      </div>
    </div>
</template>
