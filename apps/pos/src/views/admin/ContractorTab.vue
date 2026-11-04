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
  <div class="flex items-center justify-between gap-16px flex-none">
    <div class="flex items-baseline gap-12px">
      <h1 class="m-0 text-22px font-800 text-ink">{{ L.contractorDirectory }}</h1>
      <span class="text-14px font-700 text-muted num">
        ({{ filteredContractors.length }} / {{ contractors.length }})
      </span>
      <span
        v-if="totalOutstanding > 0"
        class="text-13px font-700 px-10px py-4px rounded-6px bg-negative/10 text-negative border border-negative/20 ml-8px"
      >
        {{ L.totalUnpaid }}: {{ fmtMoney(totalOutstanding) }}
      </span>
    </div>
    <div class="flex items-center gap-10px">
      <button
        type="button"
        class="pill-btn h-48px px-16px text-14px inline-flex items-center gap-6px"
        @click="emit('statement')"
      >
        <FileText class="w-16px h-16px text-muted" />
        <span>{{ L.monthlyStatement || "Monthly Statement" }}</span>
      </button>
      <button
        type="button"
        class="btn-pay h-48px px-20px text-15px inline-flex items-center gap-6px"
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
      class="pill-btn h-52px px-16px text-14px inline-flex items-center gap-6px"
      @click="search = ''"
    >
      <X class="w-16px h-16px text-muted" />
      <span>{{ L.clear }}</span>
    </button>
  </div>

  <div class="flex-1 min-h-0 border border-border rounded-8px overflow-hidden flex flex-col">
    <div class="flex-1 min-h-0 overflow-auto">
      <table class="w-full border-collapse num">
        <thead>
          <tr class="text-left text-12px font-700 text-faint border-b border-border">
            <th class="p-12px bg-panel sticky top-0 z-1 w-90px">{{ L.status }}</th>
            <th class="p-12px bg-panel sticky top-0 z-1">{{ L.contractors }}</th>
            <th class="p-12px bg-panel sticky top-0 z-1">{{ L.phoneField }}</th>
            <th class="p-12px bg-panel sticky top-0 z-1">{{ L.tinField }}</th>
            <th class="p-12px bg-panel sticky top-0 z-1 text-right">{{ L.outstandingDebt }}</th>
            <th class="p-12px bg-panel sticky top-0 z-1 text-right w-260px">{{ L.actions }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="c in filteredContractors"
            :key="c.id"
            class="border-b border-borderSoft hover:bg-panel/50 cursor-pointer select-none"
            @click="handleRowClick(c)"
          >
            <td class="p-12px">
              <span
                v-if="c.isAdhoc"
                class="inline-flex items-center px-8px py-4px rounded-4px text-12px font-800 bg-amber-500/15 text-amber-700 border border-amber-500/20"
              >
                Ad-hoc
              </span>
              <span
                v-else
                class="inline-flex items-center px-8px py-4px rounded-4px text-12px font-800"
                :class="c.active ? 'bg-positive/15 text-positive' : 'bg-muted/15 text-muted'"
              >
                {{ c.active ? L.activePartner : L.inactivePartner }}
              </span>
            </td>
            <td class="p-12px text-16px font-700 text-ink">
              <div>{{ c.name }}</div>
              <div v-if="c.address" class="text-12px font-500 text-muted mt-2px">{{ c.address }}</div>
            </td>
            <td class="p-12px text-14px font-700 text-muted">
              {{ c.phone || '—' }}
            </td>
            <td class="p-12px text-14px font-700 text-muted num">
              {{ c.tin || '—' }}
            </td>
            <td class="p-12px text-right">
              <span
                v-if="getContractorBalance(c.name) > 0"
                class="text-17px font-800 text-negative"
              >
                {{ fmtMoney(getContractorBalance(c.name)) }}
              </span>
              <span v-else class="text-14px font-700 text-muted">
                RM 0.00
              </span>
            </td>
            <td class="p-12px text-right">
              <div class="inline-flex items-center gap-6px" @click.stop>
                <button
                  type="button"
                  class="pill-btn h-38px px-12px text-13px inline-flex items-center gap-4px"
                  title="Monthly Statement"
                  @click="emit('statement', c.id, c.name)"
                >
                  <FileText class="w-14px h-14px text-muted" />
                  <span>{{ L.statement || "Statement" }}</span>
                </button>
                <button
                  v-if="getContractorBalance(c.name) > 0"
                  type="button"
                  class="btn-pay h-38px px-12px text-13px inline-flex items-center gap-4px"
                  @click="emit('settle', c.name)"
                >
                  <DollarSign class="w-14px h-14px" />
                  <span>{{ L.settle }}</span>
                </button>
                <button
                  v-if="c.isAdhoc"
                  type="button"
                  class="pill-btn h-38px px-12px text-13px inline-flex items-center gap-4px"
                  @click="emit('add', c.name)"
                >
                  <Plus class="w-14px h-14px text-muted" />
                  <span>{{ L.savePartner }}</span>
                </button>
                <template v-else>
                  <button
                    type="button"
                    class="pill-btn h-38px px-12px text-13px inline-flex items-center gap-4px"
                    @click="emit('edit', c)"
                  >
                    <Pencil class="w-14px h-14px text-muted" />
                    <span>{{ L.edit }}</span>
                  </button>
                  <button
                    type="button"
                    class="h-38px px-10px rounded-6px border text-12px font-700 cursor-pointer press inline-flex items-center gap-4px"
                    :class="c.active ? 'border-border text-muted hover:text-negative' : 'border-positive text-positive bg-positive/10'"
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
            <td colspan="6" class="p-32px text-center text-muted text-15px">
              {{ L.noContractorsFound }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
