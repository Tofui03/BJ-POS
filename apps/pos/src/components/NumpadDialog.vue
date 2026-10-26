<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  calcReverseQuantity,
  fmtMoney,
  reversePriceLine,
  toCents,
  type PricedItem,
} from "@yf/core";
import { RotateCcw, Scale, Target, X } from "lucide-vue-next";
import { L } from "../labels";
import { shouldAutoTriggerNumpad } from "../interactions";
import { appendDecimalKey } from "../decimalEntry";
import DecimalKeypad from "./DecimalKeypad.vue";

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

const emit = defineEmits<{
  confirm: [value: number];
  resetPrice: [];
  close: [];
}>();

const unitText = computed(() => props.unit ?? "");

const isWeighable = computed(() => {
  if (props.money) return false;
  return shouldAutoTriggerNumpad(props.item?.unit || props.unit);
});

const isLength = computed(() => {
  const u = (props.item?.unit || props.unit || "").toLowerCase();
  return u === "ft" || u === "meter";
});

// Mode for weighable items: 'weight' (direct net weight/length) vs 'budget' (target RM)
const activeMode = ref<"weight" | "budget">("weight");

// Direct entry string for weight / quantity / money
const entry = ref("");
const replace = ref(true);

// Budget entry string (when activeMode === 'budget')
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

const KG_PRESETS = [
  { label: "100g", val: 0.1 },
  { label: "250g", val: 0.25 },
  { label: "500g", val: 0.5 },
  { label: "1 kg", val: 1.0 },
  { label: "5 kg", val: 5.0 },
];

const LENGTH_PRESETS = [
  { label: "1", val: 1 },
  { label: "3", val: 3 },
  { label: "5", val: 5 },
  { label: "10", val: 10 },
  { label: "20", val: 20 },
];

const BUDGET_PRESETS = [2, 5, 10, 20, 50];

function reset(): void {
  activeMode.value = "weight";
  targetRmEntry.value = "";
  replaceTargetRm.value = true;
  if (props.initial > 0) {
    entry.value = props.money ? props.initial.toFixed(2) : String(props.initial);
    replace.value = true;
  } else {
    entry.value = "";
    replace.value = false;
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      reset();
    }
  },
);

function applyPreset(val: number): void {
  entry.value = String(val);
  replace.value = false;
}

function applyBudgetPreset(rm: number): void {
  targetRmEntry.value = String(rm);
  replaceTargetRm.value = false;
}

function handleResetPrice(): void {
  if (props.item && props.item.priceCents > 0) {
    emit("confirm", props.item.priceCents / 100);
    emit("resetPrice");
    emit("close");
  }
}

function tapKey(k: string): void {
  const limitDecimals = props.money || activeMode.value === "budget";
  const moneyDecimals = limitDecimals ? 2 : Number.POSITIVE_INFINITY;
  if (activeMode.value === "budget") {
    if (k === "C") {
      targetRmEntry.value = "";
      replaceTargetRm.value = false;
      return;
    }
    if (k === "⌫") {
      targetRmEntry.value = targetRmEntry.value.slice(0, -1);
      return;
    }
    if (replaceTargetRm.value) {
      targetRmEntry.value = k === "." ? "0." : k;
      replaceTargetRm.value = false;
      return;
    }
    targetRmEntry.value = appendDecimalKey(targetRmEntry.value, k, moneyDecimals);
    return;
  }

  if (k === "C") {
    entry.value = "";
    replace.value = false;
    return;
  }
  if (k === "⌫") {
    entry.value = entry.value.slice(0, -1);
    return;
  }
  if (replace.value) {
    entry.value = k === "." ? "0." : k;
    replace.value = false;
    return;
  }
  entry.value = appendDecimalKey(entry.value, k, moneyDecimals);
}

