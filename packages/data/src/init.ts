import {
  SCHEMA_SQL,
  SEED_ITEMS,
  LEGACY_SEED_ITEMS,
  SEED_COMPANIES,
  SEED_UNIT_TYPES,
  generateDemoOrders,
  localDateStr,
  type SeedItem,
} from "@yf/core";
import type { SqlDriver } from "./driver.js";
import { SqlPosRepo } from "./sql-repo.js";

/**
 * Add `column` to `table` if it isn't already present (idempotent migration).
 * Returns true only when the column was actually added this call, so callers can
 * run a one-time backfill on existing databases.
 */
async function ensureColumn(
  db: SqlDriver,
  table: string,
  column: string,
  ddl: string,
): Promise<boolean> {
  const cols = await db.all(`PRAGMA table_info(${table})`);
  if (cols.some((c) => String(c.name) === column)) return false;
  await db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  return true;
}

// The orders.method CHECK constraint is baked into the table and can't be
// ALTERed, so widening it (Online Bank -> Bank rename, and adding 'Credit') means
// rebuilding the table. Idempotent: only rebuilds when the stored DDL is stale.
async function migrateOrdersMethod(db: SqlDriver): Promise<void> {
  const rows = await db.all(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'",
  );
  const sql = String(rows[0]?.sql ?? "");
  const needsRename = sql.includes("Online Bank");
  const needsCredit = !sql.includes("'Credit'");
  if (!needsRename && !needsCredit) return;

  await db.run("PRAGMA foreign_keys = OFF");
  await db.tx(async () => {
    await db.run(`
      CREATE TABLE orders_new (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id  INTEGER NOT NULL DEFAULT 1,
        ts          INTEGER NOT NULL,
        total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
        method      TEXT    NOT NULL CHECK (method IN ('Cash','Bank','QR','Credit'))
      )
    `);
    await db.run(`
      INSERT INTO orders_new (id, company_id, ts, total_cents, method)
      SELECT id, company_id, ts, total_cents,
        CASE method WHEN 'Online Bank' THEN 'Bank' ELSE method END
      FROM orders
    `);
    await db.run("DROP TABLE orders");
    await db.run("ALTER TABLE orders_new RENAME TO orders");
    await db.run("CREATE INDEX IF NOT EXISTS idx_orders_ts ON orders(ts)");
    await db.run("CREATE INDEX IF NOT EXISTS idx_orders_company ON orders(company_id)");
  });
  await db.run("PRAGMA foreign_keys = ON");
}

/** True when `table` currently has a column named `column`. */
async function hasColumn(db: SqlDriver, table: string, column: string): Promise<boolean> {
  const cols = await db.all(`PRAGMA table_info(${table})`);
  return cols.some((c) => String(c.name) === column);
}

/**
 * Rebuild repayments table to support 'QR' payment method in CHECK constraint.
 * Idempotent: checks sqlite_master DDL and only rebuilds when 'QR' is missing.
 */
export async function migrateRepaymentsMethod(db: SqlDriver): Promise<void> {
  const rows = await db.all(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'repayments'",
  );
  if (rows.length === 0) return;
  const sql = String(rows[0]?.sql ?? "");
  const needsQR = sql.includes("CHECK (method IN ('Cash','Bank'))") || !sql.includes("'QR'");
  if (!needsQR) return;

  const hasCashier = await hasColumn(db, "repayments", "cashier_name");

  await db.run("PRAGMA foreign_keys = OFF");
  await db.tx(async () => {
    await db.run(`
      CREATE TABLE repayments_new (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id    INTEGER NOT NULL DEFAULT 1,
        credit_id     INTEGER NOT NULL REFERENCES credits(id) ON DELETE CASCADE,
        order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        contractor_id INTEGER REFERENCES contractors(id),
        amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
        method        TEXT    NOT NULL CHECK (method IN ('Cash','Bank','QR')),
        ts            INTEGER NOT NULL,
        business_date TEXT    NOT NULL,
        notes         TEXT${hasCashier ? ",\n        cashier_name  TEXT" : ""}
      )
    `);
    const cols = `id, company_id, credit_id, order_id, contractor_id, amount_cents, method, ts, business_date, notes${hasCashier ? ", cashier_name" : ""}`;
    await db.run(`
      INSERT INTO repayments_new (${cols})
      SELECT ${cols} FROM repayments
    `);
    await db.run("DROP TABLE repayments");
    await db.run("ALTER TABLE repayments_new RENAME TO repayments");
    await db.run("CREATE INDEX IF NOT EXISTS idx_repayments_bdate      ON repayments(business_date)");
    await db.run("CREATE INDEX IF NOT EXISTS idx_repayments_credit     ON repayments(credit_id)");
    await db.run("CREATE INDEX IF NOT EXISTS idx_repayments_company    ON repayments(company_id)");
    await db.run("CREATE INDEX IF NOT EXISTS idx_repayments_contractor ON repayments(contractor_id)");
    await db.run("CREATE INDEX IF NOT EXISTS idx_repayments_order      ON repayments(order_id)");
    await db.run("CREATE INDEX IF NOT EXISTS idx_repayments_date       ON repayments(business_date)");
  });
  await db.run("PRAGMA foreign_keys = ON");
}

