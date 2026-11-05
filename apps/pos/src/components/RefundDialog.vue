<script setup lang="ts">
import { L } from "../labels";
import { computed, onMounted, ref, watch } from "vue";
import { appendDecimalKey } from "../decimalEntry";
import DecimalKeypad from "./DecimalKeypad.vue";
import {
  fmtMoney,
  fmtQty,
  lineAmount,
  toMilli,
  toQty,
  unitLabel,
  type Order,
  type OrderLine,
} from "@yf/core";
import { RotateCcw, AlertCircle } from "lucide-vue-next";
import { getRepo } from "../db";
import { useCashier } from "../stores/cashier";
import { useUi } from "../stores/ui";
import { printOrderReceipt } from "../printing/printDocuments";

const props = defineProps<{
  order: Order;
}>();

const emit = defineEmits<{
  close: [];
  refunded: [order: Order];
}>();

const ui = useUi();
const cashierStore = useCashier();

const loading = ref(true);
const submitting = ref(false);
const error = ref<string | null>(null);
const priorRefunds = ref<Order[]>([]);

function lineKey(it: OrderLine, idx: number): string {
  return it.id != null ? `line_${it.id}` : `idx_${idx}`;
}

// Return quantities in thousandths (milli-units) per unique line key
const returnQuantities = ref<Record<string, number>>({});
// User-entered input string in human units per unique line key
const inputStrings = ref<Record<string, string>>({});
const activeKey = ref<string | null>(null);

async function loadPriorRefunds(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const repo = await getRepo();
    priorRefunds.value = await repo.getRefundsForOrder(props.order.id);
    // Initialize quantities to 0
    const q: Record<string, number> = {};
    const s: Record<string, string> = {};
    props.order.items.forEach((item, idx) => {
      const k = lineKey(item, idx);
      q[k] = 0;
      s[k] = "0";
    });
    returnQuantities.value = q;
    inputStrings.value = s;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to load prior refunds";
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void loadPriorRefunds();
});

watch(() => props.order.id, () => {
  void loadPriorRefunds();
});

// Calculate remaining returnable quantity per line
const remainingByLine = computed(() => {
  const map: Record<string, number> = {};
  const lineSlots = (props.order.items || []).map((it, idx) => ({
    key: lineKey(it, idx),
    item: it,
    remaining: it.qtyMilli,
  }));

  for (const refOrder of priorRefunds.value) {
    if (refOrder.voidedAt != null) continue;
    for (const refItem of refOrder.items) {
      let unallocated = refItem.qtyMilli;

      // 1. Try matching slot with same itemId and same priceCents (and matching customName if available)
      for (const slot of lineSlots) {
        if (unallocated <= 0) break;
        if (slot.remaining <= 0) continue;
        if (
          slot.item.itemId === refItem.itemId &&
          slot.item.priceCents === refItem.priceCents &&
          (refItem.customName == null || slot.item.customName === refItem.customName)
        ) {
          const deduct = Math.min(slot.remaining, unallocated);
          slot.remaining -= deduct;
          unallocated -= deduct;
        }
      }

      // 2. If still unallocated, match any slot with same itemId
      if (unallocated > 0) {
        for (const slot of lineSlots) {
          if (unallocated <= 0) break;
          if (slot.remaining <= 0) continue;
          if (slot.item.itemId === refItem.itemId) {
            const deduct = Math.min(slot.remaining, unallocated);
            slot.remaining -= deduct;
            unallocated -= deduct;
          }
        }
      }
    }
  }

  for (const slot of lineSlots) {
    map[slot.key] = Math.max(0, slot.remaining);
  }
  return map;
});

function lineDisplayName(it: OrderLine): string {
  return it.customName?.trim() || it.name || `Item #${it.itemId}`;
}

function onQtyInput(it: OrderLine, idx: number, rawVal: string): void {
  const k = lineKey(it, idx);
  inputStrings.value[k] = rawVal;
  const num = parseFloat(rawVal);
  const remaining = remainingByLine.value[k] ?? 0;
  if (!Number.isFinite(num) || num <= 0) {
    returnQuantities.value[k] = 0;
    return;
  }
  const milli = toMilli(num);
  returnQuantities.value[k] = Math.min(milli, remaining);
}

