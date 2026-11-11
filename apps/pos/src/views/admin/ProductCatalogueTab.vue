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
        class="h-42px px-14px rounded-full border text-14px font-700 whitespace-nowrap cursor-pointer transition-all active:translate-y-1px"
        :class="
          category === cat
            ? 'bg-[#18181B] border-[#18181B] text-white shadow-sm'
            : 'bg-[#F4F3EF] hover:bg-[#E7E5DE] border-[#DCDAD2] text-[#52525B] hover:text-[#18181B]'
        "
        @click="category = cat"
      >
        {{ categoryButtonLabel(cat) }}
      </button>
    </div>
  </div>

  <div class="flex-1 min-h-0 border border-[#DCDAD2] rounded-10px overflow-hidden flex flex-col bg-white">
    <div class="flex-1 min-h-0 overflow-auto">
      <table class="w-full border-collapse num">
        <thead>
          <tr class="text-left text-12px font-700 uppercase tracking-wider text-[#71717A] border-b border-[#E4E2DD]">
            <th class="p-12px bg-[#F4F3EF] sticky top-0 z-1 w-44px"></th>
            <th class="p-12px bg-[#F4F3EF] sticky top-0 z-1">{{ L.item }}</th>
            <th class="p-12px bg-[#F4F3EF] sticky top-0 z-1">{{ L.unit }}</th>
            <th class="p-12px bg-[#F4F3EF] sticky top-0 z-1 text-right">{{ L.price }}</th>
            <th class="p-12px bg-[#F4F3EF] sticky top-0 z-1 text-right w-180px">
              {{ L.actions }}
            </th>
          </tr>
        </thead>
        <tbody v-if="category !== 'All' || search.trim() !== ''">
          <tr
            v-for="it in filteredItems"
            :key="it.id"
            class="border-b border-[#F0EFEA] hover:bg-[#FAF9F5] cursor-pointer select-none transition-colors"
            @click="onRowTap(it)"
          >
            <td class="p-12px text-center text-[#A1A1AA]">·</td>
            <td class="p-12px text-15px font-700 text-[#18181B]">{{ it.name }}</td>
            <td class="p-12px text-14px font-600 text-[#71717A]">{{ it.unit }}</td>
            <td class="p-12px text-right text-17px font-800 text-[#18181B] num tracking-tight">
              {{ fmtMoney(it.priceCents) }}
            </td>
            <td class="p-12px text-right">
              <div class="inline-flex items-center gap-6px" @click.stop>
                <button
                  type="button"
                  class="h-38px px-10px rounded-8px border border-[#DCDAD2] bg-[#F4F3EF] hover:bg-[#E7E5DE] text-12px font-700 text-[#18181B] inline-flex items-center gap-4px cursor-pointer active:translate-y-1px shadow-[0_2px_0_#C8C5BC]"
                  :title="L.restock"
                  @click="emit('restock', it)"
                >
                  <PackagePlus class="w-14px h-14px text-[#52525B]" />
                  <span>{{ L.restock }}</span>
                </button>
                <button
                  type="button"
                  class="h-38px px-12px rounded-8px border border-[#DCDAD2] bg-white hover:bg-[#FAF9F5] text-13px font-700 text-[#18181B] inline-flex items-center gap-6px cursor-pointer active:translate-y-1px shadow-[0_2px_0_#C8C5BC]"
                  @click="emit('edit', it)"
                >
                  <Pencil class="w-14px h-14px text-[#52525B]" />
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
              class="border-b border-[#F0EFEA] hover:bg-[#FAF9F5] cursor-pointer select-none transition-colors"
              @click="onRowTap(it)"
            >
              <td class="p-12px text-center text-[#A1A1AA]">
                <GripVertical class="w-18px h-18px inline-block text-[#71717A]" />
              </td>
              <td class="p-12px text-15px font-700 text-[#18181B]">{{ it.name }}</td>
              <td class="p-12px text-14px font-600 text-[#71717A]">{{ it.unit }}</td>
              <td class="p-12px text-right text-17px font-800 text-[#18181B] num tracking-tight">
                {{ fmtMoney(it.priceCents) }}
              </td>
              <td class="p-12px text-right">
                <div class="inline-flex items-center gap-6px" @click.stop>
                  <button
                    type="button"
                    class="h-38px px-10px rounded-8px border border-[#DCDAD2] bg-[#F4F3EF] hover:bg-[#E7E5DE] text-12px font-700 text-[#18181B] inline-flex items-center gap-4px cursor-pointer active:translate-y-1px shadow-[0_2px_0_#C8C5BC]"
                    :title="L.restock"
                    @click="emit('restock', it)"
                  >
                    <PackagePlus class="w-14px h-14px text-[#52525B]" />
                    <span>{{ L.restock }}</span>
                  </button>
                  <button
                    type="button"
                    class="h-38px px-12px rounded-8px border border-[#DCDAD2] bg-white hover:bg-[#FAF9F5] text-13px font-700 text-[#18181B] inline-flex items-center gap-6px cursor-pointer active:translate-y-1px shadow-[0_2px_0_#C8C5BC]"
                    @click="emit('edit', it)"
                  >
                    <Pencil class="w-14px h-14px text-[#52525B]" />
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
