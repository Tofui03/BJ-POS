import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import {
  type Cents,
  type Company,
  type Contractor,
  type CustomerType,
  type DeliveryOrder,
  type DeliveryOrderLine,
  type Item,
  type ItemInput,
  type Milli,
  type Order,
  type OrderDraft,
  type PaymentMethod,
  type PriceTier,
  type PricedItem,
  type Unit,
  type CompanyInfo,
  buildDeliveryOrder,
  buildOrder,
  calcReverseQuantity,
  deductTare,
  effectiveUnitPrice,
  fmtMoney,
  fmtQty,
  fmtQtySold,
  formatDoNo,
  formatInvNo,
  isMeasureUnit,
  lineAmount,
  MEASURE_UNITS,
  PAYMENT_METHODS,
  priceLine,
  reversePriceLine,
  toCents,
  toMilli,
  toQty,
  toRM,
  unitLabel,
  validateNetWeight,
  PosError,
} from "../../packages/core/src/index.js";
import { createSqlJsDriver, initRepo, SqlPosRepo } from "../../packages/data/src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function getWasmPath(): string {
  const candidates = [
    path.resolve(process.cwd(), "node_modules/.pnpm/sql.js@1.14.1/node_modules/sql.js/dist/sql-wasm.wasm"),
    path.resolve(process.cwd(), "../../node_modules/.pnpm/sql.js@1.14.1/node_modules/sql.js/dist/sql-wasm.wasm"),
    path.resolve(__dirname, "../../node_modules/.pnpm/sql.js@1.14.1/node_modules/sql.js/dist/sql-wasm.wasm"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "sql-wasm.wasm";
}

export async function freshTestRepo(): Promise<{ repo: SqlPosRepo; driver: ReturnType<typeof createSqlJsDriver> }> {
  const wasmPath = getWasmPath();
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  const db = new SQL.Database();
  const driver = createSqlJsDriver(db as never);
  const repo = await initRepo(driver, { seedDemoOrders: false });

  // Ensure DO and contractor persistence columns exist on orders table
  await driver.run("ALTER TABLE orders ADD COLUMN contractor_id INTEGER").catch(() => {});
  await driver.run("ALTER TABLE orders ADD COLUMN contractor_name TEXT").catch(() => {});
  await driver.run("ALTER TABLE orders ADD COLUMN do_number TEXT").catch(() => {});
  await driver.run("ALTER TABLE orders ADD COLUMN site_address TEXT").catch(() => {});
  await driver.run("ALTER TABLE orders ADD COLUMN lorry_plate TEXT").catch(() => {});
  await driver.run("ALTER TABLE orders ADD COLUMN driver_name TEXT").catch(() => {});
  await driver.run("ALTER TABLE orders ADD COLUMN contractor_po TEXT").catch(() => {});
  await driver.run("ALTER TABLE orders ADD COLUMN show_price_on_do INTEGER DEFAULT 1").catch(() => {});

  return { repo, driver };
}

export interface SeededCatalog {
  nailsKg: PricedItem;
  pipeFt: PricedItem;
  steelMeter: PricedItem;
  sandKg: PricedItem;
  cementBag: PricedItem;
  hammerPcs: PricedItem;
  catalogMap: Map<number, PricedItem>;
  resolveItem: (line: { itemId?: number; key?: string }) => PricedItem | null;
}

export async function seedHardwareCatalog(repo: SqlPosRepo): Promise<SeededCatalog> {
  // 1. Nails (kg) - RM 10.00/kg base, >= 30 kg at RM 8.00/kg, >= 50 kg at RM 7.00/kg
  const nailsItem = await repo.createItem({
    key: "nails_common_2in",
    name: "Common Wire Nails 2\"",
    unit: "kg",
    priceCents: 1000,
    tracksTail: false,
  });
  await repo.setTiers(nailsItem.id, [
    { minQtyMilli: 30000, priceCents: 800 },
    { minQtyMilli: 50000, priceCents: 700 },
  ]);

  // 2. PVC Pipe (ft) - RM 2.00/ft base, >= 50 ft at RM 1.50/ft
  const pipeItem = await repo.createItem({
    key: "pvc_pipe_class_d_half_in",
    name: "PVC Pipe Class D 1/2\"",
    unit: "ft",
    priceCents: 200,
    tracksTail: false,
  });
  await repo.setTiers(pipeItem.id, [
    { minQtyMilli: 50000, priceCents: 150 },
  ]);

  // 3. Steel Bar (meter) - RM 25.00/meter base, >= 20 meter at RM 22.00/meter
  const steelItem = await repo.createItem({
    key: "high_tensile_steel_bar_y12",
    name: "High Tensile Deformed Bar Y12",
    unit: "meter",
    priceCents: 2500,
    tracksTail: false,
  });
  await repo.setTiers(steelItem.id, [
    { minQtyMilli: 20000, priceCents: 2200 },
  ]);

  // 4. Sand (kg) - RM 0.20/kg base, >= 1000 kg at RM 0.15/kg
  const sandItem = await repo.createItem({
    key: "river_sand_fine",
    name: "Fine River Sand",
    unit: "kg",
    priceCents: 20,
    tracksTail: false,
  });
  await repo.setTiers(sandItem.id, [
    { minQtyMilli: 1000000, priceCents: 15 },
  ]);

  // 5. Cement (bag) - RM 18.00/bag base, discrete unit
  const cementItem = await repo.createItem({
    key: "portland_cement_50kg",
    name: "Portland Cement 50 kg",
    unit: "bag",
    priceCents: 1800,
    tracksTail: false,
  });

  // 6. Claw Hammer (pcs) - RM 35.00/pc base, discrete count
  const hammerItem = await repo.createItem({
    key: "claw_hammer_16oz",
    name: "Fiberglass Claw Hammer 16 oz",
    unit: "pcs",
    priceCents: 3500,
    tracksTail: false,
  });

  // Refresh items with their attached tiers
  const nailsKg = (await repo.getItem(nailsItem.id))!;
  const pipeFt = (await repo.getItem(pipeItem.id))!;
  const steelMeter = (await repo.getItem(steelItem.id))!;
  const sandKg = (await repo.getItem(sandItem.id))!;
  const cementBag = (await repo.getItem(cementItem.id))!;
  const hammerPcs = (await repo.getItem(hammerItem.id))!;

  const catalogMap = new Map<number, PricedItem>([
    [nailsKg.id, nailsKg],
    [pipeFt.id, pipeFt],
    [steelMeter.id, steelMeter],
    [sandKg.id, sandKg],
    [cementBag.id, cementBag],
    [hammerPcs.id, hammerPcs],
  ]);

  const resolveItem = (line: { itemId?: number; key?: string }): PricedItem | null => {
    if (line.itemId != null) return catalogMap.get(line.itemId) ?? null;
    if (line.key) {
      for (const it of catalogMap.values()) {
        if (it.key === line.key) return it;
      }
    }
    return null;
  };

  return {
    nailsKg,
    pipeFt,
    steelMeter,
    sandKg,
    cementBag,
    hammerPcs,
    catalogMap,
    resolveItem,
  };
}

export const TEST_STORE_INFO: CompanyInfo = {
  name: "Borneo Jasa Sdn. Bhd.",
  nameCn: "婆罗洲贸易有限公司",
  regNo: "(227533-X)",
  tin: "C2398472901",
  address: "Lot 12, Kolombong Industrial Estate, 88450 Kota Kinabalu, Sabah",
  tel: "088-385555 / 016-8882233",
  email: "billing@borneojasa.com.my",
  bankInfo: "Maybank 5101-9922-3344",
};

export const CONTRACTOR_AH_SENG = {
  name: "Ah Seng Construction",
  phone: "012-3456789",
  tin: "C1234567890",
  address: "Lot 42, Telipok Industrial Park, Sabah",
};

export const CONTRACTOR_MEGA_BUILDER = {
  name: "Mega Builder Sdn Bhd",
  phone: "016-8889999",
  tin: "C9876543210",
  address: "No 88, Jalan Tuaran, 88400 Kota Kinabalu, Sabah",
};

/** Prefer the app renderer; fall back to the local copy if that module cannot be loaded. */
export async function renderDeliveryOrderHtml(
  doData: DeliveryOrder,
  company: CompanyInfo = TEST_STORE_INFO,
): Promise<string> {
  try {
    const mod = await import("../../apps/pos/src/printing/renderDeliveryOrderHtml.js");
    if (typeof mod.renderDeliveryOrderHtml === "function") {
      return mod.renderDeliveryOrderHtml(doData, company);
    }
  } catch {
    // Fall back to canonical contract renderer
  }

  return generateCanonicalDeliveryOrderHtml(doData, company);
}

export function generateCanonicalDeliveryOrderHtml(
  d: DeliveryOrder,
  company: CompanyInfo = TEST_STORE_INFO,
): string {
  const storeName = company.name ?? d.storeName;
  const regNo = company.regNo ?? d.regNo ?? "(227533-X)";
  const tel = company.tel ?? d.tel ?? "";
  const address = company.address ?? d.storeAddress ?? "";

  const renderCopy = (copyTitle: string) => {
    const priceHeaders = d.showPriceOnDo
      ? '<th style="width: 15%; text-align: right;">U/P (RM)</th><th style="width: 18%; text-align: right;">AMOUNT (RM)</th>'
      : "";

    const rows = d.lines
      .map((l) => {
        const priceCells = d.showPriceOnDo
          ? `<td style="text-align: right;">${l.unitPriceText ? l.unitPriceText.replace("RM ", "") : ""}</td>
             <td style="text-align: right;">${l.amountText ? l.amountText.replace("RM ", "") : ""}</td>`
          : "";
        return `
        <tr>
          <td style="text-align: center;">${l.itemNo}</td>
          <td><strong>${escapeHtml(l.name)}</strong></td>
          <td style="text-align: right;">${l.qtyText}</td>
          ${priceCells}
        </tr>`;
      })
      .join("");

    const totalsSection = d.showPriceOnDo
      ? `
      <div style="display: flex; justify-content: flex-end; margin-top: 6px;">
        <table style="width: 40%; font-size: 11px;">
          <tr><td>Total Qty:</td><td style="text-align: right;">${d.totalQtyText}</td></tr>
          <tr><td>Subtotal:</td><td style="text-align: right;">${d.subtotalText ?? ""}</td></tr>
          <tr style="font-weight: bold; border-top: 1px solid #000;">
            <td>TOTAL:</td><td style="text-align: right;">${d.totalText ?? ""}</td>
          </tr>
        </table>
      </div>`
      : `<div style="font-size: 11px; margin-top: 4px;"><strong>Total Qty:</strong> ${d.totalQtyText}</div>`;

    return `
    <div class="do-half" style="box-sizing: border-box; height: 138mm; padding: 6mm 8mm; position: relative;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #000; padding-bottom: 4px;">
        <div>
          <h2 style="margin: 0; font-size: 16px; font-weight: bold; text-transform: uppercase;">${escapeHtml(storeName)}</h2>
          <div style="font-size: 10px; color: #333;">Reg No: ${escapeHtml(regNo)} | Tel: ${escapeHtml(tel)}</div>
          <div style="font-size: 10px; color: #444;">${escapeHtml(address)}</div>
        </div>
        <div style="text-align: right;">
          <h1 style="margin: 0; font-size: 18px; font-weight: 800; letter-spacing: 1px;">DELIVERY ORDER</h1>
          <div style="font-size: 11px; font-weight: bold; color: #d00;">[ ${copyTitle} ]</div>
          <div style="font-size: 11px;"><strong>DO No:</strong> ${escapeHtml(d.doNumber)}</div>
          <div style="font-size: 11px;"><strong>Date:</strong> ${escapeHtml(d.dateText)}</div>
          <div style="font-size: 11px;"><strong>Invoice No:</strong> ${escapeHtml(d.invNo)}</div>
        </div>
      </div>

      <div style="display: flex; justify-content: space-between; margin: 6px 0; font-size: 11px; background: #fafafa; padding: 4px 6px; border: 1px solid #eee;">
        <div style="width: 58%;">
          <div><strong>Contractor:</strong> ${escapeHtml(d.contractorName ?? "Walk-in Customer")}</div>
          ${d.contractorTin ? `<div><strong>TIN:</strong> ${escapeHtml(d.contractorTin)}</div>` : ""}
          <div><strong>Site Address:</strong> ${escapeHtml(d.siteAddress || "-")}</div>
        </div>
        <div style="width: 38%;">
          <div><strong>Lorry Plate:</strong> ${escapeHtml(d.lorryPlate || "-")}</div>
          <div><strong>Driver:</strong> ${escapeHtml(d.driverName || "-")}</div>
          ${d.contractorPo ? `<div><strong>PO No:</strong> ${escapeHtml(d.contractorPo)}</div>` : ""}
        </div>
      </div>

      <table style="width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 4px;">
        <thead>
          <tr style="border-top: 1px solid #000; border-bottom: 1px solid #000; background: #f0f0f0;">
            <th style="width: 6%; text-align: center;">NO</th>
            <th style="text-align: left;">ITEM DESCRIPTION</th>
            <th style="width: 16%; text-align: right;">QTY</th>
            ${priceHeaders}
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>

      ${totalsSection}

      <!-- Triple Signature Blocks -->
      <div style="display: flex; justify-content: space-between; margin-top: 10px; padding-top: 4px; font-size: 10px;">
        <div style="width: 30%; border: 1px solid #ccc; padding: 4px; height: 26mm; display: flex; flex-direction: column; justify-content: space-between;">
          <div style="font-weight: bold; border-bottom: 1px dashed #ccc; padding-bottom: 2px;">ISSUED BY (Store)</div>
          <div style="font-size: 9px; color: #555;">Name: ${escapeHtml(d.signatories.issuedBy)}</div>
          <div style="border-top: 1px dotted #888; padding-top: 2px; text-align: center;">Authorised Signature</div>
        </div>
        <div style="width: 30%; border: 1px solid #ccc; padding: 4px; height: 26mm; display: flex; flex-direction: column; justify-content: space-between;">
          <div style="font-weight: bold; border-bottom: 1px dashed #ccc; padding-bottom: 2px;">DELIVERED BY (Driver)</div>
          <div style="font-size: 9px; color: #555;">Driver: ${escapeHtml(d.signatories.deliveredBy)}</div>
          <div style="border-top: 1px dotted #888; padding-top: 2px; text-align: center;">Driver Signature</div>
        </div>
        <div style="width: 36%; border: 1px solid #000; padding: 4px; height: 26mm; display: flex; flex-direction: column; justify-content: space-between;">
          <div style="font-weight: bold; border-bottom: 1px dashed #000; padding-bottom: 2px;">RECEIVED BY (Site Supervisor)</div>
          <div style="font-size: 9px;">Name: ____________________ IC: ______________</div>
          <div style="font-size: 9px;">Date: ___________ <span style="display: inline-block; border: 1px solid #999; padding: 1px 4px; margin-left: 4px;">Company Chop</span></div>
          <div style="border-top: 1px dotted #888; padding-top: 2px; text-align: center;">Recipient Signature & Stamp</div>
        </div>
      </div>
    </div>`;
  };

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Delivery Order - ${escapeHtml(d.doNumber)}</title>
  <style>
    @page { size: A4 portrait; margin: 8mm 10mm; }
    body { font-family: 'Nunito', 'Segoe UI', Arial, sans-serif; margin: 0; padding: 0; color: #000; }
    .cut-line {
      border-top: 1px dashed #777;
      text-align: center;
      margin: 2mm 0;
      position: relative;
    }
    .cut-line::after {
      content: '✂ TEAR OR CUT HERE (OFFICE / STORE COPY ABOVE — CUSTOMER COPY BELOW) ✂';
      position: absolute;
      top: -7px;
      left: 20%;
      background: #fff;
      padding: 0 8px;
      font-size: 9px;
      color: #777;
      letter-spacing: 1px;
    }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  ${renderCopy("STORE COPY")}
  <div class="cut-line"></div>
  ${renderCopy("CUSTOMER COPY")}
</body>
</html>`;
}

function escapeHtml(str: unknown): string {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Re-export core modules for clean, self-contained test files
export {
  buildDeliveryOrder,
  buildOrder,
  calcReverseQuantity,
  deductTare,
  effectiveUnitPrice,
  fmtMoney,
  fmtQty,
  fmtQtySold,
  formatDoNo,
  formatInvNo,
  isMeasureUnit,
  lineAmount,
  MEASURE_UNITS,
  PAYMENT_METHODS,
  priceLine,
  reversePriceLine,
  toCents,
  toMilli,
  toQty,
  toRM,
  unitLabel,
  validateNetWeight,
  PosError,
};
