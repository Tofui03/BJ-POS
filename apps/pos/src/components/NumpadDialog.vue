<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import {
  calcReverseQuantity,
  deductTare,
  reversePriceLine,
  toCents,
  type PricedItem,
} from "@yf/core";
import { Scale, Target } from "lucide-vue-next";
import { L } from "../labels";
import { shouldAutoTriggerNumpad } from "../interactions";

const props = defineProps<{
  open: boolean;
  title: string;
  /** Optional suffix shown next to the entered number (e.g. "kg"). */
  unit?: string;
  initial: number;
  /** Shows an "RM" label next to the entered value when no unit is given. */
  money?: boolean;
  item?: PricedItem;
  unitPriceCents?: number;
}>();

const emit = defineEmits<{ confirm: [value: number]; close: [] }>();

const unitText = computed(() => props.unit ?? "");

const isWeighable = computed(() => {
  if (props.money) return false;
  return shouldAutoTriggerNumpad(props.item?.unit || props.unit);
});

// Single keypad mode state (for discrete items or price editing)
const entry = ref("");
const replace = ref(true);
const display = computed(() => entry.value || "0");

// Dual-tab weighable state
const activeTab = ref<"weight" | "targetRm">("weight");

// Tab 1: Weight & Tare
const activeField = ref<"gross" | "tare">("gross");
const grossEntry = ref("");
const tareEntry = ref("0");
const replaceGross = ref(true);
const replaceTare = ref(true);

const grossValue = computed(() => Number(grossEntry.value) || 0);
const tareValue = computed(() => Number(tareEntry.value) || 0);
const netValue = computed(() => {
  const grossMilli = Math.max(0, Math.round(grossValue.value * 1000));
  const tareMilli = Math.max(0, Math.round(tareValue.value * 1000));
  return deductTare(grossMilli, tareMilli) / 1000;
});

// Tab 2: Target RM Budget (Reverse Calculation)
const targetRmEntry = ref("");
const replaceTargetRm = ref(true);

const targetRmCents = computed(() => toCents(Number(targetRmEntry.value) || 0));
const effectiveUnitPriceCents = computed(() => {
  if (props.unitPriceCents !== undefined && props.unitPriceCents > 0) return props.unitPriceCents;
  if (props.item?.priceCents) return props.item.priceCents;
  return 0;
});

const targetRmResult = computed(() => {
  const cents = targetRmCents.value;
  if (cents <= 0) {
    return { qtyMilli: 0, qty: 0, unitPriceCents: effectiveUnitPriceCents.value, tier: null };
  }
  if (props.item && (!props.unitPriceCents || props.unitPriceCents === props.item.priceCents)) {
    try {
      const res = reversePriceLine(props.item, cents);
      return {
        qtyMilli: res.qtyMilli,
        qty: res.qtyMilli / 1000,
        unitPriceCents: res.unitPriceCents,
        tier: res.tier,
      };
    } catch {
      // fallback to calcReverseQuantity below
    }
  }
  if (effectiveUnitPriceCents.value > 0) {
    const qtyMilli = calcReverseQuantity(cents, effectiveUnitPriceCents.value);
    return {
      qtyMilli,
      qty: qtyMilli / 1000,
      unitPriceCents: effectiveUnitPriceCents.value,
      tier: null,
    };
  }
  return { qtyMilli: 0, qty: 0, unitPriceCents: 0, tier: null };
});

const BUDGET_PRESETS = [5, 10, 20, 50];
function setBudgetPreset(rm: number): void {
  targetRmEntry.value = String(rm);
  replaceTargetRm.value = false;
}

interface QuickPreset {
  label: string;
  value: number;
}

const KG_PRESETS: readonly QuickPreset[] = [
  { label: "100g", value: 0.1 },
  { label: "250g", value: 0.25 },
  { label: "500g", value: 0.5 },
  { label: "1 kg", value: 1 },
  { label: "5 kg", value: 5 },
];

const LENGTH_PRESETS: readonly QuickPreset[] = [
  { label: "1", value: 1 },
  { label: "3", value: 3 },
  { label: "5", value: 5 },
  { label: "10", value: 10 },
  { label: "20", value: 20 },
];

