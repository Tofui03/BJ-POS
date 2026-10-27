<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
  fmtMoney,
  fmtQtyUnit,
  PAYMENT_METHODS,
  type Order,
  type PaymentMethod,
} from "@yf/core";
import { Download, Search, CheckCircle2 } from "lucide-vue-next";
import dayjs from "dayjs";
import TopBar from "../components/TopBar.vue";
import OrdersDialog from "../components/OrdersDialog.vue";
import ReceiptDialog from "../components/ReceiptDialog.vue";
import { currentCompany } from "../place";
import { buildDailyExcelB64, downloadDailyExcel } from "../report/daily";
import { useSales } from "../stores/sales";
import { useCatalog } from "../stores/catalog";
import { PAYMENT_UI } from "../payments";
import {
  from,
  setCurrentDay,
  setDay,
  dateLabel,
  weekStartStr,
  weekEndStr,
  weekLabel,
  monthLabel,
  monthStartStr,
  monthEndStr,
} from "../salesDate";
import { L } from "../labels";
import {
  DONUT_RADIUS,
  METHOD_COLORS,
  computeReportOrderStats,
  computeRealizedCashflow,
  computeDonutSlices,
  aggregateFilteredItems,
  type AggregatedItemRow,
} from "../report/reportLogic";

const sales = useSales();
const tab = ref<"date" | "week" | "month">("date");
const methodFilter = ref<"All" | PaymentMethod>("All");
const searchQuery = ref("");
const sortBy = ref<"revenue" | "qty">("revenue");

const sel = computed(() => dayjs(from.value));

function loadSalesForTab(): void {
  if (tab.value === "date") void sales.loadRange(from.value, from.value);
  else if (tab.value === "week") void sales.loadRange(weekStartStr.value, weekEndStr.value);
  else void sales.loadMonth(monthStartStr.value, monthEndStr.value);
}

async function loadReport(): Promise<void> {
  loadSalesForTab();
}

const route = useRoute();
onMounted(() => {
  const q = route.query.date;
  if (typeof q === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q)) setDay(q);
  else setCurrentDay();
  void loadReport();
});

watch([tab, from, () => currentCompany.value.id], loadReport);

// Active period data sources
const periodOrders = computed(() => (tab.value === "month" ? sales.monthOrders : sales.rangeOrders));
const periodRepayments = computed(() => (tab.value === "month" ? sales.monthRepayments : sales.rangeRepayments));
const periodLabel = computed(() =>
  tab.value === "month" ? monthLabel.value : tab.value === "week" ? weekLabel.value : dateLabel.value,
);

// Pure accounting computations
const orderStats = computed(() => computeReportOrderStats(periodOrders.value));
const repaymentsTotalCents = computed(() =>
  periodRepayments.value.reduce((acc, r) => acc + r.amountCents, 0),
);
const repaymentsCount = computed(() => periodRepayments.value.length);

const cashflow = computed(() => computeRealizedCashflow(orderStats.value, repaymentsTotalCents.value));
const donutResult = computed(() => computeDonutSlices(orderStats.value, methodFilter.value));

const aggregatedResult = computed(() =>
  aggregateFilteredItems(periodOrders.value, methodFilter.value, searchQuery.value, sortBy.value),
);

// Center donut statistics
const centerStats = computed(() => {
  if (methodFilter.value === "All") {
    return {
      title: L.allChannels,
      totalCents: orderStats.value.totalCents,
      count: orderStats.value.count,
      percentage: 100,
    };
  }
  const m = methodFilter.value;
  const channelTotal = orderStats.value.byMethod[m]?.totalCents ?? 0;
  const channelCount = orderStats.value.byMethod[m]?.count ?? 0;
  const pct =
    donutResult.value.totalPositiveCents > 0
      ? Math.round((Math.max(0, channelTotal) / donutResult.value.totalPositiveCents) * 1000) / 10
      : 0;
  return {
    title: PAYMENT_UI[m].label,
    totalCents: channelTotal,
    count: channelCount,
    percentage: pct,
  };
});

function toggleMethodFilter(m: "All" | PaymentMethod): void {
  if (m === "All") {
    methodFilter.value = "All";
  } else {
    methodFilter.value = methodFilter.value === m ? "All" : m;
  }
}

