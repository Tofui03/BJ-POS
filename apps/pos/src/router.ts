import {
  createRouter,
  createWebHashHistory,
  createMemoryHistory,
  type RouteRecordRaw,
} from "vue-router";

export const routes: RouteRecordRaw[] = [
  { path: "/", name: "till", component: () => import("./views/TillView.vue") },
  { path: "/dashboard", name: "sales", component: () => import("./views/SalesView.vue") },
  {
    path: "/item",
    name: "admin",
    component: () => import("./views/AdminView.vue"),
    props: { section: "items" },
  },
  {
    path: "/contractors",
    name: "contractors",
    component: () => import("./views/AdminView.vue"),
    props: { section: "contractors" },
  },
  { path: "/report", name: "report", component: () => import("./views/ReportView.vue") },
];

// Hash history so the SPA works from file:// once wrapped (Tauri/Electron).
export const router = createRouter({
  history: typeof window !== "undefined" ? createWebHashHistory() : createMemoryHistory(),
  routes,
});
