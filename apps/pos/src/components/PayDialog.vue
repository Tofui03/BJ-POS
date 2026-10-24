<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  fmtMoney,
  toCents,
  toRM,
  type Contractor,
  type PaymentMethod,
} from "@yf/core";
import {
  ArrowLeft,
  Building2,
  Calculator,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  RotateCcw,
  Tag,
  Truck,
  User,
  UserCheck,
  X,
} from "lucide-vue-next";
import TextInput from "./TextInput.vue";
import { PAYMENT_UI } from "../payments";
import { getRepo } from "../db";
import { currentCompany } from "../place";
import { L } from "../labels";
import { determineCheckoutInvoicePrefix } from "../interactions";
import type { PayOptions } from "../stores/cart";

export interface PayCheckoutPayload extends PayOptions {
  saveAsContractor?: boolean;
}

const props = defineProps<{
  open: boolean;
  /** Subtotal of lines (before whole-bill discount, after line overrides) */
  linesSubtotalCents: number;
  /** Gross subtotal before any line or bill discounts */
  grossSubtotalCents: number;
  /** Combined discount (line + bill) */
  totalDiscountCents: number;
  /** Whole-bill discount in cents */
  billDiscountCents: number;
  /** Final payable total in cents */
  totalCents: number;
}>();

const emit = defineEmits<{
  confirm: [method: PaymentMethod, payload?: PayCheckoutPayload];
  setFinalTotal: [finalCents: number];
  setBillDiscount: [discountCents: number];
  clearBillDiscount: [];
  close: [];
}>();

const view = ref<"methods" | "calc" | "finalTotal" | "discount">("methods");
const numEntry = ref("");

// Customer Decoupling: Walk-in (default) vs Contractor
const customerType = ref<"walkin" | "contractor">("walkin");
const contractors = ref<Contractor[]>([]);
const selectedContractor = ref<Contractor | null>(null);
const contractorSearch = ref("");
const showContractorList = ref(false);

// Ad-hoc contractor fields
const adhocName = ref("");
const adhocPhone = ref("");
const adhocTin = ref("");
const adhocAddress = ref("");
const saveAsContractor = ref(false);

// Delivery Order (DO) workflow fields
const issueDo = ref(false);
const siteAddress = ref("");
const lorryPlate = ref("");
const driverName = ref("");
const contractorPo = ref("");
const showPriceOnDo = ref(true); // default true

async function loadContractors(): Promise<void> {
  try {
    const repo = await getRepo();
    const list = await repo.listContractors(currentCompany.value.id, { activeOnly: true });
    contractors.value = list.filter((c) => c.active);
  } catch {
    contractors.value = [];
  }
}

const filteredContractors = computed(() => {
  const q = contractorSearch.value.trim().toLowerCase();
  const list = contractors.value.filter((c) => c.active);
  if (!q) return list;
  return list.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      (c.phone && c.phone.toLowerCase().includes(q)) ||
      (c.tin && c.tin.toLowerCase().includes(q)),
  );
});

function selectContractor(c: Contractor): void {
  selectedContractor.value = c;
  showContractorList.value = false;
  contractorSearch.value = "";
  if (!siteAddress.value && c.address) {
    siteAddress.value = c.address;
  }
}

function clearSelectedContractor(): void {
  selectedContractor.value = null;
  showContractorList.value = true;
}

function selectWalkIn(): void {
  customerType.value = "walkin";
  selectedContractor.value = null;
  adhocName.value = "";
  adhocPhone.value = "";
  adhocTin.value = "";
  adhocAddress.value = "";
  saveAsContractor.value = false;
  showContractorList.value = false;
  contractorSearch.value = "";
}

const activeContractorName = computed(() => {
  if (selectedContractor.value) return selectedContractor.value.name;
  return adhocName.value.trim();
});

const invoicePrefix = computed(() =>
  determineCheckoutInvoicePrefix(customerType.value, activeContractorName.value)
);

