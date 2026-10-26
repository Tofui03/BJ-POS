import type { Unit } from "./types.js";
import { HARDWARE_SEED_ITEMS, STORE_NAME } from "./hardware-catalog.js";

// One source of truth for the DB shape + initial catalogue, shared by every
// PosRepo implementation. Mirrors the original backend, plus `price_tiers`.

/** Column list for `orders`, shared by SCHEMA_SQL and table rebuilds in init. */
export const ORDERS_COLUMNS_SQL = `
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER NOT NULL DEFAULT 1,
  ts                INTEGER NOT NULL,
  business_date     TEXT,
  inv_no            TEXT,
  customer_type     TEXT    DEFAULT 'walkin',
  contractor_id     INTEGER REFERENCES contractors(id),
  contractor_name   TEXT,
  customer_tin      TEXT,
  customer_address  TEXT,
  customer_phone    TEXT,
  do_number         TEXT,
  site_address      TEXT,
  lorry_plate       TEXT,
  driver_name       TEXT,
  contractor_po     TEXT,
  show_price_on_do  INTEGER DEFAULT 1,
  discount_cents    INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  total_cents       INTEGER NOT NULL CHECK (total_cents >= 0 OR refund_of_order_id IS NOT NULL),
  refund_of_order_id INTEGER REFERENCES orders(id),
  method            TEXT    NOT NULL CHECK (method IN ('Cash','Card','QR','Bank','Credit')),
  cashier_name      TEXT,
  note              TEXT,
  voided_at         INTEGER,
  voided_by         TEXT,
  credit_cleared_at INTEGER,
  client_request_id TEXT
`.trim();

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS companies (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT    NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS unit_types (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT    NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS items (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  key    TEXT    NOT NULL UNIQUE,
  name   TEXT    NOT NULL,
  image  TEXT    NOT NULL DEFAULT '',
  unit   TEXT    NOT NULL DEFAULT 'each',
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  tracks_tail INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  stock_milli INTEGER
);

CREATE TABLE IF NOT EXISTS price_tiers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id       INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  min_qty_milli INTEGER NOT NULL CHECK (min_qty_milli > 0),
  price_cents   INTEGER NOT NULL CHECK (price_cents >= 0)
);

CREATE TABLE IF NOT EXISTS orders (
${ORDERS_COLUMNS_SQL}
);

CREATE TABLE IF NOT EXISTS day_closes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL DEFAULT 1,
  business_date TEXT    NOT NULL,
  closed_at     INTEGER NOT NULL,
  auto          INTEGER NOT NULL DEFAULT 0,
  closed_by     TEXT,
  UNIQUE (company_id, business_date)
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL DEFAULT 1,
  business_date   TEXT    NOT NULL,
  subject         TEXT    NOT NULL,
  body            TEXT    NOT NULL,
  attachment_name TEXT,
  attachment_b64  TEXT,
  channel         TEXT    NOT NULL DEFAULT 'drive',
  created_at      INTEGER NOT NULL,
  sent_at         INTEGER,
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT
);

CREATE TABLE IF NOT EXISTS contractors (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL DEFAULT 1,
  name       TEXT    NOT NULL COLLATE NOCASE,
  phone      TEXT    NOT NULL DEFAULT '',
  tin        TEXT    NOT NULL DEFAULT '',
  address    TEXT    NOT NULL DEFAULT '',
  active     INTEGER NOT NULL DEFAULT 1,
  UNIQUE (company_id, name)
);

CREATE TABLE IF NOT EXISTS credits (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL DEFAULT 1,
  order_id       INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  name           TEXT    NOT NULL,
  amount_cents   INTEGER NOT NULL CHECK (amount_cents >= 0),
  date           INTEGER NOT NULL,
  is_clear       INTEGER,
  cleared_method TEXT
);

CREATE TABLE IF NOT EXISTS repayments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL DEFAULT 1,
  credit_id     INTEGER NOT NULL REFERENCES credits(id) ON DELETE CASCADE,
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  contractor_id INTEGER REFERENCES contractors(id),
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  method        TEXT    NOT NULL CHECK (method IN ('Cash','Card','QR','Bank')),
  ts            INTEGER NOT NULL,
  business_date TEXT    NOT NULL,
  notes         TEXT,
  cashier_name  TEXT
);

