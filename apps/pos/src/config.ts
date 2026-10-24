// Store-level presentation knobs (parity with the original PROPS).
export const SHOW_MONTH_CHART = true;

// Bootstrap company list (mirrors the seeded `companies` table). Used
// for the first synchronous render before the DB list loads — see place.ts.
import { STORE_ADDRESS as CORE_STORE_ADDRESS, STORE_NAME as CORE_STORE_NAME, type Company } from "@yf/core";
export const COMPANIES: Company[] = [
  { id: 1, name: CORE_STORE_NAME },
];
export const STORE_NAME = CORE_STORE_NAME;
export const STORE_ADDRESS = CORE_STORE_ADDRESS;
