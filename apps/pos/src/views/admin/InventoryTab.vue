<script setup lang="ts">
import { computed, ref } from "vue";
import {
  categoryButtonLabel,
  categoryForGroup,
  filterStockItems,
  fmtMoney,
  formatStockQty,
  HARDWARE_CATEGORIES,
  isLowStock,
  LAIN_LAIN_KEY,
  splitItemName,
  type HardwareCategory,
  type PricedItem,
} from "@yf/core";
import { ArrowDownUp, PackagePlus, X } from "lucide-vue-next";
import TextInput from "../../components/TextInput.vue";
import { L } from "../../labels";

const props = defineProps<{
  items: PricedItem[];
  lowStockThreshold: number;
}>();

const emit = defineEmits<{
  restock: [item: PricedItem];
  quickRestock: [item: PricedItem, qty: number];
}>();

const search = ref("");
const category = ref<HardwareCategory>("All");
const trackedOnly = ref(false);
const lowStockOnly = ref(false);
const sortAsc = ref(true);

const filteredInventoryItems = computed(() => {
  const thresholdMilli = props.lowStockThreshold * 1000;
  let list = props.items.filter((it) => it.key !== LAIN_LAIN_KEY);
  if (category.value !== "All") {
    list = list.filter((it) => {
      const { groupName } = splitItemName(it.name);
      return categoryForGroup(groupName) === category.value;
    });
  }
  return filterStockItems(list, {
    search: search.value,
    trackedOnly: trackedOnly.value,
    lowStockOnly: lowStockOnly.value,
    thresholdMilli,
    sortAscending: sortAsc.value,
  });
});
</script>

