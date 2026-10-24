import { describe, it, expect } from "vitest";
import { buildDeliveryOrder, formatDoNo } from "./delivery-order.js";
import type { Order } from "./types.js";

const sampleOrder: Order = {
  id: 42,
  companyId: 1,
  ts: 1774339200000, // 2026-03-24
  businessDate: "2026-03-24",
  invNo: "B-0042",
  method: "Cash",
  customerType: "contractor",
  contractorName: "Kim Seng Engineering",
  customerTin: "C9988776655",
  customerAddress: "Lot 15, Kawasan Perindustrian Senai",
  customerPhone: "019-8765432",
  issueDo: true,
  doNumber: "DO-0042",
  siteAddress: "Plot 88, Bandar Dato Onn, JB",
  lorryPlate: "JXX 8899",
  driverName: "Pak Samad",
  contractorPo: "PO-2026-009",
  showPriceOnDo: true,
  totalCents: 15400,
  subtotalCents: 15400,
  voidedAt: null,
  items: [
    {
      id: 1,
      itemId: 101,
      name: "Mild Steel Pipe 20ft",
      image: "",
      unit: "meter",
      priceCents: 1200,
      qtyMilli: 10000, // 10.000 meter
      amountCents: 12000,
      tailCount: 0,
      bulkPrice: false,
    },
    {
      id: 2,
      itemId: 102,
      name: "Cement 50kg",
      image: "",
      unit: "bag",
      priceCents: 2200,
      qtyMilli: 1000, // 1 bag
      amountCents: 2200,
      tailCount: 0,
      bulkPrice: false,
    },
    {
      id: 3,
      itemId: 103,
      name: "Wire Nails (1 inch)",
      image: "",
      unit: "kg",
      priceCents: 600,
      qtyMilli: 2000, // 2.000 kg
      amountCents: 1200,
      tailCount: 0,
      bulkPrice: false,
    },
  ],
};

describe("formatDoNo", () => {
  it("formats running sequence number to 4-digit DO number", () => {
    expect(formatDoNo(1)).toBe("DO-0001");
    expect(formatDoNo(42)).toBe("DO-0042");
    expect(formatDoNo(105)).toBe("DO-0105");
    expect(formatDoNo(9999)).toBe("DO-9999");
    expect(formatDoNo(10000)).toBe("DO-10000");
  });
});