const canCheckout = computed(() => {
  if (customerType.value === "walkin") return true;
  return Boolean(activeContractorName.value);
});

function buildPayload(): PayCheckoutPayload {
  const isContractor = customerType.value === "contractor";
  const c = selectedContractor.value;
  const name = isContractor ? (c ? c.name : adhocName.value.trim()) : undefined;
  const tin = isContractor ? (c ? c.tin : adhocTin.value.trim()) : undefined;
  const address = isContractor ? (c ? c.address : adhocAddress.value.trim()) : undefined;
  const phone = isContractor ? (c ? c.phone : adhocPhone.value.trim()) : undefined;

  return {
    customerType: isContractor ? "contractor" : "walkin",
    // Walk-in must not carry a contractor id or name. Either one makes the
    // sale a B- invoice even after the cashier switches back to Walk-in.
    ...(isContractor
      ? {
          contractorId: c ? c.id : null,
          contractorName: name || undefined,
          contractorTin: tin || undefined,
          contractorAddress: address || undefined,
          contractorPhone: phone || undefined,
          saveAsContractor: !c && saveAsContractor.value,
        }
      : {}),
    issueDo: issueDo.value,
    ...(issueDo.value
      ? {
          siteAddress: siteAddress.value.trim() || undefined,
          lorryPlate: lorryPlate.value.trim() || undefined,
          driverName: driverName.value.trim() || undefined,
          contractorPo: contractorPo.value.trim() || undefined,
          showPriceOnDo: showPriceOnDo.value,
        }
      : {}),
  };
}

function handlePayment(method: PaymentMethod): void {
  if (customerType.value === "contractor" && !activeContractorName.value) {
    showContractorList.value = true;
    return;
  }
  const payload = buildPayload();
  emit("confirm", method, payload);
}

const numText = computed(() => numEntry.value || "0");
const numCents = computed(() => toCents(Number(numEntry.value) || 0));
const changeCents = computed(() => numCents.value - props.totalCents);
const short = computed(() => changeCents.value < 0);
const amount = (cents: number): string => toRM(cents).toFixed(2);

const KEYS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "⌫"];

function openCalc(): void {
  numEntry.value = "";
  view.value = "calc";
}

function openFinalTotalEntry(): void {
  numEntry.value = "";
  view.value = "finalTotal";
}

function openDiscountEntry(): void {
  numEntry.value = "";
  view.value = "discount";
}

function tap(k: string): void {
  if (k === "⌫") {
    numEntry.value = numEntry.value.slice(0, -1);
    return;
  }
  if (k === ".") {
    if (numEntry.value.includes(".")) return;
    if (numEntry.value === "") numEntry.value = "0";
  }
  numEntry.value += k;
}

function applyDiscountView(): void {
  if (view.value === "finalTotal") {
    emit("setFinalTotal", numCents.value);
  } else if (view.value === "discount") {
    emit("setBillDiscount", numCents.value);
  }
  view.value = "methods";
}

watch(
  () => props.open,
  (o) => {
    if (o) {
      view.value = "methods";
      numEntry.value = "";
      customerType.value = "walkin";
      selectedContractor.value = null;
      contractorSearch.value = "";
      showContractorList.value = false;
      adhocName.value = "";
      adhocPhone.value = "";
      adhocTin.value = "";
      adhocAddress.value = "";
      saveAsContractor.value = false;
      issueDo.value = false;
      siteAddress.value = "";
      lorryPlate.value = "";
      driverName.value = "";
      contractorPo.value = "";
      showPriceOnDo.value = true;
      void loadContractors();
    }
  },
);

function onKeydown(e: KeyboardEvent): void {
  if (/^[0-9.]$/.test(e.key)) tap(e.key);
  else if (e.key === "Backspace") tap("⌫");
  else if (e.key === "Enter") {
    if (view.value === "calc") handlePayment("Cash");
    else applyDiscountView();
  } else if (e.key === "Escape") view.value = "methods";
  else return;
  e.preventDefault();
}