/**
 * Slim `items` down to the current shape: the old `company_id` (items are one
 * shared catalogue now) and `tint` (derived from the name in the UI) columns
 * are dropped by rebuilding the table. Idempotent — only runs while a stale
 * column is present.
 */
async function migrateItemsSlim(db: SqlDriver): Promise<void> {
  if (!(await hasColumn(db, "items", "tint")) && !(await hasColumn(db, "items", "company_id"))) {
    return;
  }
  await db.run("PRAGMA foreign_keys = OFF");
  await db.tx(async () => {
    await db.run(`
      CREATE TABLE items_new (
        id     INTEGER PRIMARY KEY AUTOINCREMENT,
        key    TEXT    NOT NULL UNIQUE,
        name   TEXT    NOT NULL,
        image  TEXT    NOT NULL DEFAULT '',
        unit   TEXT    NOT NULL DEFAULT 'each',
        price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
        active INTEGER NOT NULL DEFAULT 1,
        tracks_tail INTEGER NOT NULL DEFAULT 0
      )
    `);
    await db.run(`
      INSERT INTO items_new (id, key, name, image, unit, price_cents, active, tracks_tail)
      SELECT id, key, name, image, unit, price_cents, active, tracks_tail FROM items
    `);
    await db.run("DROP TABLE items");
    await db.run("ALTER TABLE items_new RENAME TO items");
  });
  await db.run("PRAGMA foreign_keys = ON");
}

/**
 * Slim `order_items` down to sale facts only (item_id, price, qty, tail): the
 * per-line name/image/unit/tint snapshots and the stored bulk-tier columns are
 * dropped — display fields now come from joining `items`, and the tier
 * annotation is re-derived from `price_tiers` at read time. Legacy lines with a
 * NULL item_id are re-linked by matching their snapshotted name against the
 * catalogue; lines that still can't be linked are dropped (pre-release data
 * only). Idempotent — only runs while the old `name` column is present.
 */
async function migrateOrderItemsSlim(db: SqlDriver): Promise<void> {
  if (!(await hasColumn(db, "order_items", "name"))) return;
  await db.run("PRAGMA foreign_keys = OFF");
  await db.tx(async () => {
    await db.run(`
      CREATE TABLE order_items_new (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id  INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        item_id   INTEGER NOT NULL REFERENCES items(id),
        price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
        qty_milli   INTEGER NOT NULL CHECK (qty_milli > 0),
        tail_count  INTEGER NOT NULL DEFAULT 0 CHECK (tail_count >= 0)
      )
    `);
    await db.run(`
      INSERT INTO order_items_new (id, order_id, item_id, price_cents, qty_milli, tail_count)
      SELECT o.id, o.order_id,
             COALESCE(o.item_id, (SELECT i.id FROM items i WHERE i.name = o.name LIMIT 1)),
             o.price_cents, o.qty_milli, COALESCE(o.tail_count, 0)
      FROM order_items o
      WHERE COALESCE(o.item_id, (SELECT i.id FROM items i WHERE i.name = o.name LIMIT 1)) IS NOT NULL
    `);
    await db.run("DROP TABLE order_items");
    await db.run("ALTER TABLE order_items_new RENAME TO order_items");
    await db.run("CREATE INDEX IF NOT EXISTS idx_order_items_oid ON order_items(order_id)");
  });
  await db.run("PRAGMA foreign_keys = ON");
}

/**
 * Stamp orders saved before business days existed with the local calendar day
 * of their timestamp. Done in JS (not SQLite's 'localtime') because sql.js in
 * wasm has no reliable local timezone. Idempotent — only NULL rows are touched.
 */
async function backfillBusinessDates(db: SqlDriver): Promise<void> {
  const rows = await db.all("SELECT id, ts FROM orders WHERE business_date IS NULL");
  if (rows.length === 0) return;
  await db.tx(async () => {
    for (const r of rows) {
      await db.run("UPDATE orders SET business_date = ? WHERE id = ?", [
        localDateStr(Number(r.ts)),
        Number(r.id),
      ]);
    }
  });
}

