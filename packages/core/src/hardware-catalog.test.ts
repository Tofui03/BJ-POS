import { describe, expect, it } from "vitest";
import {
  categoryButtonLabel,
  categoryForGroup,
  HARDWARE_CATEGORY_I18N,
  mapCsvUnit,
  parseHardwareCsv,
  splitCsvLine,
  splitItemName,
} from "./hardware-catalog.js";

describe("splitItemName", () => {
  it("splits em-dash and ascii dash specs", () => {
    expect(splitItemName("Plywood — 4 x 8 x 9mm")).toEqual({
      groupName: "Plywood",
      specLabel: "4 x 8 x 9mm",
    });
    expect(splitItemName("Cement - 50 kg")).toEqual({
      groupName: "Cement",
      specLabel: "50 kg",
    });
  });
});

describe("categoryForGroup", () => {
  it("maps known families and falls back to Lain-lain", () => {
    expect(categoryForGroup("Cement")).toBe("Cement & Brick");
    expect(categoryForGroup("Sand Brick")).toBe("Cement & Brick");
    expect(categoryForGroup("Water tank 100G")).toBe("Tank, Roof & Gutter");
    expect(categoryForGroup("PVC Pipe")).toBe("Plastic Pipe");
    expect(categoryForGroup("GI Pipe")).toBe("Metal Pipe");
    expect(categoryForGroup("Mystery Widget")).toBe("Lain-lain");
  });

  it("exposes bilingual button labels", () => {
    expect(categoryButtonLabel("Cement & Brick")).toBe("Cement & Brick / Simen & Bata");
    expect(categoryButtonLabel("Lain-lain")).toBe("Others / Lain-lain");
    expect(categoryButtonLabel("All")).toBe("All / Semua");
  });

  it("supports Chinese (zh), English (en), and Malay (ms/bm) localized category labels", () => {
    expect(categoryButtonLabel("Cement & Brick", "zh")).toBe("洋灰与沙石砖");
    expect(categoryButtonLabel("Cement & Brick", "en")).toBe("Cement & Brick");
    expect(categoryButtonLabel("Cement & Brick", "ms")).toBe("Simen & Bata");

    expect(categoryButtonLabel("All", "zh")).toBe("全部");
    expect(categoryButtonLabel("All", "en")).toBe("All");
    expect(categoryButtonLabel("All", "ms")).toBe("Semua");

    expect(categoryButtonLabel("Cement & Sand", "zh")).toBe("洋灰与沙石");
    expect(categoryButtonLabel("Steel & Metal", "zh")).toBe("钢铁五金");
  });

  it("provides complete Chinese translations in HARDWARE_CATEGORY_I18N", () => {
    expect(HARDWARE_CATEGORY_I18N["All"]?.zh).toBe("全部");
    expect(HARDWARE_CATEGORY_I18N["Cement & Sand"]?.zh).toBe("洋灰与沙石");
    expect(HARDWARE_CATEGORY_I18N["Steel & Metal"]?.zh).toBe("钢铁五金");
    expect(HARDWARE_CATEGORY_I18N["Board & Wood"]?.zh).toBe("木板与木材");
    expect(HARDWARE_CATEGORY_I18N["Door & Frame"]?.zh).toBe("门与门框");
    expect(HARDWARE_CATEGORY_I18N["Plastic Pipe"]?.zh).toBe("塑料水管");
    expect(HARDWARE_CATEGORY_I18N["Metal Pipe"]?.zh).toBe("铁喉白铁管");
    expect(HARDWARE_CATEGORY_I18N["Fence & Steel"]?.zh).toBe("铁丝网与钢材");
    expect(HARDWARE_CATEGORY_I18N["Lain-lain"]?.zh).toBe("杂项");

    // All entries have non-empty en, bm, zh
    for (const [cat, entry] of Object.entries(HARDWARE_CATEGORY_I18N)) {
      expect(entry.en.length, `${cat} missing en`).toBeGreaterThan(0);
      expect(entry.bm.length, `${cat} missing bm`).toBeGreaterThan(0);
      expect(entry.zh.length, `${cat} missing zh`).toBeGreaterThan(0);
    }
  });
});

describe("mapCsvUnit / parseHardwareCsv", () => {
  it("normalizes bilingual unit strings", () => {
    expect(mapCsvUnit("pcs / batang")).toBe("batang");
    expect(mapCsvUnit("bag/karung")).toBe("bag");
    expect(mapCsvUnit("roll / gulung")).toBe("roll");
    expect(mapCsvUnit("pcs")).toBe("pcs");
  });

  it("splits quoted CSV fields", () => {
    expect(splitCsvLine('1,"Pipe, GI","1/2 inch",12.5,pcs')).toEqual([
      "1",
      "Pipe, GI",
      "1/2 inch",
      "12.5",
      "pcs",
    ]);
  });

  it("parses the hardware CSV shape with stable keys", () => {
    const csv = [
      "No,Item Name (Nama Barang),Specification / Size (Saiz / Model),Retail Price / Harga (RM),Unit (Unit Jualan)",
      "1,Cement,50 kg,24,bag/karung",
      '2,"Sand Brick",600 pcs,250,bundle',
      "10,GI Pipe,1 inch,45/2.5 ft,pcs / batang",
    ].join("\n");
    const items = parseHardwareCsv(csv);
    expect(items.find((i) => i.key === "hw_csv_1")).toMatchObject({
      name: "Cement — 50 kg",
      unit: "bag",
      priceCents: 2400,
    });
    expect(items.find((i) => i.key === "hw_csv_2")?.name).toBe("Sand Brick — 600 pcs");
    expect(items.filter((i) => i.key.startsWith("hw_csv_10"))).toEqual([
      expect.objectContaining({ key: "hw_csv_10_batang", unit: "batang", priceCents: 4500 }),
      expect.objectContaining({ key: "hw_csv_10_ft", unit: "ft", priceCents: 250 }),
    ]);
  });
});
