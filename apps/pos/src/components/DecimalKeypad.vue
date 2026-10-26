<script setup lang="ts">
import { DECIMAL_NUMPAD_KEYS } from "../decimalEntry";

defineProps<{
  /** Extra class on each digit key. */
  keyClass?: string;
}>();

const emit = defineEmits<{
  key: [key: string];
}>();
</script>

<template>
  <div class="grid grid-cols-4 gap-8px">
    <div class="col-span-3 grid grid-cols-3 gap-8px">
      <button
        v-for="k in DECIMAL_NUMPAD_KEYS"
        :key="k"
        type="button"
        class="rounded-8px border border-border bg-surface text-24px font-800 text-ink cursor-pointer press flex items-center justify-center num hover:border-ink active:bg-active"
        :class="keyClass ?? 'h-60px'"
        @click="emit('key', k)"
      >
        {{ k }}
      </button>
    </div>
    <div class="col-span-1 flex flex-col gap-8px">
      <button
        type="button"
        class="rounded-8px border border-border bg-surface text-22px font-800 text-ink cursor-pointer press flex items-center justify-center hover:border-ink active:bg-active"
        :class="keyClass ?? 'h-60px'"
        title="Backspace"
        @click="emit('key', '⌫')"
      >
        ⌫
      </button>
      <slot name="action" />
    </div>
  </div>
</template>
