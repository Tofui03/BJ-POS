<script setup lang="ts">
import { shallowRef, useAttrs } from "vue";
import { Search } from "lucide-vue-next";
import KeyboardDialog from "./KeyboardDialog.vue";

defineOptions({ inheritAttrs: false });

// Touchscreen text field: looks like an input but opens the on-screen QWERTY
// keyboard on tap (and supports physical keyboard inside the dialog).
const props = defineProps<{ modelValue: string; placeholder?: string; title?: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const attrs = useAttrs();
const open = shallowRef(false);
function onConfirm(v: string): void {
  emit("update:modelValue", v);
  open.value = false;
}
</script>

<template>
  <button
    v-bind="attrs"
    type="button"
    class="min-w-0 h-52px px-14px rounded-6px border border-control bg-surface text-16px text-left cursor-pointer press flex items-center gap-10px"
    @click="open = true"
  >
    <Search
      v-if="(title ?? '').toLowerCase().includes('search')"
      class="w-18px h-18px text-muted flex-none"
    />
    <span v-if="modelValue" class="text-ink font-600 truncate">{{ modelValue }}</span>
    <span v-else class="text-faint truncate">{{ placeholder }}</span>
  </button>

  <KeyboardDialog
    :open="open"
    :title="title ?? placeholder ?? 'Enter text'"
    :initial="modelValue"
    @confirm="onConfirm"
    @close="open = false"
  />
</template>
