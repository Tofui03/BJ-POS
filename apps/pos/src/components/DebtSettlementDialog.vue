<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { fmtMoney, type Credit, type RepaymentMethod } from "@yf/core";
import { CheckCircle2, DollarSign, Building, QrCode } from "lucide-vue-next";
import TextInput from "./TextInput.vue";
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
const selectedCreditIds = ref<Set<number>>(new Set());
const method = ref<RepaymentMethod>("Cash");
const notes = ref("");
const loading = ref(false);

const selectedTotalCents = computed(() =>
  openCredits.value
    .filter((c) => selectedCreditIds.value.has(c.id))
    .reduce((acc, c) => acc + c.amountCents, 0),
);

function toggleSelect(id: number): void {
  const next = new Set(selectedCreditIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedCreditIds.value = next;
}

function toggleSelectAll(): void {
  if (selectedCreditIds.value.size === openCredits.value.length) {
    selectedCreditIds.value = new Set();
  } else {
    selectedCreditIds.value = new Set(openCredits.value.map((c) => c.id));
  }
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
  selectedCreditIds.value = new Set(matched.map((c) => c.id));
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      method.value = "Cash";
      notes.value = "";
      void loadCredits();
    }
  },
);

async function confirmSettlement(): Promise<void> {
  const toSettle = openCredits.value.filter((c) => selectedCreditIds.value.has(c.id));
  if (toSettle.length === 0 || loading.value) return;
  loading.value = true;
  try {
    const repo = await getRepo();
    const bDate = await currentBusinessDate(currentCompany.value.id);
    const now = Date.now();
    const cashierStore = useCashier();
    const settledAmount = await repo.clearCreditsByIds(
      toSettle.map((c) => c.id),
      now,
      currentCompany.value.id,
      method.value,
      notes.value.trim() || undefined,
      bDate,
      cashierStore.currentCashier || undefined,
    );

    ui.showToast(`Settled ${props.contractorName} · ${fmtMoney(settledAmount)} (${method.value})`);
    emit("settled", settledAmount, method.value);
    emit("close");
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : "Settlement failed");
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
        <div class="text-32px font-800 text-terracotta leading-tight num mt-6px">
          {{ fmtMoney(selectedTotalCents) }}
        </div>
      </div>

      <div class="flex-1 overflow-y-auto p-20px flex flex-col gap-18px">
        <div>
          <div class="flex items-center justify-between mb-8px">
            <div class="text-14px font-700 text-muted">
              {{ L.outstandingInvoices }} ({{ openCredits.length }})
            </div>
            <button
              v-if="openCredits.length > 1"
              type="button"
              class="text-13px font-700 text-ink hover:underline cursor-pointer bg-transparent border-none"
              @click="toggleSelectAll"
            >
              {{ selectedCreditIds.size === openCredits.length ? L.deselectAll : L.selectAll }}
            </button>
          </div>
          <div class="flex flex-col gap-8px max-h-260px overflow-y-auto">
            <div
              v-for="c in openCredits"
              :key="c.id"
              class="flex items-center justify-between p-12px rounded-6px border border-border bg-panel num cursor-pointer select-none"
              :class="selectedCreditIds.has(c.id) ? 'border-ink bg-panel' : 'opacity-60'"
              @click="toggleSelect(c.id)"
            >
              <div class="flex items-center gap-10px">
                <input
                  type="checkbox"
                  :checked="selectedCreditIds.has(c.id)"
                  class="w-18px h-18px accent-ink rounded cursor-pointer"
                  @click.stop="toggleSelect(c.id)"
                />
                <div>
                  <div class="text-15px font-700 text-ink">Inv #{{ c.invNo }}</div>
                  <div class="text-13px font-500 text-muted">
                    {{ new Date(c.date).toLocaleDateString("en-GB") }}
                  </div>
                </div>
              </div>
              <div class="text-17px font-800 text-terracotta">
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
          <div class="grid grid-cols-3 gap-10px">
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

        <div>
          <TextInput
            v-model="notes"
            :title="L.notesOptional"
            :placeholder="L.notesPlaceholder"
          />
        </div>
      </div>

      <div class="px-24px py-16px flex-none border-t border-border bg-panel grid grid-cols-2 gap-12px">
        <button
          type="button"
          class="h-52px btn-ghost text-16px font-700 text-muted"
          :disabled="loading"
          @click="$emit('close')"
        >
          {{ L.cancel }}
        </button>
        <button
          type="button"
          class="h-52px btn-pay text-17px font-800 flex items-center justify-center gap-6px"
          :disabled="selectedCreditIds.size === 0 || loading"
          @click="confirmSettlement"
        >
          <CheckCircle2 class="w-18px h-18px" />
          <span>{{ loading ? L.settling : `${L.confirmSettlement} (${fmtMoney(selectedTotalCents)})` }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
