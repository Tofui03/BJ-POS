import type { PricedItem } from "./types.js";
import { PAYMENT_METHODS } from "./types.js";
import type { OrderDraft } from "./repo.js";
import { priceLine } from "./pricing.js";

// Generate plausible historical orders for the current month so the Sales
// report has something to show on first run. Pure: pass `now` and an `rng`
// (0..1) so it's deterministic in tests.

export function generateDemoOrders(
  items: PricedItem[],
  now: Date = new Date(),
  rng: () => number = Math.random,
): OrderDraft[] {
  const rnd = (a: number, b: number) => a + Math.floor(rng() * (b - a + 1));
  const active = items.filter((i) => i.active);
  if (active.length === 0) return [];

  const y = now.getFullYear();
  const m = now.getMonth();
  const today = now.getDate();
  const drafts: OrderDraft[] = [];

  for (let d = 1; d <= today; d++) {
    const count = rnd(3, 11);
    for (let i = 0; i < count; i++) {
      const ts = new Date(y, m, d, rnd(8, 18), rnd(0, 59)).getTime();
      const nLines = rnd(1, 4);
      const lines: OrderDraft["lines"] = [];
      let totalCents = 0;
      for (let k = 0; k < nLines; k++) {
        const item = active[rnd(0, active.length - 1)]!;
        const qtyMilli = item.unit === "kg" ? rnd(1, 6) * 500 : rnd(1, 5) * 1000;
        const { unitCents, amountCents } = priceLine(item, qtyMilli);
        totalCents += amountCents;
        lines.push({
          itemId: item.id,
          priceCents: unitCents,
          qtyMilli,
        });
      }
      // Demo sales are settled at the till; Credit needs a real creditor, so skip it.
      const methods = PAYMENT_METHODS.filter((m) => m !== "Credit");
      const method = methods[rnd(0, methods.length - 1)]!;
      drafts.push({ ts, method, totalCents, lines });
    }
  }
  return drafts;
}
