<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
  effectiveUnitPrice,
  fmtMoney,
  fmtQty,
  LAIN_LAIN_KEY,
  lineAmount,
  unitLabel,
} from "@yf/core";
import { RotateCcw, Tag, X } from "lucide-vue-next";
import { L } from "../labels";
import type { CartLine } from "../stores/cart";

const props = defineProps<{
  line: CartLine;
  active: boolean;
  amountCents: number;
}>();
defineEmits<{
  select: [];
  step: [delta: number];
  edit: [];
  editPrice: [];
  resetPrice: [];
  remove: [];
}>();

const rowEl = ref<HTMLElement | null>(null);

watch(
  () => props.active,
  async (isActive) => {
    if (isActive) {
      await nextTick();
      rowEl.value?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  },
);

const displayName = computed(() => props.line.customName?.trim() || props.line.item.name);
const qtyValue = computed(() => fmtQty(props.line.qtyMilli));
const qtyUnit = computed(() => unitLabel(props.line.item.unit, props.line.qtyMilli));

const isLainLain = computed(() => props.line.item.key === LAIN_LAIN_KEY);
const hasCustomPrice = computed(
  () => !isLainLain.value && props.line.customPriceCents !== undefined,
);

const origUnitCents = computed(() =>
  props.line.item.priceCents > 0
    ? effectiveUnitPrice(props.line.item, props.line.qtyMilli)
    : (props.line.customPriceCents ?? 0),
);
const unitCents = computed(() =>
  props.line.customPriceCents !== undefined
    ? props.line.customPriceCents
    : effectiveUnitPrice(props.line.item, props.line.qtyMilli),
);
const lineDiscountCents = computed(() => {
  if (props.line.item.priceCents > 0 && unitCents.value < origUnitCents.value) {
    return Math.max(0, lineAmount(origUnitCents.value, props.line.qtyMilli) - props.amountCents);
  }
  return 0;
});

const QUICK_DELTAS = [-5, 5, 10] as const;
</script>

<template>
  <div
    ref="rowEl"
    class="cart-line rounded-8px border transition-colors cursor-pointer select-none"
    :class="active ? 'bg-panel border-1.5 border-ink' : 'bg-surface border-border hover:border-control'"
    @click="$emit('select')"
  >
    <!-- Primary row: Item Name + Unit Price | − Qty + | Line Total | Remove -->
    <div class="flex items-center gap-8px px-10px py-8px">
      <div class="flex-1 min-w-0 flex flex-col gap-3px items-start">
        <div class="w-full text-16px font-700 text-ink leading-snug truncate" :title="displayName">
          {{ displayName }}
        </div>
        <button
          type="button"
          class="text-13px font-700 px-6px py-2px rounded-4px border border-border bg-surface text-muted hover:text-ink cursor-pointer press flex items-center gap-4px num"
          :title="L.changePrice"
          @click.stop="$emit('editPrice')"
        >
          <span v-if="lineDiscountCents > 0" class="line-through opacity-75">
            {{ fmtMoney(origUnitCents) }}
          </span>
          <span class="text-ink">{{ fmtMoney(unitCents) }}/{{ unitLabel(line.item.unit) }}</span>
          <span v-if="lineDiscountCents > 0" class="text-negative font-800">
            (-{{ fmtMoney(lineDiscountCents) }})
          </span>
        </button>
      </div>

      <!-- − / Decimal Qty Button / + -->
      <div class="flex items-center gap-4px flex-none">
        <button
          type="button"
          class="adj-btn w-44px h-48px text-22px flex items-center justify-center"
          @click.stop="$emit('step', -1)"
        >
          −
        </button>
        <button
          type="button"
          class="min-w-64px h-48px px-8px rounded-6px border border-control bg-surface flex flex-col items-center justify-center cursor-pointer press"
          :title="L.qty"
          @click.stop="$emit('edit')"
        >
          <span class="text-18px font-800 text-ink leading-none num">{{ qtyValue }}</span>
          <span class="text-11px font-600 text-muted leading-none mt-2px">{{ qtyUnit }}</span>
        </button>
        <button
          type="button"
          class="adj-btn w-44px h-48px text-22px flex items-center justify-center"
          @click.stop="$emit('step', 1)"
        >
          +
        </button>
      </div>

      <!-- Line Total RM -->
      <div class="w-92px text-right text-18px font-800 text-ink whitespace-nowrap num flex-none">
        {{ fmtMoney(amountCents) }}
      </div>

      <!-- Remove line -->
      <button
        type="button"
        class="w-42px h-48px flex-none rounded-6px border border-border bg-surface text-muted hover:text-negative hover:border-negative flex items-center justify-center cursor-pointer press"
        :aria-label="L.clear"
        @click.stop="$emit('remove')"
      >
        <X class="w-18px h-18px" />
      </button>
    </div>

    <!-- Inline Quick-Adjust Tray (expanded when active === true; replaces ItemAdjustSheet) -->
    <div
      v-if="active"
      class="px-10px pb-10px pt-6px border-t border-border flex flex-wrap items-center justify-between gap-6px"
      @click.stop
    >
      <div class="flex items-center gap-6px">
        <button
          v-for="d in QUICK_DELTAS"
          :key="d"
          type="button"
          class="h-42px px-12px rounded-6px border border-control bg-surface text-15px font-800 text-ink cursor-pointer press num"
          @click="$emit('step', d)"
        >
          {{ d > 0 ? `+${d}` : `${d}` }}
        </button>
      </div>

      <div class="flex items-center gap-6px">
        <button
          type="button"
          class="h-42px px-12px rounded-6px border border-control bg-surface text-14px font-700 text-ink cursor-pointer press inline-flex items-center gap-6px"
          @click="$emit('editPrice')"
        >
          <Tag class="w-15px h-15px text-muted flex-none" />
          <span>{{ L.changePrice }}</span>
        </button>
        <button
          v-if="hasCustomPrice"
          type="button"
          class="h-42px px-10px rounded-6px border border-border bg-surface text-13px font-700 text-muted hover:text-ink cursor-pointer press inline-flex items-center gap-4px"
          @click="$emit('resetPrice')"
        >
          <RotateCcw class="w-14px h-14px flex-none" />
          <span>{{ L.resetPrice }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
