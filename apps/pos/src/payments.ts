import type { PaymentMethod } from "@yf/core";
import { PAY_LABEL } from "./labels";

/** Per-method presentation — words only (no emoji). Colour stays off chrome. */
export const PAYMENT_UI: Record<
  PaymentMethod,
  { label: string; icon: string; color: string; tint: string }
> = new Proxy(
  {} as Record<PaymentMethod, { label: string; icon: string; color: string; tint: string }>,
  {
    get(_target, prop: PaymentMethod) {
      if (prop === "Cash") return { label: PAY_LABEL.Cash, icon: "", color: "#0a0a0a", tint: "#eeeeee" };
      if (prop === "Bank") return { label: PAY_LABEL.Bank, icon: "", color: "#0a0a0a", tint: "#eeeeee" };
      if (prop === "QR") return { label: PAY_LABEL.QR, icon: "", color: "#0a0a0a", tint: "#eeeeee" };
      if (prop === "Credit") return { label: PAY_LABEL.Credit, icon: "", color: "#0a0a0a", tint: "#eeeeee" };
      return { label: String(prop), icon: "", color: "#0a0a0a", tint: "#eeeeee" };
    },
    has(_target, prop) {
      return prop === "Cash" || prop === "Bank" || prop === "QR" || prop === "Credit";
    },
    ownKeys() {
      return ["Cash", "Bank", "QR", "Credit"];
    },
    getOwnPropertyDescriptor(_target, prop) {
      return {
        enumerable: true,
        configurable: true,
        value: (PAYMENT_UI as any)[prop],
      };
    },
  }
);
