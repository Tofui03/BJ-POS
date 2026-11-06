<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { allocateRepayment, fmtMoney, toCents, type Credit, type RepaymentMethod } from "@yf/core";
import { CheckCircle2, DollarSign, Building, QrCode } from "lucide-vue-next";
import DecimalKeypad from "./DecimalKeypad.vue";
import { typeDecimalKey } from "../decimalEntry";
import { getRepo } from "../db";
import { currentCompany } from "../place";
import { currentBusinessDate } from "../business";
import { useUi } from "../stores/ui";
import { useCashier } from "../stores/cashier";
import { L } from "../labels";

const props = defineProps<{
  open: boolean;
  contractorName: string;
}>();

const emit = defineEmits<{
  settled: [totalCents: number, method: RepaymentMethod];
  close: [];
}>();

const ui = useUi();
const openCredits = ref<Credit[]>([]);
const method = ref<RepaymentMethod>("Cash");
const loading = ref(false);
const amountEntry = ref("");
const replaceAmount = ref(true);

const owedCents = computed(() => openCredits.value.reduce((acc, c) => acc + c.amountCents, 0));
const payCents = computed(() => Math.min(toCents(Number(amountEntry.value) || 0), owedCents.value));

function tapAmount(key: string): void {
  const next = typeDecimalKey(amountEntry.value, key, replaceAmount.value, 2);
  amountEntry.value = next.entry;
  replaceAmount.value = next.replace;
}

async function loadCredits(): Promise<void> {
  if (!props.contractorName) return;
  const repo = await getRepo();
  const allCredits = await repo.listCredits(currentCompany.value.id, { outstandingOnly: true });
  const target = props.contractorName.trim().toLowerCase();
  const matched = allCredits.filter(
    (c) => c.name.trim().toLowerCase() === target && c.clearedAt == null,
  );
  openCredits.value = matched;
  const owed = matched.reduce((acc, c) => acc + c.amountCents, 0);
  amountEntry.value = owed > 0 ? (owed / 100).toFixed(2) : "";
  replaceAmount.value = true;
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      method.value = "Cash";
      amountEntry.value = "";
      void loadCredits();
    }
  },
);

async function confirmSettlement(): Promise<void> {
  const pay = payCents.value;
  if (pay <= 0 || openCredits.value.length === 0 || loading.value) return;
  loading.value = true;
  try {
    const repo = await getRepo();
    const bDate = await currentBusinessDate(currentCompany.value.id);
    const cashierStore = useCashier();
    const plan = allocateRepayment(pay, openCredits.value);
    await repo.recordRepayments(
      plan.allocations.map((part) => ({
        companyId: currentCompany.value.id,
        creditId: part.creditId,
        amountCents: part.amountCents,
        method: method.value,
        businessDate: bDate,
        cashierName: cashierStore.currentCashier || undefined,
      })),
    );
    ui.showToast(`Received ${fmtMoney(plan.totalAppliedCents)}`);
    emit("settled", plan.totalAppliedCents, method.value);
    emit("close");
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : "Payment failed");
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 bg-[rgba(10,10,10,.55)] flex items-center justify-center p-16px z-90 select-none"
    @click.self="!loading && $emit('close')"
  >
    <div
      class="w-540px max-w-full bg-surface rounded-12px border border-border shadow-2xl flex flex-col overflow-hidden"
      style="max-height: 94vh"
    >
      <div class="px-24px py-18px text-center border-b border-border bg-panel flex-none">
        <div class="text-15px font-700 text-muted uppercase tracking-wider">
          {{ L.debtSettlement }}
        </div>
        <div class="text-22px font-800 text-ink mt-4px">
          {{ contractorName }}
        </div>
        <div class="text-40px font-900 text-ink leading-tight num mt-6px">
          {{ fmtMoney(payCents) }}
        </div>
        <div class="text-16px font-700 text-ink mt-4px num">
          Owed {{ fmtMoney(owedCents) }}
        </div>
      </div>

      <div class="flex-1 overflow-y-auto p-20px flex flex-col gap-18px">
        <div>
          <div class="flex items-center justify-between mb-8px">
            <div class="text-16px font-800 text-ink">
              {{ L.outstandingInvoices }} ({{ openCredits.length }})
            </div>
          </div>
          <div class="flex flex-col gap-12px max-h-180px overflow-y-auto">
            <div
              v-for="c in openCredits"
              :key="c.id"
              class="flex items-center justify-between p-12px rounded-6px border-2 border-border bg-surface num"
            >
              <div>
                <div class="text-16px font-800 text-ink">{{ c.invNo }}</div>
              </div>
              <div class="text-20px font-800 text-ink">
                {{ fmtMoney(c.amountCents) }}
              </div>
            </div>
            <div
              v-if="openCredits.length === 0"
              class="text-14px font-600 text-muted p-12px text-center"
            >
              {{ L.noOutstandingDebt }}
            </div>
          </div>
        </div>

        <div>
          <div class="text-15px font-800 text-ink mb-8px">
            {{ L.settlementMethod }}
          </div>
          <div class="grid grid-cols-3 gap-12px">
            <button
              type="button"
              class="press h-56px rounded-8px border-2 flex items-center justify-center gap-8px text-15px font-800 cursor-pointer transition-colors"
              :class="
                method === 'Cash'
                  ? 'border-ink bg-ink text-white'
                  : 'border-border bg-surface text-ink hover:border-muted'
              "
              @click="method = 'Cash'"
            >
              <DollarSign class="w-18px h-18px" />
              <span>{{ L.cash }}</span>
            </button>
            <button
              type="button"
              class="press h-56px rounded-8px border-2 flex items-center justify-center gap-8px text-15px font-800 cursor-pointer transition-colors"
              :class="
                method === 'Bank'
                  ? 'border-ink bg-ink text-white'
                  : 'border-border bg-surface text-ink hover:border-muted'
              "
              @click="method = 'Bank'"
            >
              <Building class="w-18px h-18px" />
              <span>{{ L.bank }}</span>
            </button>
            <button
              type="button"
              class="press h-56px rounded-8px border-2 flex items-center justify-center gap-8px text-15px font-800 cursor-pointer transition-colors"
              :class="
                method === 'QR'
                  ? 'border-ink bg-ink text-white'
                  : 'border-border bg-surface text-ink hover:border-muted'
              "
              @click="method = 'QR'"
            >
              <QrCode class="w-18px h-18px" />
              <span>{{ L.qr }}</span>
            </button>
          </div>
        </div>

        <DecimalKeypad key-class="h-56px" @key="tapAmount" />
      </div>

      <div class="px-24px py-16px flex-none border-t border-border bg-panel grid grid-cols-2 gap-16px">
        <button
          type="button"
          class="h-64px btn-ghost text-18px font-700 text-ink"
          :disabled="loading"
          @click="$emit('close')"
        >
          {{ L.cancel }}
        </button>
        <button
          type="button"
          class="h-64px btn-pay text-20px font-800 flex items-center justify-center gap-6px"
          :disabled="payCents <= 0 || loading"
          @click="confirmSettlement"
        >
          <CheckCircle2 class="w-18px h-18px" />
          <span>{{ loading ? L.settling : `${L.confirmSettlement} ${fmtMoney(payCents)}` }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
