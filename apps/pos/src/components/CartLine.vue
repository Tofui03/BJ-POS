<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { fmtMoney, fmtQty, unitLabel } from "@yf/core";
import { X, Pencil } from "lucide-vue-next";
import { L } from "../labels";
import { useCart, type CartLine } from "../stores/cart";

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

const cart = useCart();
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

const displayName = computed(() => cart.displayNameOf(props.line));
const qtyValue = computed(() => fmtQty(props.line.qtyMilli));
const qtyUnit = computed(() => unitLabel(props.line.item.unit, props.line.qtyMilli));
const hasCustomPrice = computed(() => cart.hasCustomPrice(props.line));
const origUnitCents = computed(() => cart.origUnitCentsOf(props.line));
const unitCents = computed(() => cart.unitCentsOf(props.line));
const lineDiscountCents = computed(() => cart.lineDiscountCentsOf(props.line));
</script>

<template>
  <div
    ref="rowEl"
    class="cart-line rounded-10px border transition-all select-none px-12px py-10px flex flex-col gap-8px"
    :class="
      active
        ? 'bg-panel border-1.5 border-ink shadow-sm'
        : 'bg-surface border-border hover:border-control'
    "
    @click="$emit('select')"
  >
    <!-- 第一层：完整商品名（支持换行） + 右侧大字小计 + 轻量删除键 -->
    <div class="flex items-start justify-between gap-10px">
      <div
        class="flex-1 min-w-0 text-16px font-700 text-ink leading-snug break-words line-clamp-2"
        :title="displayName"
      >
        {{ displayName }}
      </div>

      <div class="flex items-center gap-8px flex-none">
        <div class="text-right leading-none">
          <div class="text-19px font-800 text-ink whitespace-nowrap num">
            {{ fmtMoney(amountCents) }}
          </div>
          <div
            v-if="lineDiscountCents > 0"
            class="text-11px font-700 text-negative mt-2px num"
          >
            -{{ fmtMoney(lineDiscountCents) }}
          </div>
        </div>

        <button
          type="button"
          class="w-34px h-34px -mr-2px -mt-2px flex-none rounded-6px border border-transparent text-muted hover:text-negative hover:bg-[#fee2e2] hover:border-negative/30 flex items-center justify-center cursor-pointer press transition-colors"
          :aria-label="L.clear"
          @click.stop="$emit('remove')"
        >
          <X class="w-18px h-18px" />
        </button>
      </div>
    </div>

    <!-- 第二层：左侧点按改单价胶囊 + 右侧一体化数量步进器 -->
    <div class="flex items-center justify-between gap-8px">
      <!-- 单价框（融合单位显示，减少重复标签） -->
      <button
        type="button"
        class="h-42px px-10px rounded-7px border text-ink cursor-pointer press flex items-center gap-6px num transition-colors"
        :class="
          hasCustomPrice || lineDiscountCents > 0
            ? 'border-amber-500/80 bg-amber-50/70 hover:border-amber-600'
            : 'border-control bg-raised hover:border-ink'
        "
        :title="L.changePrice"
        @click.stop="$emit('editPrice')"
      >
        <div class="flex items-baseline gap-4px leading-none">
          <span
            v-if="lineDiscountCents > 0"
            class="line-through text-12px text-muted font-600"
          >
            {{ fmtMoney(origUnitCents) }}
          </span>
          <span class="text-15px font-800 text-ink">
            {{ fmtMoney(unitCents) }}
          </span>
          <span class="text-12px font-600 text-muted">
            /{{ unitLabel(line.item.unit) }}
          </span>
        </div>
        <Pencil class="w-13px h-13px text-muted flex-none ml-2px" />
      </button>

      <!-- 一体化数量步进器（减少框套框的碎片感） -->
      <div
        class="flex items-stretch h-42px rounded-7px border border-control bg-raised overflow-hidden flex-none"
      >
        <button
          type="button"
          class="w-44px h-full p-0 text-20px font-700 leading-none text-ink hover:bg-panel active:bg-border flex items-center justify-center cursor-pointer transition-colors border-r border-control"
          @click.stop="$emit('step', -1)"
        >
          −
        </button>

        <button
          type="button"
          class="min-w-68px h-full px-10px py-0 bg-white hover:bg-amber-50/40 flex items-center justify-center gap-3px cursor-pointer transition-colors"
          :title="L.qty"
          @click.stop="$emit('edit')"
        >
          <span class="text-17px font-800 text-ink leading-none num">{{ qtyValue }}</span>
          <span
            v-if="line.item.unit !== 'pcs'"
            class="text-11px font-700 text-muted leading-none"
          >
            {{ qtyUnit }}
          </span>
        </button>

        <button
          type="button"
          class="w-44px h-full p-0 text-20px font-700 leading-none text-ink hover:bg-panel active:bg-border flex items-center justify-center cursor-pointer transition-colors border-l border-control"
          @click.stop="$emit('step', 1)"
        >
          +
        </button>
      </div>
    </div>
  </div>
</template>