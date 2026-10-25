<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { fmtMoney, toCents, type Unit } from "@yf/core";
import { PlusCircle, X, Check } from "lucide-vue-next";
import TextInput from "./TextInput.vue";
import { getRepo } from "../db";
import { useCatalog } from "../stores/catalog";
import { L } from "../labels";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  add: [payload: { label: string; priceCents: number; qtyUnits: number; unit?: Unit }];
  close: [];
}>();

const catalog = useCatalog();

const TAGS = [
  "杂项 Lain-lain",
  "螺丝 Skru",
  "铁钉 Paku",
  "人工 Upah",
  "车油 Tambang",
  "切割 Potong",
] as const;

const selectedTag = ref<string>(TAGS[0]);
const customName = ref("");
const saveToCatalog = ref(false);
const priceEntry = ref("");

const priceCents = computed(() => toCents(Number(priceEntry.value) || 0));

const displayPrice = computed(() => {
  if (!priceEntry.value) return "0.00";
  if (priceEntry.value.endsWith(".")) return `${priceEntry.value}00`;
  const parts = priceEntry.value.split(".");
  if (parts.length === 2 && parts[1]?.length === 1) {
    return `${priceEntry.value}0`;
  }
  return (Number(priceEntry.value) || 0).toFixed(2);
});

const effectiveName = computed(() => customName.value.trim() || selectedTag.value);

const catalogError = computed<string | null>(() => {
  if (!saveToCatalog.value) return null;
  const trimmed = customName.value.trim();
  if (!trimmed) {
    return "⚠️ 请输入具体且不重复的商品名称";
  }
  const lower = trimmed.toLowerCase();
  const exists = catalog.items.some((it) => it.name.trim().toLowerCase() === lower);
  if (exists) {
    return "⚠️ 请输入具体且不重复的商品名称";
  }
  return null;
});

const canSubmit = computed(() => {
  if (priceCents.value <= 0) return false;
  if (saveToCatalog.value && catalogError.value !== null) return false;
  return true;
});

function reset(): void {
  selectedTag.value = TAGS[0];
  customName.value = "";
  saveToCatalog.value = false;
  priceEntry.value = "";
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      reset();
    }
  },
);

function selectTag(tag: string): void {
  selectedTag.value = tag;
}

function tapKey(k: string): void {
  if (k === "C") {
    priceEntry.value = "";
    return;
  }
  if (k === "⌫") {
    priceEntry.value = priceEntry.value.slice(0, -1);
    return;
  }
  if (k === ".") {
    if (priceEntry.value.includes(".")) return;
    priceEntry.value = priceEntry.value ? `${priceEntry.value}.` : "0.";
    return;
  }
  // limit decimals to 2 digits
  if (priceEntry.value.includes(".")) {
    const dec = priceEntry.value.split(".")[1] ?? "";
    if (dec.length >= 2) return;
  }
  priceEntry.value = priceEntry.value === "0" ? k : `${priceEntry.value}${k}`;
}

async function handleSubmit(): Promise<void> {
  if (!canSubmit.value) return;
  const name = effectiveName.value;

  if (saveToCatalog.value) {
    try {
      const repo = await getRepo();
      const pendingKey = `hw_pending_${Date.now().toString(36)}`;
      await repo.createItem({
        key: pendingKey,
        name,
        unit: "pcs",
        priceCents: priceCents.value,
        tracksTail: false,
      });
      void catalog.load();
    } catch (e) {
      console.error("Failed to save item to catalog", e);
    }
  }

  emit("add", {
    label: name,
    priceCents: priceCents.value,
    qtyUnits: 1,
    unit: "pcs",
  });
  reset();
  emit("close");
}

function onKeydown(e: KeyboardEvent): void {
  if (!props.open) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
    if (e.key === "Escape") {
      emit("close");
    }
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    emit("close");
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    void handleSubmit();
    return;
  }
  if (e.key === "Backspace") {
    e.preventDefault();
    tapKey("⌫");
    return;
  }
  if (e.key === "." || (e.key >= "0" && e.key <= "9")) {
    e.preventDefault();
    tapKey(e.key);
  }
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
});

