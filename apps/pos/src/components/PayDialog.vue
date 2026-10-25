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
import { PAYMENT_UI } from "../payments";
import { getRepo } from "../db";
import { currentCompany } from "../place";
import { L } from "../labels";
import { determineCheckoutInvoicePrefix } from "../interactions";
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
  if (customerType.value === "contractor" && !activeContractorName.value) {
    showContractorList.value = true;
    return;
  }
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
  if (k === "C") {
    numEntry.value = "";
    return;
  }
  if (k === "⌫") {
    numEntry.value = numEntry.value.slice(0, -1);
    return;
  }
  if (k === ".") {
    if (numEntry.value.includes(".")) return;
    numEntry.value = numEntry.value ? `${numEntry.value}.` : "0.";
    return;
  }
  if (numEntry.value.includes(".")) {
    const dec = numEntry.value.split(".")[1] ?? "";
    if (dec.length >= 2) return;
  }
  numEntry.value = numEntry.value === "0" ? k : `${numEntry.value}${k}`;
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

const NUMPAD_KEYS = [
  "7", "8", "9",
  "4", "5", "6",
  "1", "2", "3",
  "C", "0", ".",
];
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
        <!-- Header -->
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

        <!-- VIEW: Final Total ("算便宜一点 / 抹零") Numpad Mode -->
        <div v-if="view === 'finalTotal'" class="flex-1 overflow-y-auto p-24px flex flex-col gap-16px">
          <div class="flex items-center justify-between">
            <span class="text-16px font-700 text-muted">账单原价:</span>
            <span class="text-20px font-800 text-ink num">{{ fmtMoney(linesSubtotalCents) }}</span>
          </div>

          <div class="p-16px rounded-10px border-2 border-ink bg-panel flex flex-col gap-8px">
            <div class="flex items-baseline justify-between">
              <span class="text-18px font-700 text-muted">实收总价 (RM):</span>
              <span class="text-36px font-800 text-ink tracking-tight num leading-none">
                RM {{ numEntry || "0.00" }}
              </span>
            </div>
            <div class="pt-10px border-t border-border flex items-center justify-between text-16px font-700">
              <span class="text-muted">自动优惠折扣:</span>
              <span class="text-20px font-800 text-negative num">
                -{{ fmtMoney(discountCalculatedCents) }}
              </span>
            </div>
          </div>

          <!-- Numpad -->
          <div class="grid grid-cols-4 gap-8px">
            <div class="col-span-3 grid grid-cols-3 gap-8px">
              <button
                v-for="k in NUMPAD_KEYS"
                :key="k"
                type="button"
                class="h-64px rounded-8px border border-border bg-surface text-24px font-800 text-ink cursor-pointer press flex items-center justify-center num hover:border-ink active:bg-active"
                @click="tapNumpadKey(k)"
              >
                {{ k }}
              </button>
            </div>
            <div class="col-span-1 flex flex-col gap-8px">
              <button
                type="button"
                class="h-64px rounded-8px border border-border bg-surface text-22px font-800 text-ink cursor-pointer press flex items-center justify-center hover:border-ink active:bg-active"
                title="Backspace"
                @click="tapNumpadKey('⌫')"
              >
                ⌫
              </button>
              <button
                type="button"
                class="btn-pay flex-1 min-h-136px rounded-8px text-20px font-800 flex flex-col items-center justify-center gap-6px leading-tight"
                :disabled="finalTotalCentsPreview <= 0"
                @click="applyFinalTotal"
              >
                <span>确定改价</span>
                <span class="text-14px font-700 opacity-90">Simpan</span>
              </button>
            </div>
          </div>

          <div class="flex items-center justify-between pt-8px">
            <button
              v-if="billDiscountCents > 0"
              type="button"
              class="h-48px px-16px rounded-6px border border-border bg-surface text-15px font-700 text-negative hover:border-negative cursor-pointer press"
              @click="clearDiscount"
            >
              清除所有优惠 / Buang Diskaun
            </button>
            <button
              type="button"
              class="h-48px px-20px rounded-6px border border-border bg-surface text-15px font-700 text-ink cursor-pointer press ml-auto"
              @click="view = 'methods'"
            >
              返回 / Kembali
            </button>
          </div>
        </div>

        <!-- VIEW: Normal Checkout Mode -->
        <div v-else class="flex-1 overflow-y-auto p-24px flex flex-col gap-18px">
          <!-- Step 1: Top Customer Type Switcher (64px tall segmented tabs) -->
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
              <span>🚶 散客现结 / Walk-in</span>
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
              <span>🚚 工程商 / 开送货单 (Contractor & DO)</span>
            </button>
          </div>

          <!-- Total RM Banner + 1-Tap Rounding / Discount Button -->
          <div class="p-16px rounded-10px border border-border bg-panel flex items-center justify-between gap-12px flex-wrap">
            <div class="flex flex-col">
              <span class="text-14px font-700 text-muted">实收金额 / Jumlah Perlu Bayar:</span>
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
                <span>✂️ 算便宜一点 / 改总价 (Genapkan RM)</span>
              </button>
              <button
                v-if="billDiscountCents > 0"
                type="button"
                class="h-50px px-12px rounded-8px border border-border bg-surface text-14px font-700 text-negative hover:border-negative cursor-pointer press"
                title="清除整单优惠"
                @click="clearDiscount"
              >
                ✕ 恢复原价
              </button>
            </div>
          </div>

          <!-- TAB 1: 🚶 散客现结 / Walk-in Tab -->
          <div v-if="customerType === 'walkin'" class="flex flex-col gap-18px">
            <!-- Cash Change Helper -->
            <div class="p-16px rounded-10px border border-border bg-surface flex flex-col gap-12px">
              <div class="flex items-center justify-between gap-12px flex-wrap">
                <span class="text-15px font-700 text-muted">现金找零计算器 (Tender & Change):</span>
                <div v-if="tenderCents >= totalCents && tenderCents > 0" class="text-20px font-800 text-positive num">
                  找零 / Baki: <span class="text-26px font-900">{{ fmtMoney(changeCents) }}</span>
                </div>
                <div v-else-if="tenderCents > 0" class="text-16px font-800 text-negative num">
                  还少 / Kurang: {{ fmtMoney(totalCents - tenderCents) }}
                </div>
              </div>

              <!-- Quick Tender Pills -->
              <div class="flex items-center gap-8px flex-wrap">
                <button
                  type="button"
                  class="h-50px px-16px rounded-8px border-1.5 text-16px font-800 cursor-pointer press transition-colors"
                  :class="tenderCents === totalCents ? 'border-ink bg-ink text-white' : 'border-border bg-panel text-ink hover:border-control'"
                  @click="setTenderExact"
                >
                  刚好 Exact ({{ fmtMoney(totalCents) }})
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

            <!-- Order Note input -->
            <div class="pt-2px">
              <TextInput
                v-model="orderNote"
                :title="L.orderNote || '单据备注 / Order Note (Optional)'"
                placeholder="如：送货到工地上午 / 送给张师傅 / 特殊交代"
              />
            </div>

            <!-- 4 Giant Payment Confirm Buttons (height: 76px, font-size: 22px bold, 2×2 grid) -->
            <div class="grid grid-cols-2 gap-12px">
              <button
                type="button"
                class="h-76px px-20px rounded-10px border-2 border-[#15803d] bg-[#15803d] text-white text-22px font-800 cursor-pointer press flex items-center justify-center gap-12px shadow-sm hover:brightness-105"
                @click="handlePayment('Cash')"
              >
                <span class="text-26px">💵</span>
                <span>现金 / Cash</span>
              </button>

              <button
                type="button"
                class="h-76px px-20px rounded-10px border-2 border-ink bg-surface text-ink text-22px font-800 cursor-pointer press flex items-center justify-center gap-12px hover:border-control hover:bg-panel"
                @click="handlePayment('Card')"
              >
                <span class="text-26px">💳</span>
                <span>刷卡 / Card</span>
              </button>

              <button
                type="button"
                class="h-76px px-20px rounded-10px border-2 border-ink bg-surface text-ink text-22px font-800 cursor-pointer press flex items-center justify-center gap-12px hover:border-control hover:bg-panel"
                @click="handlePayment('QR')"
              >
                <span class="text-26px">📱</span>
                <span>二维码 / QR</span>
              </button>

              <button
                type="button"
                class="h-76px px-20px rounded-10px border-2 border-ink bg-surface text-ink text-22px font-800 cursor-pointer press flex items-center justify-center gap-12px hover:border-control hover:bg-panel"
                @click="handlePayment('Bank')"
              >
                <span class="text-26px">🏦</span>
                <span>银行转账 / Bank Transfer</span>
              </button>
            </div>

            <!-- Quiet DO accordion toggle -->
            <div class="border border-border rounded-8px overflow-hidden">
              <button
                type="button"
                class="w-full h-50px px-16px bg-surface hover:bg-panel text-left cursor-pointer press flex items-center justify-between text-15px font-700 text-muted"
                @click="issueDo = !issueDo"
              >
                <div class="flex items-center gap-8px">
                  <FileText class="w-18px h-18px" />
                  <span>📄 需要打印 A4 送货单 (Issue DO)</span>
                </div>
                <component :is="issueDo ? ChevronUp : ChevronDown" class="w-18px h-18px" />
              </button>
              <div v-if="issueDo" class="p-16px bg-panel border-t border-border flex flex-col gap-12px">
                <TextInput v-model="siteAddress" title="送货地址 / Site Address" placeholder="Alamat Tapak Projek" />
                <div class="grid grid-cols-2 gap-10px">
                  <TextInput v-model="lorryPlate" title="罗里车牌 / Lorry No." placeholder="No. Lori (e.g. QAA 1234)" />
                  <TextInput v-model="driverName" title="司机姓名 / Driver" placeholder="Nama Pemandu" />
                </div>
              </div>
            </div>
          </div>

          <!-- TAB 2: 🚚 工程商 / 开送货单 (Contractor & DO) -->
          <div v-else class="flex flex-col gap-18px">
            <!-- Step 1: Contractor Selection / Card -->
            <div class="p-16px rounded-10px border border-border bg-surface flex flex-col gap-12px">
              <div class="flex items-center justify-between">
                <span class="text-16px font-800 text-ink">1. 选择工程商 / Pilih Kontraktor:</span>
                <button
                  type="button"
                  class="text-14px font-700 text-ink hover:underline cursor-pointer"
                  @click="showAdhocForm = !showAdhocForm"
                >
                  {{ showAdhocForm ? "选择已有商户" : "+ 临时输入新工程商" }}
                </button>
              </div>

              <!-- Selected contractor banner -->
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
                  更换 / Ganti
                </button>
              </div>

              <!-- Contractor search & list -->
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
                    未找到匹配商户，可点上方“临时输入新工程商”
                  </div>
                </div>
              </div>

              <!-- Ad-hoc contractor form -->
              <div v-else class="flex flex-col gap-10px p-12px border border-border rounded-8px bg-panel">
                <TextInput v-model="adhocName" title="商户全名 / Nama Penuh *" placeholder="Ah Seng Construction" />
                <div class="grid grid-cols-2 gap-10px">
                  <TextInput v-model="adhocPhone" title="电话 / Tel" placeholder="012-3456789" />
                  <TextInput v-model="adhocTin" title="税号 / TIN" placeholder="C 1234567890" />
                </div>
                <TextInput v-model="adhocAddress" title="地址 / Alamat" placeholder="Alamat Penuh" />
                <label class="flex items-center gap-8px text-14px font-700 text-ink cursor-pointer select-none pt-4px">
                  <input v-model="saveAsContractor" type="checkbox" class="w-18px h-18px rounded accent-ink" />
                  <span>顺便存入工程商通讯录，下次直接选</span>
                </label>
              </div>
            </div>

            <!-- Step 2: Delivery Order Toggle -->
            <div class="p-14px rounded-10px border border-border bg-surface flex flex-col gap-10px">
              <label class="flex items-center gap-10px text-16px font-800 text-ink cursor-pointer select-none">
                <input v-model="issueDo" type="checkbox" class="w-20px h-20px rounded accent-ink" />
                <span>2. 📄 开具 A4 送货单 (Issue Delivery Order)</span>
              </label>

              <div v-if="issueDo" class="pt-10px border-t border-border flex flex-col gap-10px">
                <TextInput v-model="siteAddress" title="送货地址 / Site Address" placeholder="Alamat Tapak Projek" />
                <div class="grid grid-cols-3 gap-8px">
                  <TextInput v-model="lorryPlate" title="罗里车牌 / Lorry No." placeholder="No. Lori" />
                  <TextInput v-model="driverName" title="司机姓名 / Driver" placeholder="Nama Pemandu" />
                  <TextInput v-model="contractorPo" title="采购单号 / PO No." placeholder="No. PO" />
                </div>
                <label class="flex items-center gap-8px text-14px font-700 text-muted cursor-pointer select-none">
                  <input v-model="showPriceOnDo" type="checkbox" class="w-18px h-18px rounded accent-ink" />
                  <span>送货单上打印金额 (Show Prices on DO)</span>
                </label>
              </div>
            </div>

            <!-- Order Note input -->
            <div class="p-12px rounded-10px border border-border bg-surface flex flex-col gap-8px">
              <TextInput
                v-model="orderNote"
                :title="L.orderNote || '单据备注 / Order Note (Optional)'"
                placeholder="如：Site B 批次 / 项目号 / 备注"
              />
            </div>

            <!-- Step 3: Payment Buttons (Credit prominent + Cash, Card, QR, Bank) -->
            <div class="flex flex-col gap-10px">
              <div class="text-15px font-800 text-ink">3. 选择付款方式 / Cara Bayar:</div>
              <button
                type="button"
                class="h-72px px-20px rounded-10px border-2 border-warning bg-warning text-white text-22px font-800 cursor-pointer press flex items-center justify-center gap-12px shadow-sm hover:brightness-105"
                :disabled="!activeContractorName"
                @click="handlePayment('Credit')"
              >
                <span class="text-28px">📋</span>
                <span>记账欠款 (Credit / Hutang)</span>
              </button>

              <div class="grid grid-cols-4 gap-8px pt-4px">
                <button
                  type="button"
                  class="h-60px rounded-8px border-2 border-border bg-surface text-ink text-17px font-800 cursor-pointer press flex items-center justify-center gap-6px hover:border-ink"
                  :disabled="!activeContractorName"
                  @click="handlePayment('Cash')"
                >
                  <span>💵 现金</span>
                </button>
                <button
                  type="button"
                  class="h-60px rounded-8px border-2 border-border bg-surface text-ink text-17px font-800 cursor-pointer press flex items-center justify-center gap-6px hover:border-ink"
                  :disabled="!activeContractorName"
                  @click="handlePayment('Card')"
                >
                  <span>💳 刷卡</span>
                </button>
                <button
                  type="button"
                  class="h-60px rounded-8px border-2 border-border bg-surface text-ink text-17px font-800 cursor-pointer press flex items-center justify-center gap-6px hover:border-ink"
                  :disabled="!activeContractorName"
                  @click="handlePayment('QR')"
                >
                  <span>📱 二维码</span>
                </button>
                <button
                  type="button"
                  class="h-60px rounded-8px border-2 border-border bg-surface text-ink text-17px font-800 cursor-pointer press flex items-center justify-center gap-6px hover:border-ink"
                  :disabled="!activeContractorName"
                  @click="handlePayment('Bank')"
                >
                  <span>🏦 转账</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
</template>
