import { describe, expect, it, vi } from "vitest";
import { createIpcDriver, type SqliteBridge } from "./ipc-driver";

function createMockBridge() {
  const log: string[] = [];
  const bridge: SqliteBridge = {
    all: vi.fn(async (sql) => {
      log.push(`ALL: ${sql}`);
      return [];
    }),
    values: vi.fn(async (sql) => {
      log.push(`VALUES: ${sql}`);
      return [];
    }),
    run: vi.fn(async (sql) => {
      log.push(`RUN: ${sql}`);
      return { lastInsertRowid: 1 };
    }),
    meta: vi.fn(async () => ({ fresh: false })),
    reset: vi.fn(async () => true),
  };
  return { bridge, log };
}

describe("createIpcDriver Mutex Queue & Transaction Safety", () => {
  it("serializes concurrent top-level transactions", async () => {
    const { bridge, log } = createMockBridge();
    const driver = createIpcDriver(bridge);

    // Two async operations trigger concurrently
    const task1 = driver.tx(async () => {
      log.push("TASK 1 START");
      await new Promise((r) => setTimeout(r, 30));
      log.push("TASK 1 END");
      return "res1";
    });

    const task2 = driver.tx(async () => {
      log.push("TASK 2 START");
      await new Promise((r) => setTimeout(r, 10));
      log.push("TASK 2 END");
      return "res2";
    });

    const [r1, r2] = await Promise.all([task1, task2]);

    expect(r1).toBe("res1");
    expect(r2).toBe("res2");

    // task1 must BEGIN and COMMIT before task2 can BEGIN.
    expect(log).toEqual([
      "RUN: BEGIN",
      "TASK 1 START",
      "TASK 1 END",
      "RUN: COMMIT",
      "RUN: BEGIN",
      "TASK 2 START",
      "TASK 2 END",
      "RUN: COMMIT",
    ]);
  });

  it("handles rollback on error without stalling subsequent queued transactions", async () => {
    const { bridge, log } = createMockBridge();
    const driver = createIpcDriver(bridge);

    const failingTask = driver.tx(async () => {
      log.push("FAILING TASK START");
      throw new Error("Disk error");
    });

    const subsequentTask = driver.tx(async () => {
      log.push("SUBSEQUENT TASK START");
      return "recovered";
    });

    await expect(failingTask).rejects.toThrow("Disk error");
    const res = await subsequentTask;
    expect(res).toBe("recovered");

    expect(log).toEqual([
      "RUN: BEGIN",
      "FAILING TASK START",
      "RUN: ROLLBACK",
      "RUN: BEGIN",
      "SUBSEQUENT TASK START",
      "RUN: COMMIT",
    ]);
  });

  it("supports reentrant transactions on scoped context", async () => {
    const { bridge, log } = createMockBridge();
    const driver = createIpcDriver(bridge);

    await driver.tx(async (scoped) => {
      log.push("OUTER START");
      if (scoped) {
        await scoped.tx(async () => {
          log.push("INNER START");
          log.push("INNER END");
        });
      }
      log.push("OUTER END");
    });

    expect(log).toEqual([
      "RUN: BEGIN",
      "OUTER START",
      "INNER START",
      "INNER END",
      "OUTER END",
      "RUN: COMMIT",
    ]);
  });
});
