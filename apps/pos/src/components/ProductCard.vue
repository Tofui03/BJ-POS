<script setup lang="ts">
import { computed } from "vue";
import { fmtMoney, splitItemName, unitLabel, type PricedItem } from "@yf/core";
import { ChevronRight } from "lucide-vue-next";
import type { ProductGroup } from "../stores/catalog";
import { productImage } from "../productImage";
import { L } from "../labels";

const props = defineProps<{
  group?: ProductGroup;
  item?: PricedItem;
  inCartCount?: number;
}>();
defineEmits<{ select: [] }>();

const title = computed(() => props.group?.groupName ?? props.item?.name ?? "");
const img = computed(() => productImage(props.group?.image ?? props.item?.image ?? ""));

const singleSpec = computed(() => {
  const first = props.group?.items[0] ?? props.item;
  if (!first) return "";
  if ((props.group?.items.length ?? 1) > 1) return "";
  return splitItemName(first.name).specLabel;
});

const priceSummary = computed(() => {
  if (props.group) {
    if (props.group.items.length === 1) {
      const only = props.group.items[0]!;
      return `${fmtMoney(only.priceCents)} / ${unitLabel(only.unit)}`;
    }
    if (props.group.minPriceCents === props.group.maxPriceCents) {
      return fmtMoney(props.group.minPriceCents);
    }
    return `${L.from} ${fmtMoney(props.group.minPriceCents)}`;
  }
  if (props.item) {
    return `${fmtMoney(props.item.priceCents)} / ${unitLabel(props.item.unit)}`;
  }
  return "";
});

const sizeCount = computed(() => props.group?.items.length ?? 1);
</script>

<template>
  <button
    type="button"
    :title="title"
    class="relative h-full min-h-0 bg-surface rounded-8px border p-12px overflow-hidden flex flex-col justify-between text-left cursor-pointer press transition-colors"
    :class="inCartCount && inCartCount > 0 ? 'border-ink bg-panel/40' : 'border-border hover:border-control'"
    @click="$emit('select')"
  >
    <div
      v-if="img"
      class="w-full flex-1 rounded-6px bg-surface mb-6px"
      :style="{
        backgroundImage: `url('${img}')`,
        backgroundSize: 'contain',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
      }"
    />

    <!-- Top: Item Name & Single Spec -->
    <div class="w-full flex items-start justify-between gap-6px min-w-0">
      <div class="min-w-0 flex-1">
        <div class="text-16px font-700 text-ink leading-snug line-clamp-2">{{ title }}</div>
        <div
          v-if="singleSpec"
          class="text-13px font-500 text-muted leading-tight mt-2px truncate"
        >
          {{ singleSpec }}
        </div>
      </div>

      <span
        v-if="inCartCount && inCartCount > 0"
        class="flex-none bg-ink text-white text-12px font-800 leading-none px-7px py-4px rounded-4px num"
      >
        ×{{ inCartCount }}
      </span>
    </div>

    <!-- Bottom: Price & Multi-size indicator -->
    <div class="w-full flex items-end justify-between gap-6px pt-6px mt-auto border-t border-borderSoft">
      <span class="text-15px font-800 text-ink leading-none num truncate">{{ priceSummary }}</span>
      <span
        v-if="sizeCount > 1"
        class="flex-none inline-flex items-center gap-2px bg-panel text-ink text-12px font-700 leading-none px-7px py-4px rounded-4px num"
      >
        <span>{{ sizeCount }} {{ L.sizes }}</span>
        <ChevronRight class="w-13px h-13px text-muted" />
      </span>
    </div>
  </button>
</template>
