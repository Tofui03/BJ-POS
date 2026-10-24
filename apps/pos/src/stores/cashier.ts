import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { validateCashierName } from "@yf/core";
import { getRepo } from "../db";
import { SETTING_KEYS } from "../settings";

export const useCashier = defineStore("cashier", () => {
  const currentCashier = ref<string>(
    typeof sessionStorage !== "undefined"
      ? sessionStorage.getItem("pos.cashier") || ""
      : "",
  );
  const cashiers = ref<string[]>([]);
  const showDialog = ref<boolean>(false);

  watch(currentCashier, (val) => {
    if (typeof sessionStorage !== "undefined") {
      if (val) {
        sessionStorage.setItem("pos.cashier", val);
      } else {
        sessionStorage.removeItem("pos.cashier");
      }
    }
  });

  async function init(): Promise<void> {
    try {
      const repo = await getRepo();
      const raw = await repo.getSetting(SETTING_KEYS.cashierList);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          cashiers.value = parsed.filter(
            (n): n is string => typeof n === "string" && n.trim().length > 0,
          );
        }
      }
    } catch {
      // ignore
    }
  }

  function setCashier(name: string): string {
    const valid = validateCashierName(name);
    currentCashier.value = valid;
    return valid;
  }

  async function addCashier(name: string): Promise<string> {
    const valid = validateCashierName(name);
    if (!cashiers.value.includes(valid)) {
      cashiers.value.push(valid);
      try {
        const repo = await getRepo();
        await repo.setSetting(
          SETTING_KEYS.cashierList,
          JSON.stringify(cashiers.value),
        );
      } catch {
        // ignore
      }
    }
    currentCashier.value = valid;
    return valid;
  }

  function openDialog(): void {
    showDialog.value = true;
  }

  function closeDialog(): void {
    showDialog.value = false;
  }

  return {
    currentCashier,
    cashiers,
    showDialog,
    init,
    setCashier,
    addCashier,
    openDialog,
    closeDialog,
  };
});