export interface InitOptions {
  /** Seed plausible historical orders for the Sales report (dev/demo). */
  seedDemoOrders?: boolean;
  /** Deterministic RNG for demo orders (tests). */
  rng?: () => number;
  /** Injectable clock for demo orders (tests). */
  now?: Date;
  /** Override the initial catalogue seed items (e.g. in legacy unit tests). */
  seedItems?: SeedItem[];
}

/**
 * Create tables, seed the catalogue (idempotent on `key`), and optionally seed
 * demo orders. Returns a ready-to-use repo.
 */
export async function initRepo(db: SqlDriver, opts: InitOptions = {}): Promise<SqlPosRepo> {
  // Driver-agnostic: run each schema statement individually.
  for (const stmt of SCHEMA_SQL.split(";")) {
    const sql = stmt.trim();
    if (sql) await db.run(sql);
  }

  // Lightweight migration: CREATE TABLE IF NOT EXISTS won't add new columns to a
  // pre-existing DB, so backfill new columns on older local databases.
  const tracksTailAdded = await ensureColumn(db, "items", "tracks_tail", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn(db, "orders", "company_id", "INTEGER NOT NULL DEFAULT 1");
  await ensureColumn(db, "order_items", "tail_count", "INTEGER NOT NULL DEFAULT 0");
  // Table rebuilds: items first — the order_items rebuild re-links legacy lines
  // by item name, so the slimmed items table must already be in place.
  await migrateItemsSlim(db);
  await migrateOrderItemsSlim(db);
  await migrateOrdersMethod(db);
  await migrateRepaymentsMethod(db);
  // Business-day + void columns go on *after* the orders-table rebuild above so
  // a rebuild can never drop them.
  await ensureColumn(db, "orders", "business_date", "TEXT");
  await ensureColumn(db, "orders", "voided_at", "INTEGER");
  // Deliberately NOT backfilled: sales made before the update keep showing
  // their order id (receipts were already printed with it) — MM-1000 numbering
  // starts with the first sale after this column exists.
  await ensureColumn(db, "orders", "inv_no", "TEXT");
  await ensureColumn(db, "orders", "discount_cents", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn(db, "order_items", "orig_price_cents", "INTEGER");
  await ensureColumn(db, "order_items", "custom_name", "TEXT");
  await ensureColumn(db, "order_items", "unit", "TEXT");
  // Index created here (not in SCHEMA_SQL) — on an old DB the column only
  // exists after the ensureColumn above.
  await db.run("CREATE INDEX IF NOT EXISTS idx_orders_bdate ON orders(business_date)");
  await backfillBusinessDates(db);

  // Customer decoupling and DO metadata columns on orders table
  await ensureColumn(db, "orders", "customer_type", "TEXT DEFAULT 'walkin'");
  await ensureColumn(db, "orders", "contractor_id", "INTEGER REFERENCES contractors(id)");
  await ensureColumn(db, "orders", "contractor_name", "TEXT");
  await ensureColumn(db, "orders", "customer_tin", "TEXT");
  await ensureColumn(db, "orders", "customer_address", "TEXT");
  await ensureColumn(db, "orders", "customer_phone", "TEXT");
  await ensureColumn(db, "orders", "do_number", "TEXT");
  await ensureColumn(db, "orders", "do_no", "TEXT");
  await ensureColumn(db, "orders", "site_address", "TEXT");
  await ensureColumn(db, "orders", "lorry_plate", "TEXT");
  await ensureColumn(db, "orders", "driver_name", "TEXT");
  await ensureColumn(db, "orders", "contractor_po", "TEXT");
  await ensureColumn(db, "orders", "show_price_on_do", "INTEGER DEFAULT 1");
  await ensureColumn(db, "orders", "cashier_name", "TEXT");
  await ensureColumn(db, "orders", "voided_by", "TEXT");
  await ensureColumn(db, "repayments", "cashier_name", "TEXT");
  await ensureColumn(db, "day_closes", "closed_by", "TEXT");
  await db.run("CREATE INDEX IF NOT EXISTS idx_orders_contractor ON orders(contractor_id)");
  await db.run("CREATE INDEX IF NOT EXISTS idx_orders_dono ON orders(do_number)");

  // Backfill contractor_name on existing credit orders if missing
  await db.run(`
    UPDATE orders SET contractor_name = (
      SELECT name FROM credits WHERE credits.order_id = orders.id LIMIT 1
    ) WHERE contractor_name IS NULL AND method = 'Credit'
  `);
  // Sync do_number and do_no for compatibility
  await db.run(`
    UPDATE orders SET do_number = do_no WHERE do_number IS NULL AND do_no IS NOT NULL
  `);
  await db.run(`
    UPDATE orders SET do_no = do_number WHERE do_no IS NULL AND do_number IS NOT NULL
  `);

  // sort_order must go on *after* the items rebuild above (migrateItemsSlim
  // rebuilds items without it, so adding it any earlier would just have it
  // dropped again). Backfill preserves the current id-based order as the
  // starting sort order, only on the call that added the column.
  const sortOrderAdded = await ensureColumn(db, "items", "sort_order", "INTEGER NOT NULL DEFAULT 0");
  if (sortOrderAdded) await db.run("UPDATE items SET sort_order = id");

  // Optional stock tracking (also after the items rebuild, for the same reason).
  // NULL = untracked, so existing items keep selling without limit.
  await ensureColumn(db, "items", "stock_milli", "INTEGER");

  // Close Day delivery channel: Borneo Jasa v1 defaults to Google Drive upload.
  await ensureColumn(db, "outbox", "channel", "TEXT NOT NULL DEFAULT 'drive'");

  // Credit clearance and repayment columns on pre-existing databases
  const creditClearedAdded = await ensureColumn(db, "orders", "credit_cleared_at", "INTEGER");
  if (creditClearedAdded) {
    await db.run(`
      UPDATE orders SET credit_cleared_at = (
        SELECT is_clear FROM credits WHERE credits.order_id = orders.id AND credits.is_clear IS NOT NULL LIMIT 1
      ) WHERE credit_cleared_at IS NULL AND EXISTS (
        SELECT 1 FROM credits WHERE credits.order_id = orders.id AND credits.is_clear IS NOT NULL
      ) AND NOT EXISTS (
        SELECT 1 FROM credits WHERE credits.order_id = orders.id AND credits.is_clear IS NULL
      )
    `);
  }
  await ensureColumn(db, "credits", "cleared_method", "TEXT");
  await ensureColumn(db, "contractors", "tin", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, "contractors", "address", "TEXT NOT NULL DEFAULT ''");

  // Migrate distinct creditor names from historical credits into contractors directory
  await db.run(`
    INSERT OR IGNORE INTO contractors (company_id, name, phone, active)
    SELECT company_id, trim(name), '', 1
    FROM credits
    WHERE name IS NOT NULL AND trim(name) != ''
      AND NOT EXISTS (
        SELECT 1 FROM contractors c
        WHERE c.company_id = credits.company_id
          AND lower(trim(c.name)) = lower(trim(credits.name))
      )
    GROUP BY company_id, lower(trim(name))
  `);

  // When tracks_tail is first added to an existing DB, the seeded catalogue is
  // already there (so the seed block below won't run). Mark the items that ship
  // as tail-tracking (fish/chicken) once, by key — only on this first add, so a
  // later admin toggle is never clobbered.
  if (tracksTailAdded) {
    const keys = [...SEED_ITEMS, ...LEGACY_SEED_ITEMS].filter((s) => s.tracksTail).map((s) => s.key);
    if (keys.length) {
      const placeholders = keys.map(() => "?").join(",");
      await db.run(`UPDATE items SET tracks_tail = 1 WHERE key IN (${placeholders})`, keys);
    }
  }

  const repo = new SqlPosRepo(db);

  // Seed the lookup tables (idempotent).
  for (const name of SEED_COMPANIES) {
    await db.run("INSERT OR IGNORE INTO companies (name) VALUES (?)", [name]);
  }
  for (const name of SEED_UNIT_TYPES) {
    await db.run("INSERT OR IGNORE INTO unit_types (name) VALUES (?)", [name]);
  }

  const seedList = opts.seedItems ?? SEED_ITEMS;
  const existing = await db.all("SELECT COUNT(*) AS n FROM items");
  if (Number(existing[0]?.n ?? 0) === 0) {
    await db.tx(async () => {
      for (const s of seedList) {
        const item = await repo.createItem({
          key: s.key,
          name: s.name,
          image: s.image,
          unit: s.unit,
          priceCents: s.priceCents,
          tracksTail: s.tracksTail ?? false,
        });
        if (s.tiers?.length) await repo.setTiers(item.id, s.tiers);
      }
    });
  }

  if (opts.seedDemoOrders) {
    const haveOrders = await db.all("SELECT COUNT(*) AS n FROM orders");
    if (Number(haveOrders[0]?.n ?? 0) === 0) {
      const items = await repo.listItems(true);
      const drafts = generateDemoOrders(items, opts.now ?? new Date(), opts.rng ?? Math.random);
      for (const d of drafts) await repo.persistOrder(d);
    }
  }

  return repo;
}
