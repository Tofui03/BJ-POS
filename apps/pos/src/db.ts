// Pin the classic UMD build: sql.js 1.14's "browser" export
// (sql-wasm-browser.js) has a different API and no ESM default export.
import initSqlJs from "sql.js/dist/sql-wasm.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { get, set } from "idb-keyval";
import { createSqlJsDriver, initRepo, type SqlPosRepo } from "@yf/data";
import { createIpcDriver } from "./ipc-driver";

// Data layer, two backends behind one repo:
//  - Electron: on-disk SQLite (better-sqlite3) in the main process, reached over
//    IPC (window.sqlite). Real file = the persistence; low memory.
//  - Browser dev: sql.js (SQLite-in-wasm) snapshotted to IndexedDB.
// Nothing above this module (repo, stores, UI) changes between the two.

const DB_KEY = "borneo-jasa-pos-db-v1";

let repoPromise: Promise<SqlPosRepo> | null = null;

export function getRepo(): Promise<SqlPosRepo> {
  repoPromise ??= boot();
  return repoPromise;
}

async function boot(): Promise<SqlPosRepo> {
  // Electron: the native on-disk DB lives in the main process. Production starts
  // empty — only the seeded catalogue, no demo orders.
  if (typeof window !== "undefined" && window.sqlite) {
    const driver = createIpcDriver(window.sqlite);
    return initRepo(driver, { seedDemoOrders: false });
  }
  const SQL = await initSqlJs(typeof window !== "undefined" ? { locateFile: () => wasmUrl } : undefined);
  const saved = typeof indexedDB !== "undefined" ? await get<Uint8Array>(DB_KEY) : null;
  // A corrupt or partially-exported snapshot must not brick the app: if it won't
  // open, drop it and start fresh rather than letting boot() reject.
  let db: InstanceType<typeof SQL.Database>;
  try {
    db = saved ? new SQL.Database(saved) : new SQL.Database();
  } catch (err) {
    console.warn("Discarding unreadable local DB snapshot — starting fresh.", err);
    db = new SQL.Database();
  }

  // Debounced persistence — export the whole DB after writes settle.
  let timer: ReturnType<typeof setTimeout> | null = null;
  const persist = () => {
    if (typeof indexedDB === "undefined") return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void set(DB_KEY, db.export()), 200);
  };

  const driver = createSqlJsDriver(db as never, { afterWrite: persist });
  // Browser dev convenience: seed demo orders whenever the Sales report would be
  // empty (initRepo only seeds when the orders table has no rows), so a stale or
  // empty snapshot from an earlier run still shows data. Production (Electron,
  // above) stays empty.
  return initRepo(driver, { seedDemoOrders: true });
}

/** Wipe the local DB (used by the admin "reset demo data" action). */
export async function resetDb(): Promise<void> {
  if (typeof window !== "undefined" && window.sqlite) {
    await window.sqlite.reset();
    repoPromise = null;
    return;
  }
  if (typeof indexedDB !== "undefined") {
    await set(DB_KEY, undefined as unknown as Uint8Array);
  }
  repoPromise = null;
}
