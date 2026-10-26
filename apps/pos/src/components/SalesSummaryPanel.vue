<script setup lang="ts">
import { L } from "../labels";
import { fmtMoney, PAYMENT_METHODS, type PaymentMethod, type Stats } from "@yf/core";
import { Search } from "lucide-vue-next";
import { PAYMENT_UI } from "../payments";

defineProps<{ title: string; stats: Stats }>();
defineEmits<{ inspectMethod: [method: PaymentMethod] }>();
</script>

<template>
  <div class="bg-surface border border-border rounded-8px p-20px flex flex-col gap-16px">
    <div class="text-18px font-800 text-ink">{{ L.totalReceived }} — {{ title }}</div>

    <!-- Sales (count) + Received (money) share one card -->
    <div class="flex bg-panel border border-border rounded-8px overflow-hidden num">
      <div class="flex-1 px-20px py-14px">
        <div class="text-13px font-700 text-muted mb-2px">Sales</div>
        <div class="text-32px font-800 text-ink leading-tight">
          {{ stats.count }}
        </div>
      </div>
      <div class="w-1px bg-border flex-none" />
      <div class="flex-1 px-20px py-14px">
        <div class="text-13px font-700 text-muted mb-2px">Received</div>
        <div class="text-32px font-800 text-ink leading-tight">
          {{ fmtMoney(stats.totalCents) }}
        </div>
      </div>
    </div>

    <!-- per-method breakdown: method · sales count · amount -->
    <table class="w-full border-collapse num">
      <thead>
        <tr class="text-12px font-700 text-faint border-b border-border">
          <th class="text-left pb-8px">Method</th>
          <th class="text-center pb-8px px-8px">Sales</th>
          <th class="text-right pb-8px px-8px">Amount</th>
          <th class="w-40px pb-8px" />
        </tr>
      </thead>
      <tbody>
        <tr v-for="m in PAYMENT_METHODS" :key="m" class="border-b border-borderSoft">
          <td class="py-10px pr-8px">
            <div class="inline-flex h-40px px-12px rounded-6px items-center justify-center bg-panel text-14px font-700 text-ink">
              {{ PAYMENT_UI[m].label }}
            </div>
          </td>
          <td class="py-10px px-8px text-center text-16px font-700 text-ink whitespace-nowrap">
            {{ stats.byMethod[m].count }}
          </td>
          <td class="py-10px px-8px text-right text-17px font-800 text-ink whitespace-nowrap">
            {{ fmtMoney(stats.byMethod[m].totalCents) }}
          </td>
          <td class="py-10px text-right">
            <button
              type="button"
              class="press w-36px h-36px rounded-6px border border-border bg-surface text-muted hover:text-ink inline-flex items-center justify-center cursor-pointer disabled:opacity-40"
              :disabled="!stats.byMethod[m].count"
              :title="`View ${m} orders`"
              @click="$emit('inspectMethod', m)"
            >
              <Search class="w-15px h-15px" />
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
