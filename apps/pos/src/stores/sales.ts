import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { computeStats, type Order, type Repayment } from "@yf/core";
import { getRepo } from "../db";
import { currentCompany } from "../place";

// Sales dashboard data, scoped to the selected company. Every period is a
// *business* day range (YYYY-MM-DD, Close Day boundary) rather than a wall-clock
// window, so a sale rung up after the day was closed counts toward the day it
// was stamped with — the same grouping /report and the HQ day report use.
//  - monthOrders: the selected month (Monthly tab + chart)
//  - rangeOrders: the selected day (Day tab) or ISO week (Weekly tab)
export const useSales = defineStore("sales", () => {
  const monthOrders = ref<Order[]>([]);
  const rangeOrders = ref<Order[]>([]);
  const monthRepayments = ref<Repayment[]>([]);
  const rangeRepayments = ref<Repayment[]>([]);
  let month: [string, string] | null = null;
  let range: [string, string] | null = null;

  async function loadMonth(fromDate: string, toDate: string): Promise<void> {
    month = [fromDate, toDate];
    const repo = await getRepo();
    const [orders, repayments] = await Promise.all([
      repo.listOrdersByBusinessDate(fromDate, toDate, currentCompany.value.id),
      repo.listRepaymentsByBusinessDate(fromDate, toDate, currentCompany.value.id),
    ]);
    monthOrders.value = orders;
    monthRepayments.value = repayments;
  }

  async function loadRange(fromDate: string, toDate: string): Promise<void> {
    range = [fromDate, toDate];
    const repo = await getRepo();
    const [orders, repayments] = await Promise.all([
      repo.listOrdersByBusinessDate(fromDate, toDate, currentCompany.value.id),
      repo.listRepaymentsByBusinessDate(fromDate, toDate, currentCompany.value.id),
    ]);
    rangeOrders.value = orders;
    rangeRepayments.value = repayments;
  }

  /** Re-run whichever periods have been loaded (after a cancel or a re-scope). */
  async function load(): Promise<void> {
    if (month) await loadMonth(...month);
    if (range) await loadRange(...range);
  }

  // Re-scope everything when the company changes.
  watch(
    () => currentCompany.value.id,
    () => void load(),
  );

  const rangeStats = computed(() => computeStats(rangeOrders.value, "all", rangeRepayments.value));
  const monthStats = computed(() => computeStats(monthOrders.value, "month", monthRepayments.value));

  return {
    monthOrders,
    rangeOrders,
    monthRepayments,
    rangeRepayments,
    rangeStats,
    monthStats,
    load,
    loadRange,
    loadMonth,
  };
});

