<script setup lang="ts">
import { ref, watch } from "vue";
import { fmtMoney, fmtQtyUnit } from "@yf/core";
import { AlertCircle, PauseCircle, Trash2, X } from "lucide-vue-next";
import { useCart, type HeldOrder } from "../stores/cart";
import { useUi } from "../stores/ui";
import TextInput from "./TextInput.vue";
import { HOLD_TAGS, L } from "../labels";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const cart = useCart();
const ui = useUi();

const labelInput = ref("");
const confirmDeleteId = ref<string | null>(null);

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      labelInput.value = cart.activeHoldLabel ?? "";
      confirmDeleteId.value = null;
    }
  },
);

function applyTag(tag: string): void {
  const cur = labelInput.value.trim();
  if (!cur) {
    labelInput.value = tag;
  } else if (!cur.includes(tag)) {
    labelInput.value = `${cur} · ${tag}`;
  }
}

function doHoldCurrent(): void {
  const held = cart.holdCurrent(labelInput.value);
  if (held) {
    ui.showToast(`Held · ${held.label} · ${fmtMoney(held.totalCents)}`);
    emit("close");
  }
}

function doResume(h: HeldOrder, mode: "swap" | "merge" = "swap"): void {
  if (cart.lines.length > 0) {
    cart.holdCurrent("自动暂存 / Auto-held");
    const res = cart.resumeHeld(h.id, mode);
    if (res && !("blocked" in res && res.blocked)) {
      ui.showToast("已自动暂存刚才的账单，并取回此单");
      emit("close");
      return;
    }
  }
  const res = cart.resumeHeld(h.id, mode);
  if (!res) return;
  if ("blocked" in res && res.blocked) {
    ui.showToast(L.payFirst);
    return;
  }
  if (mode === "merge") {
    ui.showToast(`Merged ${res.resumed.label} into current sale`);
  } else {
    ui.showToast(`Resumed · ${res.resumed.label}`);
  }
  emit("close");
}

function doDiscard(h: HeldOrder): void {
  if (confirmDeleteId.value !== h.id) {
    confirmDeleteId.value = h.id;
    return;
  }
  cart.discardHeld(h.id);
  confirmDeleteId.value = null;
  ui.showToast(`Discarded held sale · ${h.label}`);
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 bg-[rgba(19,20,22,.45)] flex items-center justify-center p-20px z-85"
      @click.self="emit('close')"
    >
      <section
        role="dialog"
        aria-modal="true"
        :aria-label="L.held"
        class="w-680px max-w-full max-h-[90vh] bg-surface border border-border rounded-12px shadow-[0_12px_32px_rgba(19,20,22,0.14)] flex flex-col overflow-hidden"
      >
        <header class="flex-none flex items-center justify-between px-24px py-16px border-b border-border">
          <div class="flex items-center gap-10px">
            <PauseCircle class="w-22px h-22px text-warning" />
            <h2 class="m-0 text-20px font-800 text-ink num">
              {{ L.held }} ({{ cart.heldOrders.length }})
            </h2>
          </div>
          <button
            type="button"
            class="h-48px px-16px flex-none rounded-6px border border-border bg-surface text-15px font-700 text-ink cursor-pointer press inline-flex items-center gap-6px"
            :aria-label="L.close"
            @click="emit('close')"
          >
            <X class="w-18px h-18px text-muted" />
            <span>{{ L.close }}</span>
          </button>
        </header>

        <!-- Park current sale section (shown when cart has items) -->
        <div
          v-if="cart.lines.length > 0"
          class="flex-none px-24px py-18px bg-panel border-b border-border flex flex-col gap-12px"
        >
          <div class="flex items-center justify-between">
            <span class="text-16px font-700 text-ink num">
              {{ L.currentSale }} ({{ cart.lines.length }})
            </span>
            <span class="text-22px font-800 text-ink num">
              {{ fmtMoney(cart.totalCents) }}
            </span>
          </div>

          <div class="flex gap-10px items-center">
            <TextInput
              v-model="labelInput"
              class="flex-1"
              :title="L.holdNote"
              :placeholder="L.holdPlaceholder"
            />
            <button
              type="button"
              class="btn-pay h-52px px-20px text-16px flex-none whitespace-nowrap"
              @click="doHoldCurrent"
            >
              {{ L.holdThis }}
            </button>
          </div>

          <div class="flex items-center gap-8px flex-wrap">
            <span class="text-13px font-700 text-muted">{{ L.quickTag }}:</span>
            <button
              v-for="tag in HOLD_TAGS"
              :key="tag"
              type="button"
              class="min-h-42px px-12px rounded-6px border border-border bg-surface text-14px font-700 text-ink cursor-pointer press"
              @click="applyTag(tag)"
            >
              {{ tag }}
            </button>
          </div>
        </div>

        <!-- Held orders list -->
        <div class="flex-1 min-h-0 overflow-y-auto p-20px flex flex-col gap-12px">
          <div
            v-if="cart.heldOrders.length === 0"
            class="py-44px text-center flex flex-col items-center gap-8px text-muted"
          >
            <div class="text-17px font-700">{{ L.emptyHold }}</div>
          </div>

          <div
            v-for="h in cart.heldOrders"
            :key="h.id"
            class="p-16px rounded-8px border border-border bg-surface flex flex-col gap-12px"
          >
            <div class="flex items-start justify-between gap-12px">
              <div>
                <div class="flex items-center gap-8px flex-wrap">
                  <span class="text-18px font-800 text-ink">{{ h.label }}</span>
                  <span class="text-14px font-600 text-muted num">
                    {{ formatTime(h.createdAt) }}
                  </span>
                </div>
                <div class="text-13px font-600 text-muted mt-2px num">
                  {{ h.lines.length }} {{ L.items }}
                </div>
              </div>
              <div class="text-22px font-800 text-ink whitespace-nowrap num">
                {{ fmtMoney(h.totalCents) }}
              </div>
            </div>

            <div class="bg-panel rounded-6px px-14px py-10px flex flex-col gap-6px max-h-140px overflow-y-auto">
              <div
                v-for="(line, idx) in h.lines"
                :key="idx"
                class="flex items-center justify-between gap-10px text-14px"
              >
                <span class="font-700 text-ink truncate">
                  {{ line.customName?.trim() || line.itemSnapshot.name }}
                </span>
                <span class="font-700 text-muted flex-none whitespace-nowrap num">
                  × {{ fmtQtyUnit(line.qtyMilli, line.itemSnapshot.unit) }}
                </span>
              </div>
            </div>

            <div class="flex items-center justify-between gap-10px pt-4px">
              <button
                type="button"
                class="h-52px px-16px rounded-6px border text-14px font-700 cursor-pointer press inline-flex items-center gap-6px"
                :class="
                  confirmDeleteId === h.id
                    ? 'bg-negative border-negative text-white'
                    : 'bg-surface border-border text-muted hover:text-negative'
                "
                @click="doDiscard(h)"
              >
                <Trash2 class="w-16px h-16px flex-none" />
                <span>{{ confirmDeleteId === h.id ? L.confirmDiscard : L.discard }}</span>
              </button>

              <button
                type="button"
                class="btn-pay h-52px px-20px text-16px"
                :title="L.resume"
                @click="doResume(h, 'swap')"
              >
                {{ L.resume }}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>
