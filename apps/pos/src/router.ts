import {
  createRouter,
  createWebHashHistory,
  createMemoryHistory,
  type RouteRecordRaw,
} from "vue-router";

export const routes: RouteRecordRaw[] = [
  { path: "/", name: "till", component: () => import("./views/TillView.vue") },
  { path: "/dashboard", redirect: "/report" },
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

// Hash history so the built SPA loads from file:// inside Electron.
export const router = createRouter({
  history: typeof window !== "undefined" ? createWebHashHistory() : createMemoryHistory(),
  routes,
});
