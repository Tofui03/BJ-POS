<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { priceCentsFrom, toRM, type PricedItem, type Unit, type UnitType } from "@yf/core";
import { CheckCircle2, Trash2 } from "lucide-vue-next";
import TextInput from "../../components/TextInput.vue";
import SelectInput from "../../components/SelectInput.vue";
import NumberInput from "../../components/NumberInput.vue";
import { L } from "../../labels";

export interface ItemEditDraft {
  id: number;
  key?: string;
  groupName: string;
  specLabel: string;
  unit: Unit;
  priceRM: number;
  active: boolean;
}

const props = defineProps<{
  draft: ItemEditDraft | null;
  unitTypes: UnitType[];
}>();

const emit = defineEmits<{
  close: [];
  save: [draft: ItemEditDraft];
  approve: [draft: ItemEditDraft];
  delete: [id: number];
}>();

const confirmingDelete = ref(false);

const unitOptions = computed(() =>
  props.unitTypes.map((q) => ({ value: q.name as Unit, label: q.name })),
);

watch(
  () => props.draft,
  () => {
    confirmingDelete.value = false;
  },
);
</script>

<template>
  <div
    v-if="draft"
    class="fixed inset-0 bg-[rgba(19,20,22,.45)] flex items-center justify-center p-24px z-70"
    @click.self="emit('close')"
  >
    <div
      class="w-full max-w-520px bg-surface border border-border rounded-12px shadow-[0_12px_32px_rgba(19,20,22,0.14)] p-24px max-h-[90vh] overflow-auto"
    >
      <div class="text-20px font-800 text-ink mb-18px">
        {{ draft.id === 0 ? L.add : `${L.edit} ${draft.groupName}` }}
      </div>

      <div class="flex flex-col gap-16px">
        <label class="flex flex-col gap-6px text-14px font-700 text-muted">
          {{ L.item }} (e.g. Plywood, PVC Pipe, Cement)
          <TextInput
            v-model="draft.groupName"
            :title="L.item"
            placeholder="e.g. Plywood"
            class="w-full"
          />
        </label>

        <label class="flex flex-col gap-6px text-14px font-700 text-muted">
          {{ L.spec }} (optional — e.g. 4 x 8 x 9mm, 1 inch, 50 kg)
          <TextInput
            v-model="draft.specLabel"
            :title="L.spec"
            placeholder="e.g. 4 x 8 x 9mm"
            class="w-full"
          />
        </label>

        <div class="grid grid-cols-2 gap-14px">
          <label class="flex flex-col gap-6px text-14px font-700 text-muted">
            {{ L.unit }}
            <SelectInput v-model="draft.unit" :options="unitOptions" class="w-full" />
          </label>
          <label class="flex flex-col gap-6px text-14px font-700 text-muted">
            {{ L.price }} (RM)
            <NumberInput
              v-model="draft.priceRM"
              :title="L.price"
              prefix="RM"
              :decimals="2"
              class="w-full"
            />
          </label>
        </div>
      </div>

      <div class="flex gap-12px mt-24px">
        <button type="button" class="pill-btn flex-1 h-52px text-16px" @click="emit('close')">
          {{ L.cancel }}
        </button>
        <button
          v-if="draft.key && draft.key.startsWith('hw_pending_')"
          type="button"
          class="h-52px px-16px rounded-6px border border-positive bg-positive text-white text-16px font-800 cursor-pointer press inline-flex items-center justify-center gap-6px"
          @click="emit('approve', draft)"
        >
          <CheckCircle2 class="w-18px h-18px text-white" />
          <span>✅ {{ L.approveItem }}</span>
        </button>
        <button type="button" class="btn-pay flex-1 h-52px text-17px" @click="emit('save', draft)">
          {{ L.ok }}
        </button>
      </div>
      <button
        v-if="draft.id !== 0"
        type="button"
        class="w-full h-48px mt-12px rounded-6px border border-negative bg-surface text-15px font-700 text-negative cursor-pointer press inline-flex items-center justify-center gap-6px"
        @click="confirmingDelete = true"
      >
        <Trash2 class="w-16px h-16px" />
        <span>{{ L.delete }}</span>
      </button>
    </div>
  </div>

  <div
    v-if="confirmingDelete && draft"
    class="fixed inset-0 bg-[rgba(19,20,22,.45)] flex items-center justify-center p-24px z-80"
    @click.self="confirmingDelete = false"
  >
    <div
      class="w-full max-w-420px bg-surface border border-border rounded-12px shadow-[0_12px_32px_rgba(19,20,22,0.14)] p-24px"
    >
      <div class="text-20px font-800 text-ink mb-10px">{{ L.delete }} {{ draft.groupName }}?</div>
      <div class="text-15px font-600 text-muted mb-22px">
        {{ L.deleteItemWarning }}
      </div>
      <div class="flex gap-12px">
        <button type="button" class="pill-btn flex-1 h-52px text-16px" @click="confirmingDelete = false">
          {{ L.cancel }}
        </button>
        <button
          type="button"
          class="flex-1 h-52px rounded-6px border-none bg-negative text-16px font-800 text-white cursor-pointer press"
          @click="emit('delete', draft.id)"
        >
          {{ L.delete }}
        </button>
      </div>
    </div>
  </div>
</template>
