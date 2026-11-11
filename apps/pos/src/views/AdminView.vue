<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import {
  computeAllContractorBalances,
  isLowStock,
  isStockTracked,
  LAIN_LAIN_KEY,
  priceCentsFrom,
  splitItemName,
  toRM,
  type Contractor,
  type Credit,
  type PricedItem,
  type UnitType,
  type Unit,
} from "@yf/core";
import {
  Boxes,
  List,
  PackagePlus,
  Plus,
  Users,
} from "lucide-vue-next";
import { getRepo } from "../db";
import { currentCompany } from "../place";
import { useCatalog } from "../stores/catalog";
import { useUi } from "../stores/ui";
import TopBar from "../components/TopBar.vue";
import DebtSettlementDialog from "../components/DebtSettlementDialog.vue";
import MonthlyStatementDialog from "../components/MonthlyStatementDialog.vue";
import RestockDialog from "../components/RestockDialog.vue";
import ProductCatalogueTab from "./admin/ProductCatalogueTab.vue";
import InventoryTab from "./admin/InventoryTab.vue";
import PendingReviewTab from "./admin/PendingReviewTab.vue";
import ContractorTab, { type ContractorRow } from "./admin/ContractorTab.vue";
import ProductEditModal, { type ItemEditDraft } from "./admin/ProductEditModal.vue";
import ContractorEditModal, { type ContractorForm } from "./admin/ContractorEditModal.vue";
import { L } from "../labels";

const catalog = useCatalog();
const ui = useUi();

const items = ref<PricedItem[]>([]);
const unitTypes = ref<UnitType[]>([]);
const contractors = ref<Contractor[]>([]);
const credits = ref<Credit[]>([]);

const props = defineProps<{ section?: "items" | "contractors" }>();
const route = useRoute();

const adminSection = ref<"catalogue" | "contractors">("catalogue");

const isContractorSection = computed(
  () => props.section === "contractors" || route?.name === "contractors",
);

const isItemSection = computed(
  () => props.section === "items" || route?.name === "admin",
);

const topBarMode = computed<"admin" | "contractors">(() => {
  if (isContractorSection.value) return "contractors";
  if (isItemSection.value) return "admin";
  return adminSection.value === "contractors" ? "contractors" : "admin";
});

const activeSection = computed<"catalogue" | "contractors">(() => {
  if (isContractorSection.value) return "contractors";
  if (isItemSection.value) return "catalogue";
  return adminSection.value;
});

const showTabSwitcher = computed(
  () => !isContractorSection.value && !isItemSection.value,
);

// Sub-view switcher for items section: Catalogue vs Inventory Overview vs Pending Review
const itemSubView = ref<"catalogue" | "inventory" | "pending">(
  route?.query?.tab === "inventory" ? "inventory" : route?.query?.tab === "pending" ? "pending" : "catalogue",
);

const pendingItems = computed(() => {
  return items.value.filter((it) => it.key.startsWith("hw_pending_"));
});

const lowStockThreshold = ref(5); // 5 units default

const lowStockCount = computed(() => {
  const thresholdMilli = lowStockThreshold.value * 1000;
  return items.value.filter(
    (it) => it.key !== LAIN_LAIN_KEY && isLowStock(it, thresholdMilli),
  ).length;
});

const outOfStockCount = computed(() => {
  return items.value.filter(
    (it) => it.key !== LAIN_LAIN_KEY && isStockTracked(it) && (it.stockMilli ?? 0) <= 0,
  ).length;
});

async function refresh(): Promise<void> {
  const repo = await getRepo();
  unitTypes.value = await repo.listUnitTypes();
  items.value = (await repo.listItems()).filter((i) => i.key !== LAIN_LAIN_KEY);
  contractors.value = await repo.listContractors(currentCompany.value.id);
  credits.value = await repo.listCredits(currentCompany.value.id);
  await catalog.load();
}
onMounted(refresh);

