<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  fmtMoney,
  fmtQty,
  matchesHardwareSearch,
  splitItemName,
  unitLabel,
  type PricedItem,
} from "@yf/core";
import { X } from "lucide-vue-next";
import type { ProductGroup } from "../stores/catalog";
import { useCart } from "../stores/cart";
import TextInput from "./TextInput.vue";
import { L } from "../labels";

const props = defineProps<{
  group: ProductGroup | null;
}>();

const emit = defineEmits<{
  close: [];
  pick: [item: PricedItem];
}>();

const cart = useCart();
const filterText = ref("");

watch(
  () => props.group,
  () => {
    filterText.value = "";
  },
);

const filteredItems = computed(() => {
  if (!props.group) return [];
  const q = filterText.value.trim();
  if (!q) return props.group.items;
  return props.group.items.filter((it) => matchesHardwareSearch(it.name, q));
});

function specOf(item: PricedItem): string {
  const { specLabel, groupName } = splitItemName(item.name);
  return specLabel || groupName;
}

function inCartQty(itemId: number): string | null {
  const line = cart.lines.find((l) => l.item.id === itemId);
  if (!line) return null;
  return fmtQty(line.qtyMilli);
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="group"
      class="fixed inset-0 flex items-center justify-center p-20px bg-[rgba(10,10,10,.45)] z-80"
      @click.self="emit('close')"
    >
      <section
        role="dialog"
        aria-modal="true"
        :aria-label="`${group.groupName} ${L.spec}`"
        class="w-840px max-w-full max-h-[90vh] bg-surface border border-border rounded-8px flex flex-col overflow-hidden"
      >
        <header class="flex-none flex items-center justify-between gap-16px px-24px py-16px border-b border-border">
          <div class="min-w-0">
            <div class="text-14px font-500 text-muted">{{ group.category }}</div>
            <h2 class="m-0 text-22px font-700 text-ink truncate">
              {{ group.groupName }}
              <span class="text-16px font-500 text-muted ml-8px">({{ group.items.length }} {{ L.sizes }})</span>
            </h2>
          </div>
          <div class="flex items-center gap-12px flex-none">
            <div v-if="group.items.length > 3" class="w-240px flex items-center gap-6px">
              <div class="flex-1 min-w-0">
                <TextInput
                  v-model="filterText"
                  :title="L.filterSpec"
                  :placeholder="L.filterSpecPlaceholder"
                  class="w-full"
                />
              </div>
              <button
                v-if="filterText"
                type="button"
                class="w-48px h-52px flex items-center justify-center rounded-6px border border-border bg-surface text-ink hover:bg-panel cursor-pointer press flex-none"
                :aria-label="L.clear"
                @click="filterText = ''"
              >
                <X class="w-18px h-18px text-muted hover:text-ink" />
              </button>
            </div>
            <button
              class="h-56px px-16px flex-none rounded-6px border border-border bg-surface text-16px font-700 text-ink cursor-pointer press"
              :aria-label="L.close"
              @click="emit('close')"
            >
              {{ L.close }}
            </button>
          </div>
        </header>

        <div class="flex-1 min-h-0 overflow-y-auto p-20px">
          <div
            v-if="filteredItems.length === 0"
            class="py-40px text-center text-16px font-700 text-muted"
          >
            {{ L.noSpec }}
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-12px">
            <button
              v-for="item in filteredItems"
              :key="item.id"
              type="button"
              class="relative text-left p-16px rounded-8px border cursor-pointer press flex flex-col justify-between gap-8px min-h-112px"
              :class="inCartQty(item.id) ? 'bg-panel border-ink' : 'bg-surface border-border'"
              @click="emit('pick', item)"
            >
              <div class="flex items-start justify-between gap-8px">
                <div class="text-18px font-700 text-ink leading-snug break-words">
                  {{ specOf(item) }}
                </div>
                <span
                  v-if="inCartQty(item.id)"
                  class="flex-none bg-ink text-white text-13px font-700 px-8px py-4px rounded-6px"
                >
                  ×{{ inCartQty(item.id) }}
                </span>
              </div>

              <div class="flex items-baseline justify-between gap-6px mt-auto pt-8px">
                <span class="text-20px font-700 text-terracotta num">
                  {{ fmtMoney(item.priceCents) }}
                </span>
                <span class="text-14px font-500 text-muted">
                  / {{ unitLabel(item.unit) }}
                </span>
              </div>
            </button>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>
