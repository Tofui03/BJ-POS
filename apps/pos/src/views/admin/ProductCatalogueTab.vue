<script setup lang="ts">
import { computed, ref } from "vue";
import {
  categoryButtonLabel,
  categoryForGroup,
  fmtMoney,
  HARDWARE_CATEGORIES,
  matchesHardwareSearch,
  splitItemName,
  type HardwareCategory,
  type PricedItem,
} from "@yf/core";
import { GripVertical, PackagePlus, Pencil, X } from "lucide-vue-next";
import draggable from "vuedraggable";
import TextInput from "../../components/TextInput.vue";
import { L } from "../../labels";

const props = defineProps<{
  items: PricedItem[];
}>();

const emit = defineEmits<{
  reorder: [items: PricedItem[]];
  edit: [item: PricedItem];
  restock: [item: PricedItem];
}>();

const search = ref("");
const category = ref<HardwareCategory>("All");
const dragging = ref(false);

const localItems = computed({
  get: () => props.items,
  set: (val) => emit("reorder", val),
});

const filteredItems = computed(() => {
  const q = search.value.trim();
  return props.items.filter((it) => {
    const { groupName } = splitItemName(it.name);
    if (!q && category.value !== "All" && categoryForGroup(groupName) !== category.value) {
      return false;
    }
    if (q && !matchesHardwareSearch(it.name, q) && !it.key.toLowerCase().includes(q.toLowerCase())) {
      return false;
    }
    return true;
  });
});

function onRowTap(it: PricedItem): void {
  if (dragging.value) return;
  emit("edit", it);
}

function onDragEnd(): void {
  setTimeout(() => (dragging.value = false), 150);
}
</script>

<template>
  <div class="flex flex-col gap-10px flex-none">
    <div class="flex items-center gap-10px">
      <TextInput
        v-model="search"
        :title="L.search"
        :placeholder="L.searchPlaceholder"
        class="flex-1 max-w-460px"
      />
      <button
        v-if="search"
        type="button"
        class="pill-btn h-52px px-16px text-14px inline-flex items-center gap-6px cursor-pointer"
        @click="search = ''"
      >
        <X class="w-16px h-16px text-muted" />
        <span>{{ L.clear }}</span>
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
          <tr class="text-left text-12px font-700 text-faint border-b border-border">
            <th class="p-12px bg-panel sticky top-0 z-1 w-44px"></th>
            <th class="p-12px bg-panel sticky top-0 z-1">{{ L.item }}</th>
            <th class="p-12px bg-panel sticky top-0 z-1">{{ L.unit }}</th>
            <th class="p-12px bg-panel sticky top-0 z-1 text-right">{{ L.price }}</th>
            <th class="p-12px bg-panel sticky top-0 z-1 text-right w-180px">
              {{ L.actions }}
            </th>
          </tr>
        </thead>
        <tbody v-if="category !== 'All' || search.trim() !== ''">
          <tr
            v-for="it in filteredItems"
            :key="it.id"
            class="border-b border-borderSoft hover:bg-panel/50 cursor-pointer select-none"
            @click="onRowTap(it)"
          >
            <td class="p-12px text-center text-faint">·</td>
            <td class="p-12px text-16px font-700 text-ink">{{ it.name }}</td>
            <td class="p-12px text-14px font-700 text-muted">{{ it.unit }}</td>
            <td class="p-12px text-right text-17px font-800 text-ink">
              {{ fmtMoney(it.priceCents) }}
            </td>
            <td class="p-12px text-right">
              <div class="inline-flex items-center gap-6px" @click.stop>
                <button
                  type="button"
                  class="pill-btn h-38px px-10px text-12px inline-flex items-center gap-4px hover:border-ink"
                  :title="L.restock"
                  @click="emit('restock', it)"
                >
                  <PackagePlus class="w-14px h-14px text-muted" />
                  <span>{{ L.restock }}</span>
                </button>
                <button
                  type="button"
                  class="pill-btn h-38px px-12px text-13px inline-flex items-center gap-6px"
                  @click="emit('edit', it)"
                >
                  <Pencil class="w-14px h-14px text-muted" />
                  <span>{{ L.edit }}</span>
                </button>
              </div>
            </td>
          </tr>
        </tbody>
        <draggable
          v-else
          v-model="localItems"
          tag="tbody"
          item-key="id"
          :delay="100"
          :delay-on-touch-only="false"
          :animation="150"
          ghost-class="drag-ghost"
          @start="dragging = true"
          @end="onDragEnd"
        >
          <template #item="{ element: it }">
            <tr
              :key="it.id"
              class="border-b border-borderSoft hover:bg-panel/50 cursor-pointer select-none"
              @click="onRowTap(it)"
            >
              <td class="p-12px text-center text-faint">
                <GripVertical class="w-18px h-18px inline-block text-muted" />
              </td>
              <td class="p-12px text-16px font-700 text-ink">{{ it.name }}</td>
              <td class="p-12px text-14px font-700 text-muted">{{ it.unit }}</td>
              <td class="p-12px text-right text-17px font-800 text-ink">
                {{ fmtMoney(it.priceCents) }}
              </td>
              <td class="p-12px text-right">
                <div class="inline-flex items-center gap-6px" @click.stop>
                  <button
                    type="button"
                    class="pill-btn h-38px px-10px text-12px inline-flex items-center gap-4px hover:border-ink"
                    :title="L.restock"
                    @click="emit('restock', it)"
                  >
                    <PackagePlus class="w-14px h-14px text-muted" />
                    <span>{{ L.restock }}</span>
                  </button>
                  <button
                    type="button"
                    class="pill-btn h-38px px-12px text-13px inline-flex items-center gap-6px"
                    @click="emit('edit', it)"
                  >
                    <Pencil class="w-14px h-14px text-muted" />
                    <span>{{ L.edit }}</span>
                  </button>
                </div>
              </td>
            </tr>
          </template>
        </draggable>
      </table>
    </div>
  </div>
</template>

<style scoped>
.drag-ghost {
  opacity: 0.4;
  background-color: #f3f4f6;
}
</style>
