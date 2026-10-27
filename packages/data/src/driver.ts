// The SQL surface every storage backend must provide. It stays async so one
// SqlPosRepo can run on sql.js (browser, sync work wrapped) and on
// better-sqlite3 over Electron IPC.

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
