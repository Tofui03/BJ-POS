/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}

declare module "*.wasm?url" {
  const url: string;
  export default url;
}

declare module "virtual:uno.css";

declare module "sql.js/dist/sql-wasm.js" {
  export { default } from "sql.js";
}
