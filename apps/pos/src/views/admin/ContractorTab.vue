<script setup lang="ts">
import { computed, ref } from "vue";
import { fmtMoney, type Contractor, type ContractorBalanceSummary } from "@yf/core";
import { DollarSign, FileText, Pencil, Plus, Power, X } from "lucide-vue-next";
import TextInput from "../../components/TextInput.vue";
import { L } from "../../labels";

export interface ContractorRow extends Contractor {
  isAdhoc?: boolean;
}

const props = defineProps<{
  contractors: ContractorRow[];
  balances: Map<string, ContractorBalanceSummary>;
}>();

const emit = defineEmits<{
  add: [name?: string];
  edit: [contractor: Contractor];
  toggleActive: [contractor: Contractor];
  settle: [contractorName: string];
  statement: [contractorId?: number | null, contractorName?: string | null];
}>();

const search = ref("");

function getContractorBalance(name: string): number {
  const target = name.trim().toLowerCase();
  for (const [k, summary] of props.balances.entries()) {
    if (k.toLowerCase() === target) {
      return summary.outstandingCents;
    }
  }
  return 0;
}

const totalOutstanding = computed(() => {
  let sum = 0;
  for (const summary of props.balances.values()) {
    sum += summary.outstandingCents;
  }
  return sum;
});

const filteredContractors = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return props.contractors;
  return props.contractors.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      (c.phone && c.phone.toLowerCase().includes(q)) ||
      (c.tin && c.tin.toLowerCase().includes(q)) ||
      (c.address && c.address.toLowerCase().includes(q)),
  );
});

function handleRowClick(c: ContractorRow): void {
  if (c.isAdhoc) {
    emit("add", c.name);
  } else {
    emit("edit", c);
  }
}
</script>

