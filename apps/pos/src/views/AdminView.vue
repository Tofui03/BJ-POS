<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import {
  categoryButtonLabel,
  categoryForGroup,
  compareStockAscending,
  computeAllContractorBalances,
  DEFAULT_LOW_STOCK_THRESHOLD_MILLI,
  filterStockItems,
  fmtMoney,
  formatStockQty,
  HARDWARE_CATEGORIES,
  isLowStock,
  isStockTracked,
  LAIN_LAIN_KEY,
  priceCentsFrom,
  splitItemName,
  toRM,
  type Contractor,
  type Credit,
  type HardwareCategory,
  type PricedItem,
  type UnitType,
  type Unit,
} from "@yf/core";
import {
  ArrowDownUp,
  Boxes,
  CheckCircle2,
  DollarSign,
  FileText,
  GripVertical,
  List,
  PackagePlus,
  Pencil,
  Plus,
  Power,
  Trash2,
  Users,
  X,
} from "lucide-vue-next";
import draggable from "vuedraggable";
import { getRepo } from "../db";
import { currentCompany } from "../place";
import { useCatalog } from "../stores/catalog";
import { useUi } from "../stores/ui";
import TopBar from "../components/TopBar.vue";
import SelectInput from "../components/SelectInput.vue";
import TextInput from "../components/TextInput.vue";
import NumberInput from "../components/NumberInput.vue";
import DebtSettlementDialog from "../components/DebtSettlementDialog.vue";
import MonthlyStatementDialog from "../components/MonthlyStatementDialog.vue";
import RestockDialog from "../components/RestockDialog.vue";
import { currentLocale } from "../settings";
import { L } from "../labels";

const catalog = useCatalog();
const ui = useUi();

const items = ref<PricedItem[]>([]);
const adminCategory = ref<HardwareCategory>("All");
const adminSearch = ref("");