function getMethodPercentage(m: PaymentMethod): number {
  const channelTotal = orderStats.value.byMethod[m]?.totalCents ?? 0;
  if (donutResult.value.totalPositiveCents <= 0) return 0;
  return Math.round((Math.max(0, channelTotal) / donutResult.value.totalPositiveCents) * 1000) / 10;
}

// Dialog inspection wiring
const detail = ref<Order | null>(null);
const inspect = ref<{ title: string; orders: Order[] } | null>(null);

function inspectMethod(m: PaymentMethod): void {
  inspect.value = {
    title: `${PAYMENT_UI[m].label} · ${periodLabel.value}`,
    orders: periodOrders.value.filter((o) => o.voidedAt == null && o.method === m),
  };
}

function inspectAllOrders(): void {
  inspect.value = {
    title: `${L.allChannels} · ${periodLabel.value}`,
    orders: periodOrders.value.filter((o) => o.voidedAt == null),
  };
}

function inspectRefunds(): void {
  inspect.value = {
    title: `${L.refundsProcessed} · ${periodLabel.value}`,
    orders: periodOrders.value.filter(
      (o) => o.voidedAt == null && (o.refundOfOrderId != null || o.totalCents < 0),
    ),
  };
}

function inspectRepayments(): void {
  inspect.value = {
    title: `${L.repaymentsCollected} · ${periodLabel.value}`,
    orders: periodRepayments.value.map((r) => ({
      id: -r.id,
      companyId: r.companyId,
      invNo: `REP-${r.id}`,
      businessDate: r.businessDate,
      ts: r.ts,
      cashierName: r.cashierName || undefined,
      method: r.method as PaymentMethod,
      items: [],
      subtotalCents: r.amountCents,
      discountCents: 0,
      totalCents: r.amountCents,
      contractorName: r.contractorName,
      note: r.notes ? `Repayment: ${r.notes}` : "Contractor Debt Repayment",
      voidedAt: null,
    })),
  };
}

function onSelectOrder(o: Order): void {
  if (o.id < 0 || o.invNo.startsWith("REP-")) {
    return;
  }
  detail.value = o;
}

function inspectItem(row: AggregatedItemRow): void {
  inspect.value = {
    title: `${row.name} · ${periodLabel.value}`,
    orders: periodOrders.value.filter(
      (o) =>
        o.voidedAt == null &&
        (methodFilter.value === "All" || o.method === methodFilter.value) &&
        o.items.some((li) => {
          if (row.itemId != null) return li.itemId === row.itemId;
          const displayName = li.customName?.trim() || li.name;
          return displayName === row.name && li.unit === row.unit;
        }),
    ),
  };
}

function onVoided(updated: Order): void {
  detail.value = updated;
  void loadReport();
  void useCatalog().load();
}

// Multi-period Excel export
async function downloadPeriodExcel(): Promise<void> {
  const company = currentCompany.value;
  const orders = periodOrders.value;
  const repayments = periodRepayments.value;
  const b64 = buildDailyExcelB64(orders, repayments);

  let filenameDate = "";
  if (tab.value === "date") {
    filenameDate = sel.value.format("YYYY-MM-DD");
  } else if (tab.value === "week") {
    filenameDate = `week-${weekStartStr.value}-to-${weekEndStr.value}`;
  } else {
    filenameDate = `month-${sel.value.format("YYYY-MM")}`;
  }

  const filename = `${company.name.replace(/\s+/g, "-")}-sales-${filenameDate}.xlsx`;
  downloadDailyExcel(b64, filename);
}

const downloadSelectedDayExcel = downloadPeriodExcel;
</script>

