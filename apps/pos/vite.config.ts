import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import unocss from "unocss/vite";

export default defineConfig({
  plugins: [unocss(), vue()],
  // Pre-bundle the classic sql.js UMD so it gets a clean ESM default export.
  // The .wasm is loaded separately via ?url + locateFile (see db.ts).
  optimizeDeps: { include: ["sql.js/dist/sql-wasm.js"] },
  // Relative base so the built SPA works when wrapped (Electron file://).
  base: "./",
});
