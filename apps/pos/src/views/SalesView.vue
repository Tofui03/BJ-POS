<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  fmtMoney,
  orderTotalDiscountCents,
  PAYMENT_METHODS,
  type ItemSale,
  type Order,
  type PaymentMethod,
  type Repayment,
  type RepaymentMethod,
} from "@yf/core";
import { ChevronRight } from "lucide-vue-next";
import TopBar from "../components/TopBar.vue";
import ReceiptDialog from "../components/ReceiptDialog.vue";
import OrdersDialog from "../components/OrdersDialog.vue";
import TopSellerCard from "../components/TopSellerCard.vue";
import { useSales } from "../stores/sales";
import { useCatalog } from "../stores/catalog";
import { useUi } from "../stores/ui";
import { PAYMENT_UI } from "../payments";
import { L } from "../labels";
import {
  from,
  dateLabel,
  setCurrentDay,
  weekStartStr,
  weekEndStr,
  weekLabel,
  monthLabel,
  monthStartStr,
  monthEndStr,
} from "../salesDate";

const sales = useSales();
const ui = useUi();

const tab = ref<"date" | "week" | "month">("date");
const methodFilter = ref<"All" | PaymentMethod>("All");
const detail = ref<Order | null>(null);

function loadForTab(): void {
  if (tab.value === "date") void sales.loadRange(from.value, from.value);
  else if (tab.value === "week") void sales.loadRange(weekStartStr.value, weekEndStr.value);
  else void sales.loadMonth(monthStartStr.value, monthEndStr.value);
}

onMounted(() => {
  setCurrentDay();
  loadForTab();
});
watch([tab, from], loadForTab);

const activeStats = computed(() => (tab.value === "month" ? sales.monthStats : sales.rangeStats));
const periodOrders = computed(() => (tab.value === "month" ? sales.monthOrders : sales.rangeOrders));
const periodRepayments = computed(() => (tab.value === "month" ? sales.monthRepayments : sales.rangeRepayments));
const periodLabel = computed(() =>
  tab.value === "month" ? monthLabel.value : tab.value === "week" ? weekLabel.value : dateLabel.value,
);

type TransactionRow =
  | { kind: "order"; order: Order; ts: number; method: PaymentMethod }
  | { kind: "repayment"; repayment: Repayment; ts: number; method: RepaymentMethod };

const filteredTransactions = computed<TransactionRow[]>(() => {
  const rows: TransactionRow[] = [];
  for (const o of periodOrders.value) {
    if (methodFilter.value === "All" || o.method === methodFilter.value) {
      rows.push({ kind: "order", order: o, ts: o.ts, method: o.method });
    }
  }
  for (const r of periodRepayments.value) {
    if (methodFilter.value === "All" || r.method === methodFilter.value) {
      rows.push({ kind: "repayment", repayment: r, ts: r.ts, method: r.method });
    }
  }
  return rows.sort((a, b) => b.ts - a.ts);
});

function toggleMethodFilter(m: "All" | PaymentMethod): void {
  if (m === "All") {
    methodFilter.value = "All";
  } else {
    methodFilter.value = methodFilter.value === m ? "All" : m;
  }
}

const inspect = ref<{ title: string; orders: Order[] } | null>(null);
function inspectItem(s: ItemSale): void {
  inspect.value = {
    title: `${s.name} · ${periodLabel.value}`,
    orders: periodOrders.value.filter((o) =>
      o.items.some((li) =>
        s.itemId != null ? li.itemId === s.itemId : (li.customName || li.name) === s.name && li.unit === s.unit,
      ),
    ),
  };
}

const timeStr = (ts: number) =>
  new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true });
const dateStr = (ts: number) =>
  new Date(ts).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
const itemsStr = (o: Order) => `${o.items.length} ${o.items.length === 1 ? "item" : "items"}`;

function onVoided(updated: Order): void {
  detail.value = updated;
  loadForTab();
  void useCatalog().load();
}
</script>

