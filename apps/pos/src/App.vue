<script setup lang="ts">
import { onMounted } from "vue";
import { RouterView } from "vue-router";
import Toast from "./components/Toast.vue";
import CashierDialog from "./components/CashierDialog.vue";
import { loadCompanies } from "./place";
import { loadUserImages } from "./productImage";
import { autoCloseUnclosedDays } from "./business";
import { loadLocale, loadMoneyEntry } from "./settings";
import { useUi } from "./stores/ui";
import { useCashier } from "./stores/cashier";

const ui = useUi();
const cashierStore = useCashier();

onMounted(() => {
  void loadCompanies();
  void loadUserImages();
  void loadMoneyEntry();
  void loadLocale();
  void cashierStore.init().then(() => {
    if (!cashierStore.currentCashier) {
      cashierStore.openDialog();
    }
  });
  void autoCloseUnclosedDays()
    .then((dates) => {
      if (dates.length === 1) ui.showToast(`Closed ${dates[0]} automatically`);
      else if (dates.length > 1) ui.showToast(`Closed ${dates.length} past days automatically`);
    })
    .catch(() => {});
});
</script>

<template>
  <div class="h-full flex flex-col bg-cream text-ink">
    <RouterView />
    <Toast />
    <CashierDialog
      :open="cashierStore.showDialog"
      :closable="Boolean(cashierStore.currentCashier)"
      @close="cashierStore.closeDialog()"
      @select="cashierStore.closeDialog()"
    />
  </div>
</template>