// Item Reorder
async function handleReorder(newItems: PricedItem[]): Promise<void> {
  items.value = newItems;
  const repo = await getRepo();
  await repo.setItemOrder(newItems.map((i) => i.id));
  await catalog.load();
}

// Item Edit Modal
const editing = ref<ItemEditDraft | null>(null);

const slugify = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";

function priceFromRM(value: number, label: string): number {
  try {
    return priceCentsFrom(value);
  } catch {
    throw new Error(`${label} must be a non-negative number`);
  }
}

function openAdd(): void {
  editing.value = {
    id: 0,
    groupName: "",
    specLabel: "",
    unit: "pcs" as Unit,
    priceRM: 0,
    active: true,
  };
}

function openEdit(it: PricedItem): void {
  const { groupName, specLabel } = splitItemName(it.name);
  editing.value = {
    id: it.id,
    key: it.key,
    groupName,
    specLabel,
    unit: it.unit,
    priceRM: toRM(it.priceCents),
    active: it.active,
  };
}

async function saveEdit(d: ItemEditDraft): Promise<void> {
  const gName = d.groupName.trim();
  const sLabel = d.specLabel.trim();
  if (!gName) {
    ui.showToast("Item name is required");
    return;
  }
  const fullName = sLabel ? `${gName} — ${sLabel}` : gName;
  const repo = await getRepo();
  try {
    const priceCents = priceFromRM(d.priceRM, "Price");
    if (d.id === 0) {
      await repo.createItem({
        key: `${slugify(fullName)}-${Date.now().toString(36)}`,
        name: fullName,
        unit: d.unit,
        image: "",
        priceCents,
        tracksTail: false,
        stockMilli: null,
      });
    } else {
      await repo.updateItem(d.id, {
        name: fullName,
        unit: d.unit,
        priceCents,
        active: d.active,
        tracksTail: false,
      });
    }
    editing.value = null;
    await refresh();
    ui.showToast(d.id === 0 ? "Item added" : "Saved");
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : "Could not save item");
  }
}

async function approvePending(d: ItemEditDraft): Promise<void> {
  const gName = d.groupName.trim();
  const sLabel = d.specLabel.trim();
  if (!gName) {
    ui.showToast("Item name is required");
    return;
  }
  const fullName = sLabel ? `${gName} — ${sLabel}` : gName;
  const repo = await getRepo();
  try {
    const priceCents = priceFromRM(d.priceRM, "Price");
    const formalKey = `${slugify(fullName)}-${Date.now().toString(36)}`;
    await repo.updateItem(d.id, {
      key: formalKey,
      name: fullName,
      unit: d.unit,
      priceCents,
      active: true,
      tracksTail: false,
    });
    editing.value = null;
    await refresh();
    ui.showToast(`✅ ${L.itemApprovedSuccess}`);
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : "Could not approve item");
  }
}

async function doDelete(id: number): Promise<void> {
  if (id === 0) return;
  const repo = await getRepo();
  await repo.setItemActive(id, false);
  editing.value = null;
  await refresh();
  ui.showToast("Item deleted");
}

// Restock
const restockDialogOpen = ref(false);
const restockDialogItem = ref<PricedItem | null>(null);

function openQuickInbound(): void {
  restockDialogItem.value = null;
  restockDialogOpen.value = true;
}

function openRowRestock(it: PricedItem): void {
  restockDialogItem.value = it;
  restockDialogOpen.value = true;
}

function handleRestocked(updatedItem: PricedItem): void {
  const idx = items.value.findIndex((i) => i.id === updatedItem.id);
  if (idx >= 0) {
    items.value[idx] = updatedItem;
  }
  catalog.updateItemStock(updatedItem.id, updatedItem.stockMilli!);
}

