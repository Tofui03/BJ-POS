import { describe, expect, it } from "vitest";
import initSqlJs from "sql.js";
import { createOrder, LEGACY_SEED_ITEMS, type RepaymentInput } from "@yf/core";
import { createSqlJsDriver, initRepo, type SqlDriver, type SqlPosRepo, type SqlValue } from "./index.js";

function wrappingDriver(
  inner: SqlDriver,
  fail: (sql: string) => boolean,
  sqlLog: string[],
): SqlDriver {
  const gate = async <T>(sql: string, op: () => Promise<T>): Promise<T> => {
    sqlLog.push(sql);
    if (fail(sql)) throw new Error("forced settlement failure");
    return op();
  };
  return {
    all: (sql, params) => gate(sql, () => inner.all(sql, params)),
    values: (sql, params?: SqlValue[]) => gate(sql, () => inner.values(sql, params)),
    run: (sql, params?: SqlValue[]) => gate(sql, () => inner.run(sql, params)),
    tx: (fn) => inner.tx(fn),
  };
}

async function openTwoCredits(repo: SqlPosRepo) {
  const fish = (await repo.getItemByKey("tilapia"))!;
  const first = await createOrder(repo, {
    method: "Credit",
    contractorName: "Ah Meng",
    ts: 1000,
    businessDate: "2026-08-10",
    lines: [{ itemId: fish.id, qtyMilli: 1000 }],
  });
  const second = await createOrder(repo, {
    method: "Credit",
    contractorName: "Ah Meng",
    ts: 2000,
    businessDate: "2026-08-10",
    lines: [{ itemId: fish.id, qtyMilli: 2000 }],
  });
  const open = await repo.listCredits(1, { outstandingOnly: true });
  const small = open.find((c) => c.orderId === first.id)!;
  const large = open.find((c) => c.orderId === second.id)!;
  const partial = Math.floor(large.amountCents / 2);
  const inputs: RepaymentInput[] = [
    {
      creditId: small.id,
      amountCents: small.amountCents,
      method: "Cash",
      ts: 3000,
      businessDate: "2026-08-11",
    },
    {
      creditId: large.id,
      amountCents: partial,
      method: "Cash",
      ts: 3000,
      businessDate: "2026-08-11",
    },
  ];
  return { first, second, small, large, partial, inputs };
}

describe("partial debt settlement", () => {
  it("records a partial debt settlement in one transaction", async () => {
    const SQL = await initSqlJs();
    const driver = createSqlJsDriver(new SQL.Database() as never);
    const repo = await initRepo(driver, { seedItems: LEGACY_SEED_ITEMS, seedDemoOrders: false });
    const { first, second, large, partial, inputs } = await openTwoCredits(repo);

    const written = await repo.recordRepayments(inputs);
    expect(written).toHaveLength(2);
    expect(written.reduce((sum, row) => sum + row.amountCents, 0)).toBe(
      inputs[0]!.amountCents! + partial,
    );

    const stillOpen = await repo.listCredits(1, { outstandingOnly: true });
    expect(stillOpen).toHaveLength(1);
    expect(stillOpen[0]).toMatchObject({
      orderId: second.id,
      amountCents: large.amountCents - partial,
      clearedAt: null,
    });

    expect((await repo.getOrder(first.id))!.creditClearedAt).toBe(3000);
    expect((await repo.getOrder(second.id))!.creditClearedAt).toBeNull();
    expect(await repo.listRepayments()).toHaveLength(2);
  });

  it("rolls back a partial debt settlement when a later write fails", async () => {
    const SQL = await initSqlJs();
    const sqlLog: string[] = [];
    let armed = false;
    let repaymentInserts = 0;
    const driver = wrappingDriver(
      createSqlJsDriver(new SQL.Database() as never),
      (sql) => {
        if (!armed || !/insert\s+into\s+"?repayments"?/i.test(sql)) return false;
        repaymentInserts += 1;
        return repaymentInserts >= 2;
      },
      sqlLog,
    );
    const repo = await initRepo(driver, { seedItems: LEGACY_SEED_ITEMS, seedDemoOrders: false });
    const { first, second, small, large, inputs } = await openTwoCredits(repo);
    const creditsBefore = await repo.listCredits(1);

    armed = true;
    let message = "";
    try {
      await repo.recordRepayments(inputs);
    } catch (err) {
      const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : "";
      message = `${err instanceof Error ? err.message : String(err)} ${cause}`;
    }
    expect(message).toMatch(/forced settlement failure/);

    const creditsAfter = await repo.listCredits(1);
    const openAfter = await repo.listCredits(1, { outstandingOnly: true });
    const repayments = await repo.listRepayments();
    const hint = sqlLog.filter((sql) => /insert/i.test(sql)).join("\n");
    expect(repayments, hint).toHaveLength(0);
    expect(openAfter.map((c) => c.amountCents).sort((a, b) => a - b)).toEqual(
      [small.amountCents, large.amountCents].sort((a, b) => a - b),
    );
    expect(creditsAfter).toHaveLength(creditsBefore.length);
    expect((await repo.getOrder(first.id))!.creditClearedAt).toBeNull();
    expect((await repo.getOrder(second.id))!.creditClearedAt).toBeNull();
  });
});
