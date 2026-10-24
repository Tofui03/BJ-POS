<script setup lang="ts">
defineProps<{ state: "loading" | "success"; message?: string }>();
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-18px py-34px px-24px">
    <div v-if="state === 'loading'" class="yf-spinner" />
    <div v-else class="yf-check">
      <svg width="42" height="42" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5 13l4 4L19 7" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </div>
    <div class="text-18px font-700 text-ink text-center">
      {{ message ?? (state === "loading" ? "Loading…" : "Done") }}
    </div>
  </div>
</template>

<style scoped>
.yf-spinner {
  width: 56px;
  height: 56px;
  border-radius: 9999px;
  border: 5px solid #e6e6e6;
  border-top-color: #0a0a0a;
  animation: yf-spin 0.8s linear infinite;
}
@keyframes yf-spin {
  to {
    transform: rotate(360deg);
  }
}
.yf-check {
  width: 56px;
  height: 56px;
  border-radius: 8px;
  background: #141414;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
