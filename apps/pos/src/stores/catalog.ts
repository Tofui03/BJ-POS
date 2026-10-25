import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  categoryForGroup,
  isStockTracked,
  splitItemName,
  type HardwareSaleCategory,
  type PricedItem,
} from "@yf/core";
import { getRepo } from "../db";

export interface ProductGroup {
  groupName: string;
  category: HardwareSaleCategory;
  items: PricedItem[];
  minPriceCents: number;
  maxPriceCents: number;
  image: string;
  allSoldOut: boolean;
  hasTiers: boolean;
}

export const useCatalog = defineStore("catalog", () => {
  const items = ref<PricedItem[]>([]);
  const loading = ref(false);

  const groups = computed<ProductGroup[]>(() => {
    const map = new Map<string, PricedItem[]>();
    for (const item of items.value) {
      const { groupName } = splitItemName(item.name);
      const list = map.get(groupName);
      if (list) list.push(item);
      else map.set(groupName, [item]);
    }
    const result: ProductGroup[] = [];
    for (const [groupName, list] of map.entries()) {
      const prices = list.map((i) => i.priceCents);
      const minPriceCents = Math.min(...prices);
      const maxPriceCents = Math.max(...prices);
      const image = list.find((i) => i.image)?.image ?? "";
      const allSoldOut = list.every((i) => isStockTracked(i) && (i.stockMilli ?? 0) <= 0);
      const hasTiers = list.some((i) => i.tiers.length > 0);
      result.push({
        groupName,
        category: categoryForGroup(groupName),
        items: list,
        minPriceCents,
        maxPriceCents,
        image,
        allSoldOut,
        hasTiers,
      });
    }
    return result;
  });

  async function load(includeInactive = false): Promise<void> {
    loading.value = true;
    try {
      const repo = await getRepo();
      items.value = await repo.listItems(includeInactive);
    } finally {
      loading.value = false;
    }
  }

  function updateItemStock(itemId: number, nextStockMilli: number): void {
    const item = items.value.find((i) => i.id === itemId);
    if (item) {
      item.stockMilli = nextStockMilli;
    }
  }

  return { items, groups, loading, load, updateItemStock };
});
