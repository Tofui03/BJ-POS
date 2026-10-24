<script setup lang="ts">
import { useUi } from "../stores/ui";
const ui = useUi();
</script>

<template>
  <div
    v-if="ui.toast"
    class="fixed left-1/2 bottom-34px -translate-x-1/2 bg-ink text-white px-24px py-14px rounded-8px text-18px font-700 z-60"
    style="animation: toastIn 0.25s ease"
  >
    {{ ui.toast }}
  </div>
</template>
