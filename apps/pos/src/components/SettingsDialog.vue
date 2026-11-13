<script setup lang="ts">
import { ref, watch } from "vue";
import { useRouter } from "vue-router";
import { CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-vue-next";
import dayjs from "dayjs";
import { LAIN_LAIN_KEY, parseHardwareCsv } from "@yf/core";
import { getRepo } from "../db";
import {
  driveConfigured,
  getDocumentPrinter,
  getReceiptPrinter,
  setDocumentPrinter,
  setMoneyEntry,
  setReceiptPrinter,
  SETTING_KEYS,
} from "../settings";
import type { AppUpdateInfo, PrinterInfo } from "../ipc-driver";
import { useUi } from "../stores/ui";
import { useCatalog } from "../stores/catalog";
import { L } from "../labels";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const router = useRouter();
const ui = useUi();
const catalog = useCatalog();

const driveReady = ref<boolean>(false);
const csvInput = ref<HTMLInputElement | null>(null);
const printers = ref<PrinterInfo[]>([]);
const receiptPrinter = ref<string>("");
const documentPrinter = ref<string>("");
const checkingUpdate = ref<boolean>(false);
const updateInfo = ref<AppUpdateInfo | null>(null);
const hasAppUpdateBridge = typeof window !== "undefined" && Boolean(window.appUpdate);

async function checkForUpdates(): Promise<void> {
  if (!window.appUpdate || checkingUpdate.value) return;
  checkingUpdate.value = true;
  try {
    const info = await window.appUpdate.check();
    updateInfo.value = info;
    ui.showToast(
      info.hasUpdate
        ? `Update available: v${info.latestVersion}`
        : `You are on the latest version (v${info.currentVersion})`,
    );
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : "Failed to check for updates");
  } finally {
    checkingUpdate.value = false;
  }
}

watch(
  () => props.open,
  async (o) => {
    if (!o) return;
    const [drive, list, savedReceipt, savedDoc] = await Promise.all([
      driveConfigured(),
      window.printing?.listPrinters?.().catch(() => [] as PrinterInfo[]) ?? Promise.resolve([] as PrinterInfo[]),
      getReceiptPrinter(),
      getDocumentPrinter(),
    ]);
    driveReady.value = drive;
    printers.value = list;
    receiptPrinter.value = savedReceipt;
    documentPrinter.value = savedDoc;
  },
);

async function onCsvSelected(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = parseHardwareCsv(text);
    if (parsed.length === 0) {
      ui.showToast("No valid items found in CSV");
      return;
    }
    const repo = await getRepo();
    const existing = await repo.listItems(true);
    const byKey = new Map(existing.map((i) => [i.key, i]));
    const byName = new Map(existing.map((i) => [i.name.toLowerCase(), i]));

    let added = 0;
    let updated = 0;
    for (const s of parsed) {
      const match = byKey.get(s.key) ?? byName.get(s.name.toLowerCase());
      if (match) {
        await repo.updateItem(match.id, {
          name: s.name,
          unit: s.unit,
          priceCents: s.priceCents,
          active: true,
        });
        updated++;
      } else {
        const uniqueKey = byKey.has(s.key)
          ? `${s.key}_${Date.now().toString(36)}_${added}`
          : s.key;
        const created = await repo.createItem({
          key: uniqueKey,
          name: s.name,
          unit: s.unit,
          image: s.image,
          priceCents: s.priceCents,
          tracksTail: false,
        });
        byKey.set(created.key, created);
        byName.set(created.name.toLowerCase(), created);
        added++;
      }
    }
    await catalog.load();
    ui.showToast(`CSV imported: ${added} added, ${updated} updated`);
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : "CSV import failed");
  }
}

