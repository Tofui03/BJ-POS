<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import {
  computeStats,
  computeFinancialMetrics,
  fmtMoney,
  localDateStr,
  type DayClose,
  type Order,
  type Repayment,
} from "@yf/core";
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

const todayLabel = computed(() => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today.value);
  if (!m) return today.value;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${m[3]} ${months[Number(m[2]) - 1]} ${m[1]}`;
});

const stats = computed(() => computeStats(orders.value, "today", repayments.value));
const financialMetrics = computed(() => computeFinancialMetrics(orders.value, repayments.value));

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
    <div class="w-480px max-w-full bg-white rounded-14px border border-[#D6D3C9] shadow-[0_20px_50px_rgba(0,0,0,0.25)] overflow-hidden">
      <template v-if="step === 'working' || step === 'done'">
        <Loading
          :state="step === 'done' ? 'success' : 'loading'"
          :message="step === 'done' ? doneMessage : L.closingDay"
        />
      </template>

      <template v-else-if="closedAs">
        <div class="px-24px pt-22px pb-16px border-b border-[#E4E2DD] text-center bg-[#F4F3EF]">
          <div class="text-22px font-800 text-[#18181B] tracking-tight">{{ L.dayClosed }}</div>
          <div class="text-16px font-500 text-[#71717A] mt-8px leading-snug">
            {{ today }} · {{ closedAtText }}{{ closedAs.auto ? ` ${L.autoClosed}` : "" }}
          </div>
          <div class="text-16px font-700 mt-10px" :class="delivery === 'sent' ? 'text-[#18181B]' : 'text-terracotta'">
            {{ deliveryText }}
          </div>
        </div>
        <div class="px-24px py-20px flex flex-col gap-12px bg-white">
          <button class="h-56px text-18px font-800 rounded-8px border border-[#15803d] bg-[#16A34A] hover:bg-[#15803d] text-white shadow-[0_4px_0_#14532D] cursor-pointer active:translate-y-2px" @click="$emit('close')">{{ L.ok }}</button>
          <button
            v-if="!confirmReopenStep"
            class="h-56px text-16px font-700 rounded-8px border border-[#D4D2CA] bg-white hover:bg-[#F4F3EF] text-[#71717A] shadow-[0_2px_0_#C8C5BC] cursor-pointer active:translate-y-1px"
            @click="confirmReopenStep = true"
          >{{ L.reopenDay }}</button>
          <div v-else class="grid grid-cols-2 gap-10px">
            <button
              class="h-56px text-16px font-700 rounded-8px border border-[#D4D2CA] bg-white hover:bg-[#F4F3EF] text-[#71717A] shadow-[0_2px_0_#C8C5BC] cursor-pointer active:translate-y-1px"
              @click="confirmReopenStep = false"
            >{{ L.cancel }}</button>
            <button
              class="h-56px rounded-8px border border-[#18181B] bg-[#18181B] text-white text-16px font-800 shadow-[0_3px_0_#09090b] cursor-pointer active:translate-y-2px"
              @click="reopen"
            >{{ L.confirmReopen }}</button>
          </div>
          <button
            v-if="delivery !== 'sent'"
            class="h-56px text-16px font-700 rounded-8px border border-[#D4D2CA] bg-[#F4F3EF] hover:bg-[#E7E5DE] text-[#18181B] shadow-[0_2px_0_#C8C5BC] cursor-pointer active:translate-y-1px"
            @click="retryReport"
          >{{ delivery === "queued" ? L.retryUpload : L.createReport }}</button>
        </div>
      </template>

      <template v-else>
        <div class="px-24px pt-22px pb-14px border-b border-[#E4E2DD] bg-[#F4F3EF]">
          <div class="text-22px font-800 text-[#18181B] tracking-tight">{{ L.closeDay }}</div>
          <div class="text-18px font-700 text-[#52525B] mt-2px">{{ todayLabel }}</div>
        </div>

        <div class="px-24px py-16px flex flex-col gap-12px bg-white">
          <div class="flex gap-12px text-center">
            <div class="flex-1 px-16px py-14px bg-[#F4F3EF] border border-[#E2E0D8] rounded-10px shadow-[0_2px_0_#E2E0D8]">
              <div class="text-16px font-800 text-[#52525B] mb-4px">{{ L.salesCount }}</div>
              <div class="text-32px font-900 text-[#18181B] leading-tight num">{{ stats.count }}</div>
            </div>
            <div class="flex-1 px-16px py-14px bg-[#F4F3EF] border border-[#E2E0D8] rounded-10px shadow-[0_2px_0_#E2E0D8]">
              <div class="text-16px font-800 text-[#52525B] mb-4px">{{ L.grossMerchandiseSales }}</div>
              <div class="text-36px font-900 text-[#18181B] leading-tight num">{{ fmtMoney(financialMetrics.grossMerchandiseSalesCents) }}</div>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-12px">
            <div class="bg-white border border-[#D4D2CA] shadow-[0_2px_0_#C8C5BC] rounded-10px p-12px flex flex-col gap-4px">
              <span class="text-15px font-800 text-[#52525B]">{{ L.realizedInflow }}</span>
              <span class="text-26px font-900 text-[#18181B] num">{{ fmtMoney(financialMetrics.realizedInflowCents) }}</span>
            </div>
            <div class="bg-[#F4F3EF] border-2 border-[#18181B] shadow-[0_2px_0_#C8C5BC] rounded-10px p-12px flex flex-col gap-4px">
              <span class="text-15px font-800 text-[#18181B]">{{ L.expectedDrawerCash }}</span>
              <span class="text-28px font-900 text-[#18181B] num">{{ fmtMoney(financialMetrics.expectedDrawerCashCents) }}</span>
            </div>
          </div>

          <div v-if="step === 'confirm'" class="text-center text-20px font-800 text-[#18181B] px-4px py-4px">
            {{ L.closeToday }}
          </div>
        </div>

        <div class="px-24px pb-22px grid grid-cols-2 gap-16px bg-white">
          <button
            class="h-56px rounded-8px border border-[#D4D2CA] bg-white hover:bg-[#F4F3EF] text-16px font-700 text-[#71717A] shadow-[0_2px_0_#C8C5BC] cursor-pointer active:translate-y-1px"
            @click="step === 'confirm' ? (step = 'summary') : $emit('close')"
          >{{ step === "confirm" ? L.back : L.cancel }}</button>
          <button
            class="h-56px rounded-8px border border-[#15803d] bg-[#16A34A] hover:bg-[#15803d] text-white text-18px font-800 shadow-[0_4px_0_#14532D] cursor-pointer active:translate-y-2px"
            @click="step === 'confirm' ? confirmClose() : (step = 'confirm')"
          >{{ step === "confirm" ? L.yesClose : L.closeDay }}</button>
        </div>
      </template>
    </div>
  </div>
</template>
