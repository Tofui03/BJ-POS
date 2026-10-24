<script setup lang="ts" generic="T extends string | number | null">
import { computed, ref } from "vue";
import { Check, ChevronDown } from "lucide-vue-next";

const props = defineProps<{
  modelValue: T;
  options: Array<{ value: T; label: string }>;
  placeholder?: string;
}>();
const emit = defineEmits<{ "update:modelValue": [value: T] }>();

const open = ref(false);
const selected = computed(() => props.options.find((o) => o.value === props.modelValue));
const display = computed(() => selected.value?.label ?? props.placeholder ?? "Select");

const trigger = ref<HTMLElement | null>(null);
const menuStyle = ref<Record<string, string>>({});

function toggle(): void {
  if (!open.value && trigger.value) {
    const r = trigger.value.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 16;
    const up = below < 200 && r.top > below;
    menuStyle.value = {
      left: `${r.left}px`,
      minWidth: `${r.width}px`,
      maxHeight: `${Math.min(260, Math.max(120, up ? r.top - 16 : below))}px`,
      ...(up ? { bottom: `${window.innerHeight - r.top + 4}px` } : { top: `${r.bottom + 4}px` }),
    };
  }
  open.value = !open.value;
}

function pick(o: { value: T; label: string }): void {
  emit("update:modelValue", o.value);
  open.value = false;
}
</script>

<template>
  <div class="relative">
    <button
      ref="trigger"
      type="button"
      class="press w-full flex items-center justify-between gap-8px h-52px px-14px rounded-6px border border-control bg-surface text-16px font-700 text-ink cursor-pointer"
      @click="toggle"
    >
      <span class="truncate">{{ display }}</span>
      <ChevronDown class="w-16px h-16px text-muted flex-none transition-transform" :class="open ? 'rotate-180' : ''" />
    </button>

    <Teleport to="body">
      <template v-if="open">
        <div class="fixed inset-0 z-100" @click="open = false" />
        <div
          class="fixed z-101 overflow-auto bg-surface border border-border rounded-8px shadow-[0_12px_32px_rgba(19,20,22,0.14)] p-4px"
          :style="menuStyle"
        >
          <button
            v-for="o in options"
            :key="String(o.value)"
            type="button"
            class="press w-full flex items-center justify-between gap-10px text-left px-12px py-10px rounded-6px text-16px font-700 cursor-pointer border-none whitespace-nowrap"
            :class="o.value === modelValue ? 'bg-ink text-white' : 'bg-transparent text-ink hover:bg-panel'"
            @click="pick(o)"
          >
            <span class="truncate">{{ o.label }}</span>
            <Check v-if="o.value === modelValue" class="w-16px h-16px flex-none" />
          </button>
        </div>
      </template>
    </Teleport>
  </div>
</template>
