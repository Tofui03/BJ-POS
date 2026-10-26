import type { SeedItem } from "./schema.js";
import type { Unit } from "./types.js";

export const STORE_NAME = "Borneo Jasa Sdn. Bhd.";
export const STORE_NAME_CN = "立強有限公司";
export const STORE_REG_NO = "(227533-X)";
export const STORE_ADDRESS =
  "Lot No. 2, Jalan Bariawa, Depan St Margaret Church, P.O. Box 56, 89007 Keningau, Sabah";
export const STORE_TEL = "087-336333 / 016-8335313";
export const STORE_EMAIL = "Borneojasa_sb@yahoo.com";
export const STORE_TIN = "C7875887040";
export const STORE_MSIC = "47520";
export const STORE_BANKS = "Maybank: 010095302338 | Public Bank: 3103279113";

/** Internal item key used for ad-hoc Lain-lain / miscellaneous custom lines. */
export const LAIN_LAIN_KEY = "hw_lain_lain";

/** Quick-select tags for Lain-lain miscellaneous items on the till. */
export const LAIN_LAIN_TAGS = [
  "Lain-lain",
  "Skru / Screw",
  "Paku / Nail",
  "Upah / Labour",
  "Tambang / Delivery",
  "Potong / Cut",
] as const;

/** Till category chips — English key used in filters; BM shown via categoryButtonLabel. */
export const HARDWARE_CATEGORIES = [
  "All",
  "Cement & Brick",
  "Board & Wood",
  "Tank, Roof & Gutter",
  "Door & Frame",
  "Plastic Pipe",
  "Metal Pipe",
  "Fence & Steel",
  "Lain-lain",
] as const;

export type HardwareCategory = (typeof HARDWARE_CATEGORIES)[number];
export type HardwareSaleCategory = Exclude<HardwareCategory, "All">;

export interface CategoryI18nEntry {
  en: string;
  bm: string;
  zh: string;
}

export type HardwareCategoryI18nMap = Record<HardwareSaleCategory, CategoryI18nEntry> &
  Record<string, CategoryI18nEntry>;

/** EN / BM / ZH labels for multilingual till buttons. */
export const HARDWARE_CATEGORY_I18N: HardwareCategoryI18nMap = {
  "Cement & Brick": { en: "Cement & Brick", bm: "Simen & Bata", zh: "洋灰与沙石砖" },
  "Board & Wood": { en: "Board & Wood", bm: "Papan / Kayu", zh: "木板与木材" },
  "Tank, Roof & Gutter": { en: "Tank, Roof & Gutter", bm: "Tangki, Atap & Gutter", zh: "水槽屋顶水笕" },
  "Door & Frame": { en: "Door & Frame", bm: "Pintu & Bingkai", zh: "门与门框" },
  "Plastic Pipe": { en: "Plastic Pipe", bm: "Paip Plastik", zh: "塑料水管" },
  "Metal Pipe": { en: "Metal Pipe", bm: "Paip Besi", zh: "铁喉白铁管" },
  "Fence & Steel": { en: "Fence & Steel", bm: "Pagar & Besi", zh: "铁丝网与钢材" },
  "Lain-lain": { en: "Others", bm: "Lain-lain", zh: "杂项" },

  // All and extended hardware categories (15+ categories supported)
  "All": { en: "All", bm: "Semua", zh: "全部" },
  "Cement & Sand": { en: "Cement & Sand", bm: "Simen & Pasir", zh: "洋灰与沙石" },
  "Steel & Metal": { en: "Steel & Metal", bm: "Keluli & Besi", zh: "钢铁五金" },
  "Paint & Chemical": { en: "Paint & Chemical", bm: "Cat & Bahan Kimia", zh: "油漆与化工" },
  "Electrical & Wiring": { en: "Electrical & Wiring", bm: "Elektrik & Pendawaian", zh: "电器电线" },
  "Plumbing & Sanitary": { en: "Plumbing & Sanitary", bm: "Paip & Sanitari", zh: "卫浴水暖" },
  "Tools & Hardware": { en: "Tools & Hardware", bm: "Alatan & Perkakas", zh: "工具五金" },
  "Roofing & Tiles": { en: "Roofing & Tiles", bm: "Bumbung & Jubin", zh: "屋顶与地砖" },
};

/** e.g. "Cement & Brick / Simen & Bata" or localized text. */
export function categoryButtonLabel(
  category: HardwareCategory | string,
  locale?: "en" | "ms" | "bm" | "zh" | "bi"
): string {
  if (category === "All") {
    if (locale === "zh") return "全部";
    if (locale === "ms" || locale === "bm") return "Semua";
    if (locale === "en") return "All";
    return "All / Semua";
  }
  const labels = HARDWARE_CATEGORY_I18N[category];
  if (!labels) return String(category);
  if (locale === "zh") return labels.zh;
  if (locale === "ms" || locale === "bm") return labels.bm;
  if (locale === "en") return labels.en;
  return `${labels.en} / ${labels.bm}`;
}

/**
 * Split a full item name (e.g. "Plywood — 4 x 8 x 9mm") into its main product
 * group ("Plywood") and specification label ("4 x 8 x 9mm").
 */
export function splitItemName(name: string): { groupName: string; specLabel: string } {
  const idx = name.indexOf(" — ");
  if (idx >= 0) {
    return {
      groupName: name.slice(0, idx).trim(),
      specLabel: name.slice(idx + 3).trim(),
    };
  }
  const dashIdx = name.indexOf(" - ");
  if (dashIdx >= 0) {
    return {
      groupName: name.slice(0, dashIdx).trim(),
      specLabel: name.slice(dashIdx + 3).trim(),
    };
  }
  return { groupName: name.trim(), specLabel: "" };
}

/**
 * Map a main product group name to its hardware store category.
 * Unknown names fall into Lain-lain so every SKU has a till home.
 */
export function categoryForGroup(groupName: string): HardwareSaleCategory {
  const g = groupName.toLowerCase().trim();
  if (g === "cement" || g === "cement gum" || g.includes("brick") || g.includes("bata") || g.includes("simen")) {
    return "Cement & Brick";
  }
  if (
    g.includes("plywood") ||
    g.includes("wood") ||
    g.includes("board") ||
    g.includes("sheet") ||
    g.includes("plank") ||
    g.includes("papan") ||
    g.includes("kayu")
  ) {
    return "Board & Wood";
  }
  if (g.includes("tank") || g.includes("tangki") || g.includes("zinc") || g.includes("gutter") || g.includes("atap")) {
    return "Tank, Roof & Gutter";
  }
  if (g.includes("door") || g.includes("pintu") || g.includes("frame") || g.includes("bingkai")) {
    return "Door & Frame";
  }
  if (
    g === "abs pipe" ||
    g === "pvc pipe" ||
    g === "upvc pipe" ||
    g === "poly pipe" ||
    g === "spiral pipe" ||
    g.includes("paip plastik")
  ) {
    return "Plastic Pipe";
  }
  if (g.includes("pipe") || g.includes("paip") || g === "ultra gal") {
    return "Metal Pipe";
  }
  if (
    g.includes("brc") ||
    g.includes("chain link") ||
    g.includes("wire") ||
    g.includes("bar") ||
    g.includes("tube") ||
    g.includes("channel") ||
    g.includes("pagar") ||
    g.includes("besi")
  ) {
    return "Fence & Steel";
  }
  return "Lain-lain";
}

/** Normalize CSV / bilingual unit strings to a canonical Unit. */
export function mapCsvUnit(rawUnit: string): Unit {
  const u = (rawUnit || "").toLowerCase().trim();
  if (u.includes("batang")) return "batang";
  if (u.includes("bag") || u.includes("karung")) return "bag";
  if (u.includes("bundle")) return "bundle";
  if (u.includes("roll") || u.includes("gulung")) return "roll";
  if (u === "unit") return "unit";
  if (u === "ft" || u === "fts") return "ft";
  if (u === "kg") return "kg";
  if (u === "box") return "box";
  if (u === "pack") return "pack";
  if (u.includes("pcs") || u.includes("piece")) return "pcs";
  return "pcs";
}

/** RFC-style CSV row split (handles quotes; commas inside quotes). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Parse a hardware store CSV (columns: No, Item Name, Specification / Size, Retail Price, Unit)
 * into SeedItem entries for importing into the catalog. Keys are stable across re-imports.
 */