watch(
  () => props.open && view.value !== "methods",
  (active) => {
    if (active) window.addEventListener("keydown", onKeydown);
    else window.removeEventListener("keydown", onKeydown);
  },
);
onUnmounted(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 bg-[rgba(19,20,22,.45)] flex items-center justify-center p-20px z-80 select-none"
    @click.self="$emit('close')"
  >
    <div
      class="w-680px max-w-full bg-surface rounded-12px border border-border shadow-[0_12px_32px_rgba(19,20,22,0.14)] overflow-hidden flex flex-col"
      style="max-height: 96vh"
    >
      <template v-if="view === 'methods'">
        <!-- Customer Segment Selector (Senior ergonomics friendly) -->
        <div class="grid grid-cols-2 border-b border-border bg-panel flex-none">
          <button
            type="button"
            class="py-14px px-16px text-16px font-800 cursor-pointer press flex items-center justify-center gap-8px border-b-3 transition-colors"
            :class="
              customerType === 'walkin'
                ? 'border-ink text-ink bg-surface shadow-sm'
                : 'border-transparent text-muted hover:text-ink'
            "
            @click="selectWalkIn"
          >
            <User class="w-18px h-18px" />
            <span>{{ L.walkInCustomer }}</span>
          </button>
          <button
            type="button"
            class="py-14px px-16px text-16px font-800 cursor-pointer press flex items-center justify-center gap-8px border-b-3 transition-colors"
            :class="
              customerType === 'contractor'
                ? 'border-ink text-ink bg-surface shadow-sm'
                : 'border-transparent text-muted hover:text-ink'
            "
            @click="customerType = 'contractor'; if (!selectedContractor) showContractorList = true"
          >
            <Building2 class="w-18px h-18px" />
            <span>{{ L.contractorCustomer }}</span>
          </button>
        </div>

        <!-- Total RM & Discount Summary Header -->
        <div class="px-24px py-16px border-b border-border bg-panel/60 flex-none">
          <div
            v-if="totalDiscountCents > 0"
            class="flex items-center justify-between text-14px font-700 text-muted mb-4px num"
          >
            <span>{{ L.subtotal }}: {{ fmtMoney(grossSubtotalCents) }}</span>
            <span class="text-negative font-800">{{ L.discount }}: -{{ fmtMoney(totalDiscountCents) }}</span>
          </div>

          <div class="flex items-baseline justify-between">
            <div>
              <span class="text-14px font-700 text-muted uppercase">
                {{ L.invoiceSequence }}
                <strong class="text-ink font-800">{{ invoicePrefix }}-series</strong>
              </span>
            </div>
            <div class="text-right">
              <span class="text-14px font-600 text-muted mr-6px">{{ L.total }}</span>
              <span class="text-36px font-800 text-ink leading-none num">{{ fmtMoney(totalCents) }}</span>
            </div>
          </div>

          <!-- Whole-bill rounding / discount buttons -->
          <div class="mt-10px flex flex-wrap gap-8px justify-end">
            <button
              type="button"
              class="h-40px px-12px rounded-6px border border-control bg-surface text-13px font-700 text-ink cursor-pointer press inline-flex items-center gap-6px"
              @click="openFinalTotalEntry"
            >
              <Tag class="w-14px h-14px text-muted" />
              <span>{{ L.enterFinalTotal }}</span>
            </button>
            <button
              type="button"
              class="h-40px px-12px rounded-6px border border-control bg-surface text-13px font-700 text-ink cursor-pointer press inline-flex items-center gap-6px"
              @click="openDiscountEntry"
            >
              <Tag class="w-14px h-14px text-muted" />
              <span>{{ L.enterDiscount }}</span>
            </button>
            <button
              v-if="billDiscountCents > 0"
              type="button"
              class="h-40px px-12px rounded-6px border border-border bg-surface text-13px font-700 text-muted hover:text-ink cursor-pointer press inline-flex items-center gap-6px"
              @click="$emit('clearBillDiscount')"
            >
              <RotateCcw class="w-14px h-14px" />
              <span>{{ L.clearDiscount }}</span>
            </button>
          </div>
        </div>

        <!-- Scrollable Body (Contractor Section + Delivery Order + Payment Methods) -->
        <div class="flex-1 overflow-y-auto px-24px py-16px flex flex-col gap-16px min-h-0">
          <!-- Contractor Section (when customerType === 'contractor') -->
          <div
            v-if="customerType === 'contractor'"
            class="p-14px rounded-8px border-2 border-border bg-panel flex flex-col gap-10px"
          >
            <!-- When contractor is selected -->
            <div v-if="selectedContractor" class="flex items-center justify-between">
              <div class="flex items-center gap-10px min-w-0">
                <div class="w-40px h-40px rounded-6px bg-ink text-white flex items-center justify-center flex-none">
                  <Building2 class="w-20px h-20px" />
                </div>
                <div class="min-w-0">
                  <div class="text-17px font-800 text-ink truncate">{{ selectedContractor.name }}</div>
                  <div class="text-13px font-600 text-muted truncate">
                    {{ selectedContractor.phone || L.noPhone }}
                    <span v-if="selectedContractor.tin"> · TIN: {{ selectedContractor.tin }}</span>
                  </div>
                  <div v-if="selectedContractor.address" class="text-12px text-muted truncate">
                    {{ selectedContractor.address }}
                  </div>
                </div>
              </div>
              <button
                type="button"
                class="h-38px px-12px rounded-6px border border-border bg-surface text-13px font-700 text-muted hover:text-ink cursor-pointer press flex-none"
                @click="clearSelectedContractor"
              >
                {{ L.change }}
              </button>
            </div>

            <!-- When no contractor selected: Picker or Ad-hoc form -->
            <div v-else class="flex flex-col gap-10px">
              <div class="flex items-center justify-between">
                <span class="text-15px font-800 text-ink">{{ L.selectContractor }}</span>
                <span class="text-12px font-700 text-muted">{{ contractors.length }} {{ L.partnerContractors }}</span>
              </div>

              <!-- Search Bar -->
              <TextInput
                v-model="contractorSearch"
                :placeholder="L.searchContractorPlaceholder"
              />

              <!-- Active Partner Grid -->
              <div
                v-if="filteredContractors.length > 0"
                class="grid grid-cols-2 gap-8px max-h-160px overflow-y-auto pr-2px"
              >
                <button
                  v-for="c in filteredContractors"
                  :key="c.id"
                  type="button"
                  class="p-10px rounded-6px border border-border bg-surface hover:border-ink cursor-pointer text-left press flex flex-col justify-center transition-colors"
                  @click="selectContractor(c)"
                >
                  <div class="text-15px font-800 text-ink truncate">{{ c.name }}</div>
                  <div class="text-12px font-600 text-muted truncate mt-1px">
                    {{ c.phone || L.noPhone }}<span v-if="c.tin"> · TIN: {{ c.tin }}</span>
                  </div>
                </button>
              </div>

              <!-- Ad-hoc input fields -->
              <div class="border-t border-border pt-8px flex flex-col gap-8px">
                <div class="text-13px font-700 text-muted uppercase">{{ L.orEnterAdhoc }}</div>
                <div class="grid grid-cols-2 gap-8px">
                  <TextInput
                    v-model="adhocName"
                    :title="L.contractorNameField + ' *'"
                    placeholder="e.g. Syarikat Pembinaan Ali"
                  />
                  <TextInput
                    v-model="adhocPhone"
                    :title="L.phoneField"
                    placeholder="01X-XXXXXXX"
                  />
                </div>
                <div class="grid grid-cols-2 gap-8px">
                  <TextInput
                    v-model="adhocTin"
                    :title="L.tinField"
                    placeholder="e.g. C1234567890"
                  />
                  <TextInput
                    v-model="adhocAddress"
                    :title="L.addressField"
                    placeholder="e.g. Kolombong, KK"
                  />
                </div>
                <label class="flex items-center gap-8px p-6px cursor-pointer select-none">
                  <input
                    v-model="saveAsContractor"
                    type="checkbox"
                    class="w-18px h-18px accent-ink rounded cursor-pointer"
                  />
                  <span class="text-13px font-700 text-ink">
                    {{ L.saveAsPartner }}
                  </span>
                </label>
              </div>
            </div>
          </div>

          <!-- Delivery Order (DO) Workflow Accordion -->
          <div class="rounded-8px border border-border bg-panel overflow-hidden">
            <button
              type="button"
              class="w-full px-16px py-12px flex items-center justify-between text-left cursor-pointer press bg-panel hover:bg-surface/60 transition-colors"
              @click="issueDo = !issueDo"
            >
              <div class="flex items-center gap-8px">
                <Truck class="w-18px h-18px text-ink" />
                <span class="text-15px font-800 text-ink">{{ L.issueDo }}</span>
                <span
                  class="px-8px py-2px rounded-4px text-12px font-800"
                  :class="issueDo ? 'bg-positive/20 text-positive' : 'bg-surface text-muted border border-border'"
                >
                  {{ issueDo ? L.doEnabled : L.doOptional }}
                </span>
              </div>
              <component :is="issueDo ? ChevronUp : ChevronDown" class="w-18px h-18px text-muted" />
            </button>

            <!-- Expanded DO Input Form -->
            <div v-if="issueDo" class="p-16px border-t border-border bg-surface flex flex-col gap-10px">
              <div class="text-12px font-700 text-muted uppercase">{{ L.doDetails }}</div>

              <TextInput
                v-model="siteAddress"
                :title="L.siteAddress"
                placeholder="e.g. Tapak Projek Vista Minintod, Penampang"
              />

              <div class="grid grid-cols-3 gap-8px">
                <TextInput
                  v-model="lorryPlate"
                  :title="L.lorryPlate"
                  placeholder="e.g. SABAH 8888"
                />
                <TextInput
                  v-model="driverName"
                  :title="L.driverName"
                  placeholder="e.g. Ali"
                />
                <TextInput
                  v-model="contractorPo"
                  :title="L.contractorPo"
                  placeholder="e.g. PO-88219"
                />
              </div>

              <!-- Show Price on DO Toggle -->
              <label class="flex items-center justify-between p-10px rounded-6px border border-border bg-panel cursor-pointer select-none mt-2px">
                <div>
                  <div class="text-14px font-800 text-ink">{{ L.showPricesOnDo }}</div>
                  <div class="text-12px font-600 text-muted">
                    {{ L.hidePricesHint }}
                  </div>
                </div>
                <input
                  v-model="showPriceOnDo"
                  type="checkbox"
                  class="w-22px h-22px accent-ink rounded cursor-pointer ml-12px"
                />
              </label>
            </div>
          </div>

          <!-- Payment Method Buttons -->
          <div>
            <div class="text-15px font-800 text-ink mb-10px text-center">
              {{ customerType === 'contractor' ? L.selectContractorPayMethod : L.choosePay }}
            </div>

            <!-- In Walk-in mode: Cash (Zero friction 1-click), Bank, QR -->
            <template v-if="customerType === 'walkin'">
              <div class="grid grid-cols-2 gap-12px">
                <button
                  type="button"
                  class="min-h-70px px-16px rounded-8px border cursor-pointer press text-22px font-800 border-positive bg-positive text-white flex items-center justify-center gap-8px"
                  @click="handlePayment('Cash')"
                >
                  <span>{{ PAYMENT_UI.Cash.label }}</span>
                </button>

                <div class="grid grid-cols-2 gap-8px">
                  <button
                    type="button"
                    class="h-70px px-12px rounded-8px border border-control bg-surface text-16px font-800 text-ink hover:border-ink cursor-pointer press"
                    @click="handlePayment('Bank')"
                  >
                    {{ PAYMENT_UI.Bank.label }}
                  </button>
                  <button
                    type="button"
                    class="h-70px px-12px rounded-8px border border-control bg-surface text-16px font-800 text-ink hover:border-ink cursor-pointer press"
                    @click="handlePayment('QR')"
                  >
                    {{ PAYMENT_UI.QR.label }}
                  </button>
                </div>
              </div>
            </template>

            <!-- In Contractor mode: Cash, Bank, QR, Credit -->
            <template v-else>
              <div class="grid grid-cols-2 gap-12px">
                <button
                  type="button"
                  class="min-h-64px px-16px rounded-8px border cursor-pointer press text-20px font-800 border-positive bg-positive text-white"
                  :disabled="!canCheckout"
                  :class="!canCheckout ? 'opacity-50 cursor-not-allowed' : ''"
                  @click="handlePayment('Cash')"
                >
                  {{ PAYMENT_UI.Cash.label }}
                </button>
                <button
                  type="button"
                  class="min-h-64px px-16px rounded-8px border border-control bg-surface text-20px font-800 text-ink hover:border-ink cursor-pointer press"
                  :disabled="!canCheckout"
                  :class="!canCheckout ? 'opacity-50 cursor-not-allowed' : ''"
                  @click="handlePayment('Bank')"
                >
                  {{ PAYMENT_UI.Bank.label }}
                </button>
                <button
                  type="button"
                  class="min-h-64px px-16px rounded-8px border border-control bg-surface text-20px font-800 text-ink hover:border-ink cursor-pointer press"
                  :disabled="!canCheckout"
                  :class="!canCheckout ? 'opacity-50 cursor-not-allowed' : ''"
                  @click="handlePayment('QR')"
                >
                  {{ PAYMENT_UI.QR.label }}
                </button>
                <button
                  type="button"
                  class="min-h-64px px-16px rounded-8px border border-control bg-surface text-20px font-800 text-terracotta hover:border-ink cursor-pointer press"
                  :disabled="!canCheckout"
                  :class="!canCheckout ? 'opacity-50 cursor-not-allowed' : ''"
                  @click="handlePayment('Credit')"
                >
                  {{ PAYMENT_UI.Credit.label }} ({{ L.payLater }})
                </button>
              </div>
              <div v-if="!canCheckout" class="text-13px font-700 text-terracotta text-center mt-6px">
                {{ L.pleaseSelectContractor }}
              </div>
            </template>

            <!-- Cash calculator launcher -->
            <button
              type="button"
              class="w-full mt-10px min-h-48px rounded-6px border border-control bg-panel text-15px font-700 text-ink cursor-pointer press inline-flex items-center justify-center gap-8px"
              @click="openCalc"
            >
              <Calculator class="w-18px h-18px text-muted" />
              <span>{{ L.cashCalc }}</span>
            </button>
          </div>
        </div>

        <!-- Dialog Close Footer -->
        <div class="px-24px py-14px border-t border-border bg-panel flex-none">
          <button
            type="button"
            class="w-full h-50px rounded-6px border border-border bg-surface text-15px font-700 text-muted hover:text-ink cursor-pointer press"
            @click="$emit('close')"
          >
            {{ L.cancel }}
          </button>
        </div>
      </template>

      <!-- Final Total / Discount entry view -->
      <template v-else-if="view === 'finalTotal' || view === 'discount'">
        <div class="px-20px pt-18px pb-16px border-b border-border flex-none">
          <div class="flex items-center gap-12px">
            <button
              type="button"
              class="h-48px px-14px rounded-6px border border-border bg-surface text-15px font-700 text-ink cursor-pointer press inline-flex items-center gap-6px"
              @click="view = 'methods'"
            >
              <ArrowLeft class="w-16px h-16px" />
              <span>{{ L.back }}</span>
            </button>
            <span class="text-18px font-800 text-ink">
              {{ view === "finalTotal" ? L.enterFinalTotal : L.enterDiscount }}
            </span>
          </div>

          <div class="mt-12px bg-panel border border-border rounded-8px px-20px py-14px flex items-baseline justify-between num">
            <span class="text-16px font-700 text-muted">
              {{ L.subtotal }}: {{ fmtMoney(linesSubtotalCents) }}
            </span>
            <div class="flex items-baseline gap-8px">
              <span class="text-18px font-700 text-muted">RM</span>
              <span class="text-36px font-800 text-ink leading-none">{{ numText }}</span>
            </div>
          </div>
        </div>

        <div class="p-16px grid grid-cols-3 gap-10px overflow-auto flex-1 min-h-0">
          <button
            v-for="k in KEYS"
            :key="k"
            type="button"
            class="h-60px rounded-6px border text-26px font-800 cursor-pointer press num"
            :class="k === '⌫' ? 'border-ink bg-ink text-white' : 'border-control bg-surface text-ink'"
            @click="tap(k)"
          >
            {{ k }}
          </button>
        </div>

        <div class="px-16px pb-20px flex gap-10px flex-none">
          <button
            type="button"
            class="h-60px px-20px btn-ghost text-16px font-700"
            @click="numEntry = ''"
          >
            {{ L.clear }}
          </button>
          <button type="button" class="btn-pay flex-1 h-60px text-20px font-800" @click="applyDiscountView">
            {{ L.ok }}
          </button>
        </div>
      </template>

      <!-- Cash calculator view -->
      <template v-else>
        <div class="px-20px pt-18px pb-16px border-b border-border flex-none">
          <div class="flex items-center gap-12px">
            <button
              type="button"
              class="h-48px px-14px rounded-6px border border-border bg-surface text-15px font-700 text-ink cursor-pointer press inline-flex items-center gap-6px"
              @click="view = 'methods'"
            >
              <ArrowLeft class="w-16px h-16px" />
              <span>{{ L.back }}</span>
            </button>
            <span class="text-17px font-800 text-ink">{{ L.change }}</span>
          </div>

          <div class="mt-12px bg-panel border border-border rounded-8px px-20px py-14px num">
            <div class="flex items-baseline justify-between">
              <span class="text-15px font-600 text-muted">{{ L.received }} (RM)</span>
              <span class="text-30px font-800 text-ink leading-none">{{ numText }}</span>
            </div>
            <div class="mt-8px flex items-baseline justify-between">
              <span class="text-15px font-600 text-muted">− {{ L.total }}</span>
              <span class="text-20px font-700 text-muted leading-none">{{ amount(totalCents) }}</span>
            </div>
            <div class="my-10px border-t border-border"></div>
            <div class="flex items-baseline justify-between">
              <span
                class="text-16px font-700"
                :class="short ? 'text-negative' : 'text-muted'"
              >
                {{ short ? L.short : L.change }}
              </span>
              <span
                class="text-30px font-800 leading-none"
                :class="short ? 'text-negative' : 'text-ink'"
              >
                {{ short ? "−" : "" }}{{ amount(Math.abs(changeCents)) }}
              </span>
            </div>
          </div>
        </div>

        <div class="p-16px grid grid-cols-3 gap-10px overflow-auto flex-1 min-h-0">
          <button
            v-for="k in KEYS"
            :key="k"
            type="button"
            class="h-60px rounded-6px border text-26px font-800 cursor-pointer press num"
            :class="k === '⌫' ? 'border-ink bg-ink text-white' : 'border-control bg-surface text-ink'"
            @click="tap(k)"
          >
            {{ k }}
          </button>
        </div>

        <div class="px-16px pb-20px flex-none">
          <button
            type="button"
            class="btn-pay w-full h-64px text-20px font-800"
            :disabled="!canCheckout"
            @click="handlePayment('Cash')"
          >
            {{ L.payCash }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
