<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import dayjs from "dayjs";
import {
  ArrowLeft,
  Building2,
  Calendar,
  CalendarCheck,
  ChevronDown,
  History,
  Package,
  Settings,
} from "lucide-vue-next";
import { currentCompany } from "../place";
import { from, maxDate, dateLabel, refreshBusinessDate, setCurrentDay } from "../salesDate";
import DatePicker from "./DatePicker.vue";
import SendReportDialog from "./SendReportDialog.vue";
import CloseDayDialog from "./CloseDayDialog.vue";
import SettingsDialog from "./SettingsDialog.vue";
import { currentLocale, setLocale } from "../settings";
import { L } from "../labels";

defineProps<{ mode: "till" | "sales" | "admin" | "report" | "contractors" }>();

const router = useRouter();
// Live business date (advances to tomorrow after Close Day so it matches invoice & Excel dates)
const businessDateLabel = computed(() => dayjs(maxDate.value).format("DD MMM YYYY"));

const sendOpen = ref(false);
const settingsOpen = ref(false);
const closeDayOpen = ref(false);

onMounted(() => {
  void refreshBusinessDate();
});

function onDayClosed(businessDate: string): void {
  closeDayOpen.value = false;
  void refreshBusinessDate();
  void router.push({ path: "/report", query: { date: businessDate } });
}

const dateOpen = ref(false);
function toggleDatePicker(): void {
  dateOpen.value = !dateOpen.value;
  if (dateOpen.value) void refreshBusinessDate();
}
function pickDate(v: string) {
  from.value = v;
  dateOpen.value = false;
}
</script>