<template>
  <div class="flex flex-col gap-10px flex-none">
    <div class="flex items-center gap-10px flex-wrap">
      <TextInput
        v-model="search"
        :title="L.search"
        :placeholder="L.searchPlaceholder"
        class="flex-1 min-w-260px max-w-400px"
      />
      <button
        v-if="search"
        type="button"
        class="pill-btn h-52px px-14px text-14px inline-flex items-center gap-6px cursor-pointer"
        @click="search = ''"
      >
        <X class="w-16px h-16px text-muted" />
        <span>{{ L.clear }}</span>
      </button>

      <button
        type="button"
        class="h-52px px-16px rounded-8px border text-14px font-800 whitespace-nowrap cursor-pointer press transition-colors inline-flex items-center gap-6px"
        :class="
          trackedOnly
            ? 'bg-ink border-ink text-white'
            : 'bg-surface border-border text-muted hover:text-ink'
        "
        @click="trackedOnly = !trackedOnly"
      >
        <span>{{ L.trackedOnly }}</span>
      </button>

      <button
        type="button"
        class="h-52px px-16px rounded-8px border text-14px font-800 whitespace-nowrap cursor-pointer press transition-colors inline-flex items-center gap-6px"
        :class="
          lowStockOnly
            ? 'bg-amber-600 border-amber-600 text-white'
            : 'bg-surface border-border text-muted hover:text-ink'
        "
        @click="lowStockOnly = !lowStockOnly"
      >
        <span>{{ L.lowStock }} (≤ {{ lowStockThreshold }})</span>
      </button>

      <button
        type="button"
        class="h-52px px-16px rounded-8px border text-14px font-800 whitespace-nowrap cursor-pointer press transition-colors inline-flex items-center gap-6px"
        :class="
          sortAsc
            ? 'bg-ink border-ink text-white'
            : 'bg-surface border-border text-muted hover:text-ink'
        "
        @click="sortAsc = !sortAsc"
      >
        <ArrowDownUp class="w-16px h-16px" />
        <span>{{ L.sortByStockAsc }}</span>
      </button>
    </div>

    <div class="flex items-center gap-6px overflow-x-auto pb-2px">
      <button
        v-for="cat in HARDWARE_CATEGORIES"
        :key="cat"
        type="button"
        class="h-40px px-14px rounded-6px border text-14px font-700 whitespace-nowrap cursor-pointer press"
        :class="
          category === cat
            ? 'bg-ink border-ink text-white'
            : 'bg-surface border-border text-muted hover:text-ink'
        "
        @click="category = cat"
      >
        {{ categoryButtonLabel(cat) }}
      </button>
    </div>
  </div>

  <div class="flex-1 min-h-0 border border-border rounded-8px overflow-hidden flex flex-col">
    <div class="flex-1 min-h-0 overflow-auto">
      <table class="w-full border-collapse num">
        <thead>
          <tr class="text-left text-12px font-700 text-faint border-b border-border bg-panel sticky top-0 z-1">
            <th class="p-12px w-130px">{{ L.itemCode }}</th>
            <th class="p-12px">{{ L.item }}</th>
            <th class="p-12px w-80px">{{ L.unit }}</th>
            <th class="p-12px text-right w-110px">{{ L.price }}</th>
            <th class="p-12px text-right w-130px">{{ L.currentStock }}</th>
            <th class="p-12px text-center w-120px">{{ L.status }}</th>
            <th class="p-12px text-right w-220px">{{ L.actions }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="it in filteredInventoryItems"
            :key="it.id"
            class="border-b border-borderSoft hover:bg-panel/50 cursor-pointer select-none"
            @click="emit('restock', it)"
          >
            <td class="p-12px text-13px font-700 text-muted mono">
              {{ it.key }}
            </td>

            <td class="p-12px">
              <div class="text-15px font-800 text-ink">{{ it.name }}</div>
              <div class="text-12px font-600 text-muted mt-2px">
                {{ categoryForGroup(splitItemName(it.name).groupName) }}
              </div>
            </td>

            <td class="p-12px text-14px font-700 text-muted">
              {{ it.unit }}
            </td>

            <td class="p-12px text-right text-16px font-800 text-ink">
              {{ fmtMoney(it.priceCents) }}
            </td>

            <td class="p-12px text-right">
              <span
                class="text-16px font-800"
                :class="
                  it.stockMilli == null
                    ? 'text-muted'
                    : it.stockMilli <= 0
                    ? 'text-terracotta'
                    : isLowStock(it, lowStockThreshold * 1000)
                    ? 'text-amber-700'
                    : 'text-ink'
                "
              >
                {{ formatStockQty(it.stockMilli) }}
              </span>
              <span v-if="it.stockMilli != null" class="text-12px font-700 text-muted ml-4px">
                {{ it.unit }}
              </span>
            </td>

            <td class="p-12px text-center">
              <span
                v-if="it.stockMilli == null"
                class="inline-block px-8px py-3px rounded-4px text-12px font-700 bg-panel text-muted border border-border"
              >
                {{ L.untracked }}
              </span>
              <span
                v-else-if="it.stockMilli <= 0"
                class="inline-block px-8px py-3px rounded-4px text-12px font-800 bg-terracotta/15 text-terracotta border border-terracotta/20"
              >
                {{ L.outOfStockStatus }}
              </span>
              <span
                v-else-if="isLowStock(it, lowStockThreshold * 1000)"
                class="inline-block px-8px py-3px rounded-4px text-12px font-800 bg-amber-500/15 text-amber-700 border border-amber-500/20"
              >
                {{ L.lowStock }}
              </span>
              <span
                v-else
                class="inline-block px-8px py-3px rounded-4px text-12px font-700 bg-emerald-500/15 text-emerald-700 border border-emerald-500/20"
              >
                {{ L.inStock }}
              </span>
            </td>

            <td class="p-12px text-right">
              <div class="inline-flex items-center gap-6px" @click.stop>
                <button
                  type="button"
                  class="pill-btn h-34px px-8px text-12px font-800 hover:border-ink cursor-pointer"
                  :title="`+5 ${it.unit}`"
                  @click="emit('quickRestock', it, 5)"
                >
                  +5
                </button>
                <button
                  type="button"
                  class="pill-btn h-34px px-8px text-12px font-800 hover:border-ink cursor-pointer"
                  :title="`+10 ${it.unit}`"
                  @click="emit('quickRestock', it, 10)"
                >
                  +10
                </button>
                <button
                  type="button"
                  class="pill-btn h-36px px-12px text-13px font-700 inline-flex items-center gap-4px hover:border-ink cursor-pointer"
                  @click="emit('restock', it)"
                >
                  <PackagePlus class="w-14px h-14px text-muted" />
                  <span>{{ L.restock }}</span>
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
