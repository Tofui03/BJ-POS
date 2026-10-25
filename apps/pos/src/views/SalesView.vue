<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  buildReceipt,
  fmtMoney,
  orderTotalDiscountCents,
  PAYMENT_METHODS,
  STORE_ADDRESS,
  type Order,
  type PaymentMethod,
  type Repayment,
  type RepaymentMethod,
} from "@yf/core";
import { Eye, Printer, Search, X } from "lucide-vue-next";
import TopBar from "../components/TopBar.vue";
import ReceiptDialog from "../components/ReceiptDialog.vue";
import TextInput from "../components/TextInput.vue";
import { useSales } from "../stores/sales";
import { useCatalog } from "../stores/catalog";
import { useUi } from "../stores/ui";
import { currentCompany } from "../place";
import { printer } from "../printing/printer";
import { PAYMENT_UI } from "../payments";
import { L } from "../labels";
import { from, dateLabel, setCurrentDay } from "../salesDate";

const sales = useSales();
const ui = useUi();

const methodFilter = ref<"All" | PaymentMethod>("All");
const searchQuery = ref("");
const detail = ref<Order | null>(null);

function loadSales(): void {
  void sales.loadRange(from.value, from.value);
}

onMounted(() => {
  if (!from.value) setCurrentDay();
  loadSales();
});
watch(from, loadSales);

const rangeOrders = computed(() => sales.rangeOrders);
const rangeRepayments = computed(() => sales.rangeRepayments);

// Payment method counts (no amounts shown)
const methodCounts = computed(() => {
  const counts: Record<string, number> = { All: rangeOrders.value.length + rangeRepayments.value.length };
  for (const m of PAYMENT_METHODS) {
    counts[m] =
      rangeOrders.value.filter((o) => o.method === m).length +
      rangeRepayments.value.filter((r) => r.method === m).length;
  }
  return counts;
});

type TransactionRow =
  | { kind: "order"; order: Order; ts: number; method: PaymentMethod }
  | { kind: "repayment"; repayment: Repayment; ts: number; method: RepaymentMethod };

const filteredTransactions = computed<TransactionRow[]>(() => {
  const rows: TransactionRow[] = [];
  const q = searchQuery.value.trim().toLowerCase();

  for (const o of rangeOrders.value) {
    if (methodFilter.value !== "All" && o.method !== methodFilter.value) continue;
    if (q) {
      const invMatch = (o.invNo || "").toLowerCase().includes(q);
      const contractorMatch = (o.creditorName || o.contractorName || "").toLowerCase().includes(q);
      const noteMatch = (o.note || "").toLowerCase().includes(q);
      const amountMatch = (o.totalCents / 100).toFixed(2).includes(q) || String(o.totalCents).includes(q);
      if (!invMatch && !contractorMatch && !noteMatch && !amountMatch) continue;
    }
    rows.push({ kind: "order", order: o, ts: o.ts, method: o.method });
  }

  for (const r of rangeRepayments.value) {
    if (methodFilter.value !== "All" && r.method !== methodFilter.value) continue;
    if (q) {
      const idMatch = `rp-${r.id}`.includes(q);
      const contractorMatch = (r.contractorName || "").toLowerCase().includes(q);
      const noteMatch = (r.notes || "").toLowerCase().includes(q);
      const amountMatch = (r.amountCents / 100).toFixed(2).includes(q) || String(r.amountCents).includes(q);
      if (!idMatch && !contractorMatch && !noteMatch && !amountMatch) continue;
    }
    rows.push({ kind: "repayment", repayment: r, ts: r.ts, method: r.method });
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

const timeStr = (ts: number) =>
  new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true });
const dateStr = (ts: number) =>
  new Date(ts).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
const itemsStr = (o: Order) => `${o.items.length} ${o.items.length === 1 ? "item" : "items"}`;

function onVoided(updated: Order): void {
  detail.value = updated;
  loadSales();
  void useCatalog().load();
}

async function quickReprint(o: Order): Promise<void> {
  try {
    const isRefund = Boolean(o.refundOfOrderId != null || o.totalCents < 0);
    const contractor = o.contractorName || o.creditorName
      ? {
          name: o.contractorName || o.creditorName || "",
          tin: o.contractorTin ?? o.customerTin,
          address: o.contractorAddress ?? o.customerAddress,
          phone: o.contractorPhone ?? o.customerPhone,
        }
      : undefined;

    const receipt = buildReceipt(o, {
      storeName: currentCompany.value.name,
      storeAddress: STORE_ADDRESS,
      contractor,
    });

    if (isRefund) {
      (receipt as any).isRefund = true;
      (receipt as any).refundOfInvNo = o.refundOfInvNo;
    }

    await printer.print(receipt);
    ui.showToast(`已重印小票 #${o.invNo || o.id}`);
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : "重印小票失败");
  }
}
</script>