async function quickRestockRow(item: PricedItem, qtyUnits: number): Promise<void> {
  const qtyMilli = Math.round(qtyUnits * 1000);
  try {
    const repo = await getRepo();
    const updated = await repo.restockItem(item.id, qtyMilli);
    const idx = items.value.findIndex((i) => i.id === updated.id);
    if (idx >= 0) {
      items.value[idx] = updated;
    }
    catalog.updateItemStock(updated.id, updated.stockMilli!);
    ui.showToast(
      `${L.restockSuccess}: +${qtyUnits} ${item.unit} ${item.name}`,
      2200,
    );
  } catch (e: any) {
    ui.showToast(e instanceof Error ? e.message : "Restock failed");
  }
}

// Contractor directory & balances
const contractorBalances = computed(() => computeAllContractorBalances(credits.value));

const allDirectoryEntries = computed<ContractorRow[]>(() => {
  const result: ContractorRow[] = [...contractors.value];
  const knownKeys = new Set(contractors.value.map((c) => c.name.trim().toLowerCase()));

  let adhocIdx = 1;
  for (const [key, summary] of contractorBalances.value.entries()) {
    if (summary.outstandingCents > 0 && !knownKeys.has(key.trim().toLowerCase())) {
      result.push({
        id: -adhocIdx++,
        companyId: currentCompany.value.id,
        name: summary.contractorName,
        phone: "",
        tin: "",
        address: "",
        active: false,
        isAdhoc: true,
      });
    }
  }
  return result;
});

// Contractor Add / Edit
const contractorModalOpen = ref(false);
const editingContractorId = ref<number | null>(null);
const contractorForm = ref<ContractorForm>({ name: "", phone: "", tin: "", address: "", active: true });

function openAddContractor(initialName = ""): void {
  editingContractorId.value = null;
  contractorForm.value = { name: initialName, phone: "", tin: "", address: "", active: true };
  contractorModalOpen.value = true;
}

function openEditContractor(c: Contractor): void {
  editingContractorId.value = c.id;
  contractorForm.value = {
    name: c.name,
    phone: c.phone,
    tin: c.tin || "",
    address: c.address || "",
    active: c.active,
  };
  contractorModalOpen.value = true;
}

async function saveContractor(): Promise<void> {
  if (!contractorForm.value.name.trim()) {
    ui.showToast("Contractor name is required");
    return;
  }
  const repo = await getRepo();
  try {
    if (editingContractorId.value == null) {
      await repo.createContractor({
        companyId: currentCompany.value.id,
        name: contractorForm.value.name,
        phone: contractorForm.value.phone,
        tin: contractorForm.value.tin,
        address: contractorForm.value.address,
        active: contractorForm.value.active,
      });
      ui.showToast(`Contractor added: ${contractorForm.value.name}`);
    } else {
      await repo.updateContractor(editingContractorId.value, {
        name: contractorForm.value.name,
        phone: contractorForm.value.phone,
        tin: contractorForm.value.tin,
        address: contractorForm.value.address,
        active: contractorForm.value.active,
      });
      ui.showToast(`Contractor updated: ${contractorForm.value.name}`);
    }
    contractorModalOpen.value = false;
    await refresh();
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : "Failed to save contractor");
  }
}

async function toggleContractorActive(c: Contractor): Promise<void> {
  const repo = await getRepo();
  try {
    await repo.setContractorActive(c.id, !c.active);
    ui.showToast(
      c.active
        ? `Deactivated contractor: ${c.name}`
        : `Activated contractor: ${c.name}`,
    );
    await refresh();
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : "Failed to toggle status");
  }
}

// Settlement dialog
const settleContractorName = ref<string | null>(null);
function openSettle(name: string): void {
  settleContractorName.value = name;
}

// Monthly Statement dialog
const statementOpen = ref(false);
const statementContractorId = ref<number | null>(null);
const statementContractorName = ref<string | null>(null);

function openStatementDialog(id?: number | null, name?: string | null): void {
  statementContractorId.value = id ?? null;
  statementContractorName.value = name ?? null;
  statementOpen.value = true;
}
</script>