const filteredItems = computed(() => {
  const q = adminSearch.value.trim().toLowerCase();
  return items.value.filter((it) => {
    if (it.key === LAIN_LAIN_KEY) return false;
    const { groupName } = splitItemName(it.name);
    if (adminCategory.value !== "All" && categoryForGroup(groupName) !== adminCategory.value) {
      return false;
    }
    if (q && !it.name.toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });
});

const unitTypes = ref<UnitType[]>([]);
const unitOptions = computed(() =>
  unitTypes.value.map((q) => ({ value: q.name as Unit, label: q.name })),
);

interface EditDraft {
  id: number;
  key?: string;
  groupName: string;
  specLabel: string;
  unit: Unit;
  priceRM: number;
  active: boolean;
}
const editing = ref<EditDraft | null>(null);

const slugify = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";

function priceFromRM(value: number, label: string): number {
  try {
    return priceCentsFrom(value);
  } catch {
    throw new Error(`${label} must be a non-negative number`);
  }
}

async function refresh(): Promise<void> {
  const repo = await getRepo();
  unitTypes.value = await repo.listUnitTypes();
  items.value = (await repo.listItems()).filter((i) => i.key !== LAIN_LAIN_KEY);
  contractors.value = await repo.listContractors(currentCompany.value.id);
  credits.value = await repo.listCredits(currentCompany.value.id);
  await catalog.load();
}
onMounted(refresh);

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

const inventorySearch = ref("");
const inventoryTrackedOnly = ref(false);
const inventoryLowStockOnly = ref(false);
const inventorySortAsc = ref(true);
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

const filteredInventoryItems = computed(() => {
  const thresholdMilli = lowStockThreshold.value * 1000;
  let list = items.value.filter((it) => it.key !== LAIN_LAIN_KEY);
  if (adminCategory.value !== "All") {
    list = list.filter((it) => {
      const { groupName } = splitItemName(it.name);
      return categoryForGroup(groupName) === adminCategory.value;
    });
  }
  return filterStockItems(list, {
    search: inventorySearch.value,
    trackedOnly: inventoryTrackedOnly.value,
    lowStockOnly: inventoryLowStockOnly.value,
    thresholdMilli,
    sortAscending: inventorySortAsc.value,
  });
});

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

function handleRestocked(updatedItem: PricedItem, addedQtyMilli: number, note?: string): void {
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

const contractors = ref<Contractor[]>([]);
const contractorSearch = ref("");
const credits = ref<Credit[]>([]);

const contractorBalances = computed(() => computeAllContractorBalances(credits.value));

function getContractorBalance(name: string): number {
  const target = name.trim().toLowerCase();
  for (const [k, summary] of contractorBalances.value.entries()) {
    if (k.toLowerCase() === target) {
      return summary.outstandingCents;
    }
  }
  return 0;
}

const totalContractorOutstanding = computed(() => {
  let sum = 0;
  for (const summary of contractorBalances.value.values()) {
    sum += summary.outstandingCents;
  }
  return sum;
});

export interface ContractorRow extends Contractor {
  isAdhoc?: boolean;
}

const allDirectoryEntries = computed<ContractorRow[]>(() => {
  const result: ContractorRow[] = [...contractors.value];
  const knownKeys = new Set(contractors.value.map((c) => c.name.trim().toLowerCase()));

  let adhocIdx = 1;
  for (const [key, summary] of contractorBalances.value.entries()) {
    if (summary.outstandingCents > 0 && !knownKeys.has(key)) {
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

const filteredContractors = computed(() => {
  const q = contractorSearch.value.trim().toLowerCase();
  if (!q) return allDirectoryEntries.value;
  return allDirectoryEntries.value.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      (c.phone && c.phone.toLowerCase().includes(q)) ||
      (c.tin && c.tin.toLowerCase().includes(q)) ||
      (c.address && c.address.toLowerCase().includes(q)),
  );
});

// Contractor Add / Edit
const contractorModalOpen = ref(false);
const editingContractorId = ref<number | null>(null);
const contractorForm = ref({ name: "", phone: "", tin: "", address: "", active: true });

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

function handleContractorRowClick(c: ContractorRow): void {
  if (c.isAdhoc) {
    openAddContractor(c.name);
  } else {
    openEditContractor(c);
  }
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
function onSettled(): void {
  void refresh();
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

const dragging = ref(false);

function onRowTap(it: PricedItem): void {
  if (dragging.value) return;
  openEdit(it);
}

async function onReorder(): Promise<void> {
  const repo = await getRepo();
  await repo.setItemOrder(items.value.map((i) => i.id));
  await catalog.load();
  setTimeout(() => (dragging.value = false), 150);
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

async function saveEdit(): Promise<void> {
  const d = editing.value;
  if (!d) return;
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

async function approvePending(d: EditDraft): Promise<void> {
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
    ui.showToast("✅ 商品审核通过已转正 / Item approved");
  } catch (e) {
    ui.showToast(e instanceof Error ? e.message : "Could not approve item");
  }
}

const confirmingDelete = ref(false);

async function doDelete(): Promise<void> {
  const d = editing.value;
  if (!d || d.id === 0) return;
  const repo = await getRepo();
  await repo.setItemActive(d.id, false);
  confirmingDelete.value = false;
  editing.value = null;
  await refresh();
  ui.showToast("Item deleted");
}
</script>

<template>
  <TopBar :mode="topBarMode" />

  <div
    class="flex-1 min-h-0 overflow-hidden bg-surface border border-border rounded-12px mx-8px mb-8px p-20px flex flex-col gap-16px"
  >
    <!-- Tab Switcher: Items vs Contractors -->
    <div
      v-if="showTabSwitcher"
      class="flex items-center gap-8px flex-none border-b border-border pb-12px"
    >
      <button
        type="button"
        class="h-44px px-18px rounded-8px text-15px font-800 cursor-pointer press inline-flex items-center gap-8px transition-colors"
        :class="
          adminSection === 'catalogue'
            ? 'bg-ink text-white'
            : 'bg-panel text-muted hover:text-ink border border-border'
        "
        @click="adminSection = 'catalogue'"
      >
        <span>{{ L.items }} / Barangan</span>
        <span class="text-12px opacity-75 num">({{ items.length }})</span>
      </button>

      <button
        type="button"
        class="h-44px px-18px rounded-8px text-15px font-800 cursor-pointer press inline-flex items-center gap-8px transition-colors"
        :class="
          adminSection === 'contractors'
            ? 'bg-ink text-white'
            : 'bg-panel text-muted hover:text-ink border border-border'
        "
        @click="adminSection = 'contractors'"
      >
        <Users class="w-16px h-16px" />
        <span>{{ L.contractors }}</span>
        <span class="text-12px opacity-75 num">({{ allDirectoryEntries.length }})</span>
      </button>
    </div>

    <template v-if="activeSection === 'catalogue'">
      <!-- Header Row with Sub-view Switcher -->
      <div class="flex items-center justify-between gap-16px flex-none">
        <div class="flex items-center gap-12px flex-wrap">
          <h1 class="m-0 text-22px font-800 text-ink">{{ L.items }}</h1>

          <!-- Segmented Control for Sub-Views -->
          <div class="inline-flex rounded-8px border border-border bg-panel p-2px">
            <button
              type="button"
              class="h-40px px-16px rounded-6px text-14px font-800 transition-colors flex items-center gap-6px cursor-pointer"
              :class="
                itemSubView === 'catalogue'
                  ? 'bg-ink text-white shadow-sm'
                  : 'text-muted hover:text-ink'
              "
              @click="itemSubView = 'catalogue'"
            >
              <List class="w-16px h-16px" />
              <span>{{ L.itemCatalog }}</span>
            </button>
            <button
              type="button"
              class="h-40px px-16px rounded-6px text-14px font-800 transition-colors flex items-center gap-6px cursor-pointer"
              :class="
                itemSubView === 'inventory'
                  ? 'bg-ink text-white shadow-sm'
                  : 'text-muted hover:text-ink'
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
              class="h-40px px-16px rounded-6px text-14px font-800 transition-colors flex items-center gap-6px cursor-pointer"
              :class="
                itemSubView === 'pending'
                  ? 'bg-ink text-white shadow-sm'
                  : 'text-muted hover:text-ink'
              "
              @click="itemSubView = 'pending'"
            >
              <span>🔔 待审核 / Pending</span>
              <span
                v-if="pendingItems.length > 0"
                class="ml-2px px-6px py-1px rounded-full text-11px font-800 bg-amber-500 text-white"
              >
                {{ pendingItems.length }}
              </span>
            </button>
          </div>

          <span class="text-14px font-700 text-muted num">
            ({{
              itemSubView === "catalogue"
                ? filteredItems.length
                : itemSubView === "inventory"
                ? filteredInventoryItems.length
                : pendingItems.length
            }}
            / {{ items.length }})
          </span>

          <!-- Low stock & out-of-stock badges in inventory view -->
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

        <!-- Header Action Buttons -->
        <div class="flex items-center gap-10px">
          <button
            type="button"
            class="pill-btn h-48px px-16px text-14px font-800 inline-flex items-center gap-6px cursor-pointer hover:border-ink"
            @click="openQuickInbound()"
          >
            <PackagePlus class="w-18px h-18px text-ink" />
            <span>{{ L.quickInbound }}</span>
          </button>
          <button
            v-if="itemSubView === 'catalogue'"
            type="button"
            class="btn-pay h-48px px-20px text-15px inline-flex items-center gap-6px"
            @click="openAdd"
          >
            <Plus class="w-18px h-18px" />
            <span>{{ L.add }}</span>
          </button>
        </div>
      </div>

      <!-- VIEW A: Item Catalogue -->
      <template v-if="itemSubView === 'catalogue'">
        <!-- Filter Toolbar: Search + 9 Hardware Categories -->
        <div class="flex flex-col gap-10px flex-none">
          <div class="flex items-center gap-10px">
            <TextInput
              v-model="adminSearch"
              :title="L.search"
              :placeholder="L.searchPlaceholder"
              class="flex-1 max-w-460px"
            />
            <button
              v-if="adminSearch"
              type="button"
              class="pill-btn h-52px px-16px text-14px inline-flex items-center gap-6px"
              @click="adminSearch = ''"
            >
              <X class="w-16px h-16px text-muted" />
              <span>{{ L.clear }}</span>
            </button>
          </div>
          <div class="flex items-center gap-6px overflow-x-auto pb-2px">
            <button
              v-for="cat in HARDWARE_CATEGORIES"
              :key="cat"
              type="button"
              class="h-40px px-14px rounded-6px border text-14px font-700 whitespace-nowrap cursor-pointer press"
              :class="
                adminCategory === cat
                  ? 'bg-ink border-ink text-white'
                  : 'bg-surface border-border text-muted hover:text-ink'
              "
              @click="adminCategory = cat"
            >
              {{ categoryButtonLabel(cat, currentLocale) }}
            </button>
          </div>
        </div>

        <!-- Catalogue Table -->
        <div
          class="flex-1 min-h-0 border border-border rounded-8px overflow-hidden flex flex-col"
        >
          <div class="flex-1 min-h-0 overflow-auto">
            <table class="w-full border-collapse num">
              <thead>
                <tr class="text-left text-12px font-700 text-faint border-b border-border">
                  <th class="p-12px bg-panel sticky top-0 z-1 w-44px"></th>
                  <th class="p-12px bg-panel sticky top-0 z-1">{{ L.item }}</th>
                  <th class="p-12px bg-panel sticky top-0 z-1">{{ L.unit }}</th>
                  <th class="p-12px bg-panel sticky top-0 z-1 text-right">{{ L.price }}</th>
                  <th class="p-12px bg-panel sticky top-0 z-1 text-right w-180px">
                    {{ L.actions }}
                  </th>
                </tr>
              </thead>
              <tbody v-if="adminCategory !== 'All' || adminSearch.trim() !== ''">
                <tr
                  v-for="it in filteredItems"
                  :key="it.id"
                  class="border-b border-borderSoft hover:bg-panel/50 cursor-pointer select-none"
                  @click="onRowTap(it)"
                >
                  <td class="p-12px text-center text-faint">·</td>
                  <td class="p-12px text-16px font-700 text-ink">{{ it.name }}</td>
                  <td class="p-12px text-14px font-700 text-muted">{{ it.unit }}</td>
                  <td class="p-12px text-right text-17px font-800 text-ink">
                    {{ fmtMoney(it.priceCents) }}
                  </td>
                  <td class="p-12px text-right">
                    <div class="inline-flex items-center gap-6px" @click.stop>
                      <button
                        type="button"
                        class="pill-btn h-38px px-10px text-12px inline-flex items-center gap-4px hover:border-ink"
                        :title="L.restock"
                        @click="openRowRestock(it)"
                      >
                        <PackagePlus class="w-14px h-14px text-muted" />
                        <span>{{ L.restock }}</span>
                      </button>
                      <button
                        type="button"
                        class="pill-btn h-38px px-12px text-13px inline-flex items-center gap-6px"
                        @click="openEdit(it)"
                      >
                        <Pencil class="w-14px h-14px text-muted" />
                        <span>{{ L.edit }}</span>
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
              <draggable
                v-else
                v-model="items"
                tag="tbody"
                item-key="id"
                :delay="100"
                :delay-on-touch-only="false"
                :animation="150"
                ghost-class="drag-ghost"
                @start="dragging = true"
                @end="onReorder"
              >
                <template #item="{ element: it }">
                  <tr
                    :key="it.id"
                    class="border-b border-borderSoft hover:bg-panel/50 cursor-pointer select-none"
                    @click="onRowTap(it)"
                  >
                    <td class="p-12px text-center text-faint">
                      <GripVertical class="w-18px h-18px inline-block text-muted" />
                    </td>
                    <td class="p-12px text-16px font-700 text-ink">{{ it.name }}</td>
                    <td class="p-12px text-14px font-700 text-muted">{{ it.unit }}</td>
                    <td class="p-12px text-right text-17px font-800 text-ink">
                      {{ fmtMoney(it.priceCents) }}
                    </td>
                    <td class="p-12px text-right">
                      <div class="inline-flex items-center gap-6px" @click.stop>
                        <button
                          type="button"
                          class="pill-btn h-38px px-10px text-12px inline-flex items-center gap-4px hover:border-ink"
                          :title="L.restock"
                          @click="openRowRestock(it)"
                        >
                          <PackagePlus class="w-14px h-14px text-muted" />
                          <span>{{ L.restock }}</span>
                        </button>
                        <button
                          type="button"
                          class="pill-btn h-38px px-12px text-13px inline-flex items-center gap-6px"
                          @click="openEdit(it)"
                        >
                          <Pencil class="w-14px h-14px text-muted" />
                          <span>{{ L.edit }}</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                </template>
              </draggable>
            </table>
          </div>
        </div>
      </template>

      <!-- VIEW B: Inventory Overview -->
      <template v-else-if="itemSubView === 'inventory'">
        <!-- Filter Toolbar: Search + Quick Toggles + Category Filter -->
        <div class="flex flex-col gap-10px flex-none">
          <div class="flex items-center gap-10px flex-wrap">
            <TextInput
              v-model="inventorySearch"
              :title="L.search"
              :placeholder="L.searchPlaceholder"
              class="flex-1 min-w-260px max-w-400px"
            />
            <button
              v-if="inventorySearch"
              type="button"
              class="pill-btn h-52px px-14px text-14px inline-flex items-center gap-6px cursor-pointer"
              @click="inventorySearch = ''"
            >
              <X class="w-16px h-16px text-muted" />
              <span>{{ L.clear }}</span>
            </button>

            <!-- Tracked Only Toggle -->
            <button
              type="button"
              class="h-52px px-16px rounded-8px border text-14px font-800 whitespace-nowrap cursor-pointer press transition-colors inline-flex items-center gap-6px"
              :class="
                inventoryTrackedOnly
                  ? 'bg-ink border-ink text-white'
                  : 'bg-surface border-border text-muted hover:text-ink'
              "
              @click="inventoryTrackedOnly = !inventoryTrackedOnly"
            >
              <span>{{ L.trackedOnly }}</span>
            </button>

            <!-- Low Stock Toggle -->
            <button
              type="button"
              class="h-52px px-16px rounded-8px border text-14px font-800 whitespace-nowrap cursor-pointer press transition-colors inline-flex items-center gap-6px"
              :class="
                inventoryLowStockOnly
                  ? 'bg-amber-600 border-amber-600 text-white'
                  : 'bg-surface border-border text-muted hover:text-ink'
              "
              @click="inventoryLowStockOnly = !inventoryLowStockOnly"
            >
              <span>{{ L.lowStock }} (≤ {{ lowStockThreshold }})</span>
            </button>

            <!-- Ascending Stock Sort Toggle -->
            <button
              type="button"
              class="h-52px px-16px rounded-8px border text-14px font-800 whitespace-nowrap cursor-pointer press transition-colors inline-flex items-center gap-6px"
              :class="
                inventorySortAsc
                  ? 'bg-ink border-ink text-white'
                  : 'bg-surface border-border text-muted hover:text-ink'
              "
              @click="inventorySortAsc = !inventorySortAsc"
            >
              <ArrowDownUp class="w-16px h-16px" />
              <span>{{ L.sortByStockAsc }}</span>
            </button>
          </div>

          <!-- Category Pills -->
          <div class="flex items-center gap-6px overflow-x-auto pb-2px">
            <button
              v-for="cat in HARDWARE_CATEGORIES"
              :key="cat"
              type="button"
              class="h-40px px-14px rounded-6px border text-14px font-700 whitespace-nowrap cursor-pointer press"
              :class="
                adminCategory === cat
                  ? 'bg-ink border-ink text-white'
                  : 'bg-surface border-border text-muted hover:text-ink'
              "
              @click="adminCategory = cat"
            >
              {{ categoryButtonLabel(cat, currentLocale) }}
            </button>
          </div>
        </div>

        <!-- Inventory Overview Table -->
        <div
          class="flex-1 min-h-0 border border-border rounded-8px overflow-hidden flex flex-col"
        >
          <div class="flex-1 min-h-0 overflow-auto">
            <table class="w-full border-collapse num">
              <thead>
                <tr
                  class="text-left text-12px font-700 text-faint border-b border-border bg-panel sticky top-0 z-1"
                >
                  <th class="p-12px w-130px">{{ L.itemCode }}</th>
                  <th class="p-12px">{{ L.item }}</th>
                  <th class="p-12px w-80px">{{ L.unit }}</th>
                  <th class="p-12px text-right w-110px">{{ L.price }}</th>
                  <th class="p-12px text-right w-130px">{{ L.currentStock }}</th>
                  <th class="p-12px text-center w-120px">{{ L.status }}</th>
                  <th class="p-12px text-right w-220px">{{ L.actions }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="it in filteredInventoryItems"
                  :key="it.id"
                  class="border-b border-borderSoft hover:bg-panel/50 cursor-pointer select-none"
                  @click="openRowRestock(it)"
                >
                  <!-- Code / SKU -->
                  <td class="p-12px text-13px font-700 text-muted mono">
                    {{ it.key }}
                  </td>

                  <!-- Item & Category -->
                  <td class="p-12px">
                    <div class="text-15px font-800 text-ink">{{ it.name }}</div>
                    <div class="text-12px font-600 text-muted mt-2px">
                      {{ categoryForGroup(splitItemName(it.name).groupName) }}
                    </div>
                  </td>

                  <!-- Unit -->
                  <td class="p-12px text-14px font-700 text-muted">
                    {{ it.unit }}
                  </td>

                  <!-- Selling Price -->
                  <td class="p-12px text-right text-16px font-800 text-ink">
                    {{ fmtMoney(it.priceCents) }}
                  </td>

                  <!-- Current Stock -->
                  <td class="p-12px text-right">
                    <span
                      class="text-16px font-800"
                      :class="
                        it.stockMilli == null
                          ? 'text-muted'
                          : it.stockMilli <= 0
                          ? 'text-terracotta'
                          : isLowStock(it, lowStockThreshold * 1000)
                          ? 'text-amber-700'
                          : 'text-ink'
                      "
                    >
                      {{ formatStockQty(it.stockMilli) }}
                    </span>
                    <span
                      v-if="it.stockMilli != null"
                      class="text-12px font-700 text-muted ml-4px"
                    >
                      {{ it.unit }}
                    </span>
                  </td>

                  <!-- Status Badge -->
                  <td class="p-12px text-center">
                    <span
                      v-if="it.stockMilli == null"
                      class="inline-block px-8px py-3px rounded-4px text-12px font-700 bg-panel text-muted border border-border"
                    >
                      {{ L.untracked }}
                    </span>
                    <span
                      v-else-if="it.stockMilli <= 0"
                      class="inline-block px-8px py-3px rounded-4px text-12px font-800 bg-terracotta/15 text-terracotta border border-terracotta/20"
                    >
                      {{ L.outOfStockStatus }}
                    </span>
                    <span
                      v-else-if="isLowStock(it, lowStockThreshold * 1000)"
                      class="inline-block px-8px py-3px rounded-4px text-12px font-800 bg-amber-500/15 text-amber-700 border border-amber-500/20"
                    >
                      {{ L.lowStock }}
                    </span>
                    <span
                      v-else
                      class="inline-block px-8px py-3px rounded-4px text-12px font-700 bg-emerald-500/15 text-emerald-700 border border-emerald-500/20"
                    >
                      {{ L.inStock }}
                    </span>
                  </td>

                  <!-- Actions: Quick Presets + Restock Button -->
                  <td class="p-12px text-right">
                    <div class="inline-flex items-center gap-6px" @click.stop>
                      <button
                        type="button"
                        class="pill-btn h-34px px-8px text-12px font-800 hover:border-ink cursor-pointer"
                        :title="`+5 ${it.unit}`"
                        @click="quickRestockRow(it, 5)"
                      >
                        +5
                      </button>
                      <button
                        type="button"
                        class="pill-btn h-34px px-8px text-12px font-800 hover:border-ink cursor-pointer"
                        :title="`+10 ${it.unit}`"
                        @click="quickRestockRow(it, 10)"
                      >
                        +10
                      </button>
                      <button
                        type="button"
                        class="pill-btn h-36px px-12px text-13px font-700 inline-flex items-center gap-4px hover:border-ink cursor-pointer"
                        @click="openRowRestock(it)"
                      >
                        <PackagePlus class="w-14px h-14px text-muted" />
                        <span>{{ L.restock }}</span>
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>

      <!-- Pending Items Review View -->
      <template v-else-if="itemSubView === 'pending'">
        <div class="flex-1 min-h-0 flex flex-col gap-14px">
          <div class="flex items-center justify-between text-14px font-700 text-muted">
            <span>
              店员通过「+ Lain-lain」存入待审核的临时商品（共 {{ pendingItems.length }} 件）。审核通过并规范命名后将转为正式商品。
            </span>
          </div>

          <div class="flex-1 min-h-0 overflow-y-auto border border-border rounded-8px">
            <table class="w-full border-collapse num">
              <thead class="sticky top-0 bg-surface z-10 border-b border-border text-12px font-700 text-faint">
                <tr>
                  <th class="p-12px text-left">商品名称 / Name</th>
                  <th class="p-12px text-left">单位 / Unit</th>
                  <th class="p-12px text-right">单价 / Price</th>
                  <th class="p-12px text-center">状态 / Status</th>
                  <th class="p-12px text-right">操作 / Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="it in pendingItems"
                  :key="it.id"
                  class="border-b border-borderSoft hover:bg-panel/50 cursor-pointer select-none"
                  @click="openEdit(it)"
                >
                  <td class="p-12px text-16px font-700 text-ink">
                    <span class="inline-flex items-center gap-6px">
                      <span>{{ it.name }}</span>
                      <span class="text-11px font-700 px-6px py-1px rounded bg-amber-500/15 text-amber-800 border border-amber-500/20">
                        {{ it.key }}
                      </span>
                    </span>
                  </td>
                  <td class="p-12px text-14px font-700 text-muted">{{ it.unit }}</td>
                  <td class="p-12px text-right text-17px font-800 text-ink">
                    {{ fmtMoney(it.priceCents) }}
                  </td>
                  <td class="p-12px text-center">
                    <span class="inline-block px-8px py-3px rounded-4px text-12px font-800 bg-amber-500/15 text-amber-700 border border-amber-500/20">
                      待审核 / Pending
                    </span>
                  </td>
                  <td class="p-12px text-right">
                    <div class="inline-flex items-center gap-8px" @click.stop>
                      <button
                        type="button"
                        class="pill-btn h-38px px-12px text-13px inline-flex items-center gap-6px hover:border-ink"
                        @click="openEdit(it)"
                      >
                        <Pencil class="w-14px h-14px text-muted" />
                        <span>{{ L.edit }}</span>
                      </button>
                      <button
                        type="button"
                        class="h-38px px-14px rounded-6px border border-positive bg-positive text-white text-13px font-800 cursor-pointer press inline-flex items-center gap-6px"
                        @click="approvePending({
                          id: it.id,
                          key: it.key,
                          groupName: splitItemName(it.name).groupName,
                          specLabel: splitItemName(it.name).specLabel,
                          unit: it.unit,
                          priceRM: toRM(it.priceCents),
                          active: it.active,
                        })"
                      >
                        <CheckCircle2 class="w-15px h-15px text-white" />
                        <span>审核通过 / Approve</span>
                      </button>
                    </div>
                  </td>
                </tr>
                <tr v-if="pendingItems.length === 0">
                  <td colspan="5" class="p-40px text-center text-15px font-600 text-faint">
                    🎉 目前暂无待审核商品 / No pending items
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>
    </template>

    <template v-else>
      <!-- Contractor Header Row -->
      <div class="flex items-center justify-between gap-16px flex-none">
        <div class="flex items-baseline gap-12px">
          <h1 class="m-0 text-22px font-800 text-ink">{{ L.contractorDirectory }}</h1>
          <span class="text-14px font-700 text-muted num">
            ({{ filteredContractors.length }} / {{ allDirectoryEntries.length }})
          </span>
          <span
            v-if="totalContractorOutstanding > 0"
            class="text-13px font-700 px-10px py-4px rounded-6px bg-negative/10 text-negative border border-negative/20 ml-8px"
          >
            {{ L.totalUnpaid }}: {{ fmtMoney(totalContractorOutstanding) }}
          </span>
        </div>
        <div class="flex items-center gap-10px">
          <button
            type="button"
            class="pill-btn h-48px px-16px text-14px inline-flex items-center gap-6px"
            @click="openStatementDialog()"
          >
            <FileText class="w-16px h-16px text-muted" />
            <span>{{ L.monthlyStatement || "Monthly Statement" }}</span>
          </button>
          <button
            type="button"
            class="btn-pay h-48px px-20px text-15px inline-flex items-center gap-6px"
            @click="openAddContractor()"
          >
            <Plus class="w-18px h-18px" />
            <span>{{ L.addContractor }}</span>
          </button>
        </div>
      </div>

      <!-- Search Toolbar -->
      <div class="flex items-center gap-10px flex-none">
        <TextInput
          v-model="contractorSearch"
          :title="L.searchContractor"
          :placeholder="L.searchContractorPlaceholder"
          class="flex-1 max-w-460px"
        />
        <button
          v-if="contractorSearch"
          type="button"
          class="pill-btn h-52px px-16px text-14px inline-flex items-center gap-6px"
          @click="contractorSearch = ''"
        >
          <X class="w-16px h-16px text-muted" />
          <span>{{ L.clear }}</span>
        </button>
      </div>

      <!-- Contractors Table -->
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
                @click="handleContractorRowClick(c)"
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
                      @click="openStatementDialog(c.id, c.name)"
                    >
                      <FileText class="w-14px h-14px text-muted" />
                      <span>{{ L.statement || "Statement" }}</span>
                    </button>
                    <button
                      v-if="getContractorBalance(c.name) > 0"
                      type="button"
                      class="btn-pay h-38px px-12px text-13px inline-flex items-center gap-4px"
                      @click="openSettle(c.name)"
                    >
                      <DollarSign class="w-14px h-14px" />
                      <span>{{ L.settle }}</span>
                    </button>
                    <button
                      v-if="c.isAdhoc"
                      type="button"
                      class="pill-btn h-38px px-12px text-13px inline-flex items-center gap-4px"
                      @click="openAddContractor(c.name)"
                    >
                      <Plus class="w-14px h-14px text-muted" />
                      <span>{{ L.savePartner }}</span>
                    </button>
                    <template v-else>
                      <button
                        type="button"
                        class="pill-btn h-38px px-12px text-13px inline-flex items-center gap-4px"
                        @click="openEditContractor(c)"
                      >
                        <Pencil class="w-14px h-14px text-muted" />
                        <span>{{ L.edit }}</span>
                      </button>
                      <button
                        type="button"
                        class="h-38px px-10px rounded-6px border text-12px font-700 cursor-pointer press inline-flex items-center gap-4px"
                        :class="c.active ? 'border-border text-muted hover:text-negative' : 'border-positive text-positive bg-positive/10'"
                        @click="toggleContractorActive(c)"
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
  </div>

  <!-- Simplified 4-field item editor modal -->
  <div
    v-if="editing"
    class="fixed inset-0 bg-[rgba(19,20,22,.45)] flex items-center justify-center p-24px z-70"
    @click.self="editing = null"
  >
    <div
      class="w-full max-w-520px bg-surface border border-border rounded-12px shadow-[0_12px_32px_rgba(19,20,22,0.14)] p-24px max-h-[90vh] overflow-auto"
    >
      <div class="text-20px font-800 text-ink mb-18px">
        {{ editing.id === 0 ? L.add : `${L.edit} ${editing.groupName}` }}
      </div>

      <div class="flex flex-col gap-16px">
        <label class="flex flex-col gap-6px text-14px font-700 text-muted">
          {{ L.item }} (e.g. Plywood, PVC Pipe, Cement)
          <TextInput
            v-model="editing.groupName"
            :title="L.item"
            placeholder="e.g. Plywood"
            class="w-full"
          />
        </label>

        <label class="flex flex-col gap-6px text-14px font-700 text-muted">
          {{ L.spec }} (optional — e.g. 4 x 8 x 9mm, 1 inch, 50 kg)
          <TextInput
            v-model="editing.specLabel"
            :title="L.spec"
            placeholder="e.g. 4 x 8 x 9mm"
            class="w-full"
          />
        </label>

        <div class="grid grid-cols-2 gap-14px">
          <label class="flex flex-col gap-6px text-14px font-700 text-muted">
            {{ L.unit }}
            <SelectInput v-model="editing.unit" :options="unitOptions" class="w-full" />
          </label>
          <label class="flex flex-col gap-6px text-14px font-700 text-muted">
            {{ L.price }} (RM)
            <NumberInput
              v-model="editing.priceRM"
              :title="L.price"
              prefix="RM"
              :decimals="2"
              class="w-full"
            />
          </label>
        </div>
      </div>

      <div class="flex gap-12px mt-24px">
        <button type="button" class="pill-btn flex-1 h-52px text-16px" @click="editing = null">
          {{ L.cancel }}
        </button>
        <button
          v-if="editing.key && editing.key.startsWith('hw_pending_')"
          type="button"
          class="h-52px px-16px rounded-6px border border-positive bg-positive text-white text-16px font-800 cursor-pointer press inline-flex items-center justify-center gap-6px"
          @click="approvePending(editing)"
        >
          <CheckCircle2 class="w-18px h-18px text-white" />
          <span>✅ 审核通过 / Approve</span>
        </button>
        <button type="button" class="btn-pay flex-1 h-52px text-17px" @click="saveEdit">
          {{ L.ok }}
        </button>
      </div>
      <button
        v-if="editing.id !== 0"
        type="button"
        class="w-full h-48px mt-12px rounded-6px border border-negative bg-surface text-15px font-700 text-negative cursor-pointer press inline-flex items-center justify-center gap-6px"
        @click="confirmingDelete = true"
      >
        <Trash2 class="w-16px h-16px" />
        <span>{{ L.delete }}</span>
      </button>
    </div>
  </div>

  <!-- delete confirmation -->
  <div
    v-if="confirmingDelete && editing"
    class="fixed inset-0 bg-[rgba(19,20,22,.45)] flex items-center justify-center p-24px z-80"
    @click.self="confirmingDelete = false"
  >
    <div
      class="w-full max-w-420px bg-surface border border-border rounded-12px shadow-[0_12px_32px_rgba(19,20,22,0.14)] p-24px"
    >
      <div class="text-20px font-800 text-ink mb-10px">{{ L.delete }} {{ editing.groupName }}?</div>
      <div class="text-15px font-600 text-muted mb-22px">
        It will disappear from the till and this list. Past sales and reports keep it.
      </div>
      <div class="flex gap-12px">
        <button type="button" class="pill-btn flex-1 h-52px text-16px" @click="confirmingDelete = false">
          {{ L.cancel }}
        </button>
        <button
          type="button"
          class="flex-1 h-52px rounded-6px border-none bg-negative text-16px font-800 text-white cursor-pointer press"
          @click="doDelete"
        >
          {{ L.delete }}
        </button>
      </div>
    </div>
  </div>

  <!-- Contractor Add / Edit Modal -->
  <div
    v-if="contractorModalOpen"
    class="fixed inset-0 bg-[rgba(19,20,22,.45)] flex items-center justify-center p-24px z-70"
    @click.self="contractorModalOpen = false"
  >
    <div
      class="w-full max-w-480px bg-surface border border-border rounded-12px shadow-[0_12px_32px_rgba(19,20,22,0.14)] p-24px max-h-[90vh] overflow-auto flex flex-col gap-18px"
    >
      <div class="text-20px font-800 text-ink">
        {{ editingContractorId == null ? L.addContractor : `${L.edit} ${L.contractorCustomer}` }}
      </div>

      <div class="flex flex-col gap-16px">
        <label class="flex flex-col gap-6px text-14px font-700 text-muted">
          {{ L.contractorNameField }} *
          <TextInput
            v-model="contractorForm.name"
            :title="L.contractorNameField"
            placeholder="e.g. Ah Seng Contractor, Syarikat Bina Jaya"
            class="w-full"
          />
        </label>

        <label class="flex flex-col gap-6px text-14px font-700 text-muted">
          {{ L.phoneField }} ({{ L.doOptional }})
          <TextInput
            v-model="contractorForm.phone"
            :title="L.phoneField"
            placeholder="e.g. 012-3456789"
            class="w-full"
          />
        </label>

        <label class="flex flex-col gap-6px text-14px font-700 text-muted">
          {{ L.tinField }} ({{ L.doOptional }})
          <TextInput
            v-model="contractorForm.tin"
            :title="L.tinField"
            placeholder="e.g. C1234567890 / IG1234567890"
            class="w-full"
          />
        </label>

        <label class="flex flex-col gap-6px text-14px font-700 text-muted">
          {{ L.addressField }} ({{ L.doOptional }})
          <TextInput
            v-model="contractorForm.address"
            :title="L.addressField"
            placeholder="e.g. Lot 123, Industrial Zone, 89007 Keningau"
            class="w-full"
          />
        </label>

        <label class="flex items-center gap-10px cursor-pointer select-none py-4px">
          <input
            v-model="contractorForm.active"
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
          @click="contractorModalOpen = false"
        >
          {{ L.cancel }}
        </button>
        <button
          type="button"
          class="btn-pay flex-1 h-52px text-17px"
          @click="saveContractor"
        >
          {{ L.ok }}
        </button>
      </div>
    </div>
  </div>

  <!-- Debt Settlement Dialog -->
  <DebtSettlementDialog
    :open="settleContractorName !== null"
    :contractor-name="settleContractorName || ''"
    @close="settleContractorName = null"
    @settled="settleContractorName = null; onSettled()"
  />

  <!-- Monthly Statement Dialog -->
  <MonthlyStatementDialog
    :open="statementOpen"
    :initial-contractor-id="statementContractorId"
    :initial-contractor-name="statementContractorName"
    @close="statementOpen = false"
  />

  <!-- Restock Dialog -->
  <RestockDialog
    :open="restockDialogOpen"
    :initial-item="restockDialogItem"
    :items="items"
    @close="restockDialogOpen = false"
    @restocked="handleRestocked"
  />
</template>

<style scoped>
.drag-ghost {
  opacity: 0.4;
  background-color: #f3f4f6;
}
</style>