<template>
  <header
    class="flex items-center justify-between gap-12px px-16px h-68px bg-ground flex-none relative select-none"
  >
    <!-- Left: Store identity + navigation -->
    <div class="flex items-center gap-10px min-w-0">
      <div class="flex items-center gap-10px pr-12px border-r border-border">
        <div
          class="w-40px h-40px rounded-8px bg-ink text-white flex items-center justify-center text-15px font-800 tracking-tight flex-none"
        >
          BJ
        </div>
        <span class="text-18px font-800 text-ink whitespace-nowrap">{{ currentCompany.name }}</span>
      </div>

      <template v-if="mode === 'till'">
        <button
          type="button"
          class="press flex items-center gap-8px h-50px min-h-50px px-16px rounded-6px border border-border bg-surface text-16px font-700 text-ink cursor-pointer hover:border-ink"
          @click="router.push('/dashboard')"
        >
          <History class="w-18px h-18px text-muted flex-none" />
          <span>{{ L.history }}</span>
        </button>
        <button
          type="button"
          class="press flex items-center gap-8px h-50px min-h-50px px-16px rounded-6px border border-border bg-surface text-16px font-700 text-ink cursor-pointer hover:border-ink"
          @click="router.push('/item')"
        >
          <Package class="w-18px h-18px text-muted flex-none" />
          <span>{{ L.items }}</span>
        </button>
        <button
          type="button"
          class="press flex items-center gap-8px h-50px min-h-50px px-16px rounded-6px border border-border bg-surface text-16px font-700 text-ink cursor-pointer hover:border-ink"
          @click="router.push('/contractors')"
        >
          <Building2 class="w-18px h-18px text-muted flex-none" />
          <span>{{ L.contractors }}</span>
        </button>
      </template>
      <template v-else>
        <button
          type="button"
          class="press flex items-center gap-8px h-50px min-h-50px px-18px rounded-6px border border-ink bg-ink text-white text-16px font-700 cursor-pointer"
          @click="router.push('/')"
        >
          <ArrowLeft class="w-18px h-18px flex-none" />
          <span>{{ L.till }}</span>
        </button>
        <button
          v-if="mode !== 'sales'"
          type="button"
          class="press flex items-center gap-8px h-50px min-h-50px px-16px rounded-6px border border-border bg-surface text-16px font-700 text-ink cursor-pointer hover:border-ink"
          @click="router.push('/dashboard')"
        >
          <History class="w-18px h-18px text-muted flex-none" />
          <span>{{ L.history }}</span>
        </button>
        <button
          v-if="mode !== 'admin'"
          type="button"
          class="press flex items-center gap-8px h-50px min-h-50px px-16px rounded-6px border border-border bg-surface text-16px font-700 text-ink cursor-pointer hover:border-ink"
          @click="router.push('/item')"
        >
          <Package class="w-18px h-18px text-muted flex-none" />
          <span>{{ L.items }}</span>
        </button>
        <button
          type="button"
          class="press flex items-center gap-8px h-50px min-h-50px px-16px rounded-6px border text-16px font-700 cursor-pointer"
          :class="
            mode === 'contractors'
              ? 'border-ink bg-ink text-white'
              : 'border-border bg-surface text-ink hover:border-ink'
          "
          @click="router.push('/contractors')"
        >
          <Building2
            class="w-18px h-18px flex-none"
            :class="mode === 'contractors' ? 'text-white' : 'text-muted'"
          />
          <span>{{ L.contractors }}</span>
        </button>
      </template>
    </div>

    <!-- Right: Actions / Settings + Language Switcher -->
    <div class="flex items-center gap-10px">
      <button
        v-if="mode === 'till'"
        type="button"
        class="press flex items-center gap-8px h-50px min-h-50px px-16px rounded-6px border border-border bg-surface text-15px font-700 text-ink cursor-pointer hover:border-ink"
        @click="closeDayOpen = true"
      >
        <CalendarCheck class="w-18px h-18px text-muted flex-none" />
        <span>{{ L.closeDay }}</span>
      </button>

      <button
        type="button"
        class="press flex items-center gap-8px h-50px min-h-50px px-16px rounded-6px border border-border bg-surface text-15px font-700 text-ink cursor-pointer hover:border-ink"
        @click="settingsOpen = true"
      >
        <Settings class="w-18px h-18px text-muted flex-none" />
        <span>{{ L.settings }}</span>
      </button>

      <!-- Language Switcher: 中文 / EN / BM -->
      <div class="flex items-center rounded-6px border border-border bg-surface p-2px h-50px select-none">
        <button
          type="button"
          class="h-full px-12px rounded-4px text-14px font-700 cursor-pointer press transition-colors"
          :class="currentLocale === 'zh' ? 'bg-ink text-white font-800' : 'text-muted hover:text-ink'"
          @click="setLocale('zh')"
        >
          中文
        </button>
        <button
          type="button"
          class="h-full px-12px rounded-4px text-14px font-700 cursor-pointer press transition-colors"
          :class="currentLocale === 'en' ? 'bg-ink text-white font-800' : 'text-muted hover:text-ink'"
          @click="setLocale('en')"
        >
          EN
        </button>
        <button
          type="button"
          class="h-full px-12px rounded-4px text-14px font-700 cursor-pointer press transition-colors"
          :class="currentLocale === 'ms' ? 'bg-ink text-white font-800' : 'text-muted hover:text-ink'"
          @click="setLocale('ms')"
        >
          BM
        </button>
      </div>

      <!-- sales/report: clickable date selector; till/admin: live business date badge -->
      <div v-if="mode === 'sales' || mode === 'report'" class="relative">
        <button
          type="button"
          class="press flex items-center gap-8px h-50px min-h-50px px-14px rounded-6px border border-ink bg-ink text-white text-15px font-700 cursor-pointer num"
          @click="toggleDatePicker"
        >
          <Calendar class="w-16px h-16px opacity-80 flex-none" />
          <span class="whitespace-nowrap">{{ dateLabel }}</span>
          <ChevronDown
            class="w-16px h-16px opacity-80 flex-none transition-transform"
            :class="dateOpen ? 'rotate-180' : ''"
          />
        </button>
        <template v-if="dateOpen">
          <div class="fixed inset-0 z-40" @click="dateOpen = false" />
          <div
            class="absolute top-full right-0 mt-6px z-50 bg-surface border border-border rounded-8px p-8px shadow-[0_12px_32px_rgba(19,20,22,0.14)]"
          >
            <DatePicker :model-value="from" :max="maxDate" @update:model-value="pickDate" />
            <button
              type="button"
              class="w-full h-48px text-15px mt-6px rounded-6px border-none bg-ink text-white font-700 cursor-pointer press"
              @click="((setCurrentDay()), (dateOpen = false))"
            >
              {{ L.today }}
            </button>
          </div>
        </template>
      </div>
      <div
        v-else
        class="flex items-center gap-8px h-50px min-h-50px px-14px rounded-6px border border-border bg-surface text-ink text-15px font-700 whitespace-nowrap num"
        title="Business Date / Tarikh Jualan"
      >
        <Calendar class="w-16px h-16px text-muted flex-none" />
        <span>{{ businessDateLabel }}</span>
      </div>
    </div>
  </header>

  <SendReportDialog :open="sendOpen" @close="sendOpen = false" />
  <CloseDayDialog :open="closeDayOpen" @closed="onDayClosed" @close="closeDayOpen = false" />
  <SettingsDialog :open="settingsOpen" @close="settingsOpen = false" />
</template>