function escapeCsvCell(val: string | number): string {
  const str = String(val ?? "");
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function exportItemsCsv(): Promise<void> {
  try {
    const repo = await getRepo();
    const items = (await repo.listItems()).filter((i) => i.key !== LAIN_LAIN_KEY);
    const headers = ["No", "Item Name", "Specification / Size", "Retail Price", "Unit"];
    const rows = items.map((item, index) => {
      const parts = item.name.split(" — ");
      const rawName = parts[0] || item.name;
      const rawSpec = parts.length > 1 ? parts.slice(1).join(" — ") : "";
      const priceRm = (item.priceCents / 100).toFixed(2);
      return [
        escapeCsvCell(index + 1),
        escapeCsvCell(rawName),
        escapeCsvCell(rawSpec),
        escapeCsvCell(priceRm),
        escapeCsvCell(item.unit),
      ].join(",");
    });
    const csvContent = [headers.join(","), ...rows].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `catalog-items-${dayjs().format("YYYY-MM-DD")}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    ui.showToast(`Exported ${items.length} items to CSV`);
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : "CSV export failed");
  }
}

function openReports(): void {
  emit("close");
  void router.push("/report");
}

async function save(): Promise<void> {
  const repo = await getRepo();
  await repo.setSetting(SETTING_KEYS.paperWidthMm, "80");
  await setMoneyEntry("decimal");
  await setReceiptPrinter(receiptPrinter.value);
  await setDocumentPrinter(documentPrinter.value);
  ui.showToast("Settings saved");
  emit("close");
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 bg-[rgba(19,20,22,.45)] flex items-center justify-center p-24px z-90"
    @click.self="$emit('close')"
  >
    <div
      class="w-480px max-w-full bg-surface rounded-12px border border-border overflow-auto"
      style="max-height: 92vh"
    >
      <div class="px-24px pt-20px pb-14px border-b border-border">
        <div class="text-20px font-800 text-ink">{{ L.settings }}</div>
      </div>

      <div class="px-24px py-20px flex flex-col gap-16px">
        <button
          type="button"
          class="h-52px px-16px rounded-8px border border-ink bg-ink text-white text-16px font-800 cursor-pointer press flex items-center justify-center gap-8px"
          @click="openReports"
        >
          <FileSpreadsheet class="w-20px h-20px flex-none" />
          <span>{{ L.ownerSalesReport }}</span>
        </button>

        <div class="p-16px rounded-8px bg-panel border border-border flex items-center justify-between gap-8px">
          <div class="text-15px font-800 text-ink">Google Drive</div>
          <div class="text-14px font-700 flex items-center gap-6px" :class="driveReady ? 'text-positive' : 'text-muted'">
            <CheckCircle2 v-if="driveReady" class="w-16px h-16px flex-none" />
            <span>{{ driveReady ? "Connected" : "Not connected" }}</span>
          </div>
        </div>

        <div v-if="hasAppUpdateBridge" class="p-16px rounded-8px bg-panel border border-border flex flex-col gap-10px">
          <div class="flex items-center justify-between gap-8px">
            <div class="text-15px font-800 text-ink">App Update</div>
            <div v-if="updateInfo" class="text-13px font-700" :class="updateInfo.hasUpdate ? 'text-positive' : 'text-muted'">
              {{ updateInfo.hasUpdate ? `v${updateInfo.latestVersion} available` : `Up to date (v${updateInfo.currentVersion})` }}
            </div>
          </div>
          <div class="flex items-center gap-10px flex-wrap">
            <button
              type="button"
              :disabled="checkingUpdate"
              class="h-44px px-14px rounded-6px border border-border bg-surface text-14px font-700 text-ink cursor-pointer press disabled:opacity-50"
              @click="checkForUpdates"
            >
              {{ checkingUpdate ? "Checking..." : "Check for Updates" }}
            </button>
            <button
              v-if="updateInfo?.hasUpdate"
              type="button"
              class="h-44px px-14px rounded-6px border border-ink bg-ink text-white text-14px font-700 cursor-pointer press inline-flex items-center gap-8px"
              @click="window.appUpdate?.openUrl(updateInfo.downloadUrl)"
            >
              <Download class="w-16px h-16px" />
              <span>Download v{{ updateInfo.latestVersion }}</span>
            </button>
          </div>
        </div>

        <div v-if="printers.length > 0" class="p-16px rounded-8px bg-panel border border-border flex flex-col gap-12px">
          <div class="text-15px font-800 text-ink">Printers</div>
          <label class="flex flex-col gap-4px">
            <span class="text-13px font-700 text-muted">Receipt Printer (80mm)</span>
            <select
              v-model="receiptPrinter"
              class="h-42px px-10px rounded-6px border border-border bg-surface text-14px font-600 text-ink"
            >
              <option value="">System Default</option>
              <option v-for="p in printers" :key="p.name" :value="p.name">
                {{ p.displayName }}{{ p.isDefault ? " (Default)" : "" }}
              </option>
            </select>
          </label>
          <label class="flex flex-col gap-4px">
            <span class="text-13px font-700 text-muted">A4 Document Printer</span>
            <select
              v-model="documentPrinter"
              class="h-42px px-10px rounded-6px border border-border bg-surface text-14px font-600 text-ink"
            >
              <option value="">System Default</option>
              <option v-for="p in printers" :key="p.name" :value="p.name">
                {{ p.displayName }}{{ p.isDefault ? " (Default)" : "" }}
              </option>
            </select>
          </label>
        </div>

        <div class="p-16px rounded-8px bg-panel border border-border flex flex-col gap-10px">
          <div class="text-15px font-800 text-ink">Items CSV</div>

          <div class="flex items-center gap-10px flex-wrap">
            <input
              ref="csvInput"
              type="file"
              accept=".csv"
              class="hidden"
              @change="onCsvSelected"
            />
            <button
              type="button"
              class="h-44px px-14px rounded-6px border border-border bg-surface text-14px font-700 text-ink cursor-pointer press inline-flex items-center gap-8px"
              @click="csvInput?.click()"
            >
              <Upload class="w-16px h-16px text-muted" />
              <span>Import</span>
            </button>
            <button
              type="button"
              class="h-44px px-14px rounded-6px border border-border bg-surface text-14px font-700 text-ink cursor-pointer press inline-flex items-center gap-8px"
              @click="exportItemsCsv"
            >
              <Download class="w-16px h-16px text-muted" />
              <span>Export</span>
            </button>
          </div>
        </div>
      </div>

      <div class="px-24px pb-22px grid grid-cols-2 gap-12px">
        <button
          type="button"
          class="h-52px rounded-6px border border-border bg-surface text-16px font-700 text-muted cursor-pointer press"
          @click="$emit('close')"
        >
          {{ L.cancel }}
        </button>
        <button type="button" class="btn-pay h-52px text-17px" @click="save">{{ L.ok }}</button>
      </div>
    </div>
  </div>
</template>
