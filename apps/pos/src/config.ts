import { STORE_ADDRESS as CORE_STORE_ADDRESS, STORE_NAME as CORE_STORE_NAME, type Company } from "@yf/core";

// Shown before the database company list has loaded. See place.ts.
export const COMPANIES: Company[] = [
  { id: 1, name: CORE_STORE_NAME },
];
export const STORE_NAME = CORE_STORE_NAME;
export const STORE_ADDRESS = CORE_STORE_ADDRESS;
