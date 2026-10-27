<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { L } from "../labels";

// On-screen QWERTY for touchscreen terminals (also supports physical keyboard typing).
const props = defineProps<{ open: boolean; title: string; initial: string }>();
const emit = defineEmits<{ confirm: [value: string]; close: [] }>();

const entry = ref("");
const caps = ref(false);
const layer = ref<"letters" | "symbols">("letters");

function onKeydown(e: KeyboardEvent): void {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "Backspace") {
    backspace();
    e.preventDefault();
  } else if (e.key === "Enter") {
    ok();
    e.preventDefault();
  } else if (e.key === "Escape") {
    emit("close");
    e.preventDefault();
  } else if (e.key.length === 1) {
    entry.value += e.key;
    e.preventDefault();
  }
}

watch(
  () => props.open,
  (o) => {
    if (o) {
      entry.value = props.initial ?? "";
      caps.value = false;
      layer.value = "letters";
      window.addEventListener("keydown", onKeydown);
    } else {
      window.removeEventListener("keydown", onKeydown);
    }
  },
);
onUnmounted(() => window.removeEventListener("keydown", onKeydown));

const LETTER_ROWS = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
];
const SYMBOL_ROWS = [
  ["(", ")", "[", "]", "{", "}", "<", ">"],
  ["!", "@", "#", "$", "%", "&", "*", "+", "="],
  ["-", "_", "/", ":", ";", ",", ".", "'", "\"", "?"],
];
const rows = computed(() => (layer.value === "letters" ? LETTER_ROWS : SYMBOL_ROWS));

function tap(k: string): void {
  entry.value += layer.value === "letters" && caps.value ? k.toUpperCase() : k;
}
function backspace(): void {
  entry.value = entry.value.slice(0, -1);
}
function ok(): void {
  emit("confirm", entry.value.trim());
}

// Stagger the home (asdf) and bottom (zxcv) rows like a physical keyboard.
function rowIndent(ri: number): string {
  if (ri === 2) return "32px";
  if (ri === 3) return "64px";
  return "0";
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 bg-[rgba(10,10,10,.45)] flex items-center justify-center p-24px z-90"
    @click.self="$emit('close')"
  >
    <div
      class="w-760px max-w-full bg-surface rounded-8px border border-border flex flex-col"
      style="max-height: 95vh"
    >
      <div class="px-24px pt-22px pb-18px border-b border-border flex-none">
        <div class="text-16px font-500 text-muted">{{ title }}</div>
        <div class="mt-8px flex items-center bg-panel rounded-8px px-20px py-14px min-h-66px">
          <span class="text-28px font-700 text-ink break-all leading-tight">{{ entry }}</span>
          <span class="w-2px h-32px bg-ink/40 ml-2px" />
        </div>
      </div>

      <div class="p-16px overflow-auto flex-1 min-h-0">
        <div class="mx-auto flex flex-col gap-10px w-632px max-w-full">
          <div
            v-for="(row, ri) in rows"
            :key="`${layer}-${ri}`"
            class="flex gap-8px"
            :class="layer === 'symbols' ? 'justify-center' : ''"
            :style="{ marginLeft: layer === 'letters' ? rowIndent(ri) : '0' }"
          >
            <button
              v-for="k in row"
              :key="k"
              class="flex-none w-56px h-56px rounded-6px border border-border bg-tile text-24px font-700 text-ink cursor-pointer press"
              @click="tap(k)"
            >{{ caps && layer === 'letters' ? k.toUpperCase() : k }}</button>
          </div>

          <div class="flex gap-8px w-full">
            <button
              class="w-120px h-56px rounded-6px border border-border bg-tile text-18px font-700 text-ink cursor-pointer press"
              @click="layer = layer === 'letters' ? 'symbols' : 'letters'"
            >{{ layer === "letters" ? "?#$" : "ABC" }}</button>
            <button
              v-if="layer === 'letters'"
              class="w-120px h-56px rounded-6px border text-18px font-700 cursor-pointer press"
              :class="caps ? 'bg-ink text-white border-ink' : 'bg-tile text-ink border-border'"
              @click="caps = !caps"
            >Caps</button>
            <button
              class="flex-1 h-56px rounded-6px border border-border bg-tile text-18px font-700 text-ink cursor-pointer press"
              @click="entry += ' '"
            >{{ L.space }}</button>
            <button
              class="w-120px h-56px rounded-6px border border-ink bg-ink text-24px font-700 text-white cursor-pointer press"
              @click="backspace"
            >⌫</button>
          </div>
        </div>
      </div>

      <div class="px-16px py-16px grid grid-cols-3 gap-12px flex-none border-t border-border bg-surface">
        <button
          class="h-56px btn-ghost text-16px"
          @click="entry = ''"
        >{{ L.clear }}</button>
        <button
          class="h-56px btn-ghost text-16px text-muted"
          @click="$emit('close')"
        >{{ L.cancel }}</button>
        <button class="btn-pay h-56px text-22px" @click="ok">{{ L.ok }}</button>
      </div>
    </div>
  </div>
</template>
