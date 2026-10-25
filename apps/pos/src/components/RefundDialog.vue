<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  buildReceipt,
  fmtMoney,
  fmtQty,
  lineAmount,
  STORE_ADDRESS,
  toMilli,
  toQty,
  unitLabel,
  type Order,
  type OrderLine,
} from "@yf/core";
import { RotateCcw, X, AlertCircle } from "lucide-vue-next";
import { getRepo } from "../db";
import { printer } from "../printing/printer";
import { currentCompany } from "../place";
import { useCashier } from "../stores/cashier";
import { useUi } from "../stores/ui";
import { PAYMENT_UI } from "../payments";

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

function clearReturn(it: OrderLine, idx: number): void {
  const k = lineKey(it, idx);
  returnQuantities.value[k] = 0;
  inputStrings.value[k] = "0";
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
      const receipt = buildReceipt(refundOrder, {
        storeName: currentCompany.value.name,
        storeAddress: STORE_ADDRESS,
      });
      (receipt as any).isRefund = true;
      (receipt as any).refundOfInvNo = props.order.invNo;
      void printer.print(receipt);
    } catch {
      // Non-fatal if thermal print fails
    }

    ui.showToast(`Refund ${refundOrder.invNo} completed`);
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
      <!-- Header -->
      <div class="flex items-center justify-between px-24px py-18px border-b border-border bg-panel">
        <div>
          <div class="text-20px font-800 text-ink flex items-center gap-8px">
            <RotateCcw class="w-20px h-20px text-ink" />
            <span>Partial Return / 退货申请</span>
          </div>
          <div class="text-13px text-muted font-600 mt-2px">
            Ref: Receipt {{ order.invNo }} · {{ order.method }}
          </div>
        </div>
        <button
          type="button"
          class="w-36px h-36px rounded-6px flex items-center justify-center text-muted hover:text-ink hover:bg-surface cursor-pointer transition-colors"
          @click="$emit('close')"
        >
          <X class="w-20px h-20px" />
        </button>
      </div>

      <!-- Loading / Error -->
      <div v-if="loading" class="p-40px text-center text-muted font-700">
        Loading return details...
      </div>
      <div v-else-if="error" class="p-20px bg-[#ffedea] text-negative font-700 flex items-center gap-8px mx-24px my-16px rounded-6px">
        <AlertCircle class="w-18px h-18px shrink-0" />
        <span>{{ error }}</span>
      </div>

      <!-- Body / Items selection -->
      <div v-if="!loading" class="p-24px flex flex-col gap-16px overflow-y-auto">
        <div class="text-14px font-700 text-muted">
          Specify quantities to return (defaults to 0, max remaining):
        </div>

        <div class="flex flex-col gap-12px">
          <div
            v-for="(it, idx) in order.items"
            :key="lineKey(it, idx)"
            class="p-14px rounded-8px border border-border bg-surface flex flex-col gap-10px"
          >
            <div class="flex items-start justify-between gap-12px">
              <div>
                <div class="text-16px font-800 text-ink">{{ lineDisplayName(it) }}</div>
                <div class="text-13px font-600 text-muted mt-2px">
                  Unit price: <span class="font-700 text-ink">{{ fmtMoney(it.priceCents) }}</span> / {{ unitLabel(it.unit) }}
                  · Bought: {{ fmtQty(it.qtyMilli) }} {{ it.unit }}
                  · Remaining: <span class="font-700 text-ink">{{ fmtQty(remainingByLine[lineKey(it, idx)] ?? 0) }} {{ it.unit }}</span>
                </div>
              </div>
              <div class="text-right">
                <div class="text-17px font-800 text-negative num">
                  -{{ fmtMoney(lineRefundCents(it, idx)) }}
                </div>
                <div class="text-12px text-muted font-600">Refund Amount</div>
              </div>
            </div>

            <!-- Return Qty Input Row -->
            <div class="flex items-center gap-10px pt-8px border-t border-border">
              <span class="text-13px font-700 text-muted">Return Qty:</span>
              <input
                type="number"
                step="any"
                min="0"
                :max="toQty(remainingByLine[lineKey(it, idx)] ?? 0)"
                :disabled="(remainingByLine[lineKey(it, idx)] ?? 0) <= 0"
                class="w-110px h-38px px-10px rounded-6px border border-border bg-panel text-15px font-800 text-ink num focus:outline-none focus:border-ink"
                :value="inputStrings[lineKey(it, idx)] ?? '0'"
                @input="onQtyInput(it, idx, ($event.target as HTMLInputElement).value)"
              />
              <span class="text-13px font-600 text-muted">{{ it.unit }}</span>

              <div class="ml-auto flex items-center gap-6px">
                <button
                  type="button"
                  class="h-32px px-10px rounded-4px border border-border bg-panel text-12px font-700 text-ink cursor-pointer hover:bg-surface press"
                  :disabled="(remainingByLine[lineKey(it, idx)] ?? 0) <= 0"
                  @click="setMaxReturn(it, idx)"
                >
                  Max (All)
                </button>
                <button
                  type="button"
                  class="h-32px px-10px rounded-4px border border-border bg-panel text-12px font-700 text-muted cursor-pointer hover:bg-surface press"
                  @click="clearReturn(it, idx)"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Payment Channel / Reversal Info -->
        <div class="p-14px rounded-8px border border-border bg-panel flex flex-col gap-6px">
          <div class="flex items-center justify-between text-14px font-700">
            <span class="text-muted">Refund Channel (Matches Original):</span>
            <span class="text-ink font-800 flex items-center gap-6px">
              <span
                class="inline-block w-8px h-8px rounded-full"
                :style="{ backgroundColor: PAYMENT_UI[order.method]?.color || '#000' }"
              ></span>
              {{ order.method === "Credit" ? "Credit Balance Reversal / 赊账额度冲减" : order.method }}
            </span>
          </div>
          <div v-if="order.method === 'Credit'" class="text-12px text-muted">
            Refund will automatically reduce the contractor's outstanding debt on this order.
          </div>
        </div>
      </div>

      <!-- Footer / Summary & Actions -->
      <div class="px-24px py-18px border-t border-border bg-surface flex flex-col gap-12px">
        <div class="flex items-baseline justify-between">
          <span class="text-17px font-800 text-ink">Total Refund Amount:</span>
          <span class="text-28px font-800 text-negative num">
            -{{ fmtMoney(totalRefundCents) }}
          </span>
        </div>

        <div class="grid grid-cols-2 gap-12px">
          <button
            type="button"
            class="h-50px rounded-6px border border-border bg-surface text-15px font-700 text-muted cursor-pointer press hover:bg-panel"
            @click="$emit('close')"
          >
            Cancel / 取消
          </button>
          <button
            type="button"
            class="h-50px rounded-6px border border-negative bg-negative text-15px font-800 text-white cursor-pointer press disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-8px"
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
