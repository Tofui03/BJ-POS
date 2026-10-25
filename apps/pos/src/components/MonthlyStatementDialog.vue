<script setup lang="ts">
import { computed, ref, watch } from "vue";
import dayjs from "dayjs";
import { fmtMoney, type Contractor, type ContractorMonthlyStatement } from "@yf/core";
import { ChevronLeft, ChevronRight, Printer, X, FileText } from "lucide-vue-next";
import { getRepo } from "../db";
import { currentCompany } from "../place";
import { useUi } from "../stores/ui";
import { printHtml } from "../printing/printer";
import { renderContractorStatementHtml } from "../printing/renderContractorStatementHtml";
import { L } from "../labels";

const props = defineProps<{
  open: boolean;
  initialContractorId?: number | null;
  initialContractorName?: string | null;
  initialYearMonth?: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const ui = useUi();

const contractors = ref<Contractor[]>([]);
const selectedContractorId = ref<number | null>(null);
const selectedYearMonth = ref<string>(dayjs().format("YYYY-MM"));
const statement = ref<ContractorMonthlyStatement | null>(null);
const loading = ref(false);
const printing = ref(false);

const currentMonth = computed(() => dayjs().format("YYYY-MM"));
const canGoNext = computed(() => selectedYearMonth.value < currentMonth.value);
const monthDisplay = computed(() =>
  dayjs(selectedYearMonth.value + "-01").format("MMMM YYYY"),
);

const statementHtml = computed(() => {
  if (!statement.value) return "";
  return renderContractorStatementHtml(statement.value);
});

async function loadContractors(): Promise<void> {
  try {
    const repo = await getRepo();
    const list = await repo.listContractors(currentCompany.value.id);
    contractors.value = list;

    if (props.initialContractorId != null) {
      selectedContractorId.value = props.initialContractorId;
    } else if (props.initialContractorName) {
      const target = props.initialContractorName.trim().toLowerCase();
      const found = list.find((c) => c.name.trim().toLowerCase() === target);
      if (found) {
        selectedContractorId.value = found.id;
      } else if (list.length > 0) {
        selectedContractorId.value = list[0]!.id;
      }
    } else if (list.length > 0 && selectedContractorId.value == null) {
      selectedContractorId.value = list[0]!.id;
    }
  } catch {
    contractors.value = [];
  }
}

async function loadStatement(): Promise<void> {
  if (selectedContractorId.value == null) {
    statement.value = null;
    return;
  }
  loading.value = true;
  try {
    const repo = await getRepo();
    const res = await repo.getContractorMonthlyStatement(
      selectedContractorId.value,
      selectedYearMonth.value,
      currentCompany.value.id,
    );
    statement.value = res;
  } catch (err: any) {
    statement.value = null;
    ui.showToast("Failed to load statement: " + (err?.message || String(err)));
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      if (props.initialYearMonth) {
        selectedYearMonth.value = props.initialYearMonth;
      } else {
        selectedYearMonth.value = dayjs().format("YYYY-MM");
      }
      await loadContractors();
      await loadStatement();
    }
  },
  { immediate: true },
);

watch(
  () => selectedContractorId.value,
  () => {
    if (props.open) {
      void loadStatement();
    }
  },
);

function prevMonth(): void {
  selectedYearMonth.value = dayjs(selectedYearMonth.value + "-01")
    .subtract(1, "month")
    .format("YYYY-MM");
  void loadStatement();
}

function nextMonth(): void {
  if (!canGoNext.value) return;
  selectedYearMonth.value = dayjs(selectedYearMonth.value + "-01")
    .add(1, "month")
    .format("YYYY-MM");
  void loadStatement();
}

function setThisMonth(): void {
  selectedYearMonth.value = currentMonth.value;
  void loadStatement();
}

