<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { User, UserCheck, UserPlus, Check, X, ShieldAlert } from "lucide-vue-next";
import { validateCashierName } from "@yf/core";
import { L } from "../labels";
import { useCashier } from "../stores/cashier";

const props = withDefaults(
  defineProps<{
    open: boolean;
    closable?: boolean;
  }>(),
  {
    closable: true,
  },
);

const emit = defineEmits<{
  select: [name: string];
  close: [];
}>();

const cashierStore = useCashier();
const newName = ref("");
const errorMessage = ref("");

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      newName.value = "";
      errorMessage.value = "";
      void cashierStore.init();
    }
  },
);

const canAdd = computed(() => newName.value.trim().length > 0);

function handleSelect(name: string): void {
  try {
    const valid = cashierStore.setCashier(name);
    errorMessage.value = "";
    emit("select", valid);
    emit("close");
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : "Invalid cashier name";
  }
}

async function handleAdd(): Promise<void> {
  const trimmed = newName.value.trim();
  if (!trimmed) {
    errorMessage.value = "Cashier name cannot be empty";
    return;
  }
  try {
    const valid = await cashierStore.addCashier(trimmed);
    errorMessage.value = "";
    newName.value = "";
    emit("select", valid);
    emit("close");
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : "Invalid cashier name";
  }
}

function onBackdropClick(): void {
  if (props.closable) {
    emit("close");
  }
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 bg-[rgba(10,10,10,.55)] flex items-center justify-center p-16px z-90 select-none"
    @click.self="onBackdropClick"
  >
    <div
      class="w-540px max-w-full bg-white rounded-14px border border-[#D6D3C9] shadow-[0_20px_50px_rgba(0,0,0,0.25)] flex flex-col overflow-hidden"
      style="max-height: 90vh"
    >
      <div class="px-24px py-18px flex items-center justify-between border-b border-[#E4E2DD] bg-[#F4F3EF] flex-none">
        <div class="flex items-center gap-10px">
          <div class="w-38px h-38px rounded-8px bg-[#18181B] text-white flex items-center justify-center flex-none">
            <User class="w-20px h-20px" />
          </div>
          <div>
            <div class="text-17px font-800 text-[#18181B] leading-tight">
              {{ L.cashierShift }}
            </div>
            <div class="text-13px font-600 text-[#71717A] mt-2px">
              {{ L.selectCashierHelp }}
            </div>
          </div>
        </div>

        <button
          v-if="closable"
          type="button"
          class="press w-36px h-36px rounded-8px border border-[#D4D2CA] bg-white flex items-center justify-center text-[#71717A] hover:text-[#18181B] shadow-[0_2px_0_#C8C5BC] cursor-pointer"
          @click="$emit('close')"
        >
          <X class="w-18px h-18px" />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-20px flex flex-col gap-20px bg-white">
        <div
          v-if="errorMessage"
          class="p-12px rounded-8px bg-[rgba(239,68,68,0.1)] border border-red-300 text-red-700 text-14px font-700 flex items-center gap-8px"
        >
          <ShieldAlert class="w-18px h-18px flex-none" />
          <span>{{ errorMessage }}</span>
        </div>

        <div
          v-if="!closable && !cashierStore.currentCashier"
          class="p-12px rounded-8px bg-[rgba(245,158,11,0.1)] border border-amber-300 text-amber-800 text-13px font-700 flex items-center gap-8px"
        >
          <span>{{ L.cashierRequiredWarning }}</span>
        </div>

        <div>
          <div class="text-14px font-800 text-[#71717A] uppercase tracking-wider mb-10px flex items-center gap-6px">
            <UserCheck class="w-16px h-16px text-[#71717A]" />
            <span>{{ L.activeCashiers }}</span>
          </div>

          <div
            v-if="cashierStore.cashiers.length > 0"
            class="grid grid-cols-2 gap-10px"
          >
            <button
              v-for="name in cashierStore.cashiers"
              :key="name"
              type="button"
              class="press min-h-60px p-14px rounded-10px border text-left flex items-center justify-between cursor-pointer transition-all"
              :class="
                cashierStore.currentCashier === name
                  ? 'border-[#18181B] bg-[#18181B] text-white font-800 shadow-[0_3px_0_#09090b]'
                  : 'border-[#D4D2CA] bg-white text-[#18181B] shadow-[0_3px_0_#C8C5BC] hover:bg-[#F4F3EF]'
              "
              @click="handleSelect(name)"
            >
              <div class="flex items-center gap-10px min-w-0">
                <div
                  class="w-32px h-32px rounded-full flex items-center justify-center flex-none"
                  :class="cashierStore.currentCashier === name ? 'bg-white/20 text-white' : 'bg-[#F4F3EF] text-[#18181B]'"
                >
                  <User class="w-16px h-16px" />
                </div>
                <span class="text-16px font-700 truncate">{{ name }}</span>
              </div>
              <Check
                v-if="cashierStore.currentCashier === name"
                class="w-18px h-18px flex-none"
              />
            </button>
          </div>

          <div
            v-else
            class="p-16px text-center rounded-8px border border-dashed border-[#D4D2CA] text-14px text-[#71717A] font-600 bg-[#F4F3EF]"
          >
            {{ L.noCashiersRegistered }}
          </div>
        </div>

        <div class="border-t border-[#E4E2DD] pt-16px">
          <div class="text-14px font-800 text-[#71717A] uppercase tracking-wider mb-10px flex items-center gap-6px">
            <UserPlus class="w-16px h-16px text-[#71717A]" />
            <span>{{ L.addNewCashier }}</span>
          </div>

          <div class="flex items-center gap-10px">
            <input
              v-model="newName"
              type="text"
              :placeholder="L.cashierPlaceholder"
              class="flex-1 h-52px px-16px rounded-8px border border-[#D4D2CA] bg-[#F4F3EF] text-16px font-600 text-[#18181B] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#18181B]"
              @keydown.enter.prevent="handleAdd"
            />
            <button
              type="button"
              class="h-52px px-20px rounded-8px text-15px font-800 flex items-center justify-center gap-8px cursor-pointer flex-none transition-all"
              :class="
                canAdd
                  ? 'border border-[#18181B] bg-[#18181B] text-white shadow-[0_3px_0_#09090b] active:translate-y-1px'
                  : 'bg-control text-[#A1A1AA] cursor-not-allowed opacity-60 shadow-none'
              "
              :disabled="!canAdd"
              @click="handleAdd"
            >
              <UserPlus class="w-18px h-18px" />
              <span>{{ L.addAndShift }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
