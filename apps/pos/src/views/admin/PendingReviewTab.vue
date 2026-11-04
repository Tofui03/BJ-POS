<script setup lang="ts">
import { computed, ref } from "vue";
import { fmtMoney, splitItemName, toRM, type PricedItem } from "@yf/core";
import { CheckCircle2, Pencil } from "lucide-vue-next";
import { L } from "../../labels";

const props = defineProps<{
  items: PricedItem[];
}>();

const emit = defineEmits<{
  edit: [item: PricedItem];
  approve: [draft: { id: number; key?: string; groupName: string; specLabel: string; unit: any; priceRM: number; active: boolean }];
}>();

const pendingItems = computed(() => {
  return props.items.filter((it) => it.key.startsWith("hw_pending_"));
});
</script>

<template>
  <div class="flex-1 min-h-0 flex flex-col gap-14px">
    <div class="flex items-center justify-between text-14px font-700 text-muted">
      <span>
        {{ L.pendingReviewDesc }} ({{ pendingItems.length }})
      </span>
    </div>

    <div class="flex-1 min-h-0 overflow-y-auto border border-border rounded-8px">
      <table class="w-full border-collapse num">
        <thead class="sticky top-0 bg-surface z-10 border-b border-border text-12px font-700 text-faint">
          <tr>
            <th class="p-12px text-left">{{ L.item }}</th>
            <th class="p-12px text-left">{{ L.unit }}</th>
            <th class="p-12px text-right">{{ L.price }}</th>
            <th class="p-12px text-center">{{ L.status }}</th>
            <th class="p-12px text-right">{{ L.actions }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="it in pendingItems"
            :key="it.id"
            class="border-b border-borderSoft hover:bg-panel/50 cursor-pointer select-none"
            @click="emit('edit', it)"
          >
            <td class="p-12px text-16px font-700 text-ink">
              <span class="inline-flex items-center gap-6px">
                <span>{{ it.name }}</span>
                <span class="text-11px font-700 px-6px py-1px rounded bg-amber-500/15 text-amber-800 border border-amber-500/20">
                  {{ it.key }}
                </span>
              </span>
            </td>
            <td class="p-12px text-14px font-700 text-muted">{{ it.unit }}</td>
            <td class="p-12px text-right text-17px font-800 text-ink">
              {{ fmtMoney(it.priceCents) }}
            </td>
            <td class="p-12px text-center">
              <span class="inline-block px-8px py-3px rounded-4px text-12px font-800 bg-amber-500/15 text-amber-700 border border-amber-500/20">
                Pending
              </span>
            </td>
            <td class="p-12px text-right">
              <div class="inline-flex items-center gap-8px" @click.stop>
                <button
                  type="button"
                  class="pill-btn h-38px px-12px text-13px inline-flex items-center gap-6px hover:border-ink"
                  @click="emit('edit', it)"
                >
                  <Pencil class="w-14px h-14px text-muted" />
                  <span>{{ L.edit }}</span>
                </button>
                <button
                  type="button"
                  class="h-38px px-14px rounded-6px border border-positive bg-positive text-white text-13px font-800 cursor-pointer press inline-flex items-center gap-6px"
                  @click="emit('approve', {
                    id: it.id,
                    key: it.key,
                    groupName: splitItemName(it.name).groupName,
                    specLabel: splitItemName(it.name).specLabel,
                    unit: it.unit,
                    priceRM: toRM(it.priceCents),
                    active: it.active,
                  })"
                >
                  <CheckCircle2 class="w-15px h-15px text-white" />
                  <span>{{ L.approveItem }}</span>
                </button>
              </div>
            </td>
          </tr>
          <tr v-if="pendingItems.length === 0">
            <td colspan="5" class="p-40px text-center text-15px font-600 text-faint">
              🎉 {{ L.noPendingItems }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
