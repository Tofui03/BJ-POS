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
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  RotateCcw,
  Scissors,
  Truck,
  User,
  UserCheck,
  X,
} from "lucide-vue-next";
import TextInput from "./TextInput.vue";
import DecimalKeypad from "./DecimalKeypad.vue";
import { PAYMENT_UI } from "../payments";
import { getRepo } from "../db";
import { currentCompany } from "../place";
import { L } from "../labels";
import { determineCheckoutInvoicePrefix } from "../interactions";
import { appendDecimalKey } from "../decimalEntry";
import { useCart, type PayOptions } from "../stores/cart";

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

// Main view vs Final Total Numpad view
const view = ref<"methods" | "finalTotal">("methods");
const submitting = ref(false);
const numEntry = ref("");

// Customer Decoupling: Walk-in (default 80%) vs Contractor & DO
const customerType = ref<"walkin" | "contractor">("walkin");
const contractors = ref<Contractor[]>([]);
const selectedContractor = ref<Contractor | null>(null);
const contractorSearch = ref("");
const showContractorList = ref(false);
const showAdhocForm = ref(false);

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
const showPriceOnDo = ref(true);

// Cash Tender helper (Walk-in)
const tenderEntry = ref("");
const tenderCents = computed(() => toCents(Number(tenderEntry.value) || 0));
const changeCents = computed(() => tenderCents.value - props.totalCents);

async function loadContractors(): Promise<void> {
  try {
    const repo = await getRepo();
    const list = await repo.listContractors(currentCompany.value.id, { activeOnly: true });
    contractors.value = list.filter((c) => c.active);
  } catch {
    contractors.value = [];
  }
}

// Order Note
const cart = useCart();
const orderNote = ref("");

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      view.value = "methods";
      submitting.value = false;
      numEntry.value = "";
      tenderEntry.value = "";
      orderNote.value = cart.orderNote || "";
      void loadContractors();
    }
  },
);

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
  showAdhocForm.value = false;
  contractorSearch.value = "";
  if (!siteAddress.value && c.address) {
    siteAddress.value = c.address;
  }
}

function clearSelectedContractor(): void {
  selectedContractor.value = null;
  showContractorList.value = true;
}

function switchCustomerType(type: "walkin" | "contractor"): void {
  customerType.value = type;
  if (type === "walkin") {
    selectedContractor.value = null;
    showContractorList.value = false;
    showAdhocForm.value = false;
  } else {
    showContractorList.value = contractors.value.length > 0 && !selectedContractor.value;
  }
}

const activeContractorName = computed(() => {
  if (selectedContractor.value) return selectedContractor.value.name;
  return adhocName.value.trim();
});

const invoicePrefix = computed(() =>
  determineCheckoutInvoicePrefix(customerType.value, activeContractorName.value),
);

function buildPayload(): PayCheckoutPayload {
  const isContractor = customerType.value === "contractor";
  const c = selectedContractor.value;
  const name = isContractor ? (c ? c.name : adhocName.value.trim()) : undefined;
  const tin = isContractor ? (c ? c.tin : adhocTin.value.trim()) : undefined;
  const address = isContractor ? (c ? c.address : adhocAddress.value.trim()) : undefined;
  const phone = isContractor ? (c ? c.phone : adhocPhone.value.trim()) : undefined;

  return {
    customerType: isContractor ? "contractor" : "walkin",
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
    note: orderNote.value.trim() || undefined,
  };
}

function handlePayment(method: PaymentMethod): void {
  if (submitting.value) return;
  if (customerType.value === "contractor" && !activeContractorName.value) {
    showContractorList.value = true;
    return;
  }
  submitting.value = true;
  const payload = buildPayload();
  emit("confirm", method, payload);
}

// Cash quick-tender helpers
function setTenderExact(): void {
  tenderEntry.value = (props.totalCents / 100).toFixed(2);
}
function setTenderAmount(rm: number): void {
  tenderEntry.value = String(rm);
}

// Discount / Genapkan RM Numpad Logic
function openFinalTotalNumpad(): void {
  numEntry.value = (props.totalCents / 100).toFixed(2);
  view.value = "finalTotal";
}

function tapNumpadKey(k: string): void {
  numEntry.value = appendDecimalKey(numEntry.value, k, 2);
}

const finalTotalCentsPreview = computed(() => toCents(Number(numEntry.value) || 0));
const discountCalculatedCents = computed(() =>
  Math.max(0, props.linesSubtotalCents - finalTotalCentsPreview.value),
);

