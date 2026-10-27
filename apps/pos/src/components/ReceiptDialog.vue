<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  fmtMoney,
  fmtQty,
  lineDiscountCents,
  orderGrossSubtotalCents,
  orderTotalDiscountCents,
  unitLabel,
  type Order,
  type OrderLine,
} from "@yf/core";
import { Printer, Truck, X, RotateCcw } from "lucide-vue-next";
import { getRepo } from "../db";
import { PAYMENT_UI } from "../payments";
import { useUi } from "../stores/ui";
import { useCashier } from "../stores/cashier";
import { L } from "../labels";
import RefundDialog from "./RefundDialog.vue";
import { printDeliveryOrder, printOrderReceipt } from "../printing/printDocuments";

const props = defineProps<{ order: Order | null }>();
const emit = defineEmits<{ close: []; voided: [order: Order] }>();

const ui = useUi();
const showRefund = ref(false);

const canRefund = computed(() => {
  const o = props.order;
  if (!o) return false;
  return o.voidedAt == null && o.refundOfOrderId == null && o.totalCents > 0;
});

const isRefund = computed(() => {
  const o = props.order;
  if (!o) return false;
  return o.refundOfOrderId != null || o.totalCents < 0;
});

function onRefunded(_refundOrder: Order): void {
  showRefund.value = false;
  if (props.order) {
    emit("voided", props.order);
  }
  emit("close");
}

// A sale can be cancelled (voided) only while its business day is still open.
// Refund orders and orders with active refunds can never be voided.
const canVoid = ref(false);
const confirmVoid = ref(false);
watch(
  () => props.order,
  async (o) => {
    confirmVoid.value = false;
    canVoid.value = false;
    if (!o || o.voidedAt != null) return;
    if (o.refundOfOrderId != null || o.totalCents < 0) return;
    const repo = await getRepo();
    const isDayClosed = (await repo.getDayClose(o.businessDate, o.companyId)) != null;
    if (isDayClosed) return;
    const refunds = await repo.getRefundsForOrder(o.id);
    canVoid.value = refunds.length === 0;
  },
  { immediate: true },
);

async function doVoid(): Promise<void> {
  confirmVoid.value = false;
  const o = props.order;
  if (!o) return;
  const repo = await getRepo();
  const cashierStore = useCashier();
  await repo.voidOrder(o.id, Date.now(), cashierStore.currentCashier || undefined);
  ui.showToast(`Sale ${o.invNo} cancelled`);
  const updated = await repo.getOrder(o.id);
  emit("voided", updated ?? o);
}

function lineDisplayName(it: OrderLine): string {
  return it.customName?.trim() || it.name;
}

const totalDiscountCents = computed(() => {
  return props.order ? orderTotalDiscountCents(props.order) : 0;
});

const grossSubtotalCents = computed(() => {
  return props.order ? orderGrossSubtotalCents(props.order) : 0;
});

function rateText(it: OrderLine): string {
  return `${fmtMoney(it.priceCents)}/${unitLabel(it.unit)}`;
}

async function print(): Promise<void> {
  if (!props.order) return;
  try {
    await printOrderReceipt(props.order);
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : "Printing failed");
  }
}

const hasDo = computed(() => {
  const o = props.order;
  if (!o) return false;
  return Boolean(o.doNumber || o.siteAddress || o.lorryPlate || o.issueDo);
});

async function printDo(): Promise<void> {
  if (!props.order) return;
  try {
    await printDeliveryOrder(props.order);
    ui.showToast(`Printing DO ${props.order.doNumber ?? ""}`);
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : "DO print failed");
  }
}

const whenStr = computed(() => {
  if (!props.order) return "";
  const d = new Date(props.order.ts);
  return (
    d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }) +
    " · " +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );
});
</script>

