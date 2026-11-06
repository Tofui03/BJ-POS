import { describe, expect, it } from "vitest";
import { buildOrder } from "../../packages/core/src/index.js";
import { freshTestRepo } from "./harness.js";

describe("one sale per pay", () => {
  it("records a single order when the same pay is sent twice at once", async () => {
    const { repo, driver } = await freshTestRepo();
    const items = await repo.listItems(true);
    const cement = items.find((i) => /cement/i.test(i.name));
    expect(cement).toBeTruthy();

    const draft = buildOrder(
      {
        method: "Cash",
        clientRequestId: "pay-once-1",
        lines: [{ itemId: cement!.id, qtyMilli: 2000 }],
      },
      (line) => items.find((i) => i.id === line.itemId) ?? null,
    );

    const [first, second] = await Promise.all([
      repo.persistOrder(draft),
      repo.persistOrder(draft),
    ]);
    const again = await repo.persistOrder(draft);

    expect(second.id).toBe(first.id);
    expect(again.id).toBe(first.id);
    expect(second.invNo).toBe(first.invNo);

    const rows = await driver.all("SELECT id FROM orders WHERE client_request_id = ?", [
      "pay-once-1",
    ]);
    expect(rows).toHaveLength(1);
  });
});