<template>
  <TopBar mode="sales" />

  <!-- Inset White Sheet on Warm Stone Ground -->
  <div
    class="flex-1 min-h-0 overflow-y-auto bg-surface border border-border rounded-12px mx-8px mb-8px p-20px flex flex-col gap-18px"
  >
    <!-- Header Row: Title + Segmented Period Control -->
    <div class="flex items-center justify-between gap-12px flex-wrap flex-none">
      <div class="flex items-center gap-16px flex-wrap">
        <div>
          <h1 class="m-0 text-22px font-800 text-ink leading-tight">Sales Ledger / Rekod Jualan</h1>
          <div class="text-14px font-600 text-muted mt-2px num">{{ periodLabel }}</div>
        </div>

        <div class="flex gap-4px p-4px bg-panel border border-border rounded-8px">
          <button
            type="button"
            class="h-42px px-18px rounded-6px border-none cursor-pointer text-15px font-700 transition-colors press"
            :class="tab === 'date' ? 'bg-ink text-white' : 'bg-transparent text-muted hover:text-ink'"
            @click="tab = 'date'"
          >
            Day
          </button>
          <button
            type="button"
            class="h-42px px-18px rounded-6px border-none cursor-pointer text-15px font-700 transition-colors press"
            :class="tab === 'week' ? 'bg-ink text-white' : 'bg-transparent text-muted hover:text-ink'"
            @click="tab = 'week'"
          >
            Weekly
          </button>
          <button
            type="button"
            class="h-42px px-18px rounded-6px border-none cursor-pointer text-15px font-700 transition-colors press"
            :class="tab === 'month' ? 'bg-ink text-white' : 'bg-transparent text-muted hover:text-ink'"
            @click="tab = 'month'"
          >
            Monthly
          </button>
        </div>
      </div>


    </div>

    <!-- Block 1: 5-Card KPI & Payment Filter Strip -->
    <div class="grid grid-cols-2 lg:grid-cols-5 gap-10px flex-none">
      <!-- Card 1: Total / All -->
      <button
        type="button"
        class="p-14px rounded-8px border text-left cursor-pointer press flex flex-col justify-between gap-4px num"
        :class="
          methodFilter === 'All'
            ? 'bg-panel border-1.5 border-ink'
            : 'bg-surface border-border hover:border-control'
        "
        @click="toggleMethodFilter('All')"
      >
        <div class="flex items-center justify-between text-13px font-700 text-muted">
          <span>{{ L.total }} (All)</span>
          <span>{{ activeStats.count }} sales</span>
        </div>
        <div class="text-24px font-800 text-ink leading-tight">
          {{ fmtMoney(activeStats.totalCents) }}
        </div>
      </button>

      <!-- Cards 2–5: Cash, Bank, QR, Credit -->
      <button
        v-for="m in PAYMENT_METHODS"
        :key="m"
        type="button"
        class="p-14px rounded-8px border text-left cursor-pointer press flex flex-col justify-between gap-4px num"
        :class="
          methodFilter === m
            ? 'bg-panel border-1.5 border-ink'
            : 'bg-surface border-border hover:border-control'
        "
        @click="toggleMethodFilter(m)"
      >
        <div class="flex items-center justify-between text-13px font-700 text-muted">
          <span>{{ PAYMENT_UI[m].label }}</span>
          <span>{{ activeStats.byMethod[m].count }} sales</span>
        </div>
        <div class="text-22px font-800 text-ink leading-tight">
          {{ fmtMoney(activeStats.byMethod[m].totalCents) }}
        </div>
      </button>
    </div>

    <!-- Block 2: Two-Column Ledger Body (60% Transactions Table | 40% Items Sold Ranking) -->
    <div class="grid grid-cols-1 xl:grid-cols-12 gap-18px items-start flex-1 min-h-0">
      <!-- Left (60% / 7 cols): Transactions Table -->
      <div class="xl:col-span-7 bg-surface border border-border rounded-8px p-20px flex flex-col gap-12px">
        <div class="flex items-center justify-between">
          <div class="text-18px font-800 text-ink">
            Transactions — {{ periodLabel }}
            <span v-if="methodFilter !== 'All'" class="text-14px font-700 text-muted ml-6px">
              ({{ PAYMENT_UI[methodFilter].label }})
            </span>
          </div>
          <button
            v-if="methodFilter !== 'All'"
            type="button"
            class="text-13px font-700 text-muted hover:text-ink underline cursor-pointer bg-transparent border-none"
            @click="methodFilter = 'All'"
          >
            Show all methods
          </button>
        </div>

        <div v-if="filteredTransactions.length" class="flex flex-col">
          <!-- Table header -->
          <div class="flex items-center gap-10px pb-8px border-b border-border text-12px font-700 text-faint">
            <span class="w-80px flex-none">Inv No</span>
            <span class="w-136px flex-none">Date / Time</span>
            <span class="flex-1 min-w-0">Items &amp; Notes</span>
            <span class="w-110px flex-none text-center">Method</span>
            <span class="w-108px flex-none text-right">Amount</span>
            <span class="w-20px flex-none" />
          </div>

          <button
            v-for="t in filteredTransactions"
            :key="t.kind === 'order' ? `order-${t.order.id}` : `rep-${t.repayment.id}`"
            type="button"
            class="flex items-center gap-10px py-12px px-6px border-b border-borderSoft bg-surface hover:bg-panel/60 cursor-pointer text-left w-full press num"
            @click="t.kind === 'order' ? (detail = t.order) : undefined"
          >
            <span class="text-15px font-800 text-ink w-80px flex-none">
              {{ t.kind === 'order' ? t.order.invNo : `RP-${t.repayment.id}` }}
            </span>
            <span class="text-14px font-600 text-muted w-136px flex-none whitespace-nowrap">
              {{ dateStr(t.ts) }} · {{ timeStr(t.ts) }}
            </span>
            <span v-if="t.kind === 'order'" class="flex-1 min-w-0 flex items-center gap-6px flex-wrap">
              <span class="inline-flex items-center px-8px py-3px rounded-4px bg-panel text-13px font-700 text-ink whitespace-nowrap">
                {{ itemsStr(t.order) }}
              </span>
              <span
                v-if="t.order.creditorName"
                class="inline-flex items-center px-8px py-3px rounded-4px bg-[#fffbeb] text-13px font-800 text-warning"
              >
                {{ t.order.creditorName }}
              </span>
              <span
                v-if="orderTotalDiscountCents(t.order) > 0"
                class="inline-flex items-center px-7px py-2px rounded-4px bg-[#ffedea] text-12px font-800 text-negative"
              >
                -{{ fmtMoney(orderTotalDiscountCents(t.order)) }}
              </span>
              <span
                v-if="t.order.voidedAt != null"
                class="inline-flex items-center px-8px py-3px rounded-4px bg-[#ffedea] text-12px font-800 text-[#831c1e]"
              >
                Cancelled
              </span>
            </span>
            <span v-else class="flex-1 min-w-0 flex items-center gap-6px flex-wrap">
              <span class="inline-flex items-center px-8px py-3px rounded-4px bg-positive/15 text-13px font-800 text-positive whitespace-nowrap">
                Repayment
              </span>
              <span class="inline-flex items-center px-8px py-3px rounded-4px bg-panel text-13px font-700 text-ink whitespace-nowrap">
                {{ t.repayment.contractorName || 'Credit Repayment' }}
              </span>
              <span v-if="t.repayment.notes" class="text-13px font-600 text-muted truncate">
                {{ t.repayment.notes }}
              </span>
            </span>
            <span class="w-110px flex-none text-center">
              <span class="inline-flex items-center px-10px py-4px rounded-4px bg-panel text-13px font-700 text-ink whitespace-nowrap">
                {{ PAYMENT_UI[t.method].label }}
              </span>
            </span>
            <span
              class="text-18px font-800 w-108px flex-none text-right text-ink"
              :class="t.kind === 'order' && t.order.voidedAt != null ? 'line-through opacity-50' : ''"
            >
              {{ fmtMoney(t.kind === 'order' ? t.order.totalCents : t.repayment.amountCents) }}
            </span>
            <ChevronRight class="w-18px h-18px text-faint flex-none" />
          </button>
        </div>
        <div v-else class="py-36px text-center text-15px font-600 text-faint">
          No sales recorded for this selection.
        </div>
      </div>

      <!-- Right (40% / 5 cols): Items Sold Ranking -->
      <div class="xl:col-span-5">
        <TopSellerCard
          :orders="periodOrders"
          :label="periodLabel"
          :limit="8"
          @inspect-item="inspectItem"
        />
      </div>
    </div>
  </div>

  <OrdersDialog
    :title="inspect?.title ?? null"
    :orders="inspect?.orders ?? []"
    @select="detail = $event"
    @close="inspect = null"
  />
  <ReceiptDialog :order="detail" @voided="onVoided" @close="detail = null" />
</template>
