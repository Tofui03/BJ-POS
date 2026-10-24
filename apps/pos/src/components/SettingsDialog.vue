<script setup lang="ts">
import { ref, watch } from "vue";
import { CheckCircle2, CloudUpload, Download, Upload } from "lucide-vue-next";
import dayjs from "dayjs";
import { LAIN_LAIN_KEY, parseHardwareCsv } from "@yf/core";
import { getRepo } from "../db";
import { currentLocale, driveConfigured, setLocale, setMoneyEntry, SETTING_KEYS } from "../settings";
import { useUi } from "../stores/ui";
import { useCatalog } from "../stores/catalog";
import SelectInput from "./SelectInput.vue";
import SendReportDialog from "./SendReportDialog.vue";
import { L } from "../labels";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const ui = useUi();
const catalog = useCatalog();

const paperWidth = ref<number>(80);
const driveReady = ref<boolean>(false);
const sendReportOpen = ref<boolean>(false);
const csvInput = ref<HTMLInputElement | null>(null);

const paperOptions = [
  { value: 80, label: "80 mm roll" },
  { value: 58, label: "58 mm roll" },
];

watch(
  () => props.open,
  async (o) => {
    if (!o) return;
    const repo = await getRepo();
    const w = Number(await repo.getSetting(SETTING_KEYS.paperWidthMm));
    paperWidth.value = w === 58 ? 58 : 80;
    driveReady.value = await driveConfigured();
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

async function save(): Promise<void> {
  const repo = await getRepo();
  await repo.setSetting(SETTING_KEYS.paperWidthMm, String(paperWidth.value));
  await setMoneyEntry("decimal");
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
        <div class="text-14px font-600 text-muted mt-2px">Receipt printer, Google Drive &amp; Item Catalog.</div>
      </div>

      <div class="px-24px py-20px flex flex-col gap-16px">
        <!-- Language Switcher: 中文 / EN / BM -->
        <div class="p-16px rounded-8px bg-panel border border-border flex flex-col gap-8px">
          <div class="text-15px font-800 text-ink">{{ L.language }}</div>
          <div class="grid grid-cols-3 gap-8px">
            <button
              type="button"
              class="h-44px px-12px rounded-6px border text-14px font-700 cursor-pointer press flex items-center justify-center transition-colors"
              :class="currentLocale === 'zh' ? 'border-ink bg-ink text-white font-800' : 'border-border bg-surface text-ink hover:border-control'"
              @click="setLocale('zh')"
            >
              中文
            </button>
            <button
              type="button"
              class="h-44px px-12px rounded-6px border text-14px font-700 cursor-pointer press flex items-center justify-center transition-colors"
              :class="currentLocale === 'en' ? 'border-ink bg-ink text-white font-800' : 'border-border bg-surface text-ink hover:border-control'"
              @click="setLocale('en')"
            >
              EN
            </button>
            <button
              type="button"
              class="h-44px px-12px rounded-6px border text-14px font-700 cursor-pointer press flex items-center justify-center transition-colors"
              :class="currentLocale === 'ms' ? 'border-ink bg-ink text-white font-800' : 'border-border bg-surface text-ink hover:border-control'"
              @click="setLocale('ms')"
            >
              BM
            </button>
          </div>
        </div>

        <label class="flex flex-col gap-6px text-14px font-700 text-muted">
          Receipt paper width / Saiz kertas resit
          <SelectInput v-model="paperWidth" :options="paperOptions" />
        </label>

        <!-- Google Drive Section -->
        <div class="p-16px rounded-8px bg-panel border border-border flex flex-col gap-8px">
          <div class="text-15px font-800 text-ink">Google Drive Daily Report</div>
          <div class="text-14px font-600 flex items-center gap-6px" :class="driveReady ? 'text-positive' : 'text-muted'">
            <template v-if="driveReady">
              <CheckCircle2 class="w-16px h-16px flex-none" />
              <span>Connected (DRIVE_FOLDER_ID &amp; Service Account configured)</span>
            </template>
            <template v-else>
              <span>
                Not configured — you can still download the daily Excel (.xlsx) file directly from the History or Report page.
              </span>
            </template>
          </div>
          <div class="pt-4px flex items-center">
            <button
              type="button"
              class="h-44px px-14px rounded-6px border border-border bg-surface text-14px font-700 text-ink hover:text-ink cursor-pointer press inline-flex items-center gap-8px"
              @click="sendReportOpen = true"
            >
              <CloudUpload class="w-16px h-16px text-muted" />
              <span>Upload / Resend Daily Report to Drive</span>
            </button>
          </div>
        </div>

        <!-- Item Catalog CSV (Import / Export) -->
        <div class="p-16px rounded-8px bg-panel border border-border flex flex-col gap-10px">
          <div>
            <div class="text-15px font-800 text-ink">Item Catalog CSV / Katalog Barangan CSV</div>
            <div class="text-13px font-600 text-muted mt-2px">
              Batch import or backup items catalogue via CSV.
            </div>
          </div>

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
              <span>Import Items CSV</span>
            </button>
            <button
              type="button"
              class="h-44px px-14px rounded-6px border border-border bg-surface text-14px font-700 text-ink cursor-pointer press inline-flex items-center gap-8px"
              @click="exportItemsCsv"
            >
              <Download class="w-16px h-16px text-muted" />
              <span>Export Items to CSV</span>
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

  <SendReportDialog :open="sendReportOpen" @close="sendReportOpen = false" />
</template>