CREATE TABLE IF NOT EXISTS order_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id          INTEGER NOT NULL REFERENCES items(id),
  price_cents      INTEGER NOT NULL CHECK (price_cents >= 0),
  orig_price_cents INTEGER,
  custom_name      TEXT,
  unit             TEXT,
  qty_milli        INTEGER NOT NULL CHECK (qty_milli > 0),
  tail_count       INTEGER NOT NULL DEFAULT 0 CHECK (tail_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_orders_ts           ON orders(ts);
CREATE INDEX IF NOT EXISTS idx_outbox_unsent        ON outbox(sent_at);
CREATE INDEX IF NOT EXISTS idx_orders_company       ON orders(company_id);
CREATE INDEX IF NOT EXISTS idx_order_items_oid     ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_price_tiers_iid     ON price_tiers(item_id);
CREATE INDEX IF NOT EXISTS idx_credits_company     ON credits(company_id);
CREATE INDEX IF NOT EXISTS idx_credits_open        ON credits(company_id, is_clear);
CREATE INDEX IF NOT EXISTS idx_contractors_company ON contractors(company_id);
CREATE INDEX IF NOT EXISTS idx_contractors_active  ON contractors(company_id, active);
CREATE INDEX IF NOT EXISTS idx_repayments_bdate    ON repayments(business_date);
CREATE INDEX IF NOT EXISTS idx_repayments_credit   ON repayments(credit_id);
CREATE INDEX IF NOT EXISTS idx_repayments_company  ON repayments(company_id);
`;

// Companies/tenants seeded into the companies lookup (ids 1..N in order).
export const SEED_COMPANIES = [STORE_NAME];

// Units of sale seeded into the unit_types lookup.
export const SEED_UNIT_TYPES: Unit[] = [
  "pcs",
  "batang",
  "unit",
  "bag",
  "bundle",
  "roll",
  "ft",
  "kg",
  "meter",
  "box",
  "pack",
  "pieces",
  "bottle",
  "cup",
  "each",
];

export interface SeedItem {
  key: string;
  name: string;
  unit: Unit;
  priceCents: number;
  image: string;
  /** sold by the head — capture a tail/"ekor" count alongside weight */
  tracksTail?: boolean;
  /** optional quantity breaks */
  tiers?: Array<{ minQtyMilli: number; priceCents: number }>;
}

// Legacy farm/fish seed items kept for backward-compatible unit tests.
export const LEGACY_SEED_ITEMS: SeedItem[] = [
  // Ikan Tilapia: RM25/kg, wholesale break >= 10 kg -> RM23/kg.
  { key: "tilapia", name: "Ikan Tilapia", unit: "kg", priceCents: 2500, image: "/images/talapia", tracksTail: true, tiers: [{ minQtyMilli: 10000, priceCents: 2300 }] },
  { key: "ayam", name: "Ayam", unit: "kg", priceCents: 3000, image: "", tracksTail: true },
  { key: "fresh_milk_500", name: "Fresh Milk 500 ml", unit: "bottle", priceCents: 0, image: "/images/milk" }, // TODO price
  { key: "fresh_milk_1l", name: "Fresh Milk 1 L", unit: "bottle", priceCents: 680, image: "/images/milk" },
  { key: "uht_200ml", name: "UHT 200 ml", unit: "pack", priceCents: 200, image: "" },
  { key: "nangka_box", name: "Nangka (Box)", unit: "box", priceCents: 600, image: "/images/nangka" },
  { key: "nangka_kg", name: "Nangka (kg)", unit: "kg", priceCents: 400, image: "/images/nangka" },
  { key: "avocado", name: "Avocado", unit: "kg", priceCents: 0, image: "/images/avocado" }, // TODO price
  { key: "sayur", name: "Sayur", unit: "kg", priceCents: 0, image: "" }, // TODO price
  { key: "durian_paste", name: "Durian Paste", unit: "kg", priceCents: 4000, image: "/images/durian" },
];

// Client catalogue (Borneo Jasa Sdn. Bhd. — 253 hardware store items).
export const SEED_ITEMS: SeedItem[] = HARDWARE_SEED_ITEMS;
