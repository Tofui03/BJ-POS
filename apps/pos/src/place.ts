import { ref } from "vue";
import type { Company } from "@yf/core";
import { COMPANIES } from "./config";
import { getRepo } from "./db";

// Companies now live in the DB (companies table). We bootstrap from the config
// seed list (synchronous, so the UI renders immediately) and replace it with the
// DB rows once loaded. The selected company is persisted across reloads.
const KEY = "yf_company_id";

export const companies = ref<Company[]>([...COMPANIES]);

const savedId =
  typeof localStorage !== "undefined" ? Number(localStorage.getItem(KEY)) : 0;
const initial = companies.value.find((c) => c.id === savedId) ?? companies.value[0]!;
export const currentCompany = ref<Company>(initial);

export function setCompany(c: Company): void {
  currentCompany.value = c;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(KEY, String(c.id));
  }
}

/** Load the company list from the DB (call once at app start). */
export async function loadCompanies(): Promise<void> {
  const repo = await getRepo();
  const rows = await repo.listCompanies();
  if (!rows.length) return;
  companies.value = rows;
  currentCompany.value = rows.find((c) => c.id === currentCompany.value.id) ?? rows[0]!;
}