<template>
  <TopBar mode="report" />

  <div
    class="flex-1 min-h-0 overflow-y-auto bg-surface border border-border rounded-12px mx-8px mb-8px p-16px lg:p-20px flex flex-col gap-16px"
  >
    <div class="flex items-center justify-between gap-16px flex-none flex-wrap">
      <div class="flex items-center gap-16px flex-wrap">
        <div>
          <h1 class="m-0 text-22px font-800 text-ink leading-tight">{{ L.ownerSalesReport }}</h1>
          <div class="text-14px font-600 text-muted mt-2px num">{{ periodLabel }}</div>
        </div>

        <div class="flex gap-4px p-4px bg-panel border border-border rounded-10px shadow-inner">
          <button
            type="button"
            class="h-40px px-18px rounded-7px border-none cursor-pointer text-14px font-800 transition-all press"
            :class="tab === 'date' ? 'bg-ink text-white shadow-sm' : 'bg-transparent text-muted hover:text-ink hover:bg-surface/50'"
            @click="tab = 'date'"
          >
            {{ L.dayTab }}
          </button>
          <button
            type="button"
            class="h-40px px-18px rounded-7px border-none cursor-pointer text-14px font-800 transition-all press"
            :class="tab === 'week' ? 'bg-ink text-white shadow-sm' : 'bg-transparent text-muted hover:text-ink hover:bg-surface/50'"
            @click="tab = 'week'"
          >
            {{ L.weeklyTab }}
          </button>
          <button
            type="button"
            class="h-40px px-18px rounded-7px border-none cursor-pointer text-14px font-800 transition-all press"
            :class="tab === 'month' ? 'bg-ink text-white shadow-sm' : 'bg-transparent text-muted hover:text-ink hover:bg-surface/50'"
            @click="tab = 'month'"
          >
            {{ L.monthlyTab }}
          </button>
        </div>
      </div>

      <div class="flex items-center gap-10px">
        <button
          type="button"
          class="h-44px px-16px rounded-8px border-2 border-border bg-surface text-14px font-800 text-ink cursor-pointer press inline-flex items-center gap-8px hover:border-ink hover:shadow-sm transition-all"
          @click="downloadPeriodExcel"
        >
          <Download class="w-18px h-18px text-ink" />
          <span>{{ L.downloadExcel }}</span>
        </button>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-12 gap-16px items-start">
      <div class="lg:col-span-5 flex flex-col gap-14px min-w-0">
        <div class="bg-surface border border-border rounded-12px p-16px flex flex-col gap-12px shadow-sm">
          <div class="flex items-center justify-between">
            <span class="text-14px font-800 text-ink">{{ L.report }}</span>
            <span class="text-12px font-700 text-muted">{{ periodLabel }}</span>
          </div>

          <div class="relative w-180px h-180px mx-auto flex items-center justify-center my-4px">
            <svg viewBox="0 0 200 200" class="w-full h-full transform -rotate-90">
              <circle
                cx="100"
                cy="100"
                :r="DONUT_RADIUS"
                fill="none"
                stroke="#e2e8f0"
                :stroke-width="donutResult.hasPositiveSales ? 16 : 20"
              />
              <circle
                v-for="slice in donutResult.slices"
                :key="slice.method"
                cx="100"
                cy="100"
                :r="DONUT_RADIUS"
                fill="none"
                :stroke="slice.color"
                :stroke-width="methodFilter === slice.method ? 22 : 16"
                :stroke-dasharray="slice.strokeDasharray"
                :stroke-dashoffset="slice.strokeDashoffset"
                class="cursor-pointer transition-all duration-300"
                :class="methodFilter !== 'All' && methodFilter !== slice.method ? 'opacity-25' : 'opacity-100 hover:opacity-90'"
                @click="toggleMethodFilter(slice.method)"
              />
            </svg>

            <div
              class="absolute inset-0 flex flex-col items-center justify-center text-center cursor-pointer select-none p-10px"
              @click="toggleMethodFilter('All')"
              :title="methodFilter !== 'All' ? 'Click to reset filter' : ''"
            >
              <span class="text-11px font-800 uppercase tracking-tight text-muted">
                {{ centerStats.title }}
              </span>
              <span class="text-18px font-900 text-ink leading-tight num mt-2px">
                {{ fmtMoney(centerStats.totalCents) }}
              </span>
              <span class="text-11px font-700 text-muted mt-2px">
                {{ centerStats.count }} {{ L.salesCount }}
                <template v-if="methodFilter !== 'All' && centerStats.percentage > 0">
                  · {{ centerStats.percentage }}%
                </template>
              </span>
              <span v-if="methodFilter !== 'All'" class="text-10px font-800 text-brand mt-2px">
                Reset ✕
              </span>
            </div>
          </div>

          <div class="pt-10px border-t border-border flex flex-col gap-6px">
            <div class="flex items-center justify-between text-12px font-800">
              <span class="text-success flex items-center gap-4px">
                {{ L.realizedCashIn }}: {{ fmtMoney(cashflow.realizedCashInCents) }}
              </span>
              <span class="text-warning flex items-center gap-4px">
                {{ L.creditSales }}: {{ fmtMoney(cashflow.creditSalesCents) }}
              </span>
            </div>

            <div class="w-full h-8px bg-panel rounded-full overflow-hidden flex border border-borderSoft">
              <div
                class="h-full bg-success transition-all duration-300"
                :style="{ width: `${cashflow.cashRatioPercent}%` }"
                :title="`Realized Cash In: ${cashflow.cashRatioPercent}%`"
              />
              <div
                class="h-full bg-warning transition-all duration-300"
                :style="{ width: `${cashflow.creditRatioPercent}%` }"
                :title="`Credit Sales: ${cashflow.creditRatioPercent}%`"
              />
            </div>

            <div class="flex items-center justify-between text-11px font-700 text-muted num">
              <span>{{ L.cashRatio }}: {{ cashflow.cashRatioPercent }}%</span>
              <span>100% Flow</span>
            </div>
          </div>
        </div>

        <div class="bg-surface border border-border rounded-12px p-14px flex flex-col gap-8px shadow-sm">
          <div class="text-13px font-800 text-muted uppercase tracking-tight mb-2px">
            {{ L.choosePay }}
          </div>

          <div
            class="flex items-center justify-between p-10px rounded-8px border cursor-pointer transition-all press"
            :class="methodFilter === 'All' ? 'border-2 border-ink bg-panel/80 shadow-sm' : 'border-border bg-surface hover:border-ink/40'"
            @click="toggleMethodFilter('All')"
          >
            <div class="flex items-center gap-8px">
              <span class="w-10px h-10px rounded-full bg-ink flex-none" />
              <span class="text-14px font-800 text-ink">{{ L.total }} ({{ L.allChannels }})</span>
              <span class="px-6px py-1px rounded-full bg-panel text-11px font-800 text-muted">100%</span>
            </div>
            <div class="flex items-center gap-10px">
              <span class="text-11px font-700 text-muted">{{ orderStats.count }} {{ L.salesCount }}</span>
              <span class="text-15px font-900 text-ink num">{{ fmtMoney(orderStats.totalCents) }}</span>
              <button
                type="button"
                class="w-30px h-30px rounded-6px border border-border bg-surface hover:border-ink flex items-center justify-center cursor-pointer press"
                :title="L.inspectReceipts"
                @click.stop="inspectAllOrders"
              >
                <Search class="w-14px h-14px text-muted" />
              </button>
            </div>
          </div>

          <div
            v-for="m in PAYMENT_METHODS"
            :key="m"
            class="flex items-center justify-between p-10px rounded-8px border cursor-pointer transition-all press"
            :class="methodFilter === m ? 'border-2 border-ink bg-panel/80 shadow-sm' : 'border-border bg-surface hover:border-ink/40'"
            @click="toggleMethodFilter(m)"
          >
            <div class="flex items-center gap-8px">
              <span
                class="w-10px h-10px rounded-full flex-none"
                :style="{ backgroundColor: METHOD_COLORS[m].color }"
              />
              <span class="text-14px font-800 text-ink">{{ PAYMENT_UI[m].label }}</span>
              <span
                v-if="getMethodPercentage(m) > 0"
                class="px-6px py-1px rounded-full text-11px font-800"
                :style="{ backgroundColor: METHOD_COLORS[m].bg, color: METHOD_COLORS[m].color }"
              >
                {{ getMethodPercentage(m) }}%
              </span>
            </div>
            <div class="flex items-center gap-10px">
              <span class="text-11px font-700 text-muted">
                {{ orderStats.byMethod[m].count }} {{ L.salesCount }}
              </span>
              <span class="text-15px font-900 text-ink num">
                {{ fmtMoney(orderStats.byMethod[m].totalCents) }}
              </span>
              <button
                type="button"
                class="w-30px h-30px rounded-6px border border-border bg-surface hover:border-ink flex items-center justify-center cursor-pointer press"
                :title="L.inspectReceipts"
                @click.stop="inspectMethod(m)"
              >
                <Search class="w-14px h-14px text-muted" />
              </button>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-10px">
          <div class="bg-surface border border-border rounded-10px p-12px flex flex-col justify-between gap-6px shadow-sm">
            <div class="flex items-center justify-between">
              <span class="text-12px font-800 text-success">{{ L.repaymentsCollected }}</span>
              <button
                v-if="repaymentsCount > 0"
                type="button"
                class="w-26px h-26px rounded-5px border border-border bg-surface hover:border-ink flex items-center justify-center cursor-pointer press"
                :title="L.inspectReceipts"
                @click="inspectRepayments"
              >
                <Search class="w-12px h-12px text-muted" />
              </button>
            </div>
            <div class="text-18px font-900 text-success num leading-tight">
              +{{ fmtMoney(repaymentsTotalCents) }}
            </div>
            <div class="text-11px font-700 text-muted num">
              {{ repaymentsCount }} {{ L.cashflowInRecords }}
            </div>
          </div>

          <div class="bg-surface border border-border rounded-10px p-12px flex flex-col justify-between gap-6px shadow-sm">
            <div class="flex items-center justify-between">
              <span class="text-12px font-800 text-negative">{{ L.refundsProcessed }}</span>
              <button
                v-if="(orderStats.refundsCount ?? 0) > 0"
                type="button"
                class="w-26px h-26px rounded-5px border border-border bg-surface hover:border-ink flex items-center justify-center cursor-pointer press"
                :title="L.inspectReceipts"
                @click="inspectRefunds"
              >
                <Search class="w-12px h-12px text-muted" />
              </button>
            </div>
            <div class="text-18px font-900 text-negative num leading-tight">
              -{{ fmtMoney(Math.abs(orderStats.refundsTotalCents ?? 0)) }}
            </div>
            <div class="text-11px font-700 text-muted num">
              {{ orderStats.refundsCount ?? 0 }} {{ L.returnsDeducted }}
            </div>
          </div>
        </div>
      </div>

      <div class="lg:col-span-7 bg-surface border border-border rounded-12px p-16px flex flex-col gap-12px shadow-sm min-w-0">
        <div class="flex items-center justify-between gap-10px flex-wrap border-b border-border pb-12px">
          <div class="flex items-center gap-8px">
            <div
              v-if="methodFilter !== 'All'"
              class="inline-flex items-center gap-6px px-10px py-4px rounded-full text-12px font-800 border"
              :style="{
                backgroundColor: METHOD_COLORS[methodFilter].bg,
                color: METHOD_COLORS[methodFilter].color,
                borderColor: METHOD_COLORS[methodFilter].border,
              }"
            >
              <span>{{ PAYMENT_UI[methodFilter].label }}</span>
              <button
                type="button"
                class="border-none bg-transparent cursor-pointer font-900 hover:opacity-75"
                @click="methodFilter = 'All'"
              >
                ✕
              </button>
            </div>
            <span v-else class="text-14px font-800 text-ink">
              {{ L.items }} ({{ aggregatedResult.rows.length }})
            </span>
          </div>

          <div class="flex items-center gap-8px flex-wrap">
            <div class="relative flex items-center">
              <Search class="w-14px h-14px text-muted absolute left-10px pointer-events-none" />
              <input
                v-model="searchQuery"
                type="text"
                :placeholder="L.searchItems"
                class="h-34px pl-30px pr-10px rounded-6px border border-border bg-panel text-13px font-700 text-ink focus:border-ink outline-none w-150px"
              />
              <button
                v-if="searchQuery"
                type="button"
                class="absolute right-6px text-11px font-800 text-muted hover:text-ink cursor-pointer border-none bg-transparent"
                @click="searchQuery = ''"
              >
                ✕
              </button>
            </div>

            <div class="flex gap-2px p-2px bg-panel border border-border rounded-7px">
              <button
                type="button"
                class="h-30px px-10px rounded-5px border-none cursor-pointer text-12px font-800 transition-all press"
                :class="sortBy === 'revenue' ? 'bg-ink text-white shadow-xs' : 'bg-transparent text-muted hover:text-ink'"
                @click="sortBy = 'revenue'"
              >
                {{ L.sortByRevenue }}
              </button>
              <button
                type="button"
                class="h-30px px-10px rounded-5px border-none cursor-pointer text-12px font-800 transition-all press"
                :class="sortBy === 'qty' ? 'bg-ink text-white shadow-xs' : 'bg-transparent text-muted hover:text-ink'"
                @click="sortBy = 'qty'"
              >
                {{ L.sortByQty }}
              </button>
            </div>
          </div>
        </div>

        <div class="overflow-x-auto min-h-240px">
          <table class="w-full border-collapse num text-left">
            <thead>
              <tr class="text-12px font-700 text-faint border-b border-border">
                <th class="pb-8px text-left">{{ L.item }}</th>
                <th class="pb-8px px-10px text-right">{{ L.qty }}</th>
                <th class="pb-8px pl-10px text-right">{{ L.amount }}</th>
                <th class="pb-8px pl-10px w-36px" />
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in aggregatedResult.rows"
                :key="r.key"
                class="border-b border-borderSoft hover:bg-panel/40 transition-colors"
                :class="r.isNegative ? 'bg-negative/5' : ''"
              >
                <td class="py-10px pr-10px">
                  <div class="flex items-center gap-6px flex-wrap">
                    <span
                      class="text-14px font-700 leading-tight"
                      :class="r.isNegative ? 'text-negative font-800' : 'text-ink'"
                    >
                      {{ r.name }}
                    </span>
                    <span
                      v-if="r.isNegative"
                      class="px-5px py-1px rounded-4px bg-negative/10 text-negative text-10px font-800"
                    >
                      {{ L.refundItem }}
                    </span>
                  </div>
                </td>

                <td
                  class="py-10px px-10px text-right text-14px font-700 whitespace-nowrap"
                  :class="r.isNegative ? 'text-negative font-800' : 'text-muted'"
                >
                  {{ r.qtyMilli < 0 ? '-' : '' }}{{ fmtQtyUnit(Math.abs(r.qtyMilli), r.unit) }}
                </td>

                <td
                  class="py-10px pl-10px text-right text-15px font-900 whitespace-nowrap"
                  :class="r.isNegative ? 'text-negative' : 'text-ink'"
                >
                  {{ r.totalCents < 0 ? '-' : '' }}{{ fmtMoney(Math.abs(r.totalCents)) }}
                </td>

                <td class="py-10px pl-10px text-right">
                  <button
                    type="button"
                    class="w-28px h-28px rounded-6px border border-border bg-surface hover:border-ink flex items-center justify-center cursor-pointer press"
                    :title="L.inspectReceipts"
                    @click="inspectItem(r)"
                  >
                    <Search class="w-13px h-13px text-muted" />
                  </button>
                </td>
              </tr>

              <tr v-if="!aggregatedResult.rows.length">
                <td colspan="4" class="py-40px text-center text-14px font-600 text-faint">
                  {{ L.noSalesInPeriod }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="mt-auto pt-12px border-t border-border flex flex-col gap-6px bg-panel/30 -mx-16px -mb-16px p-16px rounded-b-12px">
          <div class="flex items-center justify-between text-13px font-700 text-muted">
            <template v-if="!searchQuery.trim()">
              <span>{{ L.itemSubtotal }} ({{ aggregatedResult.rows.length }} {{ L.items }}):</span>
            </template>
            <template v-else>
              <div class="flex items-center gap-6px flex-wrap">
                <span>{{ L.periodSubtotal }} ({{ periodLabel }}):</span>
                <span class="inline-flex items-center px-6px py-1px rounded-full bg-panel border border-border text-11px font-700 text-muted">
                  {{ aggregatedResult.rows.length }} {{ L.items }} {{ L.searchMatches }}
                </span>
              </div>
            </template>
            <span class="text-14px font-800 text-ink num">{{ fmtMoney(aggregatedResult.itemSubtotalCents) }}</span>
          </div>

          <div
            v-if="aggregatedResult.wholeBillDiscountCents !== 0"
            class="flex items-center justify-between text-13px font-700 text-muted"
          >
            <span>{{ L.wholeBillDiscounts }}:</span>
            <span class="text-14px font-800 text-negative num">
              {{ aggregatedResult.wholeBillDiscountCents > 0 ? '-' : '+' }}{{ fmtMoney(Math.abs(aggregatedResult.wholeBillDiscountCents)) }}
            </span>
          </div>

          <div class="flex items-center justify-between text-15px font-900 text-ink pt-4px border-t border-borderSoft">
            <div class="flex items-center gap-6px">
              <span>{{ L.netSales }}:</span>
              <span
                class="inline-flex items-center gap-4px px-6px py-1px rounded-full bg-success/10 text-success text-11px font-800"
                :title="L.reconciledZeroDrift"
              >
                <CheckCircle2 class="w-12px h-12px" />
                <span>{{ L.reconciledZeroDrift }}</span>
              </span>
            </div>
            <span class="text-18px font-900 text-ink num">
              {{ fmtMoney(aggregatedResult.orderRevenueCents) }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <OrdersDialog
    :title="inspect?.title ?? null"
    :orders="inspect?.orders ?? []"
    @select="onSelectOrder"
    @close="inspect = null"
  />
  <ReceiptDialog :order="detail" @voided="onVoided" @close="detail = null" />
</template>
