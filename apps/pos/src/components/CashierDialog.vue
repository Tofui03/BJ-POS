<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { User, UserCheck, UserPlus, Check, X, ShieldAlert } from "lucide-vue-next";
import { validateCashierName } from "@yf/core";
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
      class="w-540px max-w-full bg-surface rounded-12px border border-border shadow-2xl flex flex-col overflow-hidden"
      style="max-height: 90vh"
    >
      <div class="px-24px py-18px flex items-center justify-between border-b border-border bg-panel flex-none">
        <div class="flex items-center gap-10px">
          <div class="w-38px h-38px rounded-8px bg-ink text-white flex items-center justify-center flex-none">
            <User class="w-20px h-20px" />
          </div>
          <div>
            <div class="text-17px font-800 text-ink leading-tight">
              {{ L.cashierShift }}
            </div>
            <div class="text-13px font-600 text-muted mt-2px">
              {{ L.selectCashierHelp }}
            </div>
          </div>
        </div>

        <button
          v-if="closable"
          type="button"
          class="press w-36px h-36px rounded-6px border border-border bg-surface flex items-center justify-center text-muted hover:text-ink cursor-pointer"
          @click="$emit('close')"
        >
          <X class="w-18px h-18px" />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-20px flex flex-col gap-20px">
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
          <div class="text-14px font-800 text-muted uppercase tracking-wider mb-10px flex items-center gap-6px">
            <UserCheck class="w-16px h-16px text-muted" />
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
              class="press min-h-60px p-14px rounded-8px border text-left flex items-center justify-between cursor-pointer transition-colors"
              :class="
                cashierStore.currentCashier === name
                  ? 'border-ink bg-ink text-white font-800 shadow-sm'
                  : 'border-border bg-surface text-ink hover:border-ink hover:bg-ground'
              "
              @click="handleSelect(name)"
            >
              <div class="flex items-center gap-10px min-w-0">
                <div
                  class="w-32px h-32px rounded-full flex items-center justify-center flex-none"
                  :class="cashierStore.currentCashier === name ? 'bg-white/20 text-white' : 'bg-ground text-ink'"
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
            class="p-16px text-center rounded-8px border border-dashed border-border text-14px text-muted font-600 bg-ground/50"
          >
            {{ L.noCashiersRegistered }}
          </div>
        </div>

        <div class="border-t border-border pt-16px">
          <div class="text-14px font-800 text-muted uppercase tracking-wider mb-10px flex items-center gap-6px">
            <UserPlus class="w-16px h-16px text-muted" />
            <span>{{ L.addNewCashier }}</span>
          </div>

          <div class="flex items-center gap-10px">
            <input
              v-model="newName"
              type="text"
              :placeholder="L.cashierPlaceholder"
              class="flex-1 h-52px px-16px rounded-8px border border-border bg-ground text-16px font-600 text-ink placeholder:text-faint focus:outline-none focus:border-ink"
              @keydown.enter.prevent="handleAdd"
            />
            <button
              type="button"
              class="press h-52px px-20px rounded-8px text-15px font-700 flex items-center justify-center gap-8px cursor-pointer flex-none transition-opacity"
              :class="
                canAdd
                  ? 'bg-ink text-white hover:opacity-90'
                  : 'bg-control text-faint cursor-not-allowed opacity-60'
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
