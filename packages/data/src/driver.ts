// The thin SQL surface every storage backend must provide. Keep it async so a
// single SqlPosRepo can run on sql.js (sync, wrapped), tauri-plugin-sql (async)
// or node:sqlite (sync, wrapped) without change.

export type SqlValue = string | number | null;
export type Row = Record<string, SqlValue>;

export interface SqlDriver {
  /** Run a SELECT, return rows as plain objects. */
  all(sql: string, params?: SqlValue[]): Promise<Row[]>;
  /**
   * Run a statement and return rows as positional value arrays (column order),
   * the shape Drizzle's sqlite-proxy maps from. Also used for write-returning
   * statements (e.g. `INSERT ... RETURNING`), which is why it must persist too.
   */
  values(sql: string, params?: SqlValue[]): Promise<SqlValue[][]>;
  /** Run a write; return the new rowid (0 if none). */
  run(sql: string, params?: SqlValue[]): Promise<{ lastInsertRowid: number }>;
  /** Run `fn` inside a BEGIN/COMMIT (ROLLBACK on throw). */
  tx<T>(fn: () => Promise<T>): Promise<T>;
}