function applyFinalTotal(): void {
  const finalCents = finalTotalCentsPreview.value;
  if (finalCents > 0) {
    emit("setFinalTotal", finalCents);
  }
  view.value = "methods";
}

function clearDiscount(): void {
  emit("clearBillDiscount");
  view.value = "methods";
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 bg-[rgba(19,20,22,.45)] flex items-center justify-center p-16px z-85"
    @click.self="emit('close')"
  >
    <section
        role="dialog"
        aria-modal="true"
        aria-label="Checkout & Payment"
        class="w-760px max-w-full max-h-[94vh] bg-surface border border-border rounded-12px shadow-[0_16px_40px_rgba(19,20,22,0.18)] flex flex-col overflow-hidden"
      >
        <header class="flex-none flex items-center justify-between px-24px py-16px border-b border-border">
          <div class="flex items-center gap-12px">
            <h2 class="m-0 text-22px font-800 text-ink">
              {{ view === "finalTotal" ? "算便宜一点 / 改总价 (Genapkan RM)" : "收银结账 / Pembayaran" }}
            </h2>
            <span
              class="px-10px py-3px rounded-6px text-13px font-800 tracking-wide num"
              :class="invoicePrefix === 'A' ? 'bg-panel text-ink' : 'bg-[#fffbeb] border border-[#fde68a] text-warning'"
            >
              {{ invoicePrefix }}-Sequence
            </span>
          </div>
          <button
            type="button"
            class="h-46px px-16px flex-none rounded-6px border border-border bg-surface text-15px font-700 text-ink cursor-pointer press inline-flex items-center gap-6px"
            @click="emit('close')"
          >
            <X class="w-18px h-18px text-muted" />
            <span>{{ L.close }}</span>
          </button>
        </header>

        <div v-if="view === 'finalTotal'" class="flex-1 overflow-y-auto p-24px flex flex-col gap-16px">
          <div class="flex items-center justify-between">
            <span class="text-16px font-700 text-muted">{{ L.originalPriceLabel }}:</span>
            <span class="text-20px font-800 text-ink num">{{ fmtMoney(linesSubtotalCents) }}</span>
          </div>

          <div class="p-16px rounded-10px border-2 border-ink bg-panel flex flex-col gap-8px">
            <div class="flex items-baseline justify-between">
              <span class="text-18px font-700 text-muted">{{ L.total }}:</span>
              <span class="text-36px font-800 text-ink tracking-tight num leading-none">
                RM {{ numEntry || "0.00" }}
              </span>
            </div>
            <div class="pt-10px border-t border-border flex items-center justify-between text-16px font-700">
              <span class="text-muted">{{ L.discount }}:</span>
              <span class="text-20px font-800 text-negative num">
                -{{ fmtMoney(discountCalculatedCents) }}
              </span>
            </div>
          </div>

          <DecimalKeypad key-class="h-64px" @key="tapNumpadKey">
            <template #action>
              <button
                type="button"
                class="btn-pay flex-1 min-h-136px rounded-8px text-20px font-800 flex flex-col items-center justify-center gap-6px leading-tight"
                :disabled="finalTotalCentsPreview <= 0"
                @click="applyFinalTotal"
              >
                <span>{{ L.ok }}</span>
                <span class="text-14px font-700 opacity-90">Simpan</span>
              </button>
            </template>
          </DecimalKeypad>

          <div class="flex items-center justify-between pt-8px">
            <button
              v-if="billDiscountCents > 0"
              type="button"
              class="h-48px px-16px rounded-6px border border-border bg-surface text-15px font-700 text-negative hover:border-negative cursor-pointer press"
              @click="clearDiscount"
            >
              {{ L.clearAllDiscounts }}
            </button>
            <button
              type="button"
              class="h-48px px-20px rounded-6px border border-border bg-surface text-15px font-700 text-ink cursor-pointer press ml-auto"
              @click="view = 'methods'"
            >
              {{ L.back }}
            </button>
          </div>
        </div>

        <div v-else class="flex-1 overflow-y-auto p-24px flex flex-col gap-18px">
          <div class="grid grid-cols-2 gap-12px flex-none">
            <button
              type="button"
              class="h-64px px-16px rounded-10px border-2 text-18px font-800 cursor-pointer press flex items-center justify-center gap-10px transition-colors"
              :class="
                customerType === 'walkin'
                  ? 'border-ink bg-ink text-white shadow-sm'
                  : 'border-border bg-surface text-ink hover:border-control'
              "
              @click="switchCustomerType('walkin')"
            >
              <User class="w-22px h-22px flex-none" />
              <span>🚶 {{ L.walkInDirect }}</span>
            </button>

            <button
              type="button"
              class="h-64px px-16px rounded-10px border-2 text-18px font-800 cursor-pointer press flex items-center justify-center gap-10px transition-colors"
              :class="
                customerType === 'contractor'
                  ? 'border-ink bg-ink text-white shadow-sm'
                  : 'border-border bg-surface text-ink hover:border-control'
              "
              @click="switchCustomerType('contractor')"
            >
              <Truck class="w-22px h-22px flex-none" />
              <span>🚚 {{ L.contractorDO }}</span>
            </button>
          </div>

          <div class="p-16px rounded-10px border border-border bg-panel flex items-center justify-between gap-12px flex-wrap">
            <div class="flex flex-col">
              <span class="text-14px font-700 text-muted">{{ L.amountToPay }}:</span>
              <div class="flex items-baseline gap-10px">
                <span class="text-36px font-800 text-ink num leading-none">
                  {{ fmtMoney(totalCents) }}
                </span>
                <span v-if="totalDiscountCents > 0" class="text-15px font-700 text-negative num">
                  (已优惠 -{{ fmtMoney(totalDiscountCents) }})
                </span>
              </div>
            </div>

            <div class="flex items-center gap-8px">
              <button
                type="button"
                class="h-50px px-16px rounded-8px border-1.5 border-ink bg-surface text-15px font-800 text-ink cursor-pointer press flex items-center gap-8px hover:bg-white"
                @click="openFinalTotalNumpad"
              >
                <Scissors class="w-18px h-18px text-muted" />
                <span>✂️ {{ L.roundOffPrice }}</span>
              </button>
              <button
                v-if="billDiscountCents > 0"
                type="button"
                class="h-50px px-12px rounded-8px border border-border bg-surface text-14px font-700 text-negative hover:border-negative cursor-pointer press"
                title="清除整单优惠"
                @click="clearDiscount"
              >
                ✕ {{ L.restorePrice }}
              </button>
            </div>
          </div>

          <div v-if="customerType === 'walkin'" class="flex flex-col gap-18px">
            <div class="p-16px rounded-10px border border-border bg-surface flex flex-col gap-12px">
              <div class="flex items-center justify-between gap-12px flex-wrap">
                <span class="text-15px font-700 text-muted">{{ L.tenderAndChangeCalc }}:</span>
                <div v-if="tenderCents >= totalCents && tenderCents > 0" class="text-20px font-800 text-positive num">
                  {{ L.changeDue }}: <span class="text-26px font-900">{{ fmtMoney(changeCents) }}</span>
                </div>
                <div v-else-if="tenderCents > 0" class="text-16px font-800 text-negative num">
                  {{ L.amountShort }}: {{ fmtMoney(totalCents - tenderCents) }}
                </div>
              </div>

              <div class="flex items-center gap-8px flex-wrap">
                <button
                  type="button"
                  class="h-50px px-16px rounded-8px border-1.5 text-16px font-800 cursor-pointer press transition-colors"
                  :class="tenderCents === totalCents ? 'border-ink bg-ink text-white' : 'border-border bg-panel text-ink hover:border-control'"
                  @click="setTenderExact"
                >
                  {{ L.exactTender }} ({{ fmtMoney(totalCents) }})
                </button>
                <button
                  v-for="amt in [10, 20, 50, 100]"
                  :key="amt"
                  type="button"
                  class="h-50px px-18px rounded-8px border-1.5 text-16px font-800 cursor-pointer press transition-colors"
                  :class="tenderCents === amt * 100 ? 'border-ink bg-ink text-white' : 'border-border bg-surface text-ink hover:border-control'"
                  @click="setTenderAmount(amt)"
                >
                  RM {{ amt }}
                </button>
              </div>
            </div>

            <div class="pt-2px">
              <TextInput
                v-model="orderNote"
                :title="L.orderNote || '单据备注 / Order Note (Optional)'"
                :placeholder="L.orderNotePlaceholder"
              />
            </div>

            <div class="grid grid-cols-2 gap-12px">
              <button
                type="button"
                class="h-76px px-20px rounded-10px border-2 border-[#15803d] bg-[#15803d] text-white text-22px font-800 cursor-pointer press flex items-center justify-center gap-12px shadow-sm hover:brightness-105"
                @click="handlePayment('Cash')"
              >
                <span class="text-26px">💵</span>
                <span>{{ L.cash }}</span>
              </button>

              <button
                type="button"
                class="h-76px px-20px rounded-10px border-2 border-ink bg-surface text-ink text-22px font-800 cursor-pointer press flex items-center justify-center gap-12px hover:border-control hover:bg-panel"
                @click="handlePayment('Card')"
              >
                <span class="text-26px">💳</span>
                <span>{{ L.card }}</span>
              </button>

              <button
                type="button"
                class="h-76px px-20px rounded-10px border-2 border-ink bg-surface text-ink text-22px font-800 cursor-pointer press flex items-center justify-center gap-12px hover:border-control hover:bg-panel"
                @click="handlePayment('QR')"
              >
                <span class="text-26px">📱</span>
                <span>{{ L.qr }}</span>
              </button>

              <button
                type="button"
                class="h-76px px-20px rounded-10px border-2 border-ink bg-surface text-ink text-22px font-800 cursor-pointer press flex items-center justify-center gap-12px hover:border-control hover:bg-panel"
                @click="handlePayment('Bank')"
              >
                <span class="text-26px">🏦</span>
                <span>{{ L.bank }}</span>
              </button>
            </div>

            <div class="border border-border rounded-8px overflow-hidden">
              <button
                type="button"
                class="w-full h-50px px-16px bg-surface hover:bg-panel text-left cursor-pointer press flex items-center justify-between text-15px font-700 text-muted"
                @click="issueDo = !issueDo"
              >
                <div class="flex items-center gap-8px">
                  <FileText class="w-18px h-18px" />
                  <span>📄 {{ L.requireDO }}</span>
                </div>
                <component :is="issueDo ? ChevronUp : ChevronDown" class="w-18px h-18px" />
              </button>
              <div v-if="issueDo" class="p-16px bg-panel border-t border-border flex flex-col gap-12px">
                <TextInput v-model="siteAddress" title="送货地址 / Site Address" :placeholder="L.siteAddressPlaceholder" />
                <div class="grid grid-cols-2 gap-10px">
                  <TextInput v-model="lorryPlate" title="罗里车牌 / Lorry No." :placeholder="L.lorryNoPlaceholder" />
                  <TextInput v-model="driverName" title="司机姓名 / Driver" :placeholder="L.driverPlaceholder" />
                </div>
              </div>
            </div>
          </div>

          <div v-else class="flex flex-col gap-18px">
            <div class="p-16px rounded-10px border border-border bg-surface flex flex-col gap-12px">
              <div class="flex items-center justify-between">
                <span class="text-16px font-800 text-ink">{{ L.step1ChooseContractor }}:</span>
                <button
                  type="button"
                  class="text-14px font-700 text-ink hover:underline cursor-pointer"
                  @click="showAdhocForm = !showAdhocForm"
                >
                  {{ showAdhocForm ? "选择已有商户" : "+ 临时输入新工程商" }}
                </button>
              </div>

              <div
                v-if="selectedContractor"
                class="p-14px rounded-8px border-2 border-ink bg-[#f8fafc] flex items-center justify-between gap-12px"
              >
                <div class="flex flex-col">
                  <div class="text-18px font-800 text-ink flex items-center gap-8px">
                    <UserCheck class="w-20px h-20px text-positive" />
                    <span>{{ selectedContractor.name }}</span>
                  </div>
                  <div class="text-13px font-600 text-muted mt-2px">
                    {{ [selectedContractor.phone, selectedContractor.tin, selectedContractor.address].filter(Boolean).join(" · ") }}
                  </div>
                </div>
                <button
                  type="button"
                  class="h-44px px-14px rounded-6px border border-border bg-surface text-14px font-700 text-ink cursor-pointer press"
                  @click="clearSelectedContractor"
                >
                  {{ L.changeContractor }}
                </button>
              </div>

              <div v-else-if="!showAdhocForm" class="flex flex-col gap-8px">
                <TextInput
                  v-model="contractorSearch"
                  title="搜索工程商 / Cari Kontraktor"
                  placeholder="输入名称 / 电话 / TIN"
                  class="w-full"
                />
                <div class="max-h-160px overflow-y-auto flex flex-col gap-6px border border-border rounded-8px p-6px bg-panel">
                  <button
                    v-for="c in filteredContractors"
                    :key="c.id"
                    type="button"
                    class="h-50px px-12px rounded-6px bg-surface border border-border text-left cursor-pointer press hover:border-ink flex items-center justify-between"
                    @click="selectContractor(c)"
                  >
                    <span class="text-15px font-800 text-ink">{{ c.name }}</span>
                    <span class="text-13px font-600 text-muted">{{ c.phone || c.tin }}</span>
                  </button>
                  <div v-if="filteredContractors.length === 0" class="p-12px text-center text-muted text-14px">
                    {{ L.noContractorMatchHint }}
                  </div>
                </div>
              </div>

              <div v-else class="flex flex-col gap-10px p-12px border border-border rounded-8px bg-panel">
                <TextInput v-model="adhocName" title="商户全名 / Nama Penuh *" placeholder="Ah Seng Construction" />
                <div class="grid grid-cols-2 gap-10px">
                  <TextInput v-model="adhocPhone" title="电话 / Tel" placeholder="012-3456789" />
                  <TextInput v-model="adhocTin" title="税号 / TIN" placeholder="C 1234567890" />
                </div>
                <TextInput v-model="adhocAddress" title="地址 / Alamat" placeholder="Alamat Penuh" />
                <label class="flex items-center gap-8px text-14px font-700 text-ink cursor-pointer select-none pt-4px">
                  <input v-model="saveAsContractor" type="checkbox" class="w-18px h-18px rounded accent-ink" />
                  <span>{{ L.saveToContractorBook }}</span>
                </label>
              </div>
            </div>

            <div class="p-14px rounded-10px border border-border bg-surface flex flex-col gap-10px">
              <label class="flex items-center gap-10px text-16px font-800 text-ink cursor-pointer select-none">
                <input v-model="issueDo" type="checkbox" class="w-20px h-20px rounded accent-ink" />
                <span>{{ L.step2IssueDO }}</span>
              </label>

              <div v-if="issueDo" class="pt-10px border-t border-border flex flex-col gap-10px">
                <TextInput v-model="siteAddress" title="送货地址 / Site Address" :placeholder="L.siteAddressPlaceholder" />
                <div class="grid grid-cols-3 gap-8px">
                  <TextInput v-model="lorryPlate" title="罗里车牌 / Lorry No." placeholder="No. Lori" />
                  <TextInput v-model="driverName" title="司机姓名 / Driver" :placeholder="L.driverPlaceholder" />
                  <TextInput v-model="contractorPo" title="采购单号 / PO No." :placeholder="L.poNoPlaceholder" />
                </div>
                <label class="flex items-center gap-8px text-14px font-700 text-muted cursor-pointer select-none">
                  <input v-model="showPriceOnDo" type="checkbox" class="w-18px h-18px rounded accent-ink" />
                  <span>{{ L.showPricesOnDO }}</span>
                </label>
              </div>
            </div>

            <div class="p-12px rounded-10px border border-border bg-surface flex flex-col gap-8px">
              <TextInput
                v-model="orderNote"
                :title="L.orderNote || '单据备注 / Order Note (Optional)'"
                :placeholder="L.contractorOrderNotePlaceholder"
              />
            </div>

            <div class="flex flex-col gap-10px">
              <div class="text-15px font-800 text-ink">{{ L.step3PaymentMethod }}:</div>
              <button
                type="button"
                class="h-72px px-20px rounded-10px border-2 border-warning bg-warning text-white text-22px font-800 cursor-pointer press flex items-center justify-center gap-12px shadow-sm hover:brightness-105"
                :disabled="!activeContractorName"
                @click="handlePayment('Credit')"
              >
                <span class="text-28px">📋</span>
                <span>{{ L.credit }}</span>
              </button>

              <div class="grid grid-cols-4 gap-8px pt-4px">
                <button
                  type="button"
                  class="h-60px rounded-8px border-2 border-border bg-surface text-ink text-17px font-800 cursor-pointer press flex items-center justify-center gap-6px hover:border-ink"
                  :disabled="!activeContractorName"
                  @click="handlePayment('Cash')"
                >
                  <span>💵 {{ L.cash }}</span>
                </button>
                <button
                  type="button"
                  class="h-60px rounded-8px border-2 border-border bg-surface text-ink text-17px font-800 cursor-pointer press flex items-center justify-center gap-6px hover:border-ink"
                  :disabled="!activeContractorName"
                  @click="handlePayment('Card')"
                >
                  <span>💳 {{ L.card }}</span>
                </button>
                <button
                  type="button"
                  class="h-60px rounded-8px border-2 border-border bg-surface text-ink text-17px font-800 cursor-pointer press flex items-center justify-center gap-6px hover:border-ink"
                  :disabled="!activeContractorName"
                  @click="handlePayment('QR')"
                >
                  <span>📱 {{ L.qr }}</span>
                </button>
                <button
                  type="button"
                  class="h-60px rounded-8px border-2 border-border bg-surface text-ink text-17px font-800 cursor-pointer press flex items-center justify-center gap-6px hover:border-ink"
                  :disabled="!activeContractorName"
                  @click="handlePayment('Bank')"
                >
                  <span>🏦 {{ L.bank }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
</template>