<template>
  <TopBar :mode="topBarMode" class="border-b border-[#D6D3C9]" />

  <div
    class="flex-1 min-h-0 overflow-hidden bg-[#E6E4DD] p-12px lg:p-16px flex flex-col gap-14px select-none"
  >
    <div
      v-if="showTabSwitcher"
      class="flex items-center gap-8px flex-none bg-white border border-[#DCDAD2] rounded-12px shadow-[0_3px_0_#C8C5BC] p-12px"
    >
      <button
        type="button"
        class="h-44px px-18px rounded-8px text-15px font-800 cursor-pointer transition-all inline-flex items-center gap-8px"
        :class="
          adminSection === 'catalogue'
            ? 'bg-[#18181B] text-white shadow-sm'
            : 'bg-[#F4F3EF] hover:bg-[#E7E5DE] text-[#52525B] hover:text-[#18181B] border border-[#DCDAD2]'
        "
        @click="adminSection = 'catalogue'"
      >
        <span>{{ L.items }}</span>
        <span class="text-12px opacity-75 num">({{ items.length }})</span>
      </button>

      <button
        type="button"
        class="h-44px px-18px rounded-8px text-15px font-800 cursor-pointer transition-all inline-flex items-center gap-8px"
        :class="
          adminSection === 'contractors'
            ? 'bg-[#18181B] text-white shadow-sm'
            : 'bg-[#F4F3EF] hover:bg-[#E7E5DE] text-[#52525B] hover:text-[#18181B] border border-[#DCDAD2]'
        "
        @click="adminSection = 'contractors'"
      >
        <Users class="w-16px h-16px" />
        <span>{{ L.contractors }}</span>
        <span class="text-12px opacity-75 num">({{ allDirectoryEntries.length }})</span>
      </button>
    </div>

    <div class="flex-1 min-h-0 overflow-hidden bg-white border border-[#DCDAD2] rounded-12px shadow-[0_3px_0_#C8C5BC] p-18px flex flex-col gap-16px">
      <template v-if="activeSection === 'catalogue'">
        <div class="flex items-center justify-between gap-16px flex-none flex-wrap">
          <div class="flex items-center gap-14px flex-wrap">
            <h1 class="m-0 text-22px font-800 text-[#18181B] tracking-tight">{{ L.items }}</h1>

            <div class="inline-flex rounded-10px border border-[#DCDAD2] bg-[#F4F3EF] p-3px">
              <button
                type="button"
                class="h-40px px-16px rounded-7px text-14px font-800 transition-all flex items-center gap-6px cursor-pointer"
                :class="
                  itemSubView === 'catalogue'
                    ? 'bg-[#18181B] text-white shadow-sm'
                    : 'text-[#52525B] hover:text-[#18181B]'
                "
                @click="itemSubView = 'catalogue'"
              >
                <List class="w-16px h-16px" />
                <span>{{ L.itemCatalog }}</span>
              </button>
              <button
                type="button"
                class="h-40px px-16px rounded-7px text-14px font-800 transition-all flex items-center gap-6px cursor-pointer"
                :class="
                  itemSubView === 'inventory'
                    ? 'bg-[#18181B] text-white shadow-sm'
                    : 'text-[#52525B] hover:text-[#18181B]'
                "
                @click="itemSubView = 'inventory'"
              >
                <Boxes class="w-16px h-16px" />
                <span>{{ L.inventoryOverview }}</span>
                <span
                  v-if="lowStockCount > 0"
                  class="ml-2px px-6px py-1px rounded-full text-11px font-800 bg-amber-500 text-white"
                >
                  {{ lowStockCount }}
                </span>
              </button>
              <button
                type="button"
                class="h-40px px-16px rounded-7px text-14px font-800 transition-all flex items-center gap-6px cursor-pointer"
                :class="
                  itemSubView === 'pending'
                    ? 'bg-[#18181B] text-white shadow-sm'
                    : 'text-[#52525B] hover:text-[#18181B]'
                "
                @click="itemSubView = 'pending'"
              >
                <span>{{ L.pendingReviewItems }}</span>
                <span
                  v-if="pendingItems.length > 0"
                  class="ml-2px px-6px py-1px rounded-full text-11px font-800 bg-amber-500 text-white"
                >
                  {{ pendingItems.length }}
                </span>
              </button>
            </div>

            <template v-if="itemSubView === 'inventory'">
              <span
                v-if="lowStockCount > 0"
                class="px-8px py-3px rounded-6px text-12px font-800 bg-amber-500/15 text-amber-700 border border-amber-500/20 num"
              >
                {{ lowStockCount }} {{ L.lowStock }}
              </span>
              <span
                v-if="outOfStockCount > 0"
                class="px-8px py-3px rounded-6px text-12px font-800 bg-terracotta/15 text-terracotta border border-terracotta/20 num"
              >
                {{ outOfStockCount }} {{ L.soldOut }}
              </span>
            </template>
          </div>

          <div class="flex items-center gap-10px">
            <button
              type="button"
              class="h-44px px-16px rounded-10px border border-[#DCDAD2] bg-[#F4F3EF] hover:bg-[#E7E5DE] text-[#18181B] text-14px font-800 inline-flex items-center gap-6px cursor-pointer shadow-[0_2px_0_#C8C5BC] active:translate-y-1px transition-all"
              @click="openQuickInbound()"
            >
              <PackagePlus class="w-18px h-18px text-[#18181B]" />
              <span>{{ L.quickInbound }}</span>
            </button>
            <button
              v-if="itemSubView === 'catalogue'"
              type="button"
              class="h-44px px-20px rounded-10px bg-[#16A34A] text-white shadow-[0_3px_0_#14532D] text-15px font-800 inline-flex items-center gap-6px cursor-pointer active:translate-y-1px transition-all"
              @click="openAdd"
            >
              <Plus class="w-18px h-18px" />
              <span>{{ L.add }}</span>
            </button>
          </div>
        </div>

        <ProductCatalogueTab
          v-if="itemSubView === 'catalogue'"
          :items="items"
          @reorder="handleReorder"
          @edit="openEdit"
          @restock="openRowRestock"
        />

        <InventoryTab
          v-else-if="itemSubView === 'inventory'"
          :items="items"
          :low-stock-threshold="lowStockThreshold"
          @restock="openRowRestock"
          @quick-restock="quickRestockRow"
        />

        <PendingReviewTab
          v-else-if="itemSubView === 'pending'"
          :items="items"
          @edit="openEdit"
          @approve="approvePending"
        />
      </template>

      <ContractorTab
        v-else
        :contractors="allDirectoryEntries"
        :balances="contractorBalances"
        @add="openAddContractor"
        @edit="openEditContractor"
        @toggle-active="toggleContractorActive"
        @settle="openSettle"
        @statement="openStatementDialog"
      />
    </div>
  </div>

  <ProductEditModal
    :draft="editing"
    :unit-types="unitTypes"
    @close="editing = null"
    @save="saveEdit"
    @approve="approvePending"
    @delete="doDelete"
  />

  <ContractorEditModal
    :open="contractorModalOpen"
    :is-edit="editingContractorId !== null"
    :form="contractorForm"
    @close="contractorModalOpen = false"
    @save="saveContractor"
  />

  <DebtSettlementDialog
    :open="settleContractorName !== null"
    :contractor-name="settleContractorName || ''"
    @close="settleContractorName = null"
    @settled="settleContractorName = null; refresh()"
  />

  <MonthlyStatementDialog
    :open="statementOpen"
    :initial-contractor-id="statementContractorId"
    :initial-contractor-name="statementContractorName"
    @close="statementOpen = false"
  />

  <RestockDialog
    :open="restockDialogOpen"
    :initial-item="restockDialogItem"
    :items="items"
    @close="restockDialogOpen = false"
    @restocked="handleRestocked"
  />
</template>
