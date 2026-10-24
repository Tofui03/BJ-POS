import { computed, ref, watch } from "vue";
import dayjs, { type Dayjs } from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import { currentBusinessDate } from "./business";
import { currentCompany } from "./place";

dayjs.extend(isoWeek);

// Shared selected date for the Sales report. This is the single source of truth:
// the Day, Weekly and Monthly tabs all derive their period (day / ISO week /
// calendar month) from `from`, so picking a date updates every tab's context.
// Every period is a *business* day range (the Close Day boundary), never wall
// clock — the dashboard, /report and the emailed day report must agree.

const FMT = "YYYY-MM-DD";

// A till runs for days without a restart, so "now" must tick — a module-load
// snapshot would freeze "today" (and the can't-navigate-into-the-future guards)
// at whatever day the app was launched.
const now = ref(dayjs());
setInterval(() => {
  now.value = dayjs();
}, 30_000);

export const todayStr = computed(() => now.value.format(FMT));

// ----- The live business day -----
// Once today is closed, new sales are stamped with tomorrow, so the last day
// worth selecting runs ahead of the calendar until midnight. Reading it costs a
// DB lookup, so it is cached and refreshed on the events that can change it:
// midnight, a company switch, and (from the UI) a close, a reopen or opening
// the date picker.
const carried = ref<string | null>(null);

export async function refreshBusinessDate(): Promise<void> {
  try {
    carried.value = await currentBusinessDate(currentCompany.value.id);
  } catch {
    carried.value = null; // DB not up yet — today stays the safe answer
  }
}

/** Latest day a sale can belong to: today, or tomorrow once today is closed. */
export const maxDate = computed(() =>
  carried.value != null && carried.value > todayStr.value ? carried.value : todayStr.value,
);

watch([todayStr, () => currentCompany.value.id], () => void refreshBusinessDate(), {
  immediate: true,
});

// ----- The selected day (Day tab) -----
export const from = ref(now.value.format(FMT));

export const dateLabel = computed(() => dayjs(from.value).format("DD MMM YYYY"));

/** Jump to the live business day (today, or the carried day after a close). */
export function setCurrentDay(): void {
  from.value = maxDate.value;
}
export function setDay(d: Dayjs | string): void {
  from.value = dayjs(d).format(FMT);
}

// ----- Weekly (ISO week: Mon–Sun) derived from `from` -----
const weekStart = computed(() => dayjs(from.value).startOf("isoWeek"));
export const weekStartStr = computed(() => weekStart.value.format(FMT));
/** Inclusive: listOrdersByBusinessDate ranges are closed at both ends. */
export const weekEndStr = computed(() => weekStart.value.add(6, "day").format(FMT));
export const weekDays = computed(() => Array.from({ length: 7 }, (_, i) => weekStart.value.add(i, "day")));
export const weekLabel = computed(
  () => `${weekStart.value.format("DD MMM")} – ${weekStart.value.add(6, "day").format("DD MMM YYYY")}`,
);
export const isThisWeek = computed(() =>
  weekStart.value.isSame(dayjs(maxDate.value).startOf("isoWeek"), "day"),
);
export const canWeekForward = computed(() => weekStart.value.add(7, "day").format(FMT) <= maxDate.value);

export function weekShift(delta: number): void {
  from.value = dayjs(from.value).add(delta, "week").format(FMT);
}
export function weekToCurrent(): void {
  from.value = maxDate.value;
}

// ----- Monthly (calendar month) derived from `from` -----
const monthRef = computed(() => dayjs(from.value));
export const monthStartStr = computed(() => monthRef.value.startOf("month").format(FMT));
export const monthEndStr = computed(() => monthRef.value.endOf("month").format(FMT));
export const monthLabel = computed(() => monthRef.value.format("MMMM YYYY"));
export const monthYear = computed(() => monthRef.value.year());
export const monthIndex = computed(() => monthRef.value.month());
export const daysInMonth = computed(() => monthRef.value.daysInMonth());
const isCurrentMonth = computed(() => monthRef.value.isSame(dayjs(maxDate.value), "month"));
// Highest selectable day-of-month: the live business day in its own month, else
// the whole month.
export const monthMaxDay = computed(() =>
  isCurrentMonth.value ? dayjs(maxDate.value).date() : daysInMonth.value,
);
// Day to highlight as "now" — only meaningful in the live business day's month.
export const monthCurrentDate = computed(() => (isCurrentMonth.value ? dayjs(maxDate.value).date() : -1));
