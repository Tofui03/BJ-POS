/**
 * @vitest-environment happy-dom
 */
import { nextTick, reactive, h, type App } from "vue";
import { createApp } from "vue";
import { createPinia } from "pinia";
import { afterEach, describe, expect, it, vi } from "vitest";
import PayDialog, { type PayCheckoutPayload } from "../src/components/PayDialog.vue";

const { contractors } = vi.hoisted(() => ({
  contractors: [] as Array<{
    id: number;
    companyId: number;
    name: string;
    phone: string;
    tin: string;
    address: string;
    active: boolean;
  }>,
}));

vi.mock("../src/db", () => ({
  getRepo: async () => ({
    listContractors: async () => contractors.filter((c) => c.active),
  }),
}));

let app: App | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  app?.unmount();
  host?.remove();
  app = null;
  host = null;
  contractors.splice(0, contractors.length);
});

function labels(): string[] {
  return [...document.querySelectorAll("button")].map((b) =>
    (b.textContent ?? "").replace(/\s+/g, " ").trim(),
  );
}

function clickButton(label: string): void {
  const btn = [...document.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").replace(/\s+/g, " ").trim() === label,
  );
  if (!btn) throw new Error(`no button "${label}"; have ${labels().join(" | ")}`);
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function mountPay() {
  const state = reactive({
    open: false,
    confirms: [] as Array<{ method: string; payload?: PayCheckoutPayload }>,
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  app = createApp({
    setup() {
      return () =>
        h(PayDialog, {
          open: state.open,
          linesSubtotalCents: 2400,
          grossSubtotalCents: 2400,
          totalDiscountCents: 0,
          billDiscountCents: 0,
          totalCents: 2400,
          onConfirm: (method: string, payload?: PayCheckoutPayload) => {
            const name = payload?.contractorName?.trim();
            if (payload?.saveAsContractor && name) {
              contractors.push({
                id: contractors.length + 1,
                companyId: 1,
                name,
                phone: payload.contractorPhone ?? "",
                tin: payload.contractorTin ?? "",
                address: payload.contractorAddress ?? "",
                active: true,
              });
            }
            state.confirms.push({ method, payload });
          },
        });
    },
  });
  app.use(createPinia());
  app.mount(host);
  return state;
}

describe("new contractor form", () => {
  it("closes the new-contractor form and selects the saved contractor", async () => {
    const state = mountPay();
    state.open = true;
    await nextTick();
    await vi.waitFor(() => expect(labels()).toContain("Contractor"));

    clickButton("Contractor");
    await vi.waitFor(() => expect(labels()).toContain("Name"));

    clickButton("Name");
    await nextTick();
    for (const key of ["A", "l", "i"]) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    }
    clickButton("OK");
    await vi.waitFor(() => expect(labels()).toContain("Ali"));
    expect(labels()).not.toContain("Change");

    clickButton("Credit");
    await nextTick();
    expect(state.confirms).toHaveLength(1);
    expect(state.confirms[0]!.method).toBe("Credit");
    expect(state.confirms[0]!.payload?.saveAsContractor).toBe(true);
    expect(state.confirms[0]!.payload?.contractorName).toBe("Ali");
    expect(contractors.map((c) => c.name)).toEqual(["Ali"]);

    state.open = false;
    await nextTick();
    state.open = true;
    await nextTick();
    await vi.waitFor(() => {
      expect(labels()).toContain("Change");
      expect(document.body.textContent).toContain("Ali");
    });
    expect(labels()).not.toContain("Name");

    clickButton("Credit");
    await nextTick();
    expect(state.confirms).toHaveLength(2);
    expect(state.confirms[1]!.payload).toMatchObject({
      contractorId: 1,
      contractorName: "Ali",
      saveAsContractor: false,
    });
  });
});
