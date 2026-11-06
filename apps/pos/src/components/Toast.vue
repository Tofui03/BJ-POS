<script setup lang="ts">
import { useUi } from "../stores/ui";
const ui = useUi();
</script>

<template>
  <div
    v-if="ui.toast"
    class="fixed left-1/2 top-84px -translate-x-1/2 bg-ink text-white px-28px py-16px rounded-8px text-28px font-800 z-60 pointer-events-none"
    style="animation: toastIn 0.25s ease"
  >
    {{ ui.toast }}
  </div>
</template>