async function handlePrint(): Promise<void> {
  if (!statementHtml.value) return;
  printing.value = true;
  try {
    await printHtml(statementHtml.value);
    ui.showToast("Statement sent to printer / 已发送打印");
  } catch (err: any) {
    ui.showToast("Print failed: " + (err?.message || String(err)));
  } finally {
    printing.value = false;
  }
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 bg-ink/50 backdrop-blur-sm z-50 flex items-center justify-center p-16px"
    @click.self="$emit('close')"
  >
    <div
      class="bg-surface border-2 border-ink rounded-12px shadow-2xl w-full max-w-1100px h-92vh flex flex-col overflow-hidden"
    >
      <!-- Dialog Header -->
      <div
        class="p-16px border-b border-border bg-panel flex items-center justify-between gap-12px flex-none flex-wrap"
      >
        <div class="flex items-center gap-10px">
          <FileText class="w-22px h-22px text-ink" />
          <h2 class="m-0 text-18px font-800 text-ink">
            {{ L.monthlyStatement || "Monthly Statement / 月结对账单" }}
          </h2>
        </div>

        <!-- Controls: Contractor Dropdown + Month Stepper -->
        <div class="flex items-center gap-8px flex-wrap">
          <!-- Contractor Selector -->
          <div class="flex items-center gap-6px">
            <label class="text-13px font-700 text-muted">Contractor:</label>
            <select
              v-model="selectedContractorId"
              class="h-44px px-12px rounded-8px border-2 border-border bg-surface text-ink text-14px font-800 cursor-pointer focus:border-ink outline-none"
            >
              <option
                v-for="c in contractors"
                :key="c.id"
                :value="c.id"
              >
                {{ c.name }}{{ c.phone ? ` (${c.phone})` : "" }}
              </option>
            </select>
          </div>

          <!-- Month Stepper -->
          <div class="flex items-center gap-4px bg-surface border-2 border-border rounded-8px p-2px">
            <button
              type="button"
              class="w-38px h-38px rounded-6px flex items-center justify-center text-ink hover:bg-panel cursor-pointer press"
              title="Previous Month"
              @click="prevMonth"
            >
              <ChevronLeft class="w-18px h-18px" />
            </button>
            <span class="text-14px font-800 text-ink px-10px min-w-120px text-center">
              {{ monthDisplay }}
            </span>
            <button
              type="button"
              class="w-38px h-38px rounded-6px flex items-center justify-center text-ink hover:bg-panel cursor-pointer press disabled:opacity-30 disabled:cursor-not-allowed"
              title="Next Month"
              :disabled="!canGoNext"
              @click="nextMonth"
            >
              <ChevronRight class="w-18px h-18px" />
            </button>
          </div>

          <button
            type="button"
            class="h-44px px-12px rounded-8px border-2 border-border bg-surface text-ink text-13px font-800 cursor-pointer press hover:border-ink"
            @click="setThisMonth"
          >
            本月 / Current
          </button>

          <!-- Close -->
          <button
            type="button"
            class="w-44px h-44px rounded-8px border-2 border-border bg-surface text-muted hover:text-ink flex items-center justify-center cursor-pointer press ml-8px"
            @click="$emit('close')"
          >
            <X class="w-20px h-20px" />
          </button>
        </div>
      </div>

      <!-- KPI Summary Header Cards -->
      <div
        v-if="statement"
        class="grid grid-cols-5 gap-8px p-12px bg-surface border-b border-border flex-none text-center"
      >
        <div class="p-8px rounded-6px bg-panel border border-border">
          <div class="text-11px font-700 text-muted uppercase">Opening / 上期结欠</div>
          <div class="text-15px font-800 text-ink mt-2px">
            {{ fmtMoney(statement.broughtForwardCents) }}
          </div>
        </div>
        <div class="p-8px rounded-6px bg-panel border border-border">
          <div class="text-11px font-700 text-muted uppercase">Credits / 本月赊账</div>
          <div class="text-15px font-800 text-ink mt-2px text-amber-700">
            +{{ fmtMoney(statement.monthCreditsCents) }}
          </div>
        </div>
        <div class="p-8px rounded-6px bg-panel border border-border">
          <div class="text-11px font-700 text-muted uppercase">Payments / 本月还款</div>
          <div class="text-15px font-800 text-ink mt-2px text-green-700">
            -{{ fmtMoney(statement.monthRepaymentsCents) }}
          </div>
        </div>
        <div class="p-8px rounded-6px bg-panel border border-border">
          <div class="text-11px font-700 text-muted uppercase">Net / 当期净变动</div>
          <div
            class="text-15px font-800 mt-2px"
            :class="statement.monthNetCents >= 0 ? 'text-amber-800' : 'text-green-800'"
          >
            {{ fmtMoney(statement.monthNetCents) }}
          </div>
        </div>
        <div class="p-8px rounded-6px bg-ink text-white border border-ink">
          <div class="text-11px font-700 text-white/70 uppercase">Closing / 期末总欠</div>
          <div class="text-16px font-900 mt-2px">
            {{ fmtMoney(statement.closingDebtCents) }}
          </div>
        </div>
      </div>

      <!-- Main Body: A4 Iframe Preview -->
      <div class="flex-1 bg-[#525659] p-12px flex items-center justify-center overflow-hidden">
        <div
          v-if="loading"
          class="text-white text-16px font-700 flex items-center gap-8px"
        >
          <span>Loading statement / 正在生成对账单…</span>
        </div>
        <div
          v-else-if="!statement"
          class="text-white text-15px font-700 p-24px bg-panel/20 rounded-8px"
        >
          No contractor selected or statement not available.
        </div>
        <iframe
          v-else
          :srcdoc="statementHtml"
          class="w-full h-full max-w-[210mm] bg-white rounded-6px shadow-xl border-0"
        />
      </div>

      <!-- Dialog Footer -->
      <div
        class="p-14px border-t border-border bg-panel flex items-center justify-between flex-none"
      >
        <div class="text-13px font-700 text-muted">
          <span>A4 Portrait Standard Document (Malaysian Commercial Format)</span>
        </div>
        <div class="flex items-center gap-10px">
          <button
            type="button"
            class="h-50px px-20px rounded-8px border-2 border-border bg-surface text-ink text-15px font-800 cursor-pointer press hover:border-ink"
            @click="$emit('close')"
          >
            {{ L.close || "Close / 关闭" }}
          </button>
          <button
            type="button"
            class="btn-pay h-50px px-28px text-16px inline-flex items-center gap-8px"
            :disabled="loading || printing || !statement"
            @click="handlePrint"
          >
            <Printer class="w-20px h-20px" />
            <span>{{ L.printStatement || "Print A4 / 打印 A4 对账单" }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