describe("buildDeliveryOrder", () => {
  it("builds a complete DeliveryOrder with prices visible when showPriceOnDo is true", () => {
    const doData = buildDeliveryOrder(sampleOrder);

    expect(doData.doNumber).toBe("DO-0042");
    expect(doData.doNo).toBe("DO-0042");
    expect(doData.invNo).toBe("B-0042");
    expect(doData.businessDate).toBe("2026-03-24");
    expect(doData.contractorName).toBe("Kim Seng Engineering");
    expect(doData.contractorTin).toBe("C9988776655");
    expect(doData.contractorAddress).toBe("Lot 15, Kawasan Perindustrian Senai");
    expect(doData.contractorPhone).toBe("019-8765432");
    expect(doData.siteAddress).toBe("Plot 88, Bandar Dato Onn, JB");
    expect(doData.lorryPlate).toBe("JXX 8899");
    expect(doData.driverName).toBe("Pak Samad");
    expect(doData.contractorPo).toBe("PO-2026-009");
    expect(doData.showPriceOnDo).toBe(true);

    // Quantity calculations
    expect(doData.totalQtyMilli).toBe(13000); // 10000 + 1000 + 2000
    expect(doData.totalQtyText).toBe("13");

    // Price visibility on header totals
    expect(doData.totalAmountCents).toBe(15400);
    expect(doData.totalText).toBe("RM 154.00");
    expect(doData.subtotalCents).toBe(15400);
    expect(doData.subtotalText).toBe("RM 154.00");

    // Line items
    expect(doData.lines).toHaveLength(3);
    const [line1, line2, line3] = doData.lines;

    // Line 1: measured meter
    expect(line1).toMatchObject({
      itemNo: 1,
      name: "Mild Steel Pipe 20ft",
      itemName: "Mild Steel Pipe 20ft",
      unit: "meter",
      qtyMilli: 10000,
      qtyText: "10 meter",
      unitPriceCents: 1200,
      unitPriceText: "RM 12.00/meter",
      lineAmountCents: 12000,
      amountText: "RM 120.00",
    });

    // Line 2: countable bag
    expect(line2).toMatchObject({
      itemNo: 2,
      name: "Cement 50kg",
      unit: "bag",
      qtyMilli: 1000,
      qtyText: "1",
      unitPriceCents: 2200,
      unitPriceText: "RM 22.00/bag",
      lineAmountCents: 2200,
      amountText: "RM 22.00",
    });

    // Line 3: measured kg
    expect(line3).toMatchObject({
      itemNo: 3,
      name: "Wire Nails (1 inch)",
      unit: "kg",
      qtyMilli: 2000,
      qtyText: "2 kg",
      unitPriceCents: 600,
      unitPriceText: "RM 6.00/kg",
      lineAmountCents: 1200,
      amountText: "RM 12.00",
    });

    // 3 Signatories
    expect(doData.signatories).toEqual({
      issuedBy: "Store / Cashier",
      deliveredBy: "Pak Samad",
      receivedBy: "Site Supervisor",
    });
  });

  it("completely suppresses all unit prices and amount totals when showPriceOnDo is false", () => {
    const doOrderNoPrices: Order = {
      ...sampleOrder,
      showPriceOnDo: false,
    };

    const doData = buildDeliveryOrder(doOrderNoPrices);

    expect(doData.showPriceOnDo).toBe(false);
    expect(doData.totalAmountCents).toBeUndefined();
    expect(doData.totalText).toBeUndefined();
    expect(doData.subtotalCents).toBeUndefined();
    expect(doData.subtotalText).toBeUndefined();

    for (const line of doData.lines) {
      expect(line.unitPriceCents).toBeUndefined();
      expect(line.unitPriceText).toBeUndefined();
      expect(line.lineAmountCents).toBeUndefined();
      expect(line.amountText).toBeUndefined();
      // Quantities and descriptions must still be intact
      expect(line.itemName).toBeTruthy();
      expect(line.qtyMilli).toBeGreaterThan(0);
      expect(line.qtyText).toBeTruthy();
    }
  });

  it("supports company option overrides and default Borneo store metadata", () => {
    const doData = buildDeliveryOrder(sampleOrder, {
      storeName: "Borneo Jasa Sdn. Bhd.",
    });

    expect(doData.storeName).toBe("Borneo Jasa Sdn. Bhd.");
    expect(doData.regNo).toBe("(227533-X)");
    expect(doData.tin).toBeTruthy();
  });

  it("defaults signatories.issuedBy to order.cashierName when present", () => {
    const orderWithCashier = { ...sampleOrder, cashierName: "Ah Ming" };
    const doData = buildDeliveryOrder(orderWithCashier);
    expect(doData.signatories.issuedBy).toBe("Ah Ming");
  });

  it("falls back signatories.issuedBy to 'Store / Cashier' when order.cashierName is missing", () => {
    const orderWithoutCashier = { ...sampleOrder, cashierName: undefined };
    const doData = buildDeliveryOrder(orderWithoutCashier);
    expect(doData.signatories.issuedBy).toBe("Store / Cashier");
  });

  it("allows opts.signatories.issuedBy to override order.cashierName", () => {
    const orderWithCashier = { ...sampleOrder, cashierName: "Ah Ming" };
    const doData = buildDeliveryOrder(orderWithCashier, {
      signatories: { issuedBy: "Custom Issuer" },
    });
    expect(doData.signatories.issuedBy).toBe("Custom Issuer");
  });
});
