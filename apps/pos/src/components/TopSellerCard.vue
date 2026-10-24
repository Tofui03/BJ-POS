<script setup lang="ts">
import { computed, ref } from "vue";
import { aggregateItemSales, fmtMoney, fmtQtySold, type ItemSale, type Order } from "@yf/core";
import { Search, X } from "lucide-vue-next";

const props = withDefaults(defineProps<{ orders: Order[]; label: string; limit?: number }>(), {
  limit: 8,
});
defineEmits<{ inspectItem: [sale: ItemSale] }>();

const sales = computed(() => aggregateItemSales(props.orders));
const top = computed(() => sales.value.slice(0, props.limit));
const totalCents = computed(() => sales.value.reduce((a, s) => a + s.amountCents, 0));
const maxAmount = computed(() => Math.max(1, ...sales.value.map((s) => s.amountCents)));
const showAll = ref(false);
</script>

<template>
  <div class="bg-surface border border-border rounded-8px p-20px flex flex-col">
    <div class="flex items-center justify-between mb-14px">
      <div>
        <div class="text-18px font-800 text-ink">Items Sold — {{ label }}</div>
        <div class="text-13px font-600 text-muted num">{{ sales.length }} products sold</div>
      </div>
      <button
        v-if="sales.length > limit"
        type="button"
        class="pill-btn h-40px px-14px text-14px"
        @click="showAll = true"
      >
        View all ({{ sales.length }})
      </button>
    </div>

    <table v-if="top.length" class="w-full border-collapse">
      <thead>
        <tr class="text-12px font-700 text-faint border-b border-border">
          <th class="text-left pb-8px">Item</th>
          <th class="text-right pb-8px px-8px">Qty Sold</th>
          <th class="text-right pb-8px px-8px">Amount</th>
          <th class="w-40px pb-8px" />
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="s in top"
          :key="(s.itemId ?? s.name) + s.unit"
          class="border-b border-borderSoft"
        >
          <td class="py-10px pr-8px">
            <div class="text-15px font-700 text-ink truncate">{{ s.name }}</div>
            <div class="mt-4px h-2px w-full bg-panel rounded-full overflow-hidden">
              <div
                class="h-full bg-ink"
                :style="{ width: `${Math.max(4, Math.round((s.amountCents / maxAmount) * 100))}%` }"
              />
            </div>
          </td>
          <td class="py-10px px-8px text-right text-15px font-700 text-muted whitespace-nowrap num">
            {{ fmtQtySold(s.qtyMilli, s.unit) }}
          </td>
          <td class="py-10px px-8px text-right text-16px font-800 text-ink whitespace-nowrap num">
            {{ fmtMoney(s.amountCents) }}
          </td>
          <td class="py-10px text-right">
            <button
              type="button"
              class="press w-36px h-36px rounded-6px border border-border bg-surface text-muted hover:text-ink inline-flex items-center justify-center cursor-pointer"
              :title="`View orders with ${s.name}`"
              @click="$emit('inspectItem', s)"
            >
              <Search class="w-15px h-15px" />
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-else class="py-30px text-center text-15px font-600 text-faint">No items sold in this period.</div>
  </div>

  <!-- Full breakdown modal -->
  <div
    v-if="showAll"
    class="fixed inset-0 bg-[rgba(19,20,22,.45)] flex items-center justify-center p-24px z-70"
    @click.self="showAll = false"
  >
    <div
      class="w-720px max-w-full max-h-86vh overflow-auto bg-surface rounded-12px border border-border shadow-[0_12px_32px_rgba(19,20,22,0.14)]"
    >
      <div class="flex items-center justify-between px-24px py-18px border-b border-border sticky top-0 bg-surface z-10">
        <div>
          <div class="text-20px font-800 text-ink">Items Sold — {{ label }}</div>
          <div class="text-14px font-600 text-muted num">{{ sales.length }} products</div>
        </div>
        <button
          type="button"
          class="w-44px h-44px rounded-6px border border-border bg-surface text-muted hover:text-ink flex items-center justify-center cursor-pointer press"
          @click="showAll = false"
        >
          <X class="w-18px h-18px" />
        </button>
      </div>
      <div class="px-24px py-18px">
        <div class="bg-panel border border-border rounded-8px px-20px py-14px flex items-baseline justify-between mb-16px num">
          <span class="text-14px font-700 text-muted">Total Amount</span>
          <span class="text-28px font-800 text-ink">{{ fmtMoney(totalCents) }}</span>
        </div>

        <div class="flex items-center gap-14px pb-8px text-12px font-700 text-faint border-b border-border">
          <div class="flex-1 min-w-0">Item</div>
          <div class="w-96px text-right">Qty Sold</div>
          <div class="w-130px text-right">Amount</div>
        </div>
        <div
          v-for="s in sales"
          :key="(s.itemId ?? s.name) + s.unit"
          class="flex items-center gap-14px py-10px border-b border-borderSoft num"
        >
          <div class="flex-1 min-w-0 text-16px font-700 text-ink truncate">{{ s.name }}</div>
          <div class="w-96px text-right text-16px font-700 text-muted">
            {{ fmtQtySold(s.qtyMilli, s.unit) }}
          </div>
          <div class="w-130px text-right text-17px font-800 text-ink">
            {{ fmtMoney(s.amountCents) }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
