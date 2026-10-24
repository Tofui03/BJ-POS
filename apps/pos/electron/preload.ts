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

// Silent printing to the default printer (no dialog).
contextBridge.exposeInMainWorld("printing", {
  printHtml: (html: string) => ipcRenderer.invoke("print:html", html),
});

// Outbox delivery — Drive (Borneo Jasa v1) and legacy email share one processor.
contextBridge.exposeInMainWorld("mailer", {
  process: () => ipcRenderer.invoke("mailer:process"),
  config: () => ipcRenderer.invoke("mailer:config"),
});

contextBridge.exposeInMainWorld("drive", {
  process: () => ipcRenderer.invoke("drive:process"),
  config: () => ipcRenderer.invoke("drive:config"),
});
