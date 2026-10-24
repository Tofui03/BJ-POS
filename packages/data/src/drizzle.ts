import { drizzle } from "drizzle-orm/sqlite-proxy";
import type { SqlDriver, SqlValue } from "./driver.js";
import * as schema from "./schema.js";

// Drizzle on top of the existing SqlDriver via sqlite-proxy: Drizzle builds the
// SQL, the driver executes it (keeping its persistence + transaction logic). The
// same code runs on sql.js today and on tauri-plugin-sql / node:sqlite later —
// only the SqlDriver passed in changes.
//
// sqlite-proxy expects rows as positional value arrays: `values()` for selects
// and write-returning statements, `run()` for plain writes. Atomic multi-step
// work still uses driver.tx() (sqlite-proxy has no interactive transactions).

export function makeDrizzle(driver: SqlDriver) {
  return drizzle(
    async (sql, params, method) => {
      if (method === "run") {
        await driver.run(sql, params as SqlValue[]);
        return { rows: [] };
      }
      const rows = await driver.values(sql, params as SqlValue[]);
      // 'get' wants a single row's values; 'all'/'values' want all rows.
      return { rows: method === "get" ? (rows[0] ?? []) : rows };
    },
    { schema },
  );
}

export type DrizzleDb = ReturnType<typeof makeDrizzle>;