<template>
  <div
    v-if="order"
    class="fixed inset-0 bg-[rgba(19,20,22,.45)] flex items-center justify-center p-24px z-70"
    @click.self="$emit('close')"
  >
    <div
      class="w-560px max-w-full max-h-88vh overflow-auto bg-surface rounded-12px border border-border shadow-[0_12px_32px_rgba(19,20,22,0.14)]"
    >
      <div class="flex items-center justify-between px-24px py-18px border-b border-border">
        <div>
          <div class="text-20px font-800 text-ink num flex items-center gap-8px">
            <span>{{ isRefund ? "Return" : "Receipt" }} {{ order.invNo }}</span>
            <span
              v-if="order.voidedAt != null"
              class="inline-flex items-center px-10px py-3px rounded-4px bg-[#ffedea] text-13px font-800 text-[#831c1e]"
            >
              Cancelled
            </span>
            <span
              v-else-if="isRefund"
              class="inline-flex items-center px-10px py-3px rounded-4px bg-[#e0f2fe] text-13px font-800 text-[#0369a1]"
            >
              RETURN / 退货
            </span>
          </div>
          <div class="text-14px font-600 text-muted mt-2px num">{{ whenStr }}</div>
          <div
            v-if="order.refundOfInvNo"
            class="text-13px font-700 text-muted mt-2px"
          >
            Refund for Receipt #{{ order.refundOfInvNo }}
          </div>
          <div
            v-if="order.contractorName"
            class="inline-flex items-center px-8px py-3px rounded-4px bg-[#fffbeb] text-13px font-800 text-warning mt-4px mr-6px"
          >
            {{ order.contractorName }}
          </div>
          <div
            v-if="order.doNumber"
            class="inline-flex items-center px-8px py-3px rounded-4px bg-panel border border-border text-13px font-800 text-ink mt-4px"
          >
            DO: {{ order.doNumber }}
          </div>
          <div
            v-if="order.note"
            class="text-13px font-700 text-ink/80 mt-4px bg-[#f8fafc] border border-border px-8px py-4px rounded-4px"
          >
            📝 {{ order.note }}
          </div>
        </div>
        <div class="flex items-center gap-10px">
          <span
            class="inline-flex items-center px-12px py-6px rounded-6px text-14px font-700 bg-panel text-ink whitespace-nowrap"
          >
            {{ PAYMENT_UI[order.method].label }}
          </span>
          <button
            type="button"
            class="w-46px h-46px flex-none rounded-6px border border-border bg-surface text-muted hover:text-ink flex items-center justify-center cursor-pointer press"
            @click="$emit('close')"
          >
            <X class="w-18px h-18px" />
          </button>
        </div>
      </div>

      <div class="px-24px py-16px flex flex-col gap-10px">
        <div class="flex items-center gap-14px text-12px font-700 text-faint">
          <div class="flex-1 min-w-0">{{ L.item }}</div>
          <div class="w-64px flex-none text-center">{{ L.qty }}</div>
          <div class="w-110px flex-none text-right">{{ L.amount }}</div>
        </div>
        <div
          v-for="it in order.items"
          :key="it.id"
          class="flex items-center gap-14px border-t border-borderSoft pt-10px"
        >
          <div class="flex-1 min-w-0">
            <div class="text-16px font-700 text-ink">{{ lineDisplayName(it) }}</div>
            <div class="text-13px font-600 text-muted flex items-center gap-6px flex-wrap num mt-2px">
              <span
                v-if="it.origPriceCents != null && it.origPriceCents > it.priceCents"
                class="line-through opacity-75"
              >
                {{ fmtMoney(it.origPriceCents) }}/{{ unitLabel(it.unit) }}
              </span>
              <span>{{ rateText(it) }}</span>
              <span v-if="lineDiscountCents(it) > 0" class="text-negative font-700">
                (-{{ fmtMoney(lineDiscountCents(it)) }})
              </span>
            </div>
          </div>
          <div class="w-64px flex-none text-center text-17px font-700 text-ink num">
            {{ fmtQty(it.qtyMilli) }}
          </div>
          <div class="w-110px flex-none text-right text-17px font-800 text-ink num">
            {{ fmtMoney(it.amountCents) }}
          </div>
        </div>
      </div>

      <div class="px-24px py-16px border-t border-border bg-panel flex flex-col gap-6px">
        <template v-if="totalDiscountCents > 0">
          <div class="flex items-baseline justify-between text-14px font-700 text-muted num">
            <span>{{ L.subtotal }}</span>
            <span>{{ fmtMoney(grossSubtotalCents) }}</span>
          </div>
          <div class="flex items-baseline justify-between text-14px font-700 text-negative num">
            <span>{{ L.discount }}</span>
            <span>-{{ fmtMoney(totalDiscountCents) }}</span>
          </div>
        </template>
        <div class="flex items-baseline justify-between">
          <span class="text-17px font-800 text-ink">{{ L.total }}</span>
          <span class="text-28px font-800 text-ink num">{{ fmtMoney(order.totalCents) }}</span>
        </div>
      </div>

      <div class="px-24px py-16px border-t border-border bg-surface flex flex-col gap-10px">
        <button
          type="button"
          class="btn-pay w-full h-54px text-17px inline-flex items-center justify-center gap-8px"
          @click="print"
        >
          <Printer class="w-18px h-18px" />
          <span>Print receipt / Cetak resit</span>
        </button>

        <button
          v-if="hasDo"
          type="button"
          class="w-full h-54px rounded-6px border-2 border-ink bg-surface text-16px font-800 text-ink cursor-pointer press inline-flex items-center justify-center gap-8px hover:bg-panel transition-colors"
          @click="printDo"
        >
          <Truck class="w-18px h-18px" />
          <span>Print DO / Cetak Nota Penghantaran</span>
        </button>

        <button
          v-if="canRefund"
          type="button"
          class="w-full h-50px rounded-6px border border-ink bg-surface text-15px font-800 text-ink cursor-pointer press inline-flex items-center justify-center gap-6px hover:bg-panel transition-colors"
          @click="showRefund = true"
        >
          <RotateCcw class="w-16px h-16px" />
          <span>Return / Refund / 退货</span>
        </button>

        <template v-if="canVoid">
          <button
            v-if="!confirmVoid"
            type="button"
            class="w-full h-50px rounded-6px border border-negative bg-surface text-15px font-700 text-negative cursor-pointer press inline-flex items-center justify-center gap-6px"
            @click="confirmVoid = true"
          >
            <X class="w-16px h-16px" />
            <span>{{ L.cancelSale }}</span>
          </button>
          <div v-else class="grid grid-cols-2 gap-10px">
            <button
              type="button"
              class="h-50px rounded-6px border border-border bg-surface text-15px font-700 text-muted cursor-pointer press"
              @click="confirmVoid = false"
            >
              {{ L.back }}
            </button>
            <button
              type="button"
              class="h-50px rounded-6px border border-negative bg-negative text-15px font-800 text-white cursor-pointer press"
              @click="doVoid"
            >
              {{ L.confirmCancelSale }}
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>

  <RefundDialog
    v-if="showRefund && order"
    :order="order"
    @close="showRefund = false"
    @refunded="onRefunded"
  />
</template>