export function parseHardwareCsv(csvText: string): SeedItem[] {
  const rows = csvText.split(/\r?\n/);
  const out: SeedItem[] = [];
  let seq = 0;
  for (let r = 1; r < rows.length; r++) {
    const line = rows[r]!;
    if (!line.trim()) continue;
    const cols = splitCsvLine(line);
    const rawName = (cols[1] ?? "").trim();
    if (!rawName) continue;
    seq += 1;
    const no = (cols[0] ?? "").trim() || String(seq);
    const rawSpec = (cols[2] ?? "").trim();
    const rawPrice = (cols[3] ?? "").trim();
    const rawUnit = (cols[4] ?? "").trim();
    const unit = mapCsvUnit(rawUnit);
    const fullName = rawSpec ? `${rawName} — ${rawSpec}` : rawName;
    if (rawPrice.includes("/") && rawPrice.toLowerCase().includes("ft")) {
      const [wholeStr, ftPart] = rawPrice.split("/").map((x) => x.trim());
      const wholeCents = Math.round((parseFloat(wholeStr ?? "0") || 0) * 100);
      const ftCents = Math.round((parseFloat(ftPart ?? "0") || 0) * 100);
      out.push({
        key: `hw_csv_${no}_batang`,
        name: `${rawName} — ${rawSpec || "whole"}`,
        unit: "batang",
        priceCents: wholeCents,
        image: "",
      });
      out.push({
        key: `hw_csv_${no}_ft`,
        name: `${rawName} — ${rawSpec} (per ft)`,
        unit: "ft",
        priceCents: ftCents,
        image: "",
      });
    } else {
      const firstPrice = rawPrice.split("/")[0]?.trim() ?? "0";
      const priceCents = Math.round((parseFloat(firstPrice) || 0) * 100);
      out.push({
        key: `hw_csv_${no}`,
        name: fullName,
        unit,
        priceCents,
        image: "",
      });
    }
  }
  return out;
}

/**
 * Keyword alias definitions mapping English keywords to bilingual BM & ZH aliases
 * covering all 43 hardware catalog groups and common workshop / retail synonyms.
 */
export const HARDWARE_SEARCH_ALIASES: Array<{ en: string[]; aliases: string[] }> = [
  { en: ["cement"], aliases: ["simen", "洋灰", "水泥"] },
  { en: ["cement gum"], aliases: ["gam", "gum", "洋灰胶", "瓷砖胶", "胶"] },
  { en: ["brick"], aliases: ["bata", "砖"] },
  { en: ["sand brick"], aliases: ["bata pasir", "沙砖", "白砖"] },
  { en: ["red brick"], aliases: ["bata merah", "红砖"] },
  { en: ["plywood", "wood", "board", "sheet", "plank"], aliases: ["papan", "kayu", "夹板", "木", "木板", "胶合板"] },
  { en: ["cement board"], aliases: ["石膏板", "水泥板", "洋灰板"] },
  { en: ["white board"], aliases: ["白板"] },
  { en: ["asbestos"], aliases: ["石棉", "石棉瓦"] },
  { en: ["pine wood"], aliases: ["松木", "木方", "白木"] },
  { en: ["tank", "water tank"], aliases: ["tangki", "tangki air", "水槽", "水塔", "蓄水池"] },
  { en: ["zinc"], aliases: ["atap", "zink", "锌", "锌片", "铁皮", "屋瓦", "bumbung"] },
  { en: ["gutter"], aliases: ["longkang", "水笕", "水槽沟", "天沟", "檐沟"] },
  { en: ["door"], aliases: ["pintu", "门"] },
  { en: ["folding"], aliases: ["lipat", "折叠", "折叠门"] },
  { en: ["frame"], aliases: ["bingkai", "门框", "框"] },
  { en: ["pipe"], aliases: ["paip", "喉", "水管", "管"] },
  { en: ["gi pipe", "g.i pipe", "ultra gal"], aliases: ["gi", "galvanized", "paip besi", "paip gi", "白铁", "白铁管", "白铁喉", "镀锌管"] },
  { en: ["black pipe"], aliases: ["paip hitam", "黑铁", "黑铁管", "黑铁喉"] },
  { en: ["poly pipe"], aliases: ["paip poly", "paip hitam", "hdpe", "黑喉", "聚乙烯管"] },
  { en: ["pvc pipe", "upvc pipe", "abs pipe"], aliases: ["paip plastik", "塑胶管", "塑料管", "胶喉", "白管", "蓝管"] },
  { en: ["spiral pipe"], aliases: ["波纹管", "涵管"] },
  { en: ["brc", "chain link", "wire", "mesh", "fence"], aliases: ["pagar", "dawai", "网", "铁丝", "铁网", "篱笆网"] },
  { en: ["barbed wire"], aliases: ["dawai duri", "刺线", "铁蒺藜", "倒刺线"] },
  { en: ["steel", "bar", "tube", "channel", "rebar"], aliases: ["besi", "铁", "钢", "keluli"] },
  { en: ["rebar", "steel bar"], aliases: ["besi bunga", "besi y", "螺纹钢", "花铁", "圆铁", "钢筋"] },
  { en: ["flat bar"], aliases: ["besi leper", "扁铁"] },
  { en: ["angle bar"], aliases: ["besi siku", "角铁", "L铁"] },
  { en: ["square tube"], aliases: ["besi kotak", "hollow", "方管", "四方铁", "方通"] },
  { en: ["rec tube"], aliases: ["besi kotak", "hollow", "扁方管", "长方铁", "矩管"] },
  { en: ["u channel"], aliases: ["槽钢", "U槽"] },
  { en: ["roller", "refill roller"], aliases: ["penggelek", "滚筒", "油漆刷", "刷"] },
  { en: ["tebal", "heavy"], aliases: ["thick", "厚", "重型"] },
  { en: ["nipis", "light"], aliases: ["thin", "薄", "轻型"] },
];

/**
 * Normalize dimensions, quotes, punctuation and units for robust hardware store search.
 * Treats ", '', and in/inch equivalently for dimensions, strips abbreviation dots,
 * and normalizes compact dimensions (e.g. 4x8 -> 4 x 8).
 */