const normalizedUnit = computed(() =>
  (props.unit || props.item?.unit || "").trim().toLowerCase(),
);

const isLengthUnit = computed(
  () =>
    normalizedUnit.value === "ft" ||
    normalizedUnit.value === "meter" ||
    normalizedUnit.value === "m",
);

const activePresets = computed<readonly QuickPreset[]>(() => {
  if (isLengthUnit.value) return LENGTH_PRESETS;
  return KG_PRESETS;
});

function applyPreset(val: number): void {
  grossEntry.value = String(val);
  activeField.value = "gross";
  replaceGross.value = false;
}

watch(
  () => props.open,
  (o) => {
    if (o) {
      if (isWeighable.value) {
        activeTab.value = "weight";
        activeField.value = "gross";
        grossEntry.value = props.initial ? String(props.initial) : "";
        tareEntry.value = "0";
        replaceGross.value = true;
        replaceTare.value = true;
        targetRmEntry.value = "";
        replaceTargetRm.value = true;
      } else {
        entry.value = props.initial ? String(props.initial) : "";
        replace.value = true;
      }
    }
  },
);

const KEYS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "⌫"];

function tap(k: string): void {
  if (!isWeighable.value) {
    if (k === "⌫") {
      entry.value = entry.value.slice(0, -1);
      replace.value = false;
      return;
    }
    if (replace.value) {
      entry.value = "";
      replace.value = false;
    }
    if (k === ".") {
      if (entry.value.includes(".")) return;
      if (entry.value === "") entry.value = "0";
    }
    entry.value += k;
    return;
  }

  if (activeTab.value === "weight") {
    if (activeField.value === "gross") {
      if (k === "⌫") {
        grossEntry.value = grossEntry.value.slice(0, -1);
        replaceGross.value = false;
        return;
      }
      if (replaceGross.value) {
        grossEntry.value = "";
        replaceGross.value = false;
      }
      if (k === ".") {
        if (grossEntry.value.includes(".")) return;
        if (grossEntry.value === "") grossEntry.value = "0";
      }
      grossEntry.value += k;
    } else {
      if (k === "⌫") {
        tareEntry.value = tareEntry.value.slice(0, -1);
        replaceTare.value = false;
        return;
      }
      if (replaceTare.value) {
        tareEntry.value = "";
        replaceTare.value = false;
      }
      if (k === ".") {
        if (tareEntry.value.includes(".")) return;
        if (tareEntry.value === "") tareEntry.value = "0";
      }
      tareEntry.value += k;
    }
  } else {
    // targetRm tab
    if (k === "⌫") {
      targetRmEntry.value = targetRmEntry.value.slice(0, -1);
      replaceTargetRm.value = false;
      return;
    }
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
}

function clearAll(): void {
  if (!isWeighable.value) {
    entry.value = "";
    replace.value = false;
    return;
  }
  if (activeTab.value === "weight") {
    if (activeField.value === "gross") {
      grossEntry.value = "";
      replaceGross.value = false;
    } else {
      tareEntry.value = "0";
      replaceTare.value = true;
    }
  } else {
    targetRmEntry.value = "";
    replaceTargetRm.value = false;
  }
}

function ok(): void {
  if (!isWeighable.value) {
    const n = Number(entry.value) || 0;
    emit("confirm", n);
    return;
  }
  if (activeTab.value === "weight") {
    emit("confirm", netValue.value);
  } else {
    emit("confirm", targetRmResult.value.qty);
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (/^[0-9.]$/.test(e.key)) tap(e.key);
  else if (e.key === "Backspace") tap("⌫");
  else if (e.key === "Enter") ok();
  else if (e.key === "Escape") emit("close");
  else return;
  e.preventDefault();
}

watch(
  () => props.open,
  (o) => {
    if (o) window.addEventListener("keydown", onKeydown);
    else window.removeEventListener("keydown", onKeydown);
  },
);
onUnmounted(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 bg-[rgba(10,10,10,.45)] flex items-center justify-center p-20px z-90 select-none"
    @click.self="$emit('close')"
  >
    <div
      class="w-460px max-w-full bg-surface rounded-10px border border-border shadow-xl flex flex-col overflow-hidden"
      style="max-height: 96vh"
    >
      <!-- Dual-Tab Switcher (Only shown for weighable/measurable units kg, ft, meter) -->
      <div v-if="isWeighable" class="flex border-b border-border bg-panel flex-none">
        <button
          type="button"
          class="flex-1 py-12px px-16px text-15px font-700 cursor-pointer press flex items-center justify-center gap-6px border-b-3 transition-colors"
          :class="
            activeTab === 'weight'
              ? 'border-ink text-ink bg-surface font-800'
              : 'border-transparent text-muted hover:text-ink'
          "
          @click="activeTab = 'weight'"
        >
          <Scale class="w-16px h-16px" />
          <span>{{ L.weightQtyTare }}</span>
        </button>
        <button
          type="button"
          class="flex-1 py-12px px-16px text-15px font-700 cursor-pointer press flex items-center justify-center gap-6px border-b-3 transition-colors"
          :class="
            activeTab === 'targetRm'
              ? 'border-ink text-ink bg-surface font-800'
              : 'border-transparent text-muted hover:text-ink'
          "
          @click="activeTab = 'targetRm'"
        >
          <Target class="w-16px h-16px" />
          <span>{{ L.targetRmBudget }}</span>
        </button>
      </div>

      <!-- Header Title & Display -->
      <div class="px-20px pt-16px pb-14px border-b border-border flex-none">
        <div class="text-15px font-600 text-muted truncate">{{ title }}</div>

        <!-- Single Mode Display (Discrete / Price) -->
        <template v-if="!isWeighable">
          <div class="mt-8px flex items-baseline justify-end gap-10px bg-panel rounded-8px px-18px py-12px min-h-64px">
            <span v-if="money && !unit" class="mr-auto text-22px font-700 text-muted">RM</span>
            <span class="text-38px font-800 text-ink leading-none num">{{ display }}</span>
            <span class="text-18px font-700 text-muted">{{ unitText }}</span>
          </div>
        </template>

        <!-- Tab 1 Display: Gross / Tare / Net Weight -->
        <template v-else-if="activeTab === 'weight'">
          <!-- Gross & Tare Selectors -->
          <div class="grid grid-cols-2 gap-8px mt-10px">
            <button
              type="button"
              class="p-10px rounded-6px border text-left cursor-pointer press flex flex-col transition-all"
              :class="
                activeField === 'gross'
                  ? 'border-2 border-ink bg-surface shadow-sm'
                  : 'border-border bg-panel hover:border-control'
              "
              @click="activeField = 'gross'"
            >
              <span class="text-12px font-700 text-muted uppercase">{{ L.grossKasar }}</span>
              <span class="text-22px font-800 text-ink num mt-2px leading-tight">
                {{ grossEntry || "0" }} <span class="text-14px font-700 text-muted">{{ unitText }}</span>
              </span>
            </button>

            <button
              type="button"
              class="p-10px rounded-6px border text-left cursor-pointer press flex flex-col transition-all"
              :class="
                activeField === 'tare'
                  ? 'border-2 border-ink bg-surface shadow-sm'
                  : 'border-border bg-panel hover:border-control'
              "
              @click="activeField = 'tare'"
            >
              <div class="flex items-center justify-between">
                <span class="text-12px font-700 text-muted uppercase">{{ L.tareBekas }}</span>
                <span
                  v-if="tareValue > 0"
                  class="text-11px font-700 text-terracotta underline"
                  @click.stop="tareEntry = '0'"
                >
                  {{ L.clear }}
                </span>
              </div>
              <span class="text-22px font-800 text-ink num mt-2px leading-tight">
                {{ tareEntry || "0" }} <span class="text-14px font-700 text-muted">{{ unitText }}</span>
              </span>
            </button>
          </div>

          <!-- Computed Net Weight Banner -->
          <div class="mt-8px bg-panel rounded-8px px-16px py-10px border border-border flex items-baseline justify-between num">
            <div>
              <div class="text-12px font-700 text-muted uppercase">{{ L.netWeight }}:</div>
              <div class="text-11px font-600 text-muted mt-1px">
                Gross {{ grossValue.toFixed(3) }} − Tare {{ tareValue.toFixed(3) }}
              </div>
            </div>
            <div class="text-32px font-800 text-ink leading-none">
              {{ netValue.toFixed(3) }} <span class="text-16px font-700 text-muted">{{ unitText }}</span>
            </div>
          </div>

          <!-- Quick Weight / Length Presets (Senior-friendly, min 48px height, high contrast borders) -->
          <div class="mt-8px">
            <div class="text-11px font-700 text-muted uppercase mb-4px">
              {{ isLengthUnit ? L.quickLength + ':' : L.quickWeight + ':' }}
            </div>
            <div class="grid grid-cols-5 gap-6px">
              <button
                v-for="p in activePresets"
                :key="p.label"
                type="button"
                class="h-48px min-h-48px rounded-6px border-2 border-border bg-surface text-14px font-800 text-ink hover:border-ink hover:bg-tile active:bg-panel cursor-pointer press flex items-center justify-center num transition-colors"
                @click="applyPreset(p.value)"
              >
                {{ p.label }}
              </button>
            </div>
          </div>
        </template>

        <!-- Tab 2 Display: Target RM Budget Reverse Calculation -->
        <template v-else>
          <div class="mt-8px bg-panel rounded-8px px-16px py-10px border border-border flex flex-col gap-6px num">
            <div class="flex items-baseline justify-between">
              <span class="text-13px font-700 text-muted">{{ L.targetRm }}:</span>
              <div class="flex items-baseline gap-4px">
                <span class="text-16px font-700 text-muted">RM</span>
                <span class="text-30px font-800 text-ink leading-none">
                  {{ targetRmEntry || "0.00" }}
                </span>
              </div>
            </div>
            <div class="text-11px font-600 text-muted flex items-center justify-between border-t border-borderSoft pt-4px">
              <span>Rate: RM {{ (effectiveUnitPriceCents / 100).toFixed(2) }} / {{ unitText }}</span>
              <span v-if="targetRmResult.tier" class="text-positive font-700">{{ L.tierDiscountApplied }}</span>
            </div>
            <div class="flex items-baseline justify-between border-t border-border pt-4px">
              <span class="text-13px font-800 text-ink">{{ L.computedQuantity }}:</span>
              <div class="text-28px font-800 text-ink leading-none">
                {{ targetRmResult.qty.toFixed(3) }} <span class="text-16px font-700 text-muted">{{ unitText }}</span>
              </div>
            </div>
          </div>

          <!-- Quick RM Presets -->
          <div class="flex items-center gap-6px mt-8px">
            <span class="text-11px font-700 text-muted uppercase mr-4px">{{ L.quickRm }}:</span>
            <button
              v-for="b in BUDGET_PRESETS"
              :key="b"
              type="button"
              class="flex-1 h-34px rounded-4px border border-border bg-surface text-12px font-700 text-ink hover:border-ink cursor-pointer press num"
              @click="setBudgetPreset(b)"
            >
              RM {{ b }}
            </button>
          </div>
        </template>
      </div>

      <!-- Keypad -->
      <div class="p-16px grid grid-cols-3 gap-10px overflow-auto flex-1 min-h-0">
        <button
          v-for="k in KEYS"
          :key="k"
          type="button"
          class="h-60px rounded-6px border text-26px font-800 num"
          :class="
            k === '⌫'
              ? 'border-ink bg-ink text-white cursor-pointer press'
              : 'border-border bg-tile text-ink cursor-pointer press hover:border-control'
          "
          @click="tap(k)"
        >
          {{ k }}
        </button>
      </div>

      <!-- Action Footer -->
      <div class="px-16px py-14px grid grid-cols-3 gap-10px flex-none border-t border-border bg-surface">
        <button
          type="button"
          class="h-56px btn-ghost text-15px font-700"
          @click="clearAll"
        >
          {{ L.clear }}
        </button>
        <button
          type="button"
          class="h-56px btn-ghost text-15px font-700 text-muted"
          @click="$emit('close')"
        >
          {{ L.cancel }}
        </button>
        <button
          type="button"
          class="btn-pay h-56px text-20px font-800"
          @click="ok"
        >
          {{ L.ok }}
        </button>
      </div>
    </div>
  </div>
</template>
