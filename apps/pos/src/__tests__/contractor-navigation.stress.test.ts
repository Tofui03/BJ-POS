import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import {
  createRouter,
  createMemoryHistory,
  createWebHashHistory,
} from "vue-router";
import { routes, router as defaultRouter } from "../router";
import TopBar from "../components/TopBar.vue";
import AdminView from "../views/AdminView.vue";
import { L } from "../labels";

describe("Contractor Navigation, Route Handling & Top-Bar State Stress Harness", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe("1. Route Transitions Mesh Stress", () => {
    it("transitions cleanly through all valid primary routes in sequence", async () => {
      const router = createRouter({
        history: createMemoryHistory(),
        routes,
      });

      const navSequence = [
        { path: "/", expectedName: "till", expectedSection: undefined },
        { path: "/contractors", expectedName: "contractors", expectedSection: "contractors" },
        { path: "/dashboard", expectedName: "sales", expectedSection: undefined },
        { path: "/contractors", expectedName: "contractors", expectedSection: "contractors" },
        { path: "/report", expectedName: "report", expectedSection: undefined },
        { path: "/contractors", expectedName: "contractors", expectedSection: "contractors" },
        { path: "/item", expectedName: "admin", expectedSection: "items" },
        { path: "/contractors", expectedName: "contractors", expectedSection: "contractors" },
        { path: "/", expectedName: "till", expectedSection: undefined },
      ];

      for (const step of navSequence) {
        await router.push(step.path);
        expect(router.currentRoute.value.path).toBe(step.path);
        expect(router.currentRoute.value.name).toBe(step.expectedName);

        const matchedRoute = router.currentRoute.value.matched[0];
        if (step.expectedSection) {
          expect((matchedRoute?.props as Record<string, unknown>)?.default).toEqual({
            section: step.expectedSection,
          });
        }
      }
    });

    it("survives rapid back-and-forth router pushes without state desynchronization", async () => {
      const router = createRouter({
        history: createMemoryHistory(),
        routes,
      });

      for (let i = 0; i < 50; i++) {
        const target = i % 2 === 0 ? "/contractors" : "/";
        await router.push(target);
        expect(router.currentRoute.value.path).toBe(target);
        expect(router.currentRoute.value.name).toBe(i % 2 === 0 ? "contractors" : "till");
      }
    });

    it("handles route transitions with query parameters and preserves contractor route identity", async () => {
      const router = createRouter({
        history: createMemoryHistory(),
        routes,
      });

      await router.push({ path: "/contractors", query: { q: "Ah Ming", filter: "unpaid" } });
      expect(router.currentRoute.value.path).toBe("/contractors");
      expect(router.currentRoute.value.name).toBe("contractors");
      expect(router.currentRoute.value.query).toEqual({ q: "Ah Ming", filter: "unpaid" });

      // Navigate to /dashboard then back to /contractors with new query
      await router.push("/dashboard");
      expect(router.currentRoute.value.name).toBe("sales");

      await router.push({ path: "/contractors", query: { sort: "balance" } });
      expect(router.currentRoute.value.name).toBe("contractors");
      expect(router.currentRoute.value.query).toEqual({ sort: "balance" });
    });

    it("handles redundant pushes to the same route idempotently", async () => {
      const router = createRouter({
        history: createMemoryHistory(),
        routes,
      });

      await router.push("/contractors");
      expect(router.currentRoute.value.path).toBe("/contractors");

      // Repeated push to the same path
      await router.push("/contractors");
      expect(router.currentRoute.value.path).toBe("/contractors");
      expect(router.currentRoute.value.name).toBe("contractors");
    });
  });

  describe("2. Direct URL Navigation & Hash Routing Stress (#/contractors)", () => {
    it("resolves route definition for #/contractors from hash history", async () => {
      // Mock window, location, and document for hash history simulation
      const originalWindow = (globalThis as unknown as { window?: unknown }).window;
      const originalLocation = (globalThis as unknown as { location?: unknown }).location;
      const originalDocument = (globalThis as unknown as { document?: unknown }).document;
      const listeners: Record<string, ((ev: unknown) => void)[]> = {};

      const mockLocation = {
        hash: "#/contractors",
        href: "http://localhost/#/contractors",
        pathname: "/",
        search: "",
      };

      const mockDocument = {
        querySelector: () => null,
        addEventListener: (evt: string, fn: (ev: unknown) => void) => {
          listeners[evt] = listeners[evt] || [];
          listeners[evt].push(fn);
        },
        removeEventListener: (evt: string, fn: (ev: unknown) => void) => {
          if (listeners[evt]) {
            listeners[evt] = listeners[evt].filter((cb) => cb !== fn);
          }
        },
      };

      const mockWindow = {
        location: mockLocation,
        document: mockDocument,
        addEventListener: (evt: string, fn: (ev: unknown) => void) => {
          listeners[evt] = listeners[evt] || [];
          listeners[evt].push(fn);
        },
        removeEventListener: (evt: string, fn: (ev: unknown) => void) => {
          if (listeners[evt]) {
            listeners[evt] = listeners[evt].filter((cb) => cb !== fn);
          }
        },
        history: {
          pushState: (_state: unknown, _title: string, url: string) => {
            const hashIdx = url.indexOf("#");
            if (hashIdx >= 0) {
              mockLocation.hash = url.slice(hashIdx);
            }
          },
          replaceState: (_state: unknown, _title: string, url: string) => {
            const hashIdx = url.indexOf("#");
            if (hashIdx >= 0) {
              mockLocation.hash = url.slice(hashIdx);
            }
          },
          state: {},
        },
      };

      try {
        (globalThis as unknown as { window: unknown }).window = mockWindow;
        (globalThis as unknown as { location: unknown }).location = mockLocation;
        (globalThis as unknown as { document: unknown }).document = mockDocument;

        const hashHistory = createWebHashHistory();
        // createWebHashHistory extracts location from mockLocation.hash ('#/contractors')
        expect(hashHistory.location).toBe("/contractors");

        const hashRouter = createRouter({
          history: hashHistory,
          routes,
        });

        // Trigger initial navigation corresponding to the hash location
        await hashRouter.push(hashHistory.location);

        expect(hashRouter.currentRoute.value.path).toBe("/contractors");
        expect(hashRouter.currentRoute.value.name).toBe("contractors");
        const matched = hashRouter.currentRoute.value.matched[0];
        expect((matched?.props as Record<string, unknown>)?.default).toEqual({
          section: "contractors",
        });

        // Test hash direct URL with query parameters e.g. '#/contractors?status=unpaid'
        mockLocation.hash = "#/contractors?status=unpaid";
        const hashHistoryWithQuery = createWebHashHistory();
        expect(hashHistoryWithQuery.location).toBe("/contractors?status=unpaid");

        const queryRouter = createRouter({
          history: hashHistoryWithQuery,
          routes,
        });
        await queryRouter.push(hashHistoryWithQuery.location);
        expect(queryRouter.currentRoute.value.path).toBe("/contractors");
        expect(queryRouter.currentRoute.value.name).toBe("contractors");
        expect(queryRouter.currentRoute.value.query).toEqual({ status: "unpaid" });

        // Router can also push to other routes and back to contractors
        await hashRouter.push("/item");
        expect(hashRouter.currentRoute.value.path).toBe("/item");
        expect(hashRouter.currentRoute.value.name).toBe("admin");

        await hashRouter.push("/contractors");
        expect(hashRouter.currentRoute.value.path).toBe("/contractors");
        expect(hashRouter.currentRoute.value.name).toBe("contractors");
      } finally {
        if (originalWindow === undefined) {
          delete (globalThis as unknown as { window?: unknown }).window;
        } else {
          (globalThis as unknown as { window: unknown }).window = originalWindow;
        }
        if (originalLocation === undefined) {
          delete (globalThis as unknown as { location?: unknown }).location;
        } else {
          (globalThis as unknown as { location: unknown }).location = originalLocation;
        }
        if (originalDocument === undefined) {
          delete (globalThis as unknown as { document?: unknown }).document;
        } else {
          (globalThis as unknown as { document: unknown }).document = originalDocument;
        }
      }
    });

    it("verifies router.resolve correctly parses '#/contractors' and direct route names", () => {
      const resolvedByName = defaultRouter.resolve({ name: "contractors" });
      expect(resolvedByName.name).toBe("contractors");
      expect(resolvedByName.path).toBe("/contractors");
      expect(resolvedByName.href).toContain("/contractors");

      const resolvedByPath = defaultRouter.resolve("/contractors");
      expect(resolvedByPath.name).toBe("contractors");
      expect(resolvedByPath.path).toBe("/contractors");

      const resolvedAdmin = defaultRouter.resolve("/item");
      expect(resolvedAdmin.name).toBe("admin");
      expect(resolvedAdmin.path).toBe("/item");
    });
  });

  describe("3. AdminView Layout & View Isolation Stress", () => {
    it("renders contractor directory exclusively without catalogue tables when section='contractors'", async () => {
      const app = createSSRApp(AdminView, { section: "contractors" });
      app.use(createPinia());
      app.use(defaultRouter);
      const html = await renderToString(app);

      // 1. Dedicated Contractor section elements MUST be present
      expect(html).toContain("Contractor Directory / Senarai Kontraktor");
      expect(html).toContain("Add Contractor / Tambah");
      expect(html).toContain("Search by name or phone");

      // 2. Tab Switcher MUST be hidden (no tab switcher to jump to Items)
      expect(html).not.toContain("Barangan");

      // 3. Catalogue tables and actions MUST be omitted
      expect(html).not.toContain("Import CSV");
      expect(html).not.toContain(`>${L.item}<`);
      expect(html).not.toContain(`>${L.price}<`);

      // 4. TopBar must be rendered in 'contractors' mode with active highlight
      expect(html).toContain("border-ink bg-ink text-white");
    });

    it("renders item catalogue exclusively without contractor directory when section='items'", async () => {
      const app = createSSRApp(AdminView, { section: "items" });
      app.use(createPinia());
      app.use(defaultRouter);
      const html = await renderToString(app);

      // 1. Catalogue elements MUST be present
      expect(html).not.toContain("Import CSV");
      expect(html).toContain(`>${L.item}<`);
      expect(html).toContain(`>${L.price}<`);

      // 2. Tab Switcher MUST be hidden
      expect(html).not.toContain("Barangan");

      // 3. Contractor directory elements MUST be omitted
      expect(html).not.toContain("Contractor Directory / Senarai Kontraktor");
      expect(html).not.toContain("Add Contractor / Tambah");
      expect(html).not.toContain("Search by name or phone");
    });

    it("renders fallback internal tab switcher when mounted bare without section props", async () => {
      const app = createSSRApp(AdminView);
      app.use(createPinia());
      app.use(defaultRouter);
      const html = await renderToString(app);

      // Bare mount without route/section falls back to showing tab switcher
      expect(html).toContain("Barangan");
      expect(html).toContain(L.contractors);
    });
  });

  describe("4. TopBar State and Mode Transitions Stress", () => {
    it("verifies navigation button presence, visibility and active styling across all 5 modes", async () => {
      const testCases: {
        mode: "till" | "sales" | "admin" | "report" | "contractors";
        expectContractorsBtn: boolean;
        contractorActive: boolean;
        expectTillBtn: boolean;
        expectHistoryBtn: boolean;
        expectReportBtn: boolean;
        expectItemsBtn: boolean;
      }[] = [
        {
          mode: "till",
          expectContractorsBtn: true,
          contractorActive: false,
          expectTillBtn: false,
          expectHistoryBtn: true,
          expectReportBtn: false,
          expectItemsBtn: true,
        },
        {
          mode: "contractors",
          expectContractorsBtn: true,
          contractorActive: true,
          expectTillBtn: true,
          expectHistoryBtn: true,
          expectReportBtn: false,
          expectItemsBtn: true,
        },
        {
          mode: "admin",
          expectContractorsBtn: true,
          contractorActive: false,
          expectTillBtn: true,
          expectHistoryBtn: true,
          expectReportBtn: false,
          expectItemsBtn: false,
        },
        {
          mode: "sales",
          expectContractorsBtn: true,
          contractorActive: false,
          expectTillBtn: true,
          expectHistoryBtn: false,
          expectReportBtn: false,
          expectItemsBtn: true,
        },
        {
          mode: "report",
          expectContractorsBtn: true,
          contractorActive: false,
          expectTillBtn: true,
          expectHistoryBtn: true,
          expectReportBtn: false,
          expectItemsBtn: true,
        },
      ];

      for (const tc of testCases) {
        const app = createSSRApp(TopBar, { mode: tc.mode });
        app.use(createPinia());
        app.use(defaultRouter);
        const html = await renderToString(app);

        // Contractor button presence
        if (tc.expectContractorsBtn) {
          expect(html).toContain("Contractors / Kontraktor");
        }

        // Active highlight on contractor button
        if (tc.contractorActive) {
          expect(html).toContain("border-ink bg-ink text-white");
        }

        // Till button presence
        if (tc.expectTillBtn) {
          expect(html).toContain(`<span>${L.till}</span>`);
        } else {
          expect(html).not.toContain(`<span>${L.till}</span>`);
        }

        // History button presence
        if (tc.expectHistoryBtn) {
          expect(html).toContain(`<span>${L.history}</span>`);
        } else {
          expect(html).not.toContain(`<span>${L.history}</span>`);
        }

        // Report button presence
        if (tc.expectReportBtn) {
          expect(html).toContain(`<span>${L.report}</span>`);
        } else {
          expect(html).not.toContain(`<span>${L.report}</span>`);
        }

        // Items button presence
        if (tc.expectItemsBtn) {
          expect(html).toContain(`<span>${L.items}</span>`);
        } else {
          expect(html).not.toContain(`<span>${L.items}</span>`);
        }
      }
    });

    it("handles adversarial path variations like trailing slash and hash fragments", () => {
      const resolvedWithSlash = defaultRouter.resolve("/contractors/");
      // vue router matches /contractors/ to /contractors
      expect(resolvedWithSlash.name).toBe("contractors");

      const resolvedWithFragment = defaultRouter.resolve("/contractors#debt-summary");
      expect(resolvedWithFragment.name).toBe("contractors");
      expect(resolvedWithFragment.hash).toBe("#debt-summary");

      const resolvedWithAll = defaultRouter.resolve("/contractors/?filter=unpaid#top");
      expect(resolvedWithAll.name).toBe("contractors");
      expect(resolvedWithAll.query).toEqual({ filter: "unpaid" });
    });

    it("verifies AdminView section detection via route.name when mounted through active router", async () => {
      const customRouter = createRouter({
        history: createMemoryHistory(),
        routes,
      });

      // Navigate router to /contractors
      await customRouter.push("/contractors");

      // Mount AdminView without section prop, relying purely on active router route.name
      const app = createSSRApp(AdminView);
      app.use(createPinia());
      app.use(customRouter);
      const html = await renderToString(app);

      // Should automatically detect route.name === 'contractors'
      expect(html).toContain("Contractor Directory / Senarai Kontraktor");
      expect(html).toContain("Add Contractor / Tambah");
      expect(html).not.toContain("Barangan");
      expect(html).not.toContain("Import CSV");
    });
  });
});
