<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { fmtMoney, fmtQtyUnit, LAIN_LAIN_KEY, type Order, type Unit } from "@yf/core";
import { Download } from "lucide-vue-next";
import dayjs from "dayjs";
import TopBar from "../components/TopBar.vue";
import { getRepo } from "../db";
import { currentCompany } from "../place";
import { buildDailyExcelB64, downloadDailyExcel } from "../report/daily";
import { from, setCurrentDay, setDay } from "../salesDate";
import { L } from "../labels";

const sel = computed(() => dayjs(from.value));
const mtdOrders = ref<Order[]>([]);

async function loadReport(): Promise<void> {
  const repo = await getRepo();
  mtdOrders.value = await repo.listOrdersByBusinessDate(
    sel.value.format("YYYY-MM-01"),
    sel.value.format("YYYY-MM-DD"),
    currentCompany.value.id,
  );
}

const route = useRoute();
onMounted(() => {
  const q = route.query.date;
  if (typeof q === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q)) setDay(q);
  else setCurrentDay();
  void loadReport();
});
watch([from, () => currentCompany.value.id], loadReport);

const dayOrders = computed(() =>
  mtdOrders.value.filter((o) => o.businessDate === sel.value.format("YYYY-MM-DD")),
);

async function downloadSelectedDayExcel(): Promise<void> {
  const repo = await getRepo();
  const company = currentCompany.value;
  const dateStr = sel.value.format("YYYY-MM-DD");
  const repayments = await repo.listRepaymentsByBusinessDate(dateStr, dateStr, company.id);
  const b64 = buildDailyExcelB64(dayOrders.value, repayments);
  downloadDailyExcel(b64, `${company.name.replace(/\s+/g, "-")}-sales-${dateStr}.xlsx`);
}

interface Row {
  key: string;
  name: string;
  unit: Unit;
  qtyMilli: number;
  total: number;
}

function aggregate(orders: Order[]): Row[] {
  const map = new Map<string, Row>();
  for (const o of orders) {
    if (o.voidedAt != null) continue;
    for (const li of o.items) {
      const displayName = li.customName?.trim() || li.name;
      const key =
        li.customName || li.name === "Lain-lain" || li.itemId == null
          ? `name:${displayName}:${li.unit}`
          : `id:${li.itemId}`;
      let row = map.get(key);
      if (!row) {
        row = { key, name: displayName, unit: li.unit, qtyMilli: 0, total: 0 };
        map.set(key, row);
      }
      row.qtyMilli += li.qtyMilli;
      row.total += li.amountCents;
    }
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

const totals = (rows: Row[]): { total: number } =>
  rows.reduce((a, r) => ({ total: a.total + r.total }), { total: 0 });

const panels = computed(() => [
  { kind: "day" as const, title: "Day", sub: sel.value.format("DD MMM YYYY"), rows: aggregate(dayOrders.value) },
  {
    kind: "mtd" as const,
    title: "Month-to-Date",
    sub: `${sel.value.startOf("month").format("DD")} – ${sel.value.format("DD MMM YYYY")}`,
    rows: aggregate(mtdOrders.value),
  },
]);
void LAIN_LAIN_KEY;
</script>

<template>
  <TopBar mode="report" />

  <div
    class="flex-1 min-h-0 overflow-y-auto bg-surface border border-border rounded-12px mx-8px mb-8px p-20px flex flex-col gap-18px"
  >
    <div class="flex items-center justify-between gap-16px flex-none flex-wrap">
      <div>
        <h1 class="m-0 text-22px font-800 text-ink">Sales Report / Laporan Jualan</h1>
        <div class="text-14px font-600 text-muted mt-2px num">{{ sel.format("DD MMM YYYY") }}</div>
      </div>
      <div class="flex items-center gap-10px">
        <button
          type="button"
          class="h-48px px-16px rounded-6px border border-control bg-surface text-14px font-700 text-ink cursor-pointer press inline-flex items-center gap-8px"
          @click="downloadSelectedDayExcel"
        >
          <Download class="w-17px h-17px text-muted" />
          <span>{{ L.downloadExcel }}</span>
        </button>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-20px">
      <div
        v-for="p in panels"
        :key="p.kind"
        class="bg-surface border border-border rounded-8px p-20px flex flex-col gap-12px min-w-0"
      >
        <div>
          <div class="text-18px font-800 text-ink">{{ p.title }}</div>
          <div class="text-14px font-600 text-muted num">{{ p.sub }}</div>
        </div>

        <table class="w-full border-collapse num">
          <thead>
            <tr class="text-12px font-700 text-faint border-b border-border">
              <th class="text-left pb-8px">{{ L.item }}</th>
              <th class="text-right pb-8px px-10px">{{ L.qty }}</th>
              <th class="text-right pb-8px pl-10px">{{ L.amount }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in p.rows" :key="r.key" class="border-b border-borderSoft">
              <td class="py-10px pr-10px text-15px font-700 text-ink truncate">{{ r.name }}</td>
              <td class="py-10px px-10px text-right text-15px font-700 text-muted whitespace-nowrap">
                {{ fmtQtyUnit(r.qtyMilli, r.unit) }}
              </td>
              <td class="py-10px pl-10px text-right text-16px font-800 whitespace-nowrap text-ink">
                {{ fmtMoney(r.total) }}
              </td>
            </tr>
            <tr v-if="!p.rows.length">
              <td colspan="3" class="py-30px text-center text-15px font-600 text-faint">No sales yet.</td>
            </tr>
          </tbody>
          <tfoot v-if="p.rows.length">
            <tr class="border-t border-border">
              <td class="pt-12px text-15px font-800 text-muted">{{ L.total }}</td>
              <td class="pt-12px px-10px" />
              <td class="pt-12px pl-10px text-right text-20px font-800 whitespace-nowrap text-ink">
                {{ fmtMoney(totals(p.rows).total) }}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  </div>
</template>