const NUMPAD_KEYS = [
  "7", "8", "9",
  "4", "5", "6",
  "1", "2", "3",
  "C", "0", ".",
];
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 bg-[rgba(19,20,22,.45)] flex items-center justify-center p-20px z-85"
    @click.self="emit('close')"
  >
    <section
        role="dialog"
        aria-modal="true"
        aria-label="Lain-lain / Misc Item"
        class="w-560px max-w-full max-h-[92vh] bg-surface border border-border rounded-12px shadow-[0_12px_32px_rgba(19,20,22,0.14)] flex flex-col overflow-hidden"
      >
        <!-- Header -->
        <header class="flex-none flex items-center justify-between px-20px py-14px border-b border-border">
          <div class="flex items-center gap-10px">
            <PlusCircle class="w-22px h-22px text-ink" />
            <h2 class="m-0 text-20px font-800 text-ink">
              + Lain-lain (极速收银 / Tambah Barang)
            </h2>
          </div>
          <button
            type="button"
            class="h-46px px-14px flex-none rounded-6px border border-border bg-surface text-15px font-700 text-ink cursor-pointer press inline-flex items-center gap-6px"
            @click="emit('close')"
          >
            <X class="w-18px h-18px text-muted" />
            <span>{{ L.close }}</span>
          </button>
        </header>

        <!-- Body: 2-Step Fast Entry -->
        <div class="flex-1 overflow-y-auto p-20px flex flex-col gap-14px">
          <!-- Step 1: 6 Big Category Tags (height: 54px, 16px bold) -->
          <div class="flex flex-col gap-6px">
            <div class="text-14px font-700 text-muted">选择快捷类型 / Pilih Kategori:</div>
            <div class="grid grid-cols-3 gap-8px">
              <button
                v-for="tag in TAGS"
                :key="tag"
                type="button"
                class="min-h-54px px-10px rounded-8px border-1.5 text-16px font-700 cursor-pointer press flex items-center justify-center text-center transition-colors"
                :class="
                  selectedTag === tag && !customName
                    ? 'border-ink bg-ink text-white'
                    : 'border-border bg-surface text-ink hover:border-control'
                "
                @click="selectTag(tag)"
              >
                {{ tag }}
              </button>
            </div>
          </div>

          <!-- Optional Custom Name Row -->
          <div class="flex flex-col gap-6px">
            <TextInput
              v-model="customName"
              placeholder="输入商品名称 (选填) / Nama Barang"
              class="w-full text-16px"
            />
          </div>

          <!-- Instant Catalog Save Toggle Pill (height: 52px) -->
          <div class="flex flex-col gap-4px">
            <label
              class="h-52px px-16px rounded-8px border-1.5 flex items-center gap-12px cursor-pointer select-none transition-colors"
              :class="
                saveToCatalog
                  ? 'border-positive bg-[#f0fdf4] text-positive font-700'
                  : 'border-border bg-surface text-muted hover:border-control'
              "
            >
              <input
                v-model="saveToCatalog"
                type="checkbox"
                class="w-22px h-22px rounded-4px accent-[#15803d] cursor-pointer"
              />
              <span class="text-15px font-700 leading-tight">
                ➕ 顺便存入商品库，下次直接点 / Simpan ke senarai barang
              </span>
            </label>
            <div v-if="saveToCatalog && catalogError" class="text-13px font-700 text-negative px-4px">
              {{ catalogError }}
            </div>
          </div>

          <!-- Giant RM Screen -->
          <div class="p-14px rounded-10px border-1.5 border-ink bg-panel flex items-baseline justify-between">
            <span class="text-20px font-800 text-muted">RM</span>
            <div class="text-36px font-800 text-ink tracking-tight num leading-none">
              {{ displayPrice }}
            </div>
          </div>

          <!-- RM Numpad Grid + Enter -->
          <div class="grid grid-cols-4 gap-8px">
            <div class="col-span-3 grid grid-cols-3 gap-8px">
              <button
                v-for="k in NUMPAD_KEYS"
                :key="k"
                type="button"
                class="h-60px rounded-8px border border-border bg-surface text-24px font-800 text-ink cursor-pointer press flex items-center justify-center num hover:border-ink active:bg-active"
                @click="tapKey(k)"
              >
                {{ k }}
              </button>
            </div>
            <div class="col-span-1 flex flex-col gap-8px">
              <button
                type="button"
                class="h-60px rounded-8px border border-border bg-surface text-22px font-800 text-ink cursor-pointer press flex items-center justify-center hover:border-ink active:bg-active"
                title="Backspace"
                @click="tapKey('⌫')"
              >
                ⌫
              </button>
              <button
                type="button"
                class="btn-pay flex-1 min-h-128px rounded-8px text-20px font-800 flex flex-col items-center justify-center gap-6px leading-tight"
                :disabled="!canSubmit"
                @click="handleSubmit"
              >
                <span>加入账单</span>
                <span class="text-14px font-700 opacity-90">Tambah</span>
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
</template>