<template>
  <TopBar mode="sales" />

  <!-- Full-Width Inset Sheet on Warm Stone Ground -->
  <div
    class="flex-1 min-h-0 overflow-y-auto bg-surface border border-border rounded-12px mx-8px mb-8px p-20px flex flex-col gap-16px"
  >
    <!-- Header Row: Title & Date -->
    <div class="flex items-center justify-between gap-12px flex-wrap flex-none">
      <div>
        <h1 class="m-0 text-22px font-800 text-ink leading-tight">查单重印台 / Sales Lookup</h1>
        <div class="text-14px font-600 text-muted mt-2px num">
          {{ dateLabel }} · 共 {{ filteredTransactions.length }} 笔记录
        </div>
      </div>

      <!-- Payment Method Filter Pills (Counts only, NO amounts) -->
      <div class="flex items-center gap-6px flex-wrap">
        <button
          type="button"
          class="h-44px px-14px rounded-8px border text-14px font-700 cursor-pointer press flex items-center gap-6px transition-colors num"
          :class="
            methodFilter === 'All'
              ? 'border-ink bg-ink text-white font-800'
              : 'border-border bg-panel text-ink hover:border-ink'
          "
          @click="toggleMethodFilter('All')"
        >
          <span>All</span>
          <span class="text-12px opacity-80">({{ methodCounts['All'] || 0 }})</span>
        </button>

        <button
          v-for="m in PAYMENT_METHODS"
          :key="m"
          type="button"
          class="h-44px px-14px rounded-8px border text-14px font-700 cursor-pointer press flex items-center gap-6px transition-colors num"
          :class="
            methodFilter === m
              ? 'border-ink bg-ink text-white font-800'
              : 'border-border bg-panel text-ink hover:border-ink'
          "
          @click="toggleMethodFilter(m)"
        >
          <span>{{ PAYMENT_UI[m].label }}</span>
          <span class="text-12px opacity-80">({{ methodCounts[m] || 0 }})</span>
        </button>
      </div>
    </div>

    <!-- Search Bar (Touch Friendly, TextInput) -->
    <div class="flex items-center gap-10px flex-none">
      <div class="relative flex-1">
        <TextInput
          v-model="searchQuery"
          placeholder="搜索单号 (Inv No)、工程商名称、备注或金额 / Search receipt..."
          class="w-full text-16px h-52px pl-40px"
        />
        <Search class="w-18px h-18px text-muted absolute left-14px top-17px pointer-events-none" />
      </div>
      <button
        v-if="searchQuery"
        type="button"
        class="h-52px px-16px rounded-8px border border-border bg-surface text-ink text-14px font-700 cursor-pointer press flex items-center gap-6px hover:border-ink"
        @click="searchQuery = ''"
      >
        <X class="w-16px h-16px text-muted" />
        <span>清除 / Clear</span>
      </button>
    </div>

    <!-- Full 100% Width Ledger Table -->
    <div class="w-full bg-surface border border-border rounded-8px p-16px flex flex-col gap-8px flex-1 min-h-0">
      <div v-if="filteredTransactions.length" class="flex flex-col">
        <!-- Table header -->
        <div class="flex items-center gap-12px pb-10px border-b border-border text-13px font-700 text-faint">
          <span class="w-100px flex-none">Inv No / 单号</span>
          <span class="w-140px flex-none">时间 / Time</span>
          <span class="flex-1 min-w-0">商品 &amp; 客户 / 备注信息</span>
          <span class="w-110px flex-none text-center">支付方式</span>
          <span class="w-130px flex-none text-right">金额 / Total</span>
          <span class="w-210px flex-none text-right pr-6px">操作 / Actions</span>
        </div>

        <!-- Table Rows (Row Height ≥ 56px) -->
        <div
          v-for="t in filteredTransactions"
          :key="t.kind === 'order' ? `order-${t.order.id}` : `rep-${t.repayment.id}`"
          class="min-h-56px flex items-center gap-12px py-10px px-6px border-b border-borderSoft hover:bg-panel/60 num transition-colors"
        >
          <!-- Inv No -->
          <span class="text-15px font-800 text-ink w-100px flex-none">
            {{ t.kind === 'order' ? t.order.invNo : `RP-${t.repayment.id}` }}
          </span>

          <!-- Date / Time -->
          <span class="text-14px font-600 text-muted w-140px flex-none whitespace-nowrap">
            {{ dateStr(t.ts) }} · {{ timeStr(t.ts) }}
          </span>

          <!-- Items & Notes -->
          <span v-if="t.kind === 'order'" class="flex-1 min-w-0 flex items-center gap-8px flex-wrap">
            <span class="inline-flex items-center px-8px py-3px rounded-4px bg-panel text-13px font-700 text-ink whitespace-nowrap">
              {{ itemsStr(t.order) }}
            </span>

            <!-- Refund Badge -->
            <span
              v-if="t.order.refundOfOrderId != null || t.order.totalCents < 0"
              class="inline-flex items-center px-8px py-3px rounded-4px bg-[#ffedea] text-13px font-800 text-negative border border-negative/30 whitespace-nowrap"
            >
              🔙 退货 (原单 #{{ t.order.refundOfInvNo || t.order.refundOfOrderId }})
            </span>

            <!-- Contractor badge -->
            <span
              v-if="t.order.creditorName || t.order.contractorName"
              class="inline-flex items-center px-8px py-3px rounded-4px bg-[#fffbeb] text-13px font-800 text-warning"
            >
              {{ t.order.creditorName || t.order.contractorName }}
            </span>

            <!-- Discount -->
            <span
              v-if="orderTotalDiscountCents(t.order) > 0"
              class="inline-flex items-center px-7px py-2px rounded-4px bg-[#ffedea] text-12px font-800 text-negative"
            >
              -{{ fmtMoney(orderTotalDiscountCents(t.order)) }}
            </span>

            <!-- Note -->
            <span
              v-if="t.order.note"
              class="inline-flex items-center px-7px py-2px rounded-4px bg-[#f1f5f9] text-12px font-700 text-ink/80 max-w-240px truncate"
              :title="t.order.note"
            >
              📝 {{ t.order.note }}
            </span>

            <!-- Cancelled badge -->
            <span
              v-if="t.order.voidedAt != null"
              class="inline-flex items-center px-8px py-3px rounded-4px bg-[#ffedea] text-12px font-800 text-[#831c1e]"
            >
              Cancelled / 已作废
            </span>
          </span>
          <span v-else class="flex-1 min-w-0 flex items-center gap-8px flex-wrap">
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

          <!-- Method -->
          <span class="w-110px flex-none text-center">
            <span class="inline-flex items-center px-10px py-4px rounded-4px bg-panel text-13px font-700 text-ink whitespace-nowrap">
              {{ PAYMENT_UI[t.method].label }}
            </span>
          </span>

          <!-- Amount -->
          <span
            class="text-18px font-800 w-130px flex-none text-right"
            :class="[
              t.kind === 'order' && t.order.voidedAt != null ? 'line-through opacity-50' : '',
              (t.kind === 'order' && (t.order.refundOfOrderId != null || t.order.totalCents < 0)) ? 'text-negative' : 'text-ink'
            ]"
          >
            {{ fmtMoney(t.kind === 'order' ? t.order.totalCents : t.repayment.amountCents) }}
          </span>

          <!-- Row Action Buttons (≥ 56px height row friendly) -->
          <div class="w-210px flex-none flex items-center justify-end gap-8px pr-6px">
            <template v-if="t.kind === 'order'">
              <button
                type="button"
                class="h-42px px-12px rounded-6px border border-border bg-surface text-ink text-13px font-700 cursor-pointer press flex items-center gap-5px hover:border-ink"
                @click="detail = t.order"
              >
                <Eye class="w-15px h-15px text-muted" />
                <span>详情/退货</span>
              </button>
              <button
                type="button"
                class="h-42px px-12px rounded-6px border border-ink bg-ink text-white text-13px font-700 cursor-pointer press flex items-center gap-5px"
                @click="quickReprint(t.order)"
              >
                <Printer class="w-15px h-15px text-white" />
                <span>重印小票</span>
              </button>
            </template>
          </div>
        </div>
      </div>

      <div v-else class="py-48px text-center text-15px font-600 text-faint">
        未找到符合条件的单据 / No records found.
      </div>
    </div>
  </div>

  <ReceiptDialog :order="detail" @voided="onVoided" @close="detail = null" />
</template>
