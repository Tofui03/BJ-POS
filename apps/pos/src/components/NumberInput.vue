<script setup lang="ts">
import { computed, ref } from "vue";
import NumpadDialog from "./NumpadDialog.vue";

// Touchscreen number field: looks like an input but opens the on-screen decimal
// numpad on tap. Two-way bound via v-model.
const props = withDefaults(
  defineProps<{
    modelValue: number;
    /** Heading shown in the numpad dialog. */
    title?: string;
    /** Suffix shown inside the numpad (e.g. "kg"). */
    unit?: string;
    /** Small label before the value on the field (e.g. "RM"). */
    prefix?: string;
    /** Small label after the value on the field (e.g. "/ kg"). */
    suffix?: string;
    /** Larger, bolder field. */
    big?: boolean;
    /** Fixed decimal places for the displayed value (e.g. 2 for money). */
    decimals?: number;
  }>(),
  { title: "Enter value" },
);
const emit = defineEmits<{ "update:modelValue": [value: number] }>();

defineOptions({ inheritAttrs: false });

const open = ref(false);
const money = computed(() => props.decimals === 2);
function onConfirm(v: number): void {
  emit("update:modelValue", v);
  open.value = false;
}
</script>

<template>
  <button
    v-bind="$attrs"
    type="button"
    class="inline-flex items-center justify-between gap-6px rounded-6px border border-control bg-surface text-ink cursor-pointer press outline-none focus:outline-none num"
    :class="big ? 'h-56px min-w-130px px-16px text-22px' : 'h-52px min-w-0 px-14px text-16px'"
    @click="open = true"
  >
    <span v-if="prefix" class="font-700 text-muted">{{ prefix }}</span>
    <span class="font-800 ml-auto">{{ decimals != null ? modelValue.toFixed(decimals) : modelValue }}</span>
    <span v-if="suffix" class="font-700 text-muted">{{ suffix }}</span>
  </button>

  <NumpadDialog
    :open="open"
    :title="title"
    :unit="unit"
    :money="money"
    :initial="modelValue"
    @confirm="onConfirm"
    @close="open = false"
  />
</template>
