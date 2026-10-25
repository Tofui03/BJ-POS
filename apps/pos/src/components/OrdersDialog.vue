<script setup lang="ts">
import { fmtMoney, type Order } from "@yf/core";
import { X } from "lucide-vue-next";
import { PAYMENT_UI } from "../payments";

defineProps<{ title: string | null; orders: Order[] }>();
defineEmits<{ close: []; select: [order: Order] }>();

const timeStr = (ts: number) =>
  new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true });
const dateStr = (ts: number) =>
  new Date(ts).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
const itemsStr = (o: Order) => `${o.items.length} ${o.items.length === 1 ? "item" : "items"}`;
</script>

<template>
  <div
    v-if="title != null"
    class="fixed inset-0 bg-[rgba(19,20,22,.45)] flex items-center justify-center p-24px z-60"
    @click.self="$emit('close')"
  >
    <div
      class="w-620px max-w-full max-h-86vh overflow-auto bg-surface rounded-12px border border-border shadow-[0_12px_32px_rgba(19,20,22,0.14)]"
    >
      <div class="flex items-center justify-between px-24px py-18px border-b border-border sticky top-0 bg-surface z-10">
        <div class="text-20px font-800 text-ink">{{ title }}</div>
        <button
          type="button"
          class="w-44px h-44px rounded-6px border border-border bg-surface text-muted hover:text-ink flex items-center justify-center cursor-pointer press"
          @click="$emit('close')"
        >
          <X class="w-18px h-18px" />
        </button>
      </div>

      <div v-if="orders.length" class="px-24px py-18px flex flex-col gap-10px">
        <div class="flex bg-panel border border-border rounded-8px overflow-hidden text-center">
          <div class="flex-1 px-20px py-14px">
            <div class="text-13px font-700 text-muted mb-2px">Sales</div>
            <div class="text-28px font-800 text-ink leading-tight num">{{ orders.length }}</div>
          </div>
          <div class="w-1px bg-border flex-none" />
          <div class="flex-1 px-20px py-14px">
            <div class="text-13px font-700 text-muted mb-2px">Total</div>
            <div class="text-28px font-800 text-ink leading-tight num">
              {{ fmtMoney(orders.reduce((a, o) => a + (o.voidedAt != null ? 0 : o.totalCents), 0)) }}
            </div>
          </div>
        </div>
        <button
          v-for="o in orders"
          :key="o.id"
          type="button"
          class="flex items-center gap-10px px-16px py-12px bg-surface border border-border hover:border-control rounded-8px cursor-pointer text-left w-full press"
          @click="$emit('select', o)"
        >
          <span class="text-15px font-800 text-ink min-w-72px num">{{ o.invNo }}</span>
          <span class="text-15px font-600 text-muted whitespace-nowrap num">{{ dateStr(o.ts) }} · {{ timeStr(o.ts) }}</span>
          <span class="flex-1 flex items-center gap-6px flex-wrap">
            <span class="inline-flex items-center px-8px py-3px rounded-4px bg-panel text-13px font-700 text-muted whitespace-nowrap">
              {{ itemsStr(o) }}
            </span>
            <span
              v-if="o.creditorName"
              class="inline-flex items-center px-8px py-3px rounded-4px bg-[#fffbeb] text-13px font-800 text-warning"
            >
              {{ o.creditorName }}
            </span>
            <span
              v-if="o.note"
              class="inline-flex items-center px-7px py-2px rounded-4px bg-[#f1f5f9] text-12px font-700 text-ink/80 max-w-160px truncate"
              :title="o.note"
            >
              📝 {{ o.note }}
            </span>
          </span>
          <span
            v-if="o.voidedAt != null"
            class="inline-flex items-center px-8px py-3px rounded-4px bg-[#ffedea] text-12px font-800 text-[#831c1e]"
          >
            Cancelled
          </span>
          <span class="inline-flex items-center px-10px py-4px rounded-4px bg-panel text-13px font-700 text-ink">
            {{ PAYMENT_UI[o.method].label }}
          </span>
          <span
            class="text-18px font-800 min-w-96px text-right text-ink num"
            :class="o.voidedAt != null ? 'line-through opacity-50' : ''"
          >
            {{ fmtMoney(o.totalCents) }}
          </span>
        </button>
      </div>
      <div v-else class="py-36px text-center text-16px font-700 text-faint">No matching orders.</div>
    </div>
  </div>
</template>
