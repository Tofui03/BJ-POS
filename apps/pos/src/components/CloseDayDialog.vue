<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import { computeStats, fmtMoney, localDateStr, type DayClose, type Order, type Repayment } from "@yf/core";
import { getRepo } from "../db";
import { currentCompany } from "../place";
import { getTodayClose, performClose, performReopen, type DailyReportDelivery } from "../business";
import { refreshBusinessDate } from "../salesDate";
import { useCashier } from "../stores/cashier";
import Loading from "./Loading.vue";
import { L } from "../labels";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; closed: [businessDate: string] }>();

const today = ref("");
const orders = ref<Order[]>([]);
const repayments = ref<Repayment[]>([]);
const closedAs = ref<DayClose | null>(null);
const step = ref<"summary" | "confirm" | "working" | "done">("summary");
const confirmReopenStep = ref(false);
const delivery = shallowRef<DailyReportDelivery | null>(null);

const stats = computed(() => computeStats(orders.value, "today", repayments.value));

async function load(): Promise<void> {
  const repo = await getRepo();
  today.value = localDateStr(Date.now());
  confirmReopenStep.value = false;
  const [dayClose, dayOrders, dayRepayments, outbox] = await Promise.all([
    getTodayClose(currentCompany.value.id),
    repo.listOrdersByBusinessDate(today.value, today.value, currentCompany.value.id),
    repo.listRepaymentsByBusinessDate(today.value, today.value, currentCompany.value.id),
    repo.listOutbox(today.value),
  ]);
  closedAs.value = dayClose;
  orders.value = dayOrders;
  repayments.value = dayRepayments;
  const report = outbox.find(
    (row) =>
      row.companyId === currentCompany.value.id &&
      row.attachmentName?.endsWith(`-close-day-${today.value}.xlsx`),
  );
  delivery.value = report ? (report.sentAt != null ? "sent" : "queued") : null;
  step.value = "summary";
}

watch(
  () => props.open,
  (o) => {
    if (o) void load();
  },
);

async function confirmClose(): Promise<void> {
  step.value = "working";
  try {
    const cashierStore = useCashier();
    const result = await performClose(today.value, {
      companyId: currentCompany.value.id,
      companyName: currentCompany.value.name,
      print: true,
      closedBy: cashierStore.currentCashier || undefined,
    });
    delivery.value = result.delivery;
    step.value = "done";
    await new Promise((r) => setTimeout(r, 1200));
    emit("closed", today.value);
  } catch {
    await load();
  }
}

async function retryReport(): Promise<void> {
  step.value = "working";
  try {
    const result = await performClose(today.value, {
      companyId: currentCompany.value.id,
      companyName: currentCompany.value.name,
      print: false,
    });
    delivery.value = result.delivery;
    step.value = "done";
    await new Promise((resolve) => setTimeout(resolve, 1200));
    emit("closed", today.value);
  } catch {
    await load();
  }
}

const doneMessage = computed(() =>
  delivery.value === "sent" ? L.driveSent : L.driveQueued,
);

const deliveryText = computed(() => {
  if (delivery.value === "sent") return L.driveSent;
  if (delivery.value === "queued") return L.driveQueued;
  return L.driveMissing;
});

async function reopen(): Promise<void> {
  confirmReopenStep.value = false;
  await performReopen(currentCompany.value.id);
  await refreshBusinessDate();
  await load();
}

const closedAtText = computed(() =>
  closedAs.value
    ? new Date(closedAs.value.closedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : "",
);
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 bg-[rgba(10,10,10,.45)] flex items-center justify-center p-24px z-90"
    @click.self="step !== 'working' && $emit('close')"
  >
    <div class="w-480px max-w-full bg-surface rounded-8px border border-border overflow-hidden">
      <template v-if="step === 'working' || step === 'done'">
        <Loading
          :state="step === 'done' ? 'success' : 'loading'"
          :message="step === 'done' ? doneMessage : L.closingDay"
        />
      </template>

      <template v-else-if="closedAs">
        <div class="px-24px pt-22px pb-16px border-b border-border text-center">
          <div class="text-22px font-700">{{ L.dayClosed }}</div>
          <div class="text-16px font-500 text-muted mt-8px leading-snug">
            {{ today }} · {{ closedAtText }}{{ closedAs.auto ? ` ${L.autoClosed}` : "" }}
          </div>
          <div class="text-16px font-700 mt-10px" :class="delivery === 'sent' ? 'text-ink' : 'text-terracotta'">
            {{ deliveryText }}
          </div>
        </div>
        <div class="px-24px py-20px flex flex-col gap-12px">
          <button class="btn-pay h-56px text-18px" @click="$emit('close')">{{ L.ok }}</button>
          <button
            v-if="!confirmReopenStep"
            class="btn-ghost h-56px text-16px text-muted"
            @click="confirmReopenStep = true"
          >{{ L.reopenDay }}</button>
          <div v-else class="grid grid-cols-2 gap-10px">
            <button
              class="btn-ghost h-56px text-16px text-muted"
              @click="confirmReopenStep = false"
            >{{ L.cancel }}</button>
            <button
              class="h-56px rounded-6px border border-ink bg-ink text-white text-16px font-700 cursor-pointer press"
              @click="reopen"
            >{{ L.confirmReopen }}</button>
          </div>
          <button
            v-if="delivery !== 'sent'"
            class="btn-ghost h-56px text-16px"
            @click="retryReport"
          >{{ delivery === "queued" ? L.retryUpload : L.createReport }}</button>
        </div>
      </template>

      <template v-else>
        <div class="px-24px pt-22px pb-14px border-b border-border">
          <div class="text-22px font-700">{{ L.closeDay }}</div>
          <div class="text-16px font-500 text-muted">{{ today }}</div>
        </div>

        <div class="px-24px py-16px flex flex-col gap-12px">
          <div class="flex bg-panel rounded-8px overflow-hidden text-center">
            <div class="flex-1 px-16px py-14px">
              <div class="text-14px font-500 text-muted mb-4px">{{ L.salesCount }}</div>
              <div class="text-30px font-700 text-ink leading-tight num">{{ stats.count }}</div>
            </div>
            <div class="w-1px bg-border flex-none" />
            <div class="flex-1 px-16px py-14px">
              <div class="text-14px font-500 text-muted mb-4px">{{ L.total }}</div>
              <div class="text-30px font-700 text-terracotta leading-tight num">{{ fmtMoney(stats.totalCents) }}</div>
            </div>
          </div>

          <div v-if="step === 'confirm'" class="text-center text-16px font-700 text-ink px-4px py-4px">
            {{ L.closeToday }}<br />
            <span class="text-15px font-500 text-muted">{{ L.closeDayHint }}</span>
          </div>
        </div>

        <div class="px-24px pb-22px grid grid-cols-2 gap-12px">
          <button
            class="btn-ghost h-56px text-16px text-muted"
            @click="step === 'confirm' ? (step = 'summary') : $emit('close')"
          >{{ step === "confirm" ? L.back : L.cancel }}</button>
          <button
            class="btn-pay h-56px text-18px"
            @click="step === 'confirm' ? confirmClose() : (step = 'confirm')"
          >{{ step === "confirm" ? L.yesClose : L.closeDay }}</button>
        </div>
      </template>
    </div>
  </div>
</template>