function handleConfirm(): void {
  if (activeMode.value === "budget") {
    if (targetRmResult.value.qty > 0) {
      emit("confirm", targetRmResult.value.qty);
      emit("close");
    }
    return;
  }

  const v = Number(entry.value);
  if (Number.isFinite(v) && v > 0) {
    emit("confirm", v);
    emit("close");
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (!props.open) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

  if (e.key === "Escape") {
    e.preventDefault();
    emit("close");
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    handleConfirm();
    return;
  }
  if (e.key === "Backspace") {
    e.preventDefault();
    tapKey("⌫");
    return;
  }
  if (e.key === "." || (e.key >= "0" && e.key <= "9")) {
    e.preventDefault();
    tapKey(e.key);
  }
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 bg-[rgba(19,20,22,.45)] flex items-center justify-center p-20px z-85"
    @click.self="emit('close')"
  >
    <section
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        class="w-540px max-w-full max-h-[92vh] bg-surface border border-border rounded-12px shadow-[0_12px_32px_rgba(19,20,22,0.14)] flex flex-col overflow-hidden"
      >
        <!-- Header -->
        <header class="flex-none flex items-center justify-between px-20px py-14px border-b border-border">
          <div class="flex items-center gap-10px min-w-0">
            <h2 class="m-0 text-18px font-800 text-ink truncate">
              {{ title }}
            </h2>
          </div>
          <button
            type="button"
            class="h-44px px-14px flex-none rounded-6px border border-border bg-surface text-15px font-700 text-ink cursor-pointer press inline-flex items-center gap-6px"
            @click="emit('close')"
          >
            <X class="w-18px h-18px text-muted" />
            <span>{{ L.close }}</span>
          </button>
        </header>

        <!-- Body -->
        <div class="flex-1 overflow-y-auto p-20px flex flex-col gap-14px">
          <!-- Unit Price Override Header: Prominent Reset Button -->
          <div v-if="money && item && item.priceCents > 0" class="flex items-center justify-between bg-panel p-10px rounded-8px">
            <div class="text-14px font-700 text-muted">
              原价: <span class="font-800 text-ink">{{ fmtMoney(item.priceCents) }}</span>
            </div>
            <button
              type="button"
              class="h-46px min-h-48px px-16px rounded-6px border-1.5 border-border bg-surface text-14px font-700 text-ink cursor-pointer press hover:border-ink flex items-center gap-6px"
              @click="handleResetPrice"
            >
              <RotateCcw class="w-15px h-15px text-muted flex-none" />
              <span>↺ 恢复原价 {{ fmtMoney(item.priceCents) }}</span>
            </button>
          </div>

          <!-- Weighable 2-Mode Toggle -->
          <div v-if="isWeighable" class="grid grid-cols-2 gap-10px flex-none">
            <button
              type="button"
              class="h-56px min-h-48px px-12px rounded-8px border-2 text-15px font-800 cursor-pointer press flex items-center justify-center gap-8px transition-colors"
              :class="activeMode === 'weight' ? 'border-ink bg-ink text-white' : 'border-border bg-surface text-ink hover:border-control'"
              @click="activeMode = 'weight'"
            >
              <Scale class="w-18px h-18px flex-none" />
              <span>⚖️ 按重量/长度输入</span>
            </button>
            <button
              type="button"
              class="h-56px min-h-48px px-12px rounded-8px border-2 text-15px font-800 cursor-pointer press flex items-center justify-center gap-8px transition-colors"
              :class="activeMode === 'budget' ? 'border-ink bg-ink text-white' : 'border-border bg-surface text-ink hover:border-control'"
              @click="activeMode = 'budget'"
            >
              <Target class="w-18px h-18px flex-none" />
              <span>💵 按客人给的钱算</span>
            </button>
          </div>

          <!-- Screen: Mode Weight / Direct Quantity -->
          <div v-if="activeMode === 'weight'" class="p-14px rounded-10px border-1.5 border-ink bg-panel flex items-baseline justify-between">
            <span class="text-20px font-800 text-muted">
              {{ money ? "RM" : "净重/数量:" }}
            </span>
            <div class="flex items-baseline gap-8px">
              <span class="text-36px font-800 text-ink tracking-tight num leading-none">
                {{ entry || "0" }}
              </span>
              <span v-if="unitText" class="text-20px font-700 text-muted">
                {{ unitText }}
              </span>
            </div>
          </div>

          <!-- Screen: Mode Target RM Budget -->
          <div v-else class="p-14px rounded-10px border-1.5 border-ink bg-panel flex flex-col gap-8px">
            <div class="flex items-baseline justify-between">
              <span class="text-20px font-800 text-muted">客人给的钱 (RM):</span>
              <span class="text-36px font-800 text-ink tracking-tight num leading-none">
                RM {{ targetRmEntry || "0.00" }}
              </span>
            </div>
            <div class="pt-8px border-t border-border flex items-baseline justify-between text-15px font-700">
              <span class="text-muted">自动算得数量:</span>
              <span class="text-20px font-800 text-positive num">
                = {{ targetRmResult.qty.toFixed(3) }} {{ unitText }}
              </span>
            </div>
          </div>

          <!-- 5 Giant Quick-Tap Presets (for Weighable or Budget) -->
          <div v-if="isWeighable && activeMode === 'weight'" class="flex flex-col gap-6px">
            <div class="text-13px font-700 text-muted">
              {{ isLength ? "Quick Length:" : "Quick Weight:" }}
            </div>
            <div class="grid grid-cols-5 gap-6px">
              <button
                v-for="p in (isLength ? LENGTH_PRESETS : KG_PRESETS)"
                :key="p.label"
                type="button"
                class="h-54px min-h-48px px-6px rounded-8px border-2 border-border bg-surface text-17px font-800 text-ink cursor-pointer press hover:border-ink flex items-center justify-center num"
                @click="applyPreset(p.val)"
              >
                {{ p.label }}
              </button>
            </div>
          </div>

          <div v-else-if="isWeighable && activeMode === 'budget'" class="flex flex-col gap-6px">
            <div class="text-13px font-700 text-muted">
              快捷预算 / Quick RM:
            </div>
            <div class="grid grid-cols-5 gap-6px">
              <button
                v-for="b in BUDGET_PRESETS"
                :key="b"
                type="button"
                class="h-54px min-h-48px px-6px rounded-8px border-2 border-border bg-surface text-17px font-800 text-ink cursor-pointer press hover:border-ink flex items-center justify-center num"
                @click="applyBudgetPreset(b)"
              >
                RM {{ b }}
              </button>
            </div>
          </div>

          <DecimalKeypad class="pt-4px" @key="tapKey">
            <template #action>
              <button
                type="button"
                class="btn-pay flex-1 min-h-128px rounded-8px text-20px font-800 flex flex-col items-center justify-center gap-6px leading-tight"
                :disabled="activeMode === 'budget' ? targetRmResult.qty <= 0 : (Number(entry) <= 0)"
                @click="handleConfirm"
              >
                <span>确定</span>
                <span class="text-14px font-700 opacity-90">OK</span>
              </button>
            </template>
          </DecimalKeypad>
        </div>
      </section>
    </div>
</template>
