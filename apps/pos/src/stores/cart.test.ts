import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { PricedItem } from "@yf/core";
import { useCart } from "./cart";

const cement: PricedItem = {
  id: 1,
  key: "hw_1",
  name: "Cement — 50 kg",
  image: "",
  unit: "bag",
  priceCents: 2400,
  active: true,
  tracksTail: false,
  stockMilli: null,
  sortOrder: 1,
  tiers: [],
};

const plywood9mm: PricedItem = {
  id: 11,
  key: "hw_11",
  name: "Plywood — 4 x 8 x 9mm",
  image: "",
  unit: "pcs",
  priceCents: 5900,
  active: true,
  tracksTail: false,
  stockMilli: null,
  sortOrder: 11,
  tiers: [],
};

describe("useCart Hold / Recall system", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("holds the current cart with a custom or auto-generated label and clears the cart", () => {
    const cart = useCart();
    cart.add(cement);
    cart.setQty(cart.lines[0]!.uid, 5); // 5 bags = RM 120.00
    expect(cart.totalCents).toBe(12000);

    const held = cart.holdCurrent("Lorry SAB 8899");
    expect(held).not.toBeNull();
    expect(held!.label).toBe("Lorry SAB 8899");
    expect(held!.totalCents).toBe(12000);
    expect(cart.lines).toHaveLength(0);
    expect(cart.heldOrders).toHaveLength(1);
  });

  it("resumes a held order into an empty cart and remembers its hold label", () => {
    const cart = useCart();
    cart.add(cement);
    const held = cart.holdCurrent("Ah Meng")!;

    const res = cart.resumeHeld(held.id, "swap");
    expect(res && !("blocked" in res && res.blocked)).toBe(true);
    if (!res || ("blocked" in res && res.blocked)) return;
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]!.item.name).toBe("Cement — 50 kg");
    expect(cart.activeHoldLabel).toBe("Ah Meng");
    expect(cart.heldOrders).toHaveLength(0);
  });

  it("blocks resume while the current cart has lines (rule B)", () => {
    const cart = useCart();
    cart.add(cement);
    const firstHold = cart.holdCurrent("Customer A")!;

    cart.add(plywood9mm);
    cart.setQty(cart.lines[0]!.uid, 2);

    const res = cart.resumeHeld(firstHold.id, "swap");
    expect(res).toEqual({ blocked: true, reason: "cart_not_empty" });
    // Current cart and the held bill are both unchanged.
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]!.item.id).toBe(plywood9mm.id);
    expect(cart.heldOrders).toHaveLength(1);
    expect(cart.heldOrders[0]!.id).toBe(firstHold.id);
  });

  it("merges a held order into an empty cart when mode is merge", () => {
    const cart = useCart();
    cart.add(cement);
    const held = cart.holdCurrent("Part 1")!;

    cart.resumeHeld(held.id, "merge");

    expect(cart.lines).toHaveLength(1);
    expect(cart.totalCents).toBe(2400);
    expect(cart.heldOrders).toHaveLength(0);
  });

  it("discards a held order", () => {
    const cart = useCart();
    cart.add(cement);
    const held = cart.holdCurrent("Cancel Me")!;
    expect(cart.heldOrders).toHaveLength(1);

    cart.discardHeld(held.id);
    expect(cart.heldOrders).toHaveLength(0);
  });

  it("supports per-line price override, Lain-lain items, and whole-bill discount / final total", () => {
    const cart = useCart();
    cart.add(cement); // 1 bag @ RM 24.00
    cart.setQty(cart.lines[0]!.uid, 2); // 2 bags @ RM 24.00 = RM 48.00
    cart.setUnitPrice(cart.lines[0]!.uid, 2200); // override to RM 22.00 -> RM 44.00 (line discount RM 4.00)
    expect(cart.lineDiscountCentsOf(cart.lines[0]!)).toBe(400);
    expect(cart.linesSubtotalCents).toBe(4400);

    // Add two distinct Lain-lain lines
    cart.addLainLain("Skru / Screw", 350, 1);
    cart.addLainLain("Upah / Labour", 1000, 1);
    expect(cart.lines).toHaveLength(3);
    expect(cart.linesSubtotalCents).toBe(5750); // 44.00 + 3.50 + 10.00 = 57.50

    // Set final total to RM 55.00 -> bill discount RM 2.50
    cart.setFinalTotal(5500);
    expect(cart.billDiscountCents).toBe(250);
    expect(cart.totalDiscountCents).toBe(650); // 4.00 line + 2.50 bill
    expect(cart.totalCents).toBe(5500);
  });

  it("guards pay() when cart is empty or credit sale lacks creditor/contractor", async () => {
    const cart = useCart();
    // Empty cart
    expect(await cart.pay("Cash")).toBeNull();

    cart.add(cement);
    // Credit without contractor or creditor
    expect(await cart.pay("Credit")).toBeNull();
    expect(await cart.pay("Credit", "")).toBeNull();
    expect(await cart.pay("Credit", { contractorName: "  " })).toBeNull();
  });

  it("supports addLainLain with kg, meter, ft units and decimal quantities", () => {
    const cart = useCart();
    // Add 1.250 kg of loose nails at RM 8.00 / kg (800 cents)
    cart.addLainLain("Paku Payung / Roofing Nails", 800, 1.25, "kg");
    expect(cart.lines).toHaveLength(1);
    const line1 = cart.lines[0]!;
    expect(line1.item.unit).toBe("kg");
    expect(line1.customName).toBe("Paku Payung / Roofing Nails");
    expect(line1.qtyMilli).toBe(1250);
    expect(line1.customPriceCents).toBe(800);
    // 1.250 * 800 = 1000 cents (RM 10.00)
    expect(cart.amountCentsOf(line1)).toBe(1000);

    // Add 0.350 kg of copper wire at RM 30.00 / kg (3000 cents)
    cart.addLainLain("Copper Wire", 3000, 0.35, "kg");
    const line2 = cart.lines[1]!;
    expect(line2.item.unit).toBe("kg");
    expect(line2.qtyMilli).toBe(350);
    // 0.350 * 3000 = 1050 cents (RM 10.50)
    expect(cart.amountCentsOf(line2)).toBe(1050);

    // Add 4.5 meters of water hose at RM 2.00 / meter (200 cents)
    cart.addLainLain("Paip Getah / Garden Hose", 200, 4.5, "meter");
    const line3 = cart.lines[2]!;
    expect(line3.item.unit).toBe("meter");
    expect(line3.qtyMilli).toBe(4500);
    // 4.5 * 200 = 900 cents (RM 9.00)
    expect(cart.amountCentsOf(line3)).toBe(900);

    // Total: 1000 + 1050 + 900 = 2950 cents (RM 29.50)
    expect(cart.totalCents).toBe(2950);

    // Verify hold and restore preserves custom unit on Lain-lain items
    const held = cart.holdCurrent("Weighed Goods Customer")!;
    expect(held).not.toBeNull();
    expect(cart.lines).toHaveLength(0);

    const res = cart.resumeHeld(held.id, "swap");
    expect(res && !("blocked" in res && res.blocked)).toBe(true);
    expect(cart.lines).toHaveLength(3);
    expect(cart.lines[0]!.item.unit).toBe("kg");
    expect(cart.lines[0]!.qtyMilli).toBe(1250);
    expect(cart.lines[1]!.item.unit).toBe("kg");
    expect(cart.lines[1]!.qtyMilli).toBe(350);
    expect(cart.lines[2]!.item.unit).toBe("meter");
    expect(cart.lines[2]!.qtyMilli).toBe(4500);
    expect(cart.totalCents).toBe(2950);
  });
});

