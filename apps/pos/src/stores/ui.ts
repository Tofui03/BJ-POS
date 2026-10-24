import { defineStore } from "pinia";
import { ref } from "vue";

export const useUi = defineStore("ui", () => {
  const toast = ref("");
  let timer: ReturnType<typeof setTimeout> | null = null;

  function showToast(message: string, ms = 2200): void {
    toast.value = message;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => (toast.value = ""), ms);
  }

  return { toast, showToast };
});