<template>
  <div class="flex items-center justify-between gap-16px flex-none flex-wrap">
    <div class="flex items-baseline gap-12px">
      <h1 class="m-0 text-22px font-800 text-[#18181B] tracking-tight">{{ L.contractorDirectory }}</h1>
      <span class="text-14px font-700 text-[#71717A] num">
        ({{ filteredContractors.length }} / {{ contractors.length }})
      </span>
      <span
        v-if="totalOutstanding > 0"
        class="text-13px font-700 px-10px py-4px rounded-6px bg-negative/10 text-negative border border-negative/20 ml-8px num"
      >
        {{ L.totalUnpaid }}: {{ fmtMoney(totalOutstanding) }}
      </span>
    </div>
    <div class="flex items-center gap-10px">
      <button
        type="button"
        class="h-44px px-16px rounded-10px border border-[#DCDAD2] bg-[#F4F3EF] hover:bg-[#E7E5DE] text-[#18181B] text-14px font-800 inline-flex items-center gap-6px cursor-pointer shadow-[0_2px_0_#C8C5BC] active:translate-y-1px transition-all"
        @click="emit('statement')"
      >
        <FileText class="w-16px h-16px text-[#52525B]" />
        <span>{{ L.monthlyStatement || "Monthly Statement" }}</span>
      </button>
      <button
        type="button"
        class="h-44px px-20px rounded-10px bg-[#16A34A] text-white shadow-[0_3px_0_#14532D] text-15px font-800 inline-flex items-center gap-6px cursor-pointer active:translate-y-1px transition-all"
        @click="emit('add')"
      >
        <Plus class="w-18px h-18px" />
        <span>{{ L.addContractor }}</span>
      </button>
    </div>
  </div>

  <div class="flex items-center gap-10px flex-none">
    <TextInput
      v-model="search"
      :title="L.searchContractor"
      :placeholder="L.searchContractorPlaceholder"
      class="flex-1 max-w-460px"
    />
    <button
      v-if="search"
      type="button"
      class="h-52px px-16px rounded-8px border border-[#DCDAD2] bg-[#F4F3EF] hover:bg-[#E7E5DE] text-14px font-700 text-[#18181B] inline-flex items-center gap-6px cursor-pointer"
      @click="search = ''"
    >
      <X class="w-16px h-16px text-[#71717A]" />
      <span>{{ L.clear }}</span>
    </button>
  </div>

  <div class="flex-1 min-h-0 border border-[#DCDAD2] rounded-10px overflow-hidden flex flex-col bg-white">
    <div class="flex-1 min-h-0 overflow-auto">
      <table class="w-full border-collapse num">
        <thead>
          <tr class="text-left text-12px font-700 uppercase tracking-wider text-[#71717A] border-b border-[#E4E2DD] bg-[#F4F3EF] sticky top-0 z-1">
            <th class="p-12px w-90px">{{ L.status }}</th>
            <th class="p-12px">{{ L.contractors }}</th>
            <th class="p-12px">{{ L.phoneField }}</th>
            <th class="p-12px">{{ L.tinField }}</th>
            <th class="p-12px text-right">{{ L.outstandingDebt }}</th>
            <th class="p-12px text-right w-260px">{{ L.actions }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="c in filteredContractors"
            :key="c.id"
            class="border-b border-[#F0EFEA] hover:bg-[#FAF9F5] cursor-pointer select-none transition-colors"
            @click="handleRowClick(c)"
          >
            <td class="p-12px">
              <span
                v-if="c.isAdhoc"
                class="inline-flex items-center px-8px py-4px rounded-6px text-12px font-800 bg-amber-500/15 text-amber-700 border border-amber-500/20"
              >
                New
              </span>
              <span
                v-else
                class="inline-flex items-center px-8px py-4px rounded-6px text-12px font-800"
                :class="c.active ? 'bg-positive/15 text-positive' : 'bg-muted/15 text-muted'"
              >
                {{ c.active ? L.activePartner : L.inactivePartner }}
              </span>
            </td>
            <td class="p-12px text-15px font-700 text-[#18181B]">
              <div>{{ c.name }}</div>
              <div v-if="c.address" class="text-12px font-500 text-[#71717A] mt-2px">{{ c.address }}</div>
            </td>
            <td class="p-12px text-14px font-600 text-[#71717A]">
              {{ c.phone || '—' }}
            </td>
            <td class="p-12px text-14px font-600 text-[#71717A] num">
              {{ c.tin || '—' }}
            </td>
            <td class="p-12px text-right">
              <span
                v-if="getContractorBalance(c.name) > 0"
                class="text-17px font-800 text-negative num"
              >
                {{ fmtMoney(getContractorBalance(c.name)) }}
              </span>
              <span v-else class="text-14px font-700 text-[#71717A] num">
                RM 0.00
              </span>
            </td>
            <td class="p-12px text-right">
              <div class="inline-flex items-center gap-8px" @click.stop>
                <button
                  type="button"
                  class="h-44px px-12px rounded-8px border border-[#DCDAD2] bg-[#F4F3EF] hover:bg-[#E7E5DE] text-13px font-700 text-[#18181B] inline-flex items-center gap-4px cursor-pointer shadow-[0_2px_0_#C8C5BC] active:translate-y-1px"
                  title="Monthly Statement"
                  @click="emit('statement', c.id, c.name)"
                >
                  <FileText class="w-14px h-14px text-[#52525B]" />
                  <span>{{ L.statement || "Statement" }}</span>
                </button>
                <button
                  v-if="getContractorBalance(c.name) > 0"
                  type="button"
                  class="h-44px px-12px rounded-8px bg-[#16A34A] text-white shadow-[0_2px_0_#14532D] text-13px font-800 inline-flex items-center gap-4px cursor-pointer active:translate-y-1px"
                  @click="emit('settle', c.name)"
                >
                  <DollarSign class="w-14px h-14px" />
                  <span>{{ L.settle }}</span>
                </button>
                <button
                  v-if="c.isAdhoc"
                  type="button"
                  class="h-44px px-12px rounded-8px border border-[#DCDAD2] bg-white hover:bg-[#FAF9F5] text-13px font-700 text-[#18181B] inline-flex items-center gap-4px cursor-pointer shadow-[0_2px_0_#C8C5BC] active:translate-y-1px"
                  @click="emit('add', c.name)"
                >
                  <Plus class="w-14px h-14px text-[#52525B]" />
                  <span>{{ L.savePartner }}</span>
                </button>
                <template v-else>
                  <button
                    type="button"
                    class="h-44px px-12px rounded-8px border border-[#DCDAD2] bg-white hover:bg-[#FAF9F5] text-13px font-700 text-[#18181B] inline-flex items-center gap-4px cursor-pointer shadow-[0_2px_0_#C8C5BC] active:translate-y-1px"
                    @click="emit('edit', c)"
                  >
                    <Pencil class="w-14px h-14px text-[#52525B]" />
                    <span>{{ L.edit }}</span>
                  </button>
                  <button
                    type="button"
                    class="h-44px px-10px rounded-8px border text-12px font-700 cursor-pointer active:translate-y-1px inline-flex items-center gap-4px"
                    :class="c.active ? 'border-[#DCDAD2] text-[#71717A] hover:text-negative' : 'border-positive text-positive bg-positive/10'"
                    @click="emit('toggleActive', c)"
                  >
                    <Power class="w-13px h-13px" />
                    <span>{{ c.active ? L.deactivate : L.activate }}</span>
                  </button>
                </template>
              </div>
            </td>
          </tr>
          <tr v-if="filteredContractors.length === 0">
            <td colspan="6" class="p-32px text-center text-[#71717A] text-15px font-600">
              {{ L.noContractorsFound }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
