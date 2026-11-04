<script setup lang="ts">
import TextInput from "../../components/TextInput.vue";
import { L } from "../../labels";

export interface ContractorForm {
  name: string;
  phone: string;
  tin: string;
  address: string;
  active: boolean;
}

defineProps<{
  open: boolean;
  isEdit: boolean;
  form: ContractorForm;
}>();

const emit = defineEmits<{
  close: [];
  save: [];
}>();
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 bg-[rgba(19,20,22,.45)] flex items-center justify-center p-24px z-70"
    @click.self="emit('close')"
  >
    <div
      class="w-full max-w-480px bg-surface border border-border rounded-12px shadow-[0_12px_32px_rgba(19,20,22,0.14)] p-24px max-h-[90vh] overflow-auto flex flex-col gap-18px"
    >
      <div class="text-20px font-800 text-ink">
        {{ !isEdit ? L.addContractor : `${L.edit} ${L.contractorCustomer}` }}
      </div>

      <div class="flex flex-col gap-16px">
        <label class="flex flex-col gap-6px text-14px font-700 text-muted">
          {{ L.contractorNameField }} *
          <TextInput
            v-model="form.name"
            :title="L.contractorNameField"
            placeholder="e.g. Ah Seng Contractor, Syarikat Bina Jaya"
            class="w-full"
          />
        </label>

        <label class="flex flex-col gap-6px text-14px font-700 text-muted">
          {{ L.phoneField }} ({{ L.doOptional }})
          <TextInput
            v-model="form.phone"
            :title="L.phoneField"
            placeholder="e.g. 012-3456789"
            class="w-full"
          />
        </label>

        <label class="flex flex-col gap-6px text-14px font-700 text-muted">
          {{ L.tinField }} ({{ L.doOptional }})
          <TextInput
            v-model="form.tin"
            :title="L.tinField"
            placeholder="e.g. C1234567890 / IG1234567890"
            class="w-full"
          />
        </label>

        <label class="flex flex-col gap-6px text-14px font-700 text-muted">
          {{ L.addressField }} ({{ L.doOptional }})
          <TextInput
            v-model="form.address"
            :title="L.addressField"
            placeholder="e.g. Lot 123, Industrial Zone, 89007 Keningau"
            class="w-full"
          />
        </label>

        <label class="flex items-center gap-10px cursor-pointer select-none py-4px">
          <input
            v-model="form.active"
            type="checkbox"
            class="w-20px h-20px rounded border-border text-ink cursor-pointer accent-ink"
          />
          <span class="text-15px font-700 text-ink">{{ L.activePartner }}</span>
        </label>
      </div>

      <div class="flex gap-12px mt-8px">
        <button
          type="button"
          class="pill-btn flex-1 h-52px text-16px"
          @click="emit('close')"
        >
          {{ L.cancel }}
        </button>
        <button
          type="button"
          class="btn-pay flex-1 h-52px text-17px"
          @click="emit('save')"
        >
          {{ L.ok }}
        </button>
      </div>
    </div>
  </div>
</template>