function setMaxReturn(it: OrderLine, idx: number): void {
  const k = lineKey(it, idx);
  const remaining = remainingByLine.value[k] ?? 0;
  returnQuantities.value[k] = remaining;
  inputStrings.value[k] = String(toQty(remaining));
}

function stepReturn(it: OrderLine, idx: number, delta: number): void {
  const k = lineKey(it, idx);
  const remaining = remainingByLine.value[k] ?? 0;
  const cur = returnQuantities.value[k] ?? 0;
  const next = Math.max(0, Math.min(remaining, cur + Math.round(delta * 1000)));
  returnQuantities.value[k] = next;
  inputStrings.value[k] = String(toQty(next));
}

function typeReturn(it: OrderLine, idx: number, key: string): void {
  const k = lineKey(it, idx);
  const next = appendDecimalKey(inputStrings.value[k] === "0" ? "" : (inputStrings.value[k] ?? ""), key);
  onQtyInput(it, idx, next || "0");
}

// Line refund amount in cents
function lineRefundCents(it: OrderLine, idx: number): number {
  const k = lineKey(it, idx);
  const qty = returnQuantities.value[k] ?? 0;
  return lineAmount(it.priceCents, qty);
}

// Total refund amount in cents
const totalRefundCents = computed(() => {
  let total = 0;
  props.order.items.forEach((it, idx) => {
    total += lineRefundCents(it, idx);
  });
  return total;
});

const hasReturnLines = computed(() => {
  return Object.values(returnQuantities.value).some((q) => q > 0);
});

