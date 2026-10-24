<script setup lang="ts">
import { computed, ref, watch } from "vue";
import dayjs, { type Dayjs } from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";

dayjs.extend(isoWeek);

// Compact calendar: Monday-first, fixed 6-row month grid, past dates only.
const props = withDefaults(defineProps<{ modelValue: string; max?: string }>(), {
  max: () => dayjs().format("YYYY-MM-DD"),
});
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const FMT = "YYYY-MM-DD";
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const selected = computed(() => dayjs(props.modelValue));
const maxMs = computed(() => dayjs(props.max).endOf("day").valueOf());

// The month currently on screen — follows the selection when it changes.
const cursor = ref(selected.value.startOf("month"));
watch(
  () => props.modelValue,
  (v) => (cursor.value = dayjs(v).startOf("month")),
);

const monthLabel = computed(() => cursor.value.format("MMM YYYY"));
const canNext = computed(() => cursor.value.endOf("month").valueOf() < maxMs.value);

// Always 42 cells (6 weeks), starting on the Monday on/before the 1st.
const cells = computed(() => {
  const start = cursor.value.startOf("month").startOf("isoWeek");
  return Array.from({ length: 42 }, (_, i) => {
    const d = start.add(i, "day");
    return {
      key: d.format(FMT),
      d,
      label: d.date(),
      inMonth: d.month() === cursor.value.month(),
      isToday: d.isSame(dayjs(), "day"),
      isSelected: d.isSame(selected.value, "day"),
      disabled: d.valueOf() > maxMs.value,
    };
  });
});

function prevMonth(): void {
  cursor.value = cursor.value.subtract(1, "month");
}
function nextMonth(): void {
  if (canNext.value) cursor.value = cursor.value.add(1, "month");
}
function pick(c: { d: Dayjs; disabled: boolean }): void {
  if (!c.disabled) emit("update:modelValue", c.d.format(FMT));
}
</script>

<template>
  <div class="w-300px bg-surface rounded-16px p-14px select-none">
    <!-- header -->
    <div class="flex items-center justify-between mb-12px">
      <div class="text-17px font-800">{{ monthLabel }}</div>
      <div class="flex items-center gap-6px">
        <button class="cal-nav" title="Previous month" @click="prevMonth">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M15 6 9 12l6 6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <button
          class="cal-nav"
          :class="!canNext ? 'opacity-30 cursor-not-allowed' : ''"
          :disabled="!canNext"
          title="Next month"
          @click="nextMonth"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="m9 6 6 6-6 6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </div>
    </div>

    <!-- weekday labels -->
    <div class="grid grid-cols-7 gap-2px mb-4px">
      <div v-for="w in WEEKDAYS" :key="w" class="text-center text-12px font-800 text-faint py-2px">
        {{ w }}
      </div>
    </div>

    <!-- 6 rows of days -->
    <div class="grid grid-cols-7 gap-2px">
      <button
        v-for="c in cells"
        :key="c.key"
        class="aspect-square rounded-full flex items-center justify-center text-15px font-700 border-none"
        :class="
          c.disabled
            ? 'bg-transparent text-faint opacity-30 cursor-not-allowed'
            : c.isSelected
              ? 'bg-date text-white font-800 cursor-pointer'
              : c.isToday
                ? 'bg-panel text-olive font-800 cursor-pointer'
                : c.inMonth
                  ? 'bg-transparent text-ink cursor-pointer hover:bg-panel'
                  : 'bg-transparent text-faint cursor-pointer hover:bg-panel'
        "
        :disabled="c.disabled"
        @click="pick(c)"
      >{{ c.label }}</button>
    </div>
  </div>
</template>

<style scoped>
.cal-nav {
  width: 30px;
  height: 30px;
  border-radius: 9999px;
  border: 2px solid var(--cal-border, #e7dcc7);
  background: #fbf6ec;
  color: #9a8d76;
  font-weight: 800;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cal-nav:active {
  transform: translateY(1px);
}
</style>
