import { describe, expect, it } from "vitest";
import {
  categoryButtonLabel,
  categoryForGroup,
  HARDWARE_CATEGORY_I18N,
  HARDWARE_SEED_ITEMS,
  mapCsvUnit,
  matchesHardwareSearch,
  normalizeHardwareSearchText,
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

describe("HARDWARE_SEED_ITEMS", () => {
  it("contains exactly 253 items with unique keys and preserved prices", () => {
    expect(HARDWARE_SEED_ITEMS).toHaveLength(253);
    const keys = new Set(HARDWARE_SEED_ITEMS.map((i) => i.key));
    expect(keys.size).toBe(253);
    // Preserves specific known keys
    expect(keys.has("hw_1")).toBe(true);
    expect(keys.has("hw_251")).toBe(true);
    expect(keys.has("hw_158_batang")).toBe(true);
    expect(keys.has("hw_158_ft")).toBe(true);
    expect(keys.has("hw_159_batang")).toBe(true);
    expect(keys.has("hw_159_ft")).toBe(true);
  });

  it("disambiguates duplicate / ambiguous item names (hw_148, hw_160, hw_162)", () => {
    const hw148 = HARDWARE_SEED_ITEMS.find((i) => i.key === "hw_148");
    expect(hw148?.name).toBe("Black Pipe — 2 1/2'' (AA)");
    expect(hw148?.priceCents).toBe(14800);

    const hw147 = HARDWARE_SEED_ITEMS.find((i) => i.key === "hw_147");
    expect(hw147?.name).toBe("Black Pipe — 2 1/2'' (A)");
    expect(hw147?.priceCents).toBe(28800);

    const hw160 = HARDWARE_SEED_ITEMS.find((i) => i.key === "hw_160");
    expect(hw160?.name).toBe("Steel Pipe — 1'' x 6m (Light)");
    expect(hw160?.priceCents).toBe(4500);

    const hw162 = HARDWARE_SEED_ITEMS.find((i) => i.key === "hw_162");
    expect(hw162?.name).toBe("Steel Pipe — 1'' x 6m (Heavy)");
    expect(hw162?.priceCents).toBe(5980);
  });

  it("fixes incorrect units for pipes, coils, rolls and mesh sheets", () => {
    // PVC Pipe: batang
    const pvc80 = HARDWARE_SEED_ITEMS.find((i) => i.key === "hw_80");
    expect(pvc80?.unit).toBe("batang");
    const pvc83 = HARDWARE_SEED_ITEMS.find((i) => i.key === "hw_83");
    expect(pvc83?.unit).toBe("batang");

    // UPVC Pipe: batang
    const upvc104 = HARDWARE_SEED_ITEMS.find((i) => i.key === "hw_104");
    expect(upvc104?.unit).toBe("batang");

    // Poly Pipe rolls: roll; 6m: batang
    const poly113 = HARDWARE_SEED_ITEMS.find((i) => i.key === "hw_113");
    expect(poly113?.unit).toBe("roll");
    const poly125 = HARDWARE_SEED_ITEMS.find((i) => i.key === "hw_125");
    expect(poly125?.unit).toBe("batang");

    // Spiral Pipe: batang
    const spiral126 = HARDWARE_SEED_ITEMS.find((i) => i.key === "hw_126");
    expect(spiral126?.unit).toBe("batang");

    // Ultra Gal: batang
    const ug128 = HARDWARE_SEED_ITEMS.find((i) => i.key === "hw_128");
    expect(ug128?.unit).toBe("batang");

    // Barbed Wire: roll
    const bw79 = HARDWARE_SEED_ITEMS.find((i) => i.key === "hw_79");
    expect(bw79?.unit).toBe("roll");

    // BRC Mesh flat sheets: pcs
    const brc166 = HARDWARE_SEED_ITEMS.find((i) => i.key === "hw_166");
    expect(brc166?.unit).toBe("pcs");
    const brc176 = HARDWARE_SEED_ITEMS.find((i) => i.key === "hw_176");
    expect(brc176?.unit).toBe("pcs");

    // BRC Mesh rolls: roll
    const brc168 = HARDWARE_SEED_ITEMS.find((i) => i.key === "hw_168");
    expect(brc168?.unit).toBe("roll");
  });

  it("groups all product groups contiguously without fragmentation", () => {
    const groupsSeen: string[] = [];
    for (const item of HARDWARE_SEED_ITEMS) {
      const { groupName } = splitItemName(item.name);
      if (groupsSeen.length === 0 || groupsSeen[groupsSeen.length - 1] !== groupName) {
        expect(groupsSeen, `Group "${groupName}" was fragmented across the catalog`).not.toContain(groupName);
        groupsSeen.push(groupName);
      }
    }
    expect(groupsSeen).toHaveLength(43);
  });

  it("places hw_18 immediately following hw_14 in Plywood", () => {
    const idx14 = HARDWARE_SEED_ITEMS.findIndex((i) => i.key === "hw_14");
    const idx18 = HARDWARE_SEED_ITEMS.findIndex((i) => i.key === "hw_18");
    expect(idx18).toBe(idx14 + 1);
  });

  it("places hw_80 (Wiring) at the end of PVC Pipe", () => {
    const pvcItems = HARDWARE_SEED_ITEMS.filter((i) => splitItemName(i.name).groupName === "PVC Pipe");
    expect(pvcItems[pvcItems.length - 1]?.key).toBe("hw_80");
  });

  it("groups Cement, Cement Gum, Sand Brick, and Red Brick together at start", () => {
    const firstFour = HARDWARE_SEED_ITEMS.slice(0, 4).map((i) => splitItemName(i.name).groupName);
    expect(firstFour).toEqual(["Cement", "Cement Gum", "Sand Brick", "Red Brick"]);
  });
});

describe("matchesHardwareSearch", () => {
  it("matches multi-token search terms regardless of token order", () => {
    expect(matchesHardwareSearch("Cement — 50 kg", "cement 50")).toBe(true);
    expect(matchesHardwareSearch("Cement — 50 kg", "50 cement")).toBe(true);
    expect(matchesHardwareSearch("Cement — 50 kg", "cement 50 kg")).toBe(true);
    expect(matchesHardwareSearch("Cement — 50 kg", "cement 40")).toBe(false);
  });

  it("normalizes inch and quote symbols (\", '', and 'in'/'inch')", () => {
    const pipe = "PVC Pipe — 1'' x 6m (23mm) (nipis)";
    expect(matchesHardwareSearch(pipe, 'pvc 1"')).toBe(true);
    expect(matchesHardwareSearch(pipe, "pvc 1''")).toBe(true);
    expect(matchesHardwareSearch(pipe, "pvc 1 in")).toBe(true);
    expect(matchesHardwareSearch(pipe, "pvc 1inch")).toBe(true);
    expect(matchesHardwareSearch(pipe, '1" 6m')).toBe(true);

    const door = "Solid Door — 36'' x 83''";
    expect(matchesHardwareSearch(door, 'solid 36"')).toBe(true);
    expect(matchesHardwareSearch(door, "solid 36 in")).toBe(true);
  });

  it("supports bilingual BM & ZH keyword aliases for hardware categories", () => {
    // Cement: simen / 洋灰 / 水泥
    expect(matchesHardwareSearch("Cement — 50 kg", "simen 50")).toBe(true);
    expect(matchesHardwareSearch("Cement — 50 kg", "洋灰 50")).toBe(true);
    expect(matchesHardwareSearch("Cement — 50 kg", "水泥 50kg")).toBe(true);

    // Brick: bata / 砖
    expect(matchesHardwareSearch("Sand Brick — 600 pcs", "bata 600")).toBe(true);
    expect(matchesHardwareSearch("Red Brick — 600 pcs", "砖 600")).toBe(true);

    // Plywood / Wood: papan / kayu / 夹板 / 木
    expect(matchesHardwareSearch("Plywood — 4 x 8 x 9mm", "papan 9mm")).toBe(true);
    expect(matchesHardwareSearch("Plywood — 4 x 8 x 9mm", "夹板 9mm")).toBe(true);
    expect(matchesHardwareSearch("Pine Wood — 1 x 2 x 10'", "kayu 1 x 2")).toBe(true);
    expect(matchesHardwareSearch("Pine Wood — 1 x 2 x 10'", "木 10'")).toBe(true);

    // Tank: tangki / 水槽 / 水塔
    expect(matchesHardwareSearch("Water Tank — 100G · Blue tank (BOWANG)", "tangki 100")).toBe(true);
    expect(matchesHardwareSearch("Water Tank — 100G · Blue tank (BOWANG)", "水塔 100G")).toBe(true);

    // Zinc: atap / zink / 锌片 / 屋瓦
    expect(matchesHardwareSearch("Zinc — 8'", "atap 8'")).toBe(true);
    expect(matchesHardwareSearch("Zinc — 8'", "zink 8")).toBe(true);
    expect(matchesHardwareSearch("Zinc — 8'", "锌片 8'")).toBe(true);

    // Gutter: longkang / 水笕 / 水槽沟
    expect(matchesHardwareSearch("UPVC Gutter — Rain Gutter 5.8m", "longkang 5.8m")).toBe(true);
    expect(matchesHardwareSearch("UPVC Gutter — Rain Gutter 5.8m", "水笕 5.8")).toBe(true);

    // Door & Frame: pintu / 门 / bingkai / 门框
    expect(matchesHardwareSearch("Solid Door — 36'' x 83''", 'pintu 36"')).toBe(true);
    expect(matchesHardwareSearch("Solid Door — 36'' x 83''", "门 36")).toBe(true);
    expect(matchesHardwareSearch("Metal Door Frame — 36'' x 83''", "bingkai 36")).toBe(true);
    expect(matchesHardwareSearch("Metal Door Frame — 36'' x 83''", "门框 36")).toBe(true);

    // Pipe: paip / 喉 / 水管 / 铁管
    expect(matchesHardwareSearch("PVC Pipe — 1'' x 6m (23mm) (nipis)", 'paip 1"')).toBe(true);
    expect(matchesHardwareSearch("PVC Pipe — 1'' x 6m (23mm) (nipis)", '水管 1"')).toBe(true);
    expect(matchesHardwareSearch("PVC Pipe — 1'' x 6m (23mm) (nipis)", '喉 1"')).toBe(true);
    expect(matchesHardwareSearch("Black Pipe — 2 1/2'' (AA)", '铁管 2 1/2"')).toBe(true);

    // Fence / Wire / Mesh: pagar / dawai / 网 / 铁丝
    expect(matchesHardwareSearch("Barbed Wire — 35 lbs (16 kg)", "dawai 16 kg")).toBe(true);
    expect(matchesHardwareSearch("Barbed Wire — 35 lbs (16 kg)", "铁丝 35 lbs")).toBe(true);
    expect(matchesHardwareSearch("BRC Mesh — 7' x 12' x 11", "pagar 7'")).toBe(true);
    expect(matchesHardwareSearch("Chain Link — 4' x 2'' x 2'' x 12", "pagar 4'")).toBe(true);

    // Steel: besi / 铁 / 钢
    expect(matchesHardwareSearch("Flat Bar — 1/2'' x 3mm x 6m", 'besi 1/2" 3mm')).toBe(true);
    expect(matchesHardwareSearch("Angle Bar — 1'' x 3mm x 6m", '铁 1" 6m')).toBe(true);
    expect(matchesHardwareSearch("Square Tube — 2'' x 2'' x 1.6mm x 6m", '钢 2"')).toBe(true);
  });

  it("matches abbreviations with dots and compact dimensions without spaces", () => {
    // gi 1/2 matching G.I Pipe — 1/2'' (A)
    expect(matchesHardwareSearch("G.I Pipe — 1/2'' (A)", "gi 1/2")).toBe(true);
    expect(matchesHardwareSearch("G.I Pipe — 1/2'' (A)", "g.i 1/2")).toBe(true);
    expect(matchesHardwareSearch("G.I Pipe — 1/2'' (A)", "g.i. 1/2")).toBe(true);

    // plywood 4x8 12mm matching Plywood — 4 x 8 x 12mm (W/P)
    expect(matchesHardwareSearch("Plywood — 4 x 8 x 12mm (W/P)", "plywood 4x8 12mm")).toBe(true);
    expect(matchesHardwareSearch("Plywood — 4 x 8 x 12mm (W/P)", "4x8 12mm")).toBe(true);
    expect(matchesHardwareSearch("Plywood — 4 x 8 x 12mm (W/P)", "plywood 4x8")).toBe(true);

    // pine 1x2x10 matching Pine Wood — 1 x 2 x 10'
    expect(matchesHardwareSearch("Pine Wood — 1 x 2 x 10'", "pine 1x2x10")).toBe(true);
    expect(matchesHardwareSearch("Pine Wood — 1 x 2 x 10'", "pine 1x2x10'")).toBe(true);
    expect(matchesHardwareSearch("Pine Wood — 1 x 2 x 10'", "pine 1 x 2 x 10")).toBe(true);
  });

  it("matches Chinese and Malay specific shop floor aliases across categories", () => {
    // 白铁管 -> G.I Pipe
    expect(matchesHardwareSearch("G.I Pipe — 1/2'' (A)", "白铁管")).toBe(true);
    expect(matchesHardwareSearch("G.I Pipe — 1/2'' (A)", "白铁管 1/2")).toBe(true);

    // 黑喉 -> Poly Pipe
    expect(matchesHardwareSearch("Poly Pipe — 1/2'' x 100m", "黑喉")).toBe(true);
    expect(matchesHardwareSearch("Poly Pipe — 1/2'' x 100m", "黑喉 1/2")).toBe(true);

    // 方管 -> Square Tube
    expect(matchesHardwareSearch("Square Tube — 2'' x 2'' x 1.6mm x 6m", "方管")).toBe(true);
    expect(matchesHardwareSearch("Square Tube — 2'' x 2'' x 1.6mm x 6m", "方管 2")).toBe(true);

    // 角铁 -> Angle Bar
    expect(matchesHardwareSearch("Angle Bar — 1'' x 3mm x 6m", "角铁")).toBe(true);
    expect(matchesHardwareSearch("Angle Bar — 1'' x 3mm x 6m", "角铁 1")).toBe(true);

    // 扁铁 -> Flat Bar
    expect(matchesHardwareSearch("Flat Bar — 1/2'' x 3mm x 6m", "扁铁")).toBe(true);
    expect(matchesHardwareSearch("Flat Bar — 1/2'' x 3mm x 6m", "扁铁 1/2")).toBe(true);

    // 红砖 -> Red Brick
    expect(matchesHardwareSearch("Red Brick — 600 pcs", "红砖")).toBe(true);
    expect(matchesHardwareSearch("Red Brick — 600 pcs", "红砖 600")).toBe(true);

    // 沙砖 -> Sand Brick
    expect(matchesHardwareSearch("Sand Brick — 600 pcs", "沙砖")).toBe(true);
    expect(matchesHardwareSearch("Sand Brick — 600 pcs", "沙砖 600")).toBe(true);

    // 石膏板 -> Cement Board
    expect(matchesHardwareSearch("Cement Board — 4 x 8 x 6mm", "石膏板")).toBe(true);
    expect(matchesHardwareSearch("Cement Board — 4 x 8 x 6mm", "石膏板 6mm")).toBe(true);

    // 刺线 -> Barbed Wire
    expect(matchesHardwareSearch("Barbed Wire — 35 lbs (16 kg)", "刺线")).toBe(true);
    expect(matchesHardwareSearch("Barbed Wire — 35 lbs (16 kg)", "刺线 16kg")).toBe(true);

    // 厚 / 薄 -> tebal / nipis
    expect(matchesHardwareSearch("PVC Pipe — 1'' x 6m (23mm) (tebal)", "厚")).toBe(true);
    expect(matchesHardwareSearch("PVC Pipe — 1'' x 6m (23mm) (nipis)", "薄")).toBe(true);
  });

  it("returns true for empty or whitespace query", () => {
    expect(matchesHardwareSearch("Cement — 50 kg", "")).toBe(true);
    expect(matchesHardwareSearch("Cement — 50 kg", "   ")).toBe(true);
  });

  it("returns false when any token does not match", () => {
    expect(matchesHardwareSearch("Cement — 50 kg", "cement 100kg")).toBe(false);
    expect(matchesHardwareSearch("Plywood — 4 x 8 x 9mm", "papan besi")).toBe(false);
    expect(matchesHardwareSearch("Solid Door — 36'' x 83''", "door paip")).toBe(false);
  });
});