async function doConfirmRefund(): Promise<void> {
  if (!hasReturnLines.value || submitting.value) return;
  submitting.value = true;
  error.value = null;

  try {
    const lines = props.order.items
      .map((it, idx) => {
        const k = lineKey(it, idx);
        const q = returnQuantities.value[k] ?? 0;
        return {
          orderItemId: it.id,
          itemId: it.itemId,
          qtyMilli: q,
        };
      })
      .filter((l) => l.qtyMilli > 0);

    const repo = await getRepo();
    const refundOrder = await repo.createRefundOrder({
      originalOrderId: props.order.id,
      lines,
      cashierName: cashierStore.currentCashier || undefined,
    });

    // Thermal return receipt print
    try {
      void printOrderReceipt(refundOrder);
    } catch {
      // Non-fatal if thermal print fails
    }

    ui.showToast(`${L.refundSuccessToast} #${refundOrder.invNo}`);
    emit("refunded", refundOrder);
    emit("close");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to process refund";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div
    class="fixed inset-0 bg-[rgba(19,20,22,.45)] flex items-center justify-center p-24px z-80"
    @click.self="$emit('close')"
  >
    <div
      class="w-640px max-w-full max-h-90vh overflow-auto bg-surface rounded-12px border border-border shadow-[0_16px_40px_rgba(19,20,22,0.18)] flex flex-col"
    >
      <div class="flex items-center justify-between px-24px py-18px border-b border-border bg-panel">
        <div>
          <div class="text-20px font-800 text-ink flex items-center gap-8px">
            <RotateCcw class="w-20px h-20px text-ink" />
            <span>{{ L.partialReturnTitle }}</span>
          </div>
          <div class="text-13px text-muted font-600 mt-2px">
            Ref: Receipt {{ order.invNo }} · {{ order.method }}
          </div>
        </div>
        <button
          type="button"
          class="h-56px px-16px rounded-6px border border-border bg-surface text-16px font-700 text-ink cursor-pointer press"
          @click="$emit('close')"
        >
          {{ L.close }}
        </button>
      </div>

      <div v-if="loading" class="p-40px text-center text-muted font-700">
        Loading return details...
      </div>
      <div v-else-if="error" class="p-20px bg-[#ffedea] text-negative font-700 flex items-center gap-8px mx-24px my-16px rounded-6px">
        <AlertCircle class="w-18px h-18px shrink-0" />
        <span>{{ error }}</span>
      </div>

      <div v-if="!loading" class="p-24px flex flex-col gap-16px overflow-y-auto">
        <div class="flex flex-col gap-12px">
          <div
            v-for="(it, idx) in order.items"
            :key="lineKey(it, idx)"
            class="p-14px rounded-8px border border-border bg-surface flex flex-col gap-10px"
          >
            <div class="flex items-start justify-between gap-12px">
              <div>
                <div class="text-20px font-800 text-ink">{{ lineDisplayName(it) }}</div>
                <div class="text-16px font-700 text-ink mt-2px">
                  {{ fmtMoney(it.priceCents) }} / {{ unitLabel(it.unit) }}
                  · {{ fmtQty(it.qtyMilli) }} {{ it.unit }}
                </div>
              </div>
              <div class="text-right">
                <div class="text-22px font-800 text-negative num">
                  -{{ fmtMoney(lineRefundCents(it, idx)) }}
                </div>
              </div>
            </div>

            <div class="flex items-center gap-12px pt-8px border-t border-border">
              <button
                type="button"
                class="w-56px h-56px rounded-8px border-2 border-border bg-surface text-24px font-800 text-ink cursor-pointer press"
                :disabled="(remainingByLine[lineKey(it, idx)] ?? 0) <= 0"
                @click="stepReturn(it, idx, -1)"
              >
                −
              </button>
              <button
                type="button"
                class="h-56px min-w-88px px-12px rounded-8px border-2 text-22px font-800 num cursor-pointer press"
                :class="activeKey === lineKey(it, idx) ? 'border-ink bg-ink text-white' : 'border-border bg-surface text-ink'"
                @click="activeKey = activeKey === lineKey(it, idx) ? null : lineKey(it, idx)"
              >
                {{ inputStrings[lineKey(it, idx)] ?? "0" }}
              </button>
              <button
                type="button"
                class="w-56px h-56px rounded-8px border-2 border-border bg-surface text-24px font-800 text-ink cursor-pointer press"
                :disabled="(remainingByLine[lineKey(it, idx)] ?? 0) <= 0"
                @click="stepReturn(it, idx, 1)"
              >
                +
              </button>
              <span class="text-16px font-800 text-ink">{{ it.unit }}</span>
              <button
                type="button"
                class="ml-auto h-56px px-14px rounded-8px border-2 border-border bg-surface text-16px font-800 text-ink cursor-pointer press"
                :disabled="(remainingByLine[lineKey(it, idx)] ?? 0) <= 0"
                @click="setMaxReturn(it, idx)"
              >
                {{ L.returnMaxAll }}
              </button>
            </div>
            <DecimalKeypad
              v-if="activeKey === lineKey(it, idx)"
              key-class="h-56px"
              @key="typeReturn(it, idx, $event)"
            />
          </div>
        </div>

        <div class="text-18px font-800 text-ink">
          {{ order.method }}
        </div>
      </div>

      <div class="px-24px py-18px border-t border-border bg-surface flex flex-col gap-12px">
        <div class="flex items-baseline justify-between">
          <span class="text-18px font-800 text-ink">{{ L.refund }}</span>
          <span class="text-36px font-900 text-ink num">
            -{{ fmtMoney(totalRefundCents) }}
          </span>
        </div>

        <div class="grid grid-cols-2 gap-16px">
          <button
            type="button"
            class="h-64px rounded-6px border border-border bg-surface text-18px font-700 text-ink cursor-pointer press"
            @click="$emit('close')"
          >
            {{ L.cancel }}
          </button>
          <button
            type="button"
            class="h-64px rounded-6px border border-negative bg-negative text-18px font-800 text-white cursor-pointer press disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-8px"
            :disabled="!hasReturnLines || totalRefundCents <= 0 || submitting"
            @click="doConfirmRefund"
          >
            <RotateCcw class="w-16px h-16px" />
            <span>{{ submitting ? "Processing..." : `Confirm Refund (-${fmtMoney(totalRefundCents)})` }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
