import { contextBridge, ipcRenderer } from "electron";

// Minimal SQL bridge exposed to the renderer (contextIsolation on). Mirrors the
// SqlDriver surface; see src/ipc-driver.ts.
contextBridge.exposeInMainWorld("sqlite", {
  all: (sql: string, params?: unknown[]) => ipcRenderer.invoke("db:all", sql, params),
  values: (sql: string, params?: unknown[]) => ipcRenderer.invoke("db:values", sql, params),
  run: (sql: string, params?: unknown[]) => ipcRenderer.invoke("db:run", sql, params),
  meta: () => ipcRenderer.invoke("db:meta"),
  reset: () => ipcRenderer.invoke("db:reset"),
});

// Product image library stored on disk (importable from a USB drive).
contextBridge.exposeInMainWorld("images", {
  list: () => ipcRenderer.invoke("images:list"),
  import: () => ipcRenderer.invoke("images:import"),
});

// Silent printing to the configured (or default) printer (no dialog).
contextBridge.exposeInMainWorld("printing", {
  listPrinters: () => ipcRenderer.invoke("print:printers"),
  printHtml: (html: string, deviceName?: string) => ipcRenderer.invoke("print:html", html, deviceName),
});

// Outbox delivery — Google Drive. Legacy email rows are not sent.

contextBridge.exposeInMainWorld("drive", {
  process: () => ipcRenderer.invoke("drive:process"),
  config: () => ipcRenderer.invoke("drive:config"),
});

contextBridge.exposeInMainWorld("appUpdate", {
  check: () => ipcRenderer.invoke("app:checkUpdate"),
  openUrl: (url: string) => ipcRenderer.invoke("app:openExternal", url),
  quit: () => ipcRenderer.invoke("app:quit"),
});
