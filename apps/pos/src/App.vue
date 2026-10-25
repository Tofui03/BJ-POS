<script setup lang="ts">
import { onMounted } from "vue";
import { RouterView } from "vue-router";
import Toast from "./components/Toast.vue";
import { loadCompanies } from "./place";
import { loadUserImages } from "./productImage";
import { autoCloseUnclosedDays } from "./business";
import { loadLocale, loadMoneyEntry } from "./settings";
import { useUi } from "./stores/ui";

const ui = useUi();

onMounted(() => {
  void loadCompanies();
  void loadUserImages();
  void loadMoneyEntry();
  void loadLocale();
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
  </div>
</template>
