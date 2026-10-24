import type { Row, SqlDriver, SqlValue } from "@yf/data";

// The on-disk SQLite (better-sqlite3) lives in Electron's main process; this
// SqlDriver forwards each statement over IPC (see electron/preload.ts +
// electron/main.ts). No persistence hook is needed — the .sqlite file *is* the
// storage. Drizzle/repo code above this is identical to the browser build.

export interface SqliteBridge {
  all(sql: string, params?: SqlValue[]): Promise<Row[]>;
  values(sql: string, params?: SqlValue[]): Promise<SqlValue[][]>;
  run(sql: string, params?: SqlValue[]): Promise<{ lastInsertRowid: number }>;
  meta(): Promise<{ fresh: boolean }>;
  reset(): Promise<boolean>;
}

/** On-disk product image library (Electron only). */
export interface ImagesBridge {
  list(): Promise<{ name: string; dataUrl: string }[]>;
  /** Open a file dialog to copy images in; returns the full updated list. */
  import(): Promise<{ name: string; dataUrl: string }[]>;
}

/** Silent printing via the Electron main process. */
export interface PrintingBridge {
  printHtml(html: string): Promise<{ ok: boolean; error?: string }>;
}

/** Outbox processor in the Electron main process (Drive + legacy email). */
export interface MailerBridge {
  /** Try to deliver every unsent outbox row now; returns what happened. */
  process(): Promise<{ sent: number; pending: number; lastError: string | null }>;
  /** Sender credentials status — SMTP_USER/SMTP_PASS come from .env on the till. */
  config?(): Promise<{ hasCredentials: boolean; user: string | null }>;
}

/** Google Drive Close Day upload (Borneo Jasa v1). */
export interface DriveBridge {
  process(): Promise<{ sent: number; pending: number; lastError: string | null }>;
  config?(): Promise<{ configured: boolean; folderId: string | null }>;
}

declare global {
  interface Window {
    sqlite?: SqliteBridge;
    images?: ImagesBridge;
    printing?: PrintingBridge;
    mailer?: MailerBridge;
    drive?: DriveBridge;
  }
}

export interface ScopedSqlDriver extends SqlDriver {
  tx<T>(fn: (scopedDriver?: ScopedSqlDriver) => Promise<T>): Promise<T>;
}

export function createIpcDriver(bridge: SqliteBridge): ScopedSqlDriver {
  // Mutex queue: serializes top-level transactions so concurrent async writes
  // (e.g. background day closing vs cashier order placement) never interleave
  // SQL statements or share a single BEGIN/COMMIT/ROLLBACK lifecycle.
  let txQueue = Promise.resolve();

  const run = (sql: string, params: SqlValue[] = []) => bridge.run(sql, params);

  const createScopedDriver = (depthRef: { current: number }): ScopedSqlDriver => {
    return {
      all: (sql, params = []) => bridge.all(sql, params),
      values: (sql, params = []) => bridge.values(sql, params),
      run,
      tx: async <T>(fn: (nestedDriver?: ScopedSqlDriver) => Promise<T>): Promise<T> => {
        // Reentrant call within the same active transaction scope: execute directly
        depthRef.current++;
        try {
          return await fn(createScopedDriver(depthRef));
        } finally {
          depthRef.current--;
        }
      },
    };
  };

  const tx = <T>(fn: (scopedDriver?: ScopedSqlDriver) => Promise<T>): Promise<T> => {
    const runExclusive = async () => {
      await run("BEGIN");
      const depthRef = { current: 1 };
      const scopedDriver = createScopedDriver(depthRef);
      try {
        const result = await fn(scopedDriver);
        await run("COMMIT");
        return result;
      } catch (e) {
        try {
          await run("ROLLBACK");
        } catch (rollbackErr) {
          console.error("IPC transaction ROLLBACK failed:", rollbackErr);
        }
        throw e;
      }
    };

    const next = txQueue.then(runExclusive, runExclusive);
    txQueue = next.then(() => {}, () => {});
    return next;
  };

  return {
    all: (sql, params = []) => bridge.all(sql, params),
    values: (sql, params = []) => bridge.values(sql, params),
    run,
    tx,
  };
}
