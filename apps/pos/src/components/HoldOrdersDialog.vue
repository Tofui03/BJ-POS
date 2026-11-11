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
    ui.showToast(`Parked ${fmtMoney(held.totalCents)}`);
    emit("close");
  }
}

function doResume(h: HeldOrder, mode: "swap" | "merge" = "swap"): void {
  if (cart.lines.length > 0) {
    cart.holdCurrent(L.autoHeldSale);
    const res = cart.resumeHeld(h.id, mode);
    if (res && !("blocked" in res && res.blocked)) {
      ui.showToast(L.autoHeldToast);
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
    ui.showToast(`${res.resumed.label} · ${L.orderMergedToast}`);
  } else {
    ui.showToast(`${L.resume} · ${res.resumed.label}`);
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
  ui.showToast(`${L.orderDiscardedToast} · ${h.label}`);
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
        class="w-680px max-w-full max-h-[90vh] bg-white border border-[#D6D3C9] rounded-14px shadow-[0_20px_50px_rgba(0,0,0,0.25)] flex flex-col overflow-hidden"
      >
        <header class="flex-none flex items-center justify-between px-24px py-16px border-b border-[#E4E2DD] bg-white">
          <div class="flex items-center gap-10px">
            <PauseCircle class="w-22px h-22px text-[#D97706]" />
            <h2 class="m-0 text-20px font-800 text-[#18181B] tracking-tight num">
              {{ L.held }} ({{ cart.heldOrders.length }})
            </h2>
          </div>
          <button
            type="button"
            class="h-48px px-16px flex-none rounded-8px border border-[#D4D2CA] bg-[#F4F3EF] hover:bg-[#E7E5DE] text-15px font-700 text-[#18181B] cursor-pointer inline-flex items-center gap-6px"
            :aria-label="L.close"
            @click="emit('close')"
          >
            <X class="w-18px h-18px text-[#52525B]" />
            <span>{{ L.close }}</span>
          </button>
        </header>

        <div
          v-if="cart.lines.length > 0"
          class="flex-none px-24px py-18px bg-[#F4F3EF] border-b border-[#E4E2DD] flex flex-col gap-12px"
        >
          <div class="flex items-center justify-between">
            <span class="text-16px font-700 text-[#18181B] num">
              {{ L.currentSale }} ({{ cart.lines.length }})
            </span>
            <span class="text-22px font-800 text-[#18181B] num">
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
              class="h-56px px-20px text-18px font-800 flex-none whitespace-nowrap rounded-8px border border-[#15803d] bg-[#16A34A] hover:bg-[#15803d] text-white shadow-[0_3px_0_#14532D] cursor-pointer active:translate-y-2px"
              @click="doHoldCurrent"
            >
              {{ L.holdThis }}
            </button>
          </div>

          <div class="flex items-center gap-8px flex-wrap">
            <span class="text-13px font-700 text-[#52525B]">{{ L.quickTag }}:</span>
            <button
              v-for="tag in HOLD_TAGS"
              :key="tag"
              type="button"
              class="min-h-42px px-14px rounded-8px border border-[#D4D2CA] bg-white hover:bg-[#E7E5DE] text-14px font-700 text-[#18181B] shadow-[0_2px_0_#C8C5BC] cursor-pointer active:translate-y-1px"
              @click="applyTag(tag)"
            >
              {{ tag }}
            </button>
          </div>
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto p-20px flex flex-col gap-12px bg-[#FAFAF9]">
          <div
            v-if="cart.heldOrders.length === 0"
            class="py-44px text-center flex flex-col items-center gap-8px text-[#71717A]"
          >
            <div class="text-17px font-700">{{ L.emptyHold }}</div>
          </div>

          <div
            v-for="h in cart.heldOrders"
            :key="h.id"
            class="p-16px rounded-10px border border-[#DCDAD2] bg-white shadow-[0_3px_0_#C8C5BC] flex flex-col gap-12px"
          >
            <div class="flex items-start justify-between gap-12px">
              <div>
                <div class="flex items-center gap-8px flex-wrap">
                  <span class="text-18px font-800 text-[#18181B]">{{ h.label }}</span>
                  <span class="text-14px font-600 text-[#71717A] num">
                    {{ formatTime(h.createdAt) }}
                  </span>
                </div>
                <div class="text-13px font-600 text-[#71717A] mt-2px num">
                  {{ h.lines.length }} {{ L.items }}
                </div>
              </div>
              <div class="text-22px font-800 text-[#18181B] whitespace-nowrap num">
                {{ fmtMoney(h.totalCents) }}
              </div>
            </div>

            <div class="bg-[#F4F3EF] rounded-8px px-14px py-10px border border-[#E2E0D8] flex flex-col gap-6px max-h-140px overflow-y-auto">
              <div
                v-for="(line, idx) in h.lines"
                :key="idx"
                class="flex items-center justify-between gap-10px text-14px"
              >
                <span class="font-700 text-[#18181B] truncate">
                  {{ line.customName?.trim() || line.itemSnapshot.name }}
                </span>
                <span class="font-700 text-[#71717A] flex-none whitespace-nowrap num">
                  × {{ fmtQtyUnit(line.qtyMilli, line.itemSnapshot.unit) }}
                </span>
              </div>
            </div>

            <div class="flex items-center justify-between gap-20px pt-4px">
              <button
                type="button"
                class="h-56px px-16px rounded-8px border text-16px font-700 cursor-pointer press inline-flex items-center gap-6px shadow-[0_2px_0_#C8C5BC] active:translate-y-1px"
                :class="
                  confirmDeleteId === h.id
                    ? 'bg-negative border-negative text-white shadow-none'
                    : 'bg-white border-[#D4D2CA] text-[#71717A] hover:text-negative hover:border-negative'
                "
                @click="doDiscard(h)"
              >
                <Trash2 class="w-16px h-16px flex-none" />
                <span>{{ confirmDeleteId === h.id ? L.confirmDiscard : L.discard }}</span>
              </button>

              <button
                type="button"
                class="h-56px px-20px text-18px font-800 rounded-8px border border-[#15803d] bg-[#16A34A] hover:bg-[#15803d] text-white shadow-[0_3px_0_#14532D] cursor-pointer active:translate-y-2px"
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