export function normalizeHardwareSearchText(text: string): string {
  let s = text.toLowerCase();
  // Standardize double-quotes and two single-quotes to "
  s = s.replace(/''/g, '"');
  // Strip dots inside letter abbreviations: e.g. "g.i" -> "gi", "u.p.v.c" -> "upvc", while preserving decimal numbers
  while (/([a-z])\.([a-z])/i.test(s)) {
    s = s.replace(/([a-z])\.([a-z])/gi, "$1$2");
  }
  s = s.replace(/\b([a-z]+)\.(?=\s|$|[^\w.])/gi, "$1");
  s = s.replace(/\bg\.i\.?(?=\s|$|[^\w])/gi, "gi");
  // Convert explicit inch representations: e.g. '1 inch', '1 in', '1/2in' -> '1"'
  s = s.replace(/(\d+(?:\/\d+)?)\s*(?:inch(?:es)?|in\b)/g, '$1"');
  s = s.replace(/(\d+(?:\/\d+)?)\s*寸/g, '$1"');
  // Convert feet representations: e.g. '12 ft', '12fts', '12 feet' -> "12'"
  s = s.replace(/(\d+(?:\/\d+)?)\s*(?:fts?|feet)\b/g, "$1'");
  // Normalize dimension x spacing so that both "4x8" and "4 x 8", "1x2x10" and "1 x 2 x 10" match
  s = s.replace(/(\d|['"])\s*x\s*(?=\d)/g, "$1 x ");
  s = s.replace(/(\d|['"])\s*x\s*(?=\d)/g, "$1 x ");
  // Normalize spacing between numbers and metric units (e.g. '50kg' -> '50 kg', '6mtr' -> '6 m')
  s = s.replace(/(\d+(?:\.\d+)?)\s*(kg|lbs?|mm|mtr?|cm|m)\b/g, "$1 $2");
  // Normalize spacing between CJK and alphanumeric characters (e.g. '水泥50kg' -> '水泥 50 kg')
  s = s.replace(/([\u4e00-\u9fa5])([a-z0-9])/gi, "$1 $2").replace(/([a-z0-9])([\u4e00-\u9fa5])/gi, "$1 $2");
  return s.trim();
}

/**
 * Matches an item name against a search query supporting multi-token matching,
 * dimension/quote normalization, and bilingual (BM/ZH) category & hardware aliases.
 */
export function matchesHardwareSearch(itemName: string, query: string): boolean {
  const q = normalizeHardwareSearchText(query).trim();
  if (!q) return true;

  const normItem = normalizeHardwareSearchText(itemName);
  const searchCorpusParts = [normItem];

  for (const group of HARDWARE_SEARCH_ALIASES) {
    if (
      group.en.some((k) => normItem.includes(normalizeHardwareSearchText(k))) ||
      group.aliases.some((a) => normItem.includes(normalizeHardwareSearchText(a)))
    ) {
      searchCorpusParts.push(...group.aliases);
      searchCorpusParts.push(...group.en);
    }
  }

  const corpus = searchCorpusParts.join(" ");
  const tokens = q.split(/\s+/).filter(Boolean);

  return tokens.every((token) => corpus.includes(token));
}

export const HARDWARE_SEED_ITEMS: SeedItem[] = [
  {
    "key": "hw_1",
    "name": "Cement \u2014 50 kg",
    "unit": "bag",
    "priceCents": 2400,
    "image": ""
  },
  {
    "key": "hw_81",
    "name": "Cement Gum \u2014 50 kg",
    "unit": "bag",
    "priceCents": 2400,
    "image": ""
  },
  {
    "key": "hw_2",
    "name": "Sand Brick \u2014 600 pcs",
    "unit": "bundle",
    "priceCents": 25000,
    "image": ""
  },
  {
    "key": "hw_3",
    "name": "Red Brick \u2014 600 pcs",
    "unit": "bundle",
    "priceCents": 35000,
    "image": ""
  },
  {
    "key": "hw_8",
    "name": "Plywood \u2014 4 x 8 x 3mm",
    "unit": "pcs",
    "priceCents": 2300,
    "image": ""
  },
  {
    "key": "hw_9",
    "name": "Plywood \u2014 4 x 8 x 3.6mm",
    "unit": "pcs",
    "priceCents": 2980,
    "image": ""
  },
  {
    "key": "hw_10",
    "name": "Plywood \u2014 4 x 8 x 5.2mm",
    "unit": "pcs",
    "priceCents": 4800,
    "image": ""
  },
  {
    "key": "hw_11",
    "name": "Plywood \u2014 4 x 8 x 9mm",
    "unit": "pcs",
    "priceCents": 5900,
    "image": ""
  },
  {
    "key": "hw_12",
    "name": "Plywood \u2014 4 x 8 x 12mm (W/P)",
    "unit": "pcs",
    "priceCents": 7900,
    "image": ""
  },
  {
    "key": "hw_13",
    "name": "Plywood \u2014 4 x 8 x 12mm (BBC)",
    "unit": "pcs",
    "priceCents": 6500,
    "image": ""
  },
  {
    "key": "hw_14",
    "name": "Plywood \u2014 4 x 8 x 12mm (W/P TECO)",
    "unit": "pcs",
    "priceCents": 9500,
    "image": ""
  },
  {
    "key": "hw_18",
    "name": "Plywood \u2014 4 x 8 x 12mm (W/P RED)",
    "unit": "pcs",
    "priceCents": 7800,
    "image": ""
  },
  {
    "key": "hw_15",
    "name": "White Board \u2014 4 x 8 x 3mm",
    "unit": "pcs",
    "priceCents": 6800,
    "image": ""
  },
  {
    "key": "hw_16",
    "name": "Asbestos Sheet \u2014 4 x 4 x 3.2mm",
    "unit": "pcs",
    "priceCents": 1480,
    "image": ""
  },
  {
    "key": "hw_69",
    "name": "Cement Board \u2014 4 x 8 x 3.2mm",
    "unit": "pcs",
    "priceCents": 2300,
    "image": ""
  },
  {
    "key": "hw_70",
    "name": "Cement Board \u2014 4 x 8 x 6mm",
    "unit": "pcs",
    "priceCents": 6800,
    "image": ""
  },
  {
    "key": "hw_71",
    "name": "Cement Board \u2014 4 x 8 x 9mm",
    "unit": "pcs",
    "priceCents": 9800,
    "image": ""
  },
  {
    "key": "hw_72",
    "name": "Cement Board \u2014 4 x 8 x 12mm",
    "unit": "pcs",
    "priceCents": 12800,
    "image": ""
  },
  {
    "key": "hw_17",
    "name": "UAC Plank \u2014 9'' x 12'",
    "unit": "pcs",
    "priceCents": 3900,
    "image": ""
  },
  {
    "key": "hw_19",
    "name": "Pine Wood \u2014 1 x 2 x 10'",
    "unit": "batang",
    "priceCents": 1480,
    "image": ""
  },
  {
    "key": "hw_28",
    "name": "Pine Wood \u2014 1 x 2 x 12'",
    "unit": "batang",
    "priceCents": 1680,
    "image": ""
  },
  {
    "key": "hw_31",
    "name": "Pine Wood \u2014 1 x 4 x 10'",
    "unit": "batang",
    "priceCents": 2980,
    "image": ""
  },
  {
    "key": "hw_25",
    "name": "Pine Wood \u2014 1 x 6 x 10'",
    "unit": "batang",
    "priceCents": 3900,
    "image": ""
  },
  {
    "key": "hw_26",
    "name": "Pine Wood \u2014 1 x 6 x 12'",
    "unit": "batang",
    "priceCents": 4300,
    "image": ""
  },
  {
    "key": "hw_30",
    "name": "Pine Wood \u2014 1 x 8 x 10'",
    "unit": "batang",
    "priceCents": 4980,
    "image": ""
  },
  {
    "key": "hw_27",
    "name": "Pine Wood \u2014 1 x 8 x 12'",
    "unit": "batang",
    "priceCents": 5800,
    "image": ""
  },
  {
    "key": "hw_29",
    "name": "Pine Wood \u2014 2 x 2 x 8'",
    "unit": "batang",
    "priceCents": 1900,
    "image": ""
  },
  {
    "key": "hw_20",
    "name": "Pine Wood \u2014 2 x 2 x 10'",
    "unit": "batang",
    "priceCents": 2600,
    "image": ""
  },
  {
    "key": "hw_21",
    "name": "Pine Wood \u2014 2 x 2 x 12'",
    "unit": "batang",
    "priceCents": 2900,
    "image": ""
  },
  {
    "key": "hw_22",
    "name": "Pine Wood \u2014 2 x 3 x 10'",
    "unit": "batang",
    "priceCents": 3500,
    "image": ""
  },
  {
    "key": "hw_23",
    "name": "Pine Wood \u2014 2 x 3 x 12'",
    "unit": "batang",
    "priceCents": 3900,
    "image": ""
  },
  {
    "key": "hw_32",
    "name": "Pine Wood \u2014 2 x 4 x 10'",
    "unit": "batang",
    "priceCents": 4300,
    "image": ""
  },
  {
    "key": "hw_24",
    "name": "Pine Wood \u2014 2 x 4 x 12'",
    "unit": "batang",
    "priceCents": 4800,
    "image": ""
  },
  {
    "key": "hw_4",
    "name": "Water Tank \u2014 100G \u00b7 Blue tank (BOWANG)",
    "unit": "unit",
    "priceCents": 18500,
    "image": ""
  },
  {
    "key": "hw_5",
    "name": "Water Tank \u2014 200G \u00b7 Blue tank (BOWANG)",
    "unit": "unit",
    "priceCents": 28500,
    "image": ""
  },
  {
    "key": "hw_6",
    "name": "Water Tank \u2014 300G \u00b7 Blue tank (BOWANG)",
    "unit": "unit",
    "priceCents": 38500,
    "image": ""
  },
  {
    "key": "hw_7",
    "name": "Water Tank \u2014 400G \u00b7 Blue tank (BOWANG)",
    "unit": "unit",
    "priceCents": 39800,
    "image": ""
  },
  {
    "key": "hw_33",
    "name": "Zinc \u2014 6'",
    "unit": "pcs",
    "priceCents": 1480,
    "image": ""
  },
  {
    "key": "hw_34",
    "name": "Zinc \u2014 8'",
    "unit": "pcs",
    "priceCents": 1980,
    "image": ""
  },
  {
    "key": "hw_35",
    "name": "Zinc \u2014 10'",
    "unit": "pcs",
    "priceCents": 2480,
    "image": ""
  },
  {
    "key": "hw_36",
    "name": "Zinc \u2014 12'",
    "unit": "pcs",
    "priceCents": 2980,
    "image": ""
  },
  {
    "key": "hw_37",
    "name": "Zinc \u2014 14'",
    "unit": "pcs",
    "priceCents": 3480,
    "image": ""
  },
  {
    "key": "hw_38",
    "name": "Zinc \u2014 Ridge 8' x 12''",
    "unit": "pcs",
    "priceCents": 1980,
    "image": ""
  },
  {
    "key": "hw_39",
    "name": "Zinc \u2014 Plastic 8' x 0.8mm",
    "unit": "pcs",
    "priceCents": 6800,
    "image": ""
  },
  {
    "key": "hw_46",
    "name": "Rain Gutter \u2014 (A)",
    "unit": "pcs",
    "priceCents": 3300,
    "image": ""
  },
  {
    "key": "hw_47",
    "name": "Rain Gutter \u2014 (B)",
    "unit": "pcs",
    "priceCents": 3100,
    "image": ""
  },
  {
    "key": "hw_48",
    "name": "Rain Gutter \u2014 (C)",
    "unit": "pcs",
    "priceCents": 2980,
    "image": ""
  },
  {
    "key": "hw_49",
    "name": "Rain Gutter \u2014 Gutter Hook",
    "unit": "pcs",
    "priceCents": 680,
    "image": ""
  },
  {
    "key": "hw_73",
    "name": "UPVC Gutter \u2014 Rain Gutter 5.8m",
    "unit": "pcs",
    "priceCents": 14800,
    "image": ""
  },
  {
    "key": "hw_74",
    "name": "UPVC Gutter \u2014 Gutter Bracket",
    "unit": "pcs",
    "priceCents": 750,
    "image": ""
  },
  {
    "key": "hw_75",
    "name": "UPVC Gutter \u2014 End Cap",
    "unit": "pcs",
    "priceCents": 880,
    "image": ""
  },
  {
    "key": "hw_76",
    "name": "UPVC Gutter \u2014 External Angle",
    "unit": "pcs",
    "priceCents": 4500,
    "image": ""
  },
  {
    "key": "hw_77",
    "name": "UPVC Gutter \u2014 Gutter Joiner",
    "unit": "pcs",
    "priceCents": 980,
    "image": ""
  },
  {
    "key": "hw_78",
    "name": "UPVC Gutter \u2014 Gutter Nozzle",
    "unit": "pcs",
    "priceCents": 3900,
    "image": ""
  },
  {
    "key": "hw_50",
    "name": "Solid Door \u2014 33 3/4'' x 83''",
    "unit": "unit",
    "priceCents": 33800,
    "image": ""
  },
  {
    "key": "hw_51",
    "name": "Solid Door \u2014 36'' x 83''",
    "unit": "unit",
    "priceCents": 39800,
    "image": ""
  },
  {
    "key": "hw_61",
    "name": "Solid Door \u2014 Double \u00b7 53 5/8 x 83'' (TG 35)",
    "unit": "unit",
    "priceCents": 63800,
    "image": ""
  },
  {
    "key": "hw_52",
    "name": "MP 9 Door \u2014 33 3/4'' x 83''",
    "unit": "unit",
    "priceCents": 19800,
    "image": ""
  },
  {
    "key": "hw_53",
    "name": "MP 9 Door \u2014 36'' x 83''",
    "unit": "unit",
    "priceCents": 19800,
    "image": ""
  },
  {
    "key": "hw_54",
    "name": "Plywood Door \u2014 33 3/4'' x 83''",
    "unit": "unit",
    "priceCents": 12800,
    "image": ""
  },
  {
    "key": "hw_55",
    "name": "Plywood Door \u2014 36'' x 83''",
    "unit": "unit",
    "priceCents": 12800,
    "image": ""
  },
  {
    "key": "hw_56",
    "name": "Pine Door \u2014 33 3/4'' x 83''",
    "unit": "unit",
    "priceCents": 28800,
    "image": ""
  },
  {
    "key": "hw_57",
    "name": "Pine Door \u2014 36'' x 83''",
    "unit": "unit",
    "priceCents": 29800,
    "image": ""
  },
  {
    "key": "hw_62",
    "name": "PVC Door \u2014 30'' x 72''",
    "unit": "unit",
    "priceCents": 13800,
    "image": ""
  },
  {
    "key": "hw_63",
    "name": "PVC Door \u2014 30'' x 82''",
    "unit": "unit",
    "priceCents": 16800,
    "image": ""
  },
  {
    "key": "hw_65",
    "name": "PVC Door \u2014 Folding \u00b7 31'' x 82''",
    "unit": "unit",
    "priceCents": 19800,
    "image": ""
  },
  {
    "key": "hw_64",
    "name": "Aluminium Door \u2014 30'' x 72''",
    "unit": "unit",
    "priceCents": 15800,
    "image": ""
  },
  {
    "key": "hw_58",
    "name": "Wooden Door Frame \u2014 2 x 5 x 33 3/4 x 83'' (SERAYA)",
    "unit": "unit",
    "priceCents": 9800,
    "image": ""
  },
  {
    "key": "hw_59",
    "name": "Wooden Door Frame \u2014 2 x 5 x 33 3/4 x 83'' (KAPOR)",
    "unit": "unit",
    "priceCents": 13800,
    "image": ""
  },
  {
    "key": "hw_60",
    "name": "Wooden Door Frame \u2014 Double \u00b7 2 x 6 x 53 5/8 x 83'' (KAPOR)",
    "unit": "unit",
    "priceCents": 19800,
    "image": ""
  },
  {
    "key": "hw_68",
    "name": "Metal Door Frame \u2014 30'' x 72''",
    "unit": "unit",
    "priceCents": 10800,
    "image": ""
  },
  {
    "key": "hw_67",
    "name": "Metal Door Frame \u2014 33 3/4 x 83''",
    "unit": "unit",
    "priceCents": 10800,
    "image": ""
  },
  {
    "key": "hw_66",
    "name": "Metal Door Frame \u2014 36'' x 83''",
    "unit": "unit",
    "priceCents": 11800,
    "image": ""
  },
  {
    "key": "hw_40",
    "name": "ABS Pipe \u2014 1/2''",
    "unit": "batang",
    "priceCents": 2100,
    "image": ""
  },
  {
    "key": "hw_41",
    "name": "ABS Pipe \u2014 3/4''",
    "unit": "batang",
    "priceCents": 3200,
    "image": ""
  },
  {
    "key": "hw_42",
    "name": "ABS Pipe \u2014 1''",
    "unit": "batang",
    "priceCents": 4300,
    "image": ""
  },
  {
    "key": "hw_43",
    "name": "ABS Pipe \u2014 1 1/4''",
    "unit": "batang",
    "priceCents": 7800,
    "image": ""
  },
  {
    "key": "hw_44",
    "name": "ABS Pipe \u2014 1 1/2''",
    "unit": "batang",
    "priceCents": 9800,
    "image": ""
  },
  {
    "key": "hw_45",
    "name": "ABS Pipe \u2014 2''",
    "unit": "batang",
    "priceCents": 18500,
    "image": ""
  },
  {
    "key": "hw_83",
    "name": "PVC Pipe \u2014 1/2'' x 6m (15mm)",
    "unit": "batang",
    "priceCents": 1180,
    "image": ""
  },
  {
    "key": "hw_84",
    "name": "PVC Pipe \u2014 1/2'' (Class 7)",
    "unit": "batang",
    "priceCents": 2300,
    "image": ""
  },
  {
    "key": "hw_85",
    "name": "PVC Pipe \u2014 3/4'' x 6m (20mm)",
    "unit": "batang",
    "priceCents": 1480,
    "image": ""
  },
  {
    "key": "hw_86",
    "name": "PVC Pipe \u2014 3/4'' (Class 7)",
    "unit": "batang",
    "priceCents": 2800,
    "image": ""
  },
  {
    "key": "hw_87",
    "name": "PVC Pipe \u2014 1'' x 6m (23mm) (nipis)",
    "unit": "batang",
    "priceCents": 1980,
    "image": ""
  },
  {
    "key": "hw_88",
    "name": "PVC Pipe \u2014 1'' x 6m (23mm) (tebal)",
    "unit": "batang",
    "priceCents": 2880,
    "image": ""
  },
  {
    "key": "hw_89",
    "name": "PVC Pipe \u2014 1'' x 6m (Class 7)",
    "unit": "batang",
    "priceCents": 3800,
    "image": ""
  },
  {
    "key": "hw_90",
    "name": "PVC Pipe \u2014 1 1/4'' x 6m (nipis)",
    "unit": "batang",
    "priceCents": 2200,
    "image": ""
  },
  {
    "key": "hw_91",
    "name": "PVC Pipe \u2014 1 1/4'' x 6m (tebal)",
    "unit": "batang",
    "priceCents": 2700,
    "image": ""
  },
  {
    "key": "hw_92",
    "name": "PVC Pipe \u2014 1 1/2'' x 6m (nipis)",
    "unit": "batang",
    "priceCents": 2500,
    "image": ""
  },
  {
    "key": "hw_93",
    "name": "PVC Pipe \u2014 1 1/2'' x 6m (tebal)",
    "unit": "batang",
    "priceCents": 3500,
    "image": ""
  },
  {
    "key": "hw_94",
    "name": "PVC Pipe \u2014 2'' x 6m",
    "unit": "batang",
    "priceCents": 2980,
    "image": ""
  },
  {
    "key": "hw_95",
    "name": "PVC Pipe \u2014 3'' x 6m (80mm)",
    "unit": "batang",
    "priceCents": 5900,
    "image": ""
  },
  {
    "key": "hw_96",
    "name": "PVC Pipe \u2014 3'' x 6m (AE) (tebal)",
    "unit": "batang",
    "priceCents": 5980,
    "image": ""
  },
  {
    "key": "hw_97",
    "name": "PVC Pipe \u2014 3'' x 6m (D) (tebal)",
    "unit": "batang",
    "priceCents": 6800,
    "image": ""
  },
  {
    "key": "hw_98",
    "name": "PVC Pipe \u2014 4'' x 6m (100mm)",
    "unit": "batang",
    "priceCents": 6500,
    "image": ""
  },
  {
    "key": "hw_99",
    "name": "PVC Pipe \u2014 4'' x 6m (AE) (B)",
    "unit": "batang",
    "priceCents": 7900,
    "image": ""
  },
  {
    "key": "hw_100",
    "name": "PVC Pipe \u2014 4'' x 6m (D)",
    "unit": "batang",
    "priceCents": 12800,
    "image": ""
  },
  {
    "key": "hw_101",
    "name": "PVC Pipe \u2014 6'' x 6m (155mm)",
    "unit": "batang",
    "priceCents": 15800,
    "image": ""
  },
  {
    "key": "hw_102",
    "name": "PVC Pipe \u2014 6'' x 6m (D) (tebal)",
    "unit": "batang",
    "priceCents": 27800,
    "image": ""
  },
  {
    "key": "hw_103",
    "name": "PVC Pipe \u2014 8'' x 6m (AE) (tebal)",
    "unit": "batang",
    "priceCents": 32000,
    "image": ""
  },
  {
    "key": "hw_80",
    "name": "PVC Pipe \u2014 (Wiring)",
    "unit": "batang",
    "priceCents": 1500,
    "image": ""
  },
  {
    "key": "hw_104",
    "name": "UPVC Pipe \u2014 1 1/4'' x 6m",
    "unit": "batang",
    "priceCents": 2300,
    "image": ""
  },
  {
    "key": "hw_105",
    "name": "UPVC Pipe \u2014 1 1/2'' x 6m",
    "unit": "batang",
    "priceCents": 2900,
    "image": ""
  },
  {
    "key": "hw_106",
    "name": "UPVC Pipe \u2014 2'' x 6m",
    "unit": "batang",
    "priceCents": 3500,
    "image": ""
  },
  {
    "key": "hw_107",
    "name": "UPVC Pipe \u2014 2'' x 6m (SIRIM)",
    "unit": "batang",
    "priceCents": 7800,
    "image": ""
  },
  {
    "key": "hw_108",
    "name": "UPVC Pipe \u2014 3'' x 6m (82mm)",
    "unit": "batang",
    "priceCents": 5900,
    "image": ""
  },
  {
    "key": "hw_109",
    "name": "UPVC Pipe \u2014 4'' x 6m",
    "unit": "batang",
    "priceCents": 6500,
    "image": ""
  },
  {
    "key": "hw_110",
    "name": "UPVC Pipe \u2014 4'' x 6m (2.2mm) (tebal)",
    "unit": "batang",
    "priceCents": 9800,
    "image": ""
  },
  {
    "key": "hw_111",
    "name": "UPVC Pipe \u2014 4'' x 6m x 3.2mm (SIRIM)",
    "unit": "batang",
    "priceCents": 14800,
    "image": ""
  },
  {
    "key": "hw_112",
    "name": "UPVC Pipe \u2014 6'' x 5.8m",
    "unit": "batang",
    "priceCents": 14800,
    "image": ""
  },
  {
    "key": "hw_113",
    "name": "Poly Pipe \u2014 1/2'' x 3mm x 100m",
    "unit": "roll",
    "priceCents": 13800,
    "image": ""
  },
  {
    "key": "hw_114",
    "name": "Poly Pipe \u2014 1/2'' (PN16 SIRIM)",
    "unit": "roll",
    "priceCents": 22800,
    "image": ""
  },
  {
    "key": "hw_115",
    "name": "Poly Pipe \u2014 3/4'' x 3mm x 100m",
    "unit": "roll",
    "priceCents": 16800,
    "image": ""
  },
  {
    "key": "hw_116",
    "name": "Poly Pipe \u2014 3/4'' (PN12.5 SIRIM)",
    "unit": "roll",
    "priceCents": 27800,
    "image": ""
  },
  {
    "key": "hw_117",
    "name": "Poly Pipe \u2014 1'' x 3mm x 100m",
    "unit": "roll",
    "priceCents": 21500,
    "image": ""
  },
  {
    "key": "hw_118",
    "name": "Poly Pipe \u2014 1'' (PN10 SIRIM) 32mm",
    "unit": "roll",
    "priceCents": 32800,
    "image": ""
  },
  {
    "key": "hw_119",
    "name": "Poly Pipe \u2014 1 1/2'' x PN6 x 2.9mm",
    "unit": "roll",
    "priceCents": 49800,
    "image": ""
  },
  {
    "key": "hw_120",
    "name": "Poly Pipe \u2014 1 1/2'' x PN10 (SIRIM)",
    "unit": "roll",
    "priceCents": 79800,
    "image": ""
  },
  {
    "key": "hw_121",
    "name": "Poly Pipe \u2014 2'' x PN6 x 3.6mm",
    "unit": "roll",
    "priceCents": 59800,
    "image": ""
  },
  {
    "key": "hw_122",
    "name": "Poly Pipe \u2014 2'' x PN10 x 63mm (SIRIM)",
    "unit": "roll",
    "priceCents": 98000,
    "image": ""
  },
  {
    "key": "hw_123",
    "name": "Poly Pipe \u2014 3'' x PN6 x 50m",
    "unit": "roll",
    "priceCents": 84500,
    "image": ""
  },
  {
    "key": "hw_124",
    "name": "Poly Pipe \u2014 3'' x PN10 x 50m (SIRIM)",
    "unit": "roll",
    "priceCents": 93000,
    "image": ""
  },
  {
    "key": "hw_125",
    "name": "Poly Pipe \u2014 4'' x PN10 x 6m",
    "unit": "batang",
    "priceCents": 19800,
    "image": ""
  },
  {
    "key": "hw_126",
    "name": "Spiral Pipe \u2014 18'' x 6m",
    "unit": "batang",
    "priceCents": 87500,
    "image": ""
  },
  {
    "key": "hw_127",
    "name": "Spiral Pipe \u2014 24'' x 6m",
    "unit": "batang",
    "priceCents": 127000,
    "image": ""
  },
  {
    "key": "hw_128",
    "name": "Ultra Gal \u2014 1/2'' x 15mm",
    "unit": "batang",
    "priceCents": 1800,
    "image": ""
  },
  {
    "key": "hw_129",
    "name": "Ultra Gal \u2014 3/4'' x 20mm",
    "unit": "batang",
    "priceCents": 2300,
    "image": ""
  },
  {
    "key": "hw_130",
    "name": "Ultra Gal \u2014 1'' x 25mm",
    "unit": "batang",
    "priceCents": 2800,
    "image": ""
  },
  {
    "key": "hw_131",
    "name": "G.I Pipe \u2014 1/2'' (A)",
    "unit": "batang",
    "priceCents": 5900,
    "image": ""
  },
  {
    "key": "hw_132",
    "name": "G.I Pipe \u2014 3/4'' (A)",
    "unit": "batang",
    "priceCents": 8900,
    "image": ""
  },
  {
    "key": "hw_134",
    "name": "G.I Pipe \u2014 1'' (A)",
    "unit": "batang",
    "priceCents": 12800,
    "image": ""
  },
  {
    "key": "hw_135",
    "name": "G.I Pipe \u2014 1 1/4'' (A)",
    "unit": "batang",
    "priceCents": 19800,
    "image": ""
  },
  {
    "key": "hw_136",
    "name": "G.I Pipe \u2014 1 1/2'' (A)",
    "unit": "batang",
    "priceCents": 16800,
    "image": ""
  },
  {
    "key": "hw_137",
    "name": "G.I Pipe \u2014 2'' (A)",
    "unit": "batang",
    "priceCents": 23800,
    "image": ""
  },
  {
    "key": "hw_139",
    "name": "G.I Pipe \u2014 2 1/2'' (A)",
    "unit": "batang",
    "priceCents": 29800,
    "image": ""
  },
  {
    "key": "hw_140",
    "name": "G.I Pipe \u2014 3'' (A)",
    "unit": "batang",
    "priceCents": 45800,
    "image": ""
  },
  {
    "key": "hw_133",
    "name": "G.I Pipe \u2014 4'' (A)",
    "unit": "batang",
    "priceCents": 63000,
    "image": ""
  },
  {
    "key": "hw_138",
    "name": "G.I Pipe \u2014 2'' (AA)",
    "unit": "batang",
    "priceCents": 9800,
    "image": ""
  },
  {
    "key": "hw_157",
    "name": "G.I Pipe \u2014 4'' (AA)",
    "unit": "batang",
    "priceCents": 42000,
    "image": ""
  },
  {
    "key": "hw_141",
    "name": "Black Pipe \u2014 1/2'' (A)",
    "unit": "batang",
    "priceCents": 4900,
    "image": ""
  },
  {
    "key": "hw_142",
    "name": "Black Pipe \u2014 3/4'' (A)",
    "unit": "batang",
    "priceCents": 7900,
    "image": ""
  },
  {
    "key": "hw_143",
    "name": "Black Pipe \u2014 1'' (A)",
    "unit": "batang",
    "priceCents": 11800,
    "image": ""
  },
  {
    "key": "hw_144",
    "name": "Black Pipe \u2014 1 1/4'' (A)",
    "unit": "batang",
    "priceCents": 15800,
    "image": ""
  },
  {
    "key": "hw_145",
    "name": "Black Pipe \u2014 1 1/2'' (A)",
    "unit": "batang",
    "priceCents": 17800,
    "image": ""
  },
  {
    "key": "hw_146",
    "name": "Black Pipe \u2014 2'' (A)",
    "unit": "batang",
    "priceCents": 19800,
    "image": ""
  },
  {
    "key": "hw_147",
    "name": "Black Pipe \u2014 2 1/2'' (A)",
    "unit": "batang",
    "priceCents": 28800,
    "image": ""
  },
  {
    "key": "hw_149",
    "name": "Black Pipe \u2014 3'' (A)",
    "unit": "batang",
    "priceCents": 39800,
    "image": ""
  },
  {
    "key": "hw_151",
    "name": "Black Pipe \u2014 4'' (A)",
    "unit": "batang",
    "priceCents": 43800,
    "image": ""
  },
  {
    "key": "hw_152",
    "name": "Black Pipe \u2014 3/4'' (AA)",
    "unit": "batang",
    "priceCents": 4800,
    "image": ""
  },
  {
    "key": "hw_153",
    "name": "Black Pipe \u2014 1'' (AA)",
    "unit": "batang",
    "priceCents": 6800,
    "image": ""
  },
  {
    "key": "hw_154",
    "name": "Black Pipe \u2014 1 1/4'' (AA)",
    "unit": "batang",
    "priceCents": 7800,
    "image": ""
  },
  {
    "key": "hw_155",
    "name": "Black Pipe \u2014 1 1/2'' (AA)",
    "unit": "batang",
    "priceCents": 8800,
    "image": ""
  },
  {
    "key": "hw_156",
    "name": "Black Pipe \u2014 2'' (AA)",
    "unit": "batang",
    "priceCents": 9800,
    "image": ""
  },
  {
    "key": "hw_148",
    "name": "Black Pipe \u2014 2 1/2'' (AA)",
    "unit": "batang",
    "priceCents": 14800,
    "image": ""
  },
  {
    "key": "hw_150",
    "name": "Black Pipe \u2014 3'' (AA)",
    "unit": "batang",
    "priceCents": 19800,
    "image": ""
  },
  {
    "key": "hw_158_batang",
    "name": "Chrome Pipe \u2014 3/4'' (12')",
    "unit": "batang",
    "priceCents": 2800,
    "image": ""
  },
  {
    "key": "hw_158_ft",
    "name": "Chrome Pipe \u2014 3/4'' (per ft)",
    "unit": "ft",
    "priceCents": 350,
    "image": ""
  },
  {
    "key": "hw_159_batang",
    "name": "Chrome Pipe \u2014 1'' (12')",
    "unit": "batang",
    "priceCents": 3980,
    "image": ""
  },
  {
    "key": "hw_159_ft",
    "name": "Chrome Pipe \u2014 1'' (per ft)",
    "unit": "ft",
    "priceCents": 450,
    "image": ""
  },
  {
    "key": "hw_161",
    "name": "Steel Pipe \u2014 3/4'' x 12'",
    "unit": "batang",
    "priceCents": 4980,
    "image": ""
  },
  {
    "key": "hw_160",
    "name": "Steel Pipe \u2014 1'' x 6m (Light)",
    "unit": "batang",
    "priceCents": 4500,
    "image": ""
  },
  {
    "key": "hw_162",
    "name": "Steel Pipe \u2014 1'' x 6m (Heavy)",
    "unit": "batang",
    "priceCents": 5980,
    "image": ""
  },
  {
    "key": "hw_163",
    "name": "Deco Pipe \u2014 1''",
    "unit": "batang",
    "priceCents": 2580,
    "image": ""
  },
  {
    "key": "hw_164",
    "name": "Deco Pipe \u2014 1 1/4''",
    "unit": "batang",
    "priceCents": 3980,
    "image": ""
  },
  {
    "key": "hw_165",
    "name": "Deco Pipe \u2014 1 1/2''",
    "unit": "batang",
    "priceCents": 5800,
    "image": ""
  },
  {
    "key": "hw_79",
    "name": "Barbed Wire \u2014 35 lbs (16 kg)",
    "unit": "roll",
    "priceCents": 14800,
    "image": ""
  },
  {
    "key": "hw_166",
    "name": "BRC Mesh \u2014 7' x 12' x 11",
    "unit": "pcs",
    "priceCents": 15800,
    "image": ""
  },
  {
    "key": "hw_167",
    "name": "BRC Mesh \u2014 7' x 12' x 13",
    "unit": "pcs",
    "priceCents": 11800,
    "image": ""
  },
  {
    "key": "hw_168",
    "name": "BRC Mesh \u2014 4' x 2'' x 1'' x 13 x 50'",
    "unit": "roll",
    "priceCents": 29500,
    "image": ""
  },
  {
    "key": "hw_169",
    "name": "BRC Mesh \u2014 4' x 2'' x 2'' x 13 x 50'",
    "unit": "roll",
    "priceCents": 22000,
    "image": ""
  },
  {
    "key": "hw_171",
    "name": "BRC Mesh \u2014 4' x 2'' x 2'' x 11 x 50'",
    "unit": "roll",
    "priceCents": 29800,
    "image": ""
  },
  {
    "key": "hw_170",
    "name": "BRC Mesh \u2014 4' x 2'' x 2'' x 10 x 50'",
    "unit": "roll",
    "priceCents": 33800,
    "image": ""
  },
  {
    "key": "hw_173",
    "name": "BRC Mesh \u2014 811 x 150'",
    "unit": "roll",
    "priceCents": 24800,
    "image": ""
  },
  {
    "key": "hw_172",
    "name": "BRC Mesh \u2014 810 x 150'",
    "unit": "roll",
    "priceCents": 32000,
    "image": ""
  },
  {
    "key": "hw_174",
    "name": "BRC Mesh \u2014 87 x 150'",
    "unit": "roll",
    "priceCents": 32000,
    "image": ""
  },
  {
    "key": "hw_175",
    "name": "BRC Mesh \u2014 85 x 150'",
    "unit": "roll",
    "priceCents": 48500,
    "image": ""
  },
  {
    "key": "hw_176",
    "name": "BRC Mesh \u2014 A6 2m x 5m",
    "unit": "pcs",
    "priceCents": 9800,
    "image": ""
  },
  {
    "key": "hw_177",
    "name": "BRC Mesh \u2014 A8 2m x 5m",
    "unit": "pcs",
    "priceCents": 19800,
    "image": ""
  },
  {
    "key": "hw_178",
    "name": "BRC Mesh \u2014 A9 2m x 5m",
    "unit": "pcs",
    "priceCents": 25800,
    "image": ""
  },
  {
    "key": "hw_179",
    "name": "BRC Mesh \u2014 A10 2m x 5m",
    "unit": "pcs",
    "priceCents": 28500,
    "image": ""
  },
  {
    "key": "hw_180",
    "name": "Chain Link \u2014 3' x 2 1/2'' x 2 1/2'' x 12",
    "unit": "roll",
    "priceCents": 15800,
    "image": ""
  },
  {
    "key": "hw_181",
    "name": "Chain Link \u2014 3' x 2 1/2'' x 2 1/2'' x 10",
    "unit": "roll",
    "priceCents": 19800,
    "image": ""
  },
  {
    "key": "hw_182",
    "name": "Chain Link \u2014 4' x 2 1/2'' x 2 1/2'' x 12",
    "unit": "roll",
    "priceCents": 19800,
    "image": ""
  },
  {
    "key": "hw_183",
    "name": "Chain Link \u2014 4' x 2 1/2'' x 2 1/2'' x 10",
    "unit": "roll",
    "priceCents": 28800,
    "image": ""
  },
  {
    "key": "hw_184",
    "name": "Chain Link \u2014 4' x 2'' x 2'' x 12",
    "unit": "roll",
    "priceCents": 22800,
    "image": ""
  },
  {
    "key": "hw_185",
    "name": "Chain Link \u2014 4' x 2'' x 2'' x 10 x 50'",
    "unit": "roll",
    "priceCents": 35000,
    "image": ""
  },
  {
    "key": "hw_186",
    "name": "Chain Link \u2014 5' x 2 1/2'' x 2 1/2'' x 12",
    "unit": "roll",
    "priceCents": 25800,
    "image": ""
  },
  {
    "key": "hw_187",
    "name": "Chain Link \u2014 5' x 2 1/2'' x 2 1/2'' x 10",
    "unit": "roll",
    "priceCents": 35800,
    "image": ""
  },
  {
    "key": "hw_188",
    "name": "Chain Link \u2014 5' x 2'' x 2'' x 12 x 50'",
    "unit": "roll",
    "priceCents": 32000,
    "image": ""
  },
  {
    "key": "hw_190",
    "name": "Chain Link \u2014 5' x 2'' x 2'' x 11 x 50'",
    "unit": "roll",
    "priceCents": 38000,
    "image": ""
  },
  {
    "key": "hw_189",
    "name": "Chain Link \u2014 5' x 2'' x 2'' x 10 x 50'",
    "unit": "roll",
    "priceCents": 42500,
    "image": ""
  },
  {
    "key": "hw_192",
    "name": "Chain Link \u2014 6' x 2 1/2'' x 2 1/2'' x 12 x 50'",
    "unit": "roll",
    "priceCents": 33800,
    "image": ""
  },
  {
    "key": "hw_191",
    "name": "Chain Link \u2014 6' x 2'' x 2'' x 12 x 50'",
    "unit": "roll",
    "priceCents": 38800,
    "image": ""
  },
  {
    "key": "hw_193",
    "name": "Chain Link \u2014 6' x 2'' x 2'' x 10",
    "unit": "roll",
    "priceCents": 45800,
    "image": ""
  },
  {
    "key": "hw_194",
    "name": "Steel Bar (Rebar) \u2014 R5.2mm",
    "unit": "batang",
    "priceCents": 1280,
    "image": ""
  },
  {
    "key": "hw_195",
    "name": "Steel Bar (Rebar) \u2014 R8.2mm",
    "unit": "batang",
    "priceCents": 2980,
    "image": ""
  },
  {
    "key": "hw_196",
    "name": "Steel Bar (Rebar) \u2014 Y10",
    "unit": "batang",
    "priceCents": 3900,
    "image": ""
  },
  {
    "key": "hw_197",
    "name": "Steel Bar (Rebar) \u2014 Y12",
    "unit": "batang",
    "priceCents": 5900,
    "image": ""
  },
  {
    "key": "hw_198",
    "name": "Steel Bar (Rebar) \u2014 Y16",
    "unit": "batang",
    "priceCents": 9800,
    "image": ""
  },
  {
    "key": "hw_199",
    "name": "Flat Bar \u2014 1/2'' x 3mm x 6m",
    "unit": "batang",
    "priceCents": 1850,
    "image": ""
  },
  {
    "key": "hw_200",
    "name": "Flat Bar \u2014 5/8'' x 3mm x 6m",
    "unit": "batang",
    "priceCents": 1980,
    "image": ""
  },
  {
    "key": "hw_201",
    "name": "Flat Bar \u2014 3/4'' x 3mm x 6m",
    "unit": "batang",
    "priceCents": 2200,
    "image": ""
  },
  {
    "key": "hw_202",
    "name": "Flat Bar \u2014 1'' x 3mm x 6m",
    "unit": "batang",
    "priceCents": 2800,
    "image": ""
  },
  {
    "key": "hw_203",
    "name": "Flat Bar \u2014 1 1/4'' x 3mm x 6m",
    "unit": "batang",
    "priceCents": 3900,
    "image": ""
  },
  {
    "key": "hw_204",
    "name": "Flat Bar \u2014 1 1/2'' x 3mm x 6m",
    "unit": "batang",
    "priceCents": 4900,
    "image": ""
  },
  {
    "key": "hw_205",
    "name": "Flat Bar \u2014 1 1/2'' x 6mm x 6m",
    "unit": "batang",
    "priceCents": 8800,
    "image": ""
  },
  {
    "key": "hw_206",
    "name": "Flat Bar \u2014 2'' x 3mm x 6m",
    "unit": "batang",
    "priceCents": 5900,
    "image": ""
  },
  {
    "key": "hw_207",
    "name": "Flat Bar \u2014 2'' x 4mm x 6m",
    "unit": "batang",
    "priceCents": 7900,
    "image": ""
  },
  {
    "key": "hw_208",
    "name": "Flat Bar \u2014 3'' x 4mm x 6m",
    "unit": "batang",
    "priceCents": 11800,
    "image": ""
  },
  {
    "key": "hw_209",
    "name": "Flat Bar \u2014 3'' x 6mm x 6m",
    "unit": "batang",
    "priceCents": 13800,
    "image": ""
  },
  {
    "key": "hw_210",
    "name": "Flat Bar \u2014 3'' x 9mm x 6m",
    "unit": "batang",
    "priceCents": 11800,
    "image": ""
  },
  {
    "key": "hw_211",
    "name": "Flat Bar \u2014 4'' x 6mm x 6m",
    "unit": "batang",
    "priceCents": 15900,
    "image": ""
  },
  {
    "key": "hw_212",
    "name": "Angle Bar \u2014 1'' x 3mm x 6m",
    "unit": "batang",
    "priceCents": 3700,
    "image": ""
  },
  {
    "key": "hw_213",
    "name": "Angle Bar \u2014 1 1/4'' x 3mm x 6m",
    "unit": "batang",
    "priceCents": 4200,
    "image": ""
  },
  {
    "key": "hw_214",
    "name": "Angle Bar \u2014 1 1/2'' x 3mm x 6m",
    "unit": "batang",
    "priceCents": 4900,
    "image": ""
  },
  {
    "key": "hw_215",
    "name": "Angle Bar \u2014 2'' x 2'' x 3mm x 6m",
    "unit": "batang",
    "priceCents": 6500,
    "image": ""
  },
  {
    "key": "hw_216",
    "name": "Angle Bar \u2014 2'' x 2'' x 4mm x 6m",
    "unit": "batang",
    "priceCents": 9800,
    "image": ""
  },
  {
    "key": "hw_217",
    "name": "Angle Bar \u2014 2'' x 2'' x 6mm x 6m",
    "unit": "batang",
    "priceCents": 14800,
    "image": ""
  },
  {
    "key": "hw_218",
    "name": "Angle Bar \u2014 2 1/2'' x 2 1/2'' x 6mm x 6m",
    "unit": "batang",
    "priceCents": 18600,
    "image": ""
  },
  {
    "key": "hw_219",
    "name": "Angle Bar \u2014 3'' x 3'' x 6mm x 6m",
    "unit": "batang",
    "priceCents": 23300,
    "image": ""
  },
  {
    "key": "hw_220",
    "name": "Square Tube \u2014 1/2'' x 1/2'' x 1mm x 6m",
    "unit": "batang",
    "priceCents": 1850,
    "image": ""
  },
  {
    "key": "hw_221",
    "name": "Square Tube \u2014 1/2'' x 1/2'' x 1.2mm x 6m",
    "unit": "batang",
    "priceCents": 2200,
    "image": ""
  },
  {
    "key": "hw_222",
    "name": "Square Tube \u2014 5/8'' x 1mm x 6m",
    "unit": "batang",
    "priceCents": 1980,
    "image": ""
  },
  {
    "key": "hw_223",
    "name": "Square Tube \u2014 5/8'' x 1.2mm x 6m",
    "unit": "batang",
    "priceCents": 2500,
    "image": ""
  },
  {
    "key": "hw_224",
    "name": "Square Tube \u2014 3/4'' x 3/4'' x 1mm x 6m",
    "unit": "batang",
    "priceCents": 2300,
    "image": ""
  },
  {
    "key": "hw_225",
    "name": "Square Tube \u2014 3/4'' x 3/4'' x 1.2mm x 6m",
    "unit": "batang",
    "priceCents": 2980,
    "image": ""
  },
  {
    "key": "hw_226",
    "name": "Square Tube \u2014 1'' x 1'' x 1mm x 6m",
    "unit": "batang",
    "priceCents": 2980,
    "image": ""
  },
  {
    "key": "hw_227",
    "name": "Square Tube \u2014 1'' x 1'' x 1.2mm x 6m",
    "unit": "batang",
    "priceCents": 3500,
    "image": ""
  },
  {
    "key": "hw_228",
    "name": "Square Tube \u2014 1'' x 1'' x 1.6mm x 6m",
    "unit": "batang",
    "priceCents": 4300,
    "image": ""
  },
  {
    "key": "hw_229",
    "name": "Square Tube \u2014 1 1/4'' x 1.2mm x 6m",
    "unit": "batang",
    "priceCents": 4980,
    "image": ""
  },
  {
    "key": "hw_230",
    "name": "Square Tube \u2014 1 1/2'' x 1 1/2'' x 1.2mm x 6m",
    "unit": "batang",
    "priceCents": 5900,
    "image": ""
  },
  {
    "key": "hw_231",
    "name": "Square Tube \u2014 1 1/2'' x 1 1/2'' x 1.6mm x 6m",
    "unit": "batang",
    "priceCents": 8800,
    "image": ""
  },
  {
    "key": "hw_232",
    "name": "Square Tube \u2014 2'' x 2'' x 1.2mm x 6m",
    "unit": "batang",
    "priceCents": 7800,
    "image": ""
  },
  {
    "key": "hw_233",
    "name": "Square Tube \u2014 2'' x 2'' x 1.6mm x 6m",
    "unit": "batang",
    "priceCents": 9800,
    "image": ""
  },
  {
    "key": "hw_234",
    "name": "Square Tube \u2014 2 1/2'' x 2 1/2'' x 2.3mm x 6m",
    "unit": "batang",
    "priceCents": 14800,
    "image": ""
  },
  {
    "key": "hw_236",
    "name": "Square Tube \u2014 3'' x 3'' x 1.6mm x 6m",
    "unit": "batang",
    "priceCents": 15800,
    "image": ""
  },
  {
    "key": "hw_235",
    "name": "Square Tube \u2014 3'' x 3'' x 3mm x 6m",
    "unit": "batang",
    "priceCents": 28000,
    "image": ""
  },
  {
    "key": "hw_237",
    "name": "Square Tube \u2014 4'' x 4'' x 3mm x 6m",
    "unit": "batang",
    "priceCents": 34800,
    "image": ""
  },
  {
    "key": "hw_238",
    "name": "Rec Tube \u2014 1'' x 2'' x 1mm x 6m",
    "unit": "batang",
    "priceCents": 3980,
    "image": ""
  },
  {
    "key": "hw_239",
    "name": "Rec Tube \u2014 1'' x 2'' x 1.2mm x 6m",
    "unit": "batang",
    "priceCents": 5200,
    "image": ""
  },
  {
    "key": "hw_240",
    "name": "Rec Tube \u2014 1 1/2'' x 1 1/2'' x 1.9mm x 6m",
    "unit": "batang",
    "priceCents": 15800,
    "image": ""
  },
  {
    "key": "hw_241",
    "name": "Rec Tube \u2014 1 1/2'' x 3'' x 1.6mm x 6m",
    "unit": "batang",
    "priceCents": 13800,
    "image": ""
  },
  {
    "key": "hw_242",
    "name": "Rec Tube \u2014 1 1/2'' x 3'' x 1.9mm x 6m",
    "unit": "batang",
    "priceCents": 18800,
    "image": ""
  },
  {
    "key": "hw_243",
    "name": "Rec Tube \u2014 2'' x 3'' x 1.6mm x 6m",
    "unit": "batang",
    "priceCents": 11500,
    "image": ""
  },
  {
    "key": "hw_244",
    "name": "Rec Tube \u2014 2'' x 3'' x 1.9mm x 6m",
    "unit": "batang",
    "priceCents": 14800,
    "image": ""
  },
  {
    "key": "hw_245",
    "name": "Rec Tube \u2014 2'' x 3'' x 2.3mm x 6m",
    "unit": "batang",
    "priceCents": 16500,
    "image": ""
  },
  {
    "key": "hw_246",
    "name": "Rec Tube \u2014 2'' x 4'' x 1.6mm x 6m",
    "unit": "batang",
    "priceCents": 12800,
    "image": ""
  },
  {
    "key": "hw_247",
    "name": "Rec Tube \u2014 2'' x 4'' x 1.9mm x 6m",
    "unit": "batang",
    "priceCents": 14500,
    "image": ""
  },
  {
    "key": "hw_248",
    "name": "Rec Tube \u2014 2'' x 4'' x 3mm x 6m",
    "unit": "batang",
    "priceCents": 33000,
    "image": ""
  },
  {
    "key": "hw_249",
    "name": "Rec Tube \u2014 2'' x 5'' x 3mm x 6m",
    "unit": "batang",
    "priceCents": 38800,
    "image": ""
  },
  {
    "key": "hw_250",
    "name": "Rec Tube \u2014 2'' x 6'' x 3mm x 6m",
    "unit": "batang",
    "priceCents": 43000,
    "image": ""
  },
  {
    "key": "hw_251",
    "name": "U Channel \u2014 1'' x 1'' x 1.6mm x 6m",
    "unit": "batang",
    "priceCents": 4800,
    "image": ""
  },
  {
    "key": "hw_82",
    "name": "Refill Roller \u2014 4''",
    "unit": "pcs",
    "priceCents": 200,
    "image": ""
  }
];
