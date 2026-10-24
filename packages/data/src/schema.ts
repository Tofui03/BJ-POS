import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Drizzle's typed view of the database — the source of truth for queries.
// It mirrors @yf/core's SCHEMA_SQL (which still owns the actual DDL/migrations
// via init.ts). CHECK constraints and foreign keys live in SCHEMA_SQL; they
// don't affect query building, so they're omitted here. Booleans map 0/1 <->
// true/false at the column.

export const companies = sqliteTable("companies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
});

export const unitTypes = sqliteTable("unit_types", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
});

export const items = sqliteTable("items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  image: text("image").notNull().default(""),
  unit: text("unit").notNull().default("each"),
  priceCents: integer("price_cents").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  tracksTail: integer("tracks_tail", { mode: "boolean" }).notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  stockMilli: integer("stock_milli"),
});

export const priceTiers = sqliteTable("price_tiers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemId: integer("item_id").notNull(),
  minQtyMilli: integer("min_qty_milli").notNull(),
  priceCents: integer("price_cents").notNull(),
});

export const contractors = sqliteTable("contractors", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().default(1),
  name: text("name").notNull(),
  phone: text("phone").notNull().default(""),
  tin: text("tin").notNull().default(""),
  address: text("address").notNull().default(""),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const orders = sqliteTable("orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().default(1),
  ts: integer("ts").notNull(),
  businessDate: text("business_date"),
  invNo: text("inv_no"),
  customerType: text("customer_type").default("walkin"),
  contractorId: integer("contractor_id").references(() => contractors.id),
  contractorName: text("contractor_name"),
  customerTin: text("customer_tin"),
  customerAddress: text("customer_address"),
  customerPhone: text("customer_phone"),
  doNumber: text("do_number"),
  siteAddress: text("site_address"),
  lorryPlate: text("lorry_plate"),
  driverName: text("driver_name"),
  contractorPo: text("contractor_po"),
  showPriceOnDo: integer("show_price_on_do", { mode: "boolean" }),
  discountCents: integer("discount_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull(),
  method: text("method", { enum: ["Cash", "Bank", "QR", "Credit"] }).notNull(),
  cashierName: text("cashier_name"),
  voidedAt: integer("voided_at"),
  voidedBy: text("voided_by"),
  creditClearedAt: integer("credit_cleared_at"),
});

export const dayCloses = sqliteTable("day_closes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().default(1),
  businessDate: text("business_date").notNull(),
  closedAt: integer("closed_at").notNull(),
  auto: integer("auto", { mode: "boolean" }).notNull().default(false),
  closedBy: text("closed_by"),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const outbox = sqliteTable("outbox", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().default(1),
  businessDate: text("business_date").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  attachmentName: text("attachment_name"),
  attachmentB64: text("attachment_b64"),
  /** 'drive' (Borneo Jasa v1) or legacy 'email' */
  channel: text("channel").notNull().default("drive"),
  createdAt: integer("created_at").notNull(),
  sentAt: integer("sent_at"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
});

export const credits = sqliteTable("credits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().default(1),
  orderId: integer("order_id").notNull(),
  name: text("name").notNull(),
  amountCents: integer("amount_cents").notNull(),
  date: integer("date").notNull(),
  isClear: integer("is_clear"),
  clearedMethod: text("cleared_method", { enum: ["Cash", "Bank", "QR"] }),
});

export const repayments = sqliteTable("repayments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().default(1),
  creditId: integer("credit_id").notNull(),
  orderId: integer("order_id").notNull(),
  contractorId: integer("contractor_id"),
  amountCents: integer("amount_cents").notNull(),
  method: text("method", { enum: ["Cash", "Bank", "QR"] }).notNull(),
  ts: integer("ts").notNull(),
  businessDate: text("business_date").notNull(),
  notes: text("notes"),
  cashierName: text("cashier_name"),
});

export const orderItems = sqliteTable("order_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id").notNull(),
  itemId: integer("item_id").notNull(),
  unit: text("unit"),
  priceCents: integer("price_cents").notNull(),
  origPriceCents: integer("orig_price_cents"),
  customName: text("custom_name"),
  qtyMilli: integer("qty_milli").notNull(),
  tailCount: integer("tail_count").notNull().default(0),
});
