<script setup lang="ts">
import { ref, watch } from "vue";
import dayjs from "dayjs";
import { AlertTriangle, ChevronDown, Clock, CloudUpload, Download } from "lucide-vue-next";
import DatePicker from "./DatePicker.vue";
import Loading from "./Loading.vue";
import { getRepo } from "../db";
import { currentCompany } from "../place";
import { driveConfigured } from "../settings";
import {
  buildDailyExcelB64,
  dailyReportBody,
  dailyReportSubject,
  downloadDailyExcel,
} from "../report/daily";
import { computeFinancialMetrics } from "@yf/core";
import { L } from "../labels";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const today = (): string => dayjs().format("YYYY-MM-DD");
const date = ref(today());
const calOpen = ref(false);
const status = ref<"idle" | "loading" | "success" | "queued" | "error">("idle");
const note = ref("");

watch(
  () => props.open,
  (o) => {
    if (o) {
      date.value = today();
      calOpen.value = false;
      status.value = "idle";
      note.value = "";
    }
  },
);

function pick(v: string): void {
  date.value = v;
  calOpen.value = false;
}

async function downloadLocal(): Promise<void> {
  const repo = await getRepo();
  const company = currentCompany.value;
  const [orders, repayments] = await Promise.all([
    repo.listOrdersByBusinessDate(date.value, date.value, company.id),
    repo.listRepaymentsByBusinessDate(date.value, date.value, company.id),
  ]);
  const b64 = buildDailyExcelB64(orders, repayments);
  const filename = `${company.name.replace(/\s+/g, "-")}-sales-${date.value}.xlsx`;
  downloadDailyExcel(b64, filename);
}

async function send(): Promise<void> {
  status.value = "loading";
  try {
    if (!(await driveConfigured())) {
      status.value = "error";
      note.value =
        "Google Drive is not configured yet — use Download Excel to save the file directly, or configure DRIVE_FOLDER_ID and DRIVE_SERVICE_ACCOUNT_FILE in .env.";
      return;
    }
    const repo = await getRepo();
    const company = currentCompany.value;
    const [orders, repayments] = await Promise.all([
      repo.listOrdersByBusinessDate(date.value, date.value, company.id),
      repo.listRepaymentsByBusinessDate(date.value, date.value, company.id),
    ]);
    await repo.queueEmail({
      companyId: company.id,
      businessDate: date.value,
      channel: "drive",
      subject: dailyReportSubject(company.name, date.value, false),
      body: dailyReportBody(company.name, date.value, false, computeFinancialMetrics(orders, repayments)),
      attachmentName: `${company.name.replace(/\s+/g, "-")}-sales-${date.value}.xlsx`,
      attachmentB64: buildDailyExcelB64(orders, repayments),
    });

    const result = await window.drive?.process();
    if (result && result.sent > 0 && result.pending === 0) {
      status.value = "success";
      await new Promise((r) => setTimeout(r, 1300));
      emit("close");
    } else {
      status.value = "queued";
      note.value = result?.lastError
        ? "Could not upload right now — it will keep trying automatically."
        : "No internet — the report is saved and will upload automatically when the connection is back.";
    }
  } catch (e) {
    status.value = "error";
    note.value = e instanceof Error ? e.message : "Something went wrong.";
  }
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 bg-[rgba(19,20,22,.45)] flex items-center justify-center p-24px z-[100]"
    @click.self="status !== 'loading' && $emit('close')"
  >
    <div
      class="w-420px max-w-full bg-surface rounded-12px border border-border shadow-[0_12px_32px_rgba(19,20,22,0.14)] flex flex-col overflow-auto"
      style="max-height: 92vh"
    >
      <template v-if="status === 'idle'">
        <div class="px-24px pt-20px pb-14px border-b border-border flex-none">
          <div class="text-18px font-800 text-ink">Export Daily Excel / Laporan Excel</div>
          <div class="text-14px font-600 text-muted mt-2px">
            Close Day already uploads automatically. Use this only to download or resend manually.
          </div>
        </div>

        <div class="p-16px flex flex-col gap-10px">
          <div class="text-13px font-700 text-muted">Date</div>
          <button
            type="button"
            class="h-52px px-16px rounded-6px border border-control bg-surface text-16px font-700 text-ink flex items-center justify-between cursor-pointer press num"
            @click="calOpen = !calOpen"
          >
            <span>{{ dayjs(date).format("DD MMM YYYY") }}</span>
            <ChevronDown class="w-16px h-16px text-muted transition-transform" :class="calOpen ? 'rotate-180' : ''" />
          </button>
          <div v-if="calOpen" class="flex justify-center">
            <DatePicker :model-value="date" @update:model-value="pick" />
          </div>
        </div>

        <div class="px-16px py-16px flex flex-col gap-10px border-t border-border flex-none">
          <button
            type="button"
            class="h-52px rounded-6px border border-ink bg-panel text-15px font-700 text-ink cursor-pointer press inline-flex items-center justify-center gap-8px"
            @click="downloadLocal"
          >
            <Download class="w-18px h-18px" />
            <span>{{ L.downloadExcel }}</span>
          </button>
          <div class="grid grid-cols-2 gap-10px">
            <button
              type="button"
              class="h-52px rounded-6px border border-border bg-surface text-15px font-700 text-muted cursor-pointer press"
              @click="$emit('close')"
            >
              {{ L.cancel }}
            </button>
            <button
              type="button"
              class="btn-pay h-52px text-15px inline-flex items-center justify-center gap-6px"
              @click="send"
            >
              <CloudUpload class="w-18px h-18px" />
              <span>{{ L.resendDrive }}</span>
            </button>
          </div>
        </div>
      </template>

      <Loading
        v-else-if="status === 'loading' || status === 'success'"
        :state="status"
        :message="status === 'success' ? L.driveSent : 'Uploading to Google Drive…'"
      />

      <template v-else>
        <div class="flex flex-col items-center gap-14px px-24px py-30px text-center">
          <div
            class="w-56px h-56px rounded-full flex items-center justify-center"
            :class="status === 'queued' ? 'bg-[#fffbeb] text-warning' : 'bg-[#ffedea] text-negative'"
          >
            <Clock v-if="status === 'queued'" class="w-28px h-28px" />
            <AlertTriangle v-else class="w-28px h-28px" />
          </div>
          <div class="text-19px font-800 text-ink">{{ status === "queued" ? L.driveQueued : "Could not upload" }}</div>
          <div class="text-15px font-600 text-muted">{{ note }}</div>
          <button type="button" class="btn-pay h-52px px-30px text-17px" @click="$emit('close')">{{ L.ok }}</button>
        </div>
      </template>
    </div>
  </div>
</template>
