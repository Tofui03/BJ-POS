import type {
  PosRepo,
  ItemInput,
  ItemPatch,
  TierInput,
  OrderDraft,
  Company,
  Contractor,
  ContractorInput,
  ContractorMonthlyStatement,
  ContractorPatch,
  Credit,
  DayClose,
  Item,
  PricedItem,
  PriceTier,
  Repayment,
  RepaymentInput,
  RepaymentMethod,
  UnitType,
  CustomerType,
  Order,
  OrderLine,
  Unit,
  CreateRefundInput,
} from "@yf/core";
import type { SqlDriver } from "./driver.js";
import { makeDrizzle, type DrizzleDb } from "./drizzle.js";
import { CatalogRepo } from "./repo/catalog.js";
import { OrdersRepo } from "./repo/orders.js";
import { ContractorsRepo } from "./repo/contractors.js";
import { CreditsRepo } from "./repo/credits.js";
import { CloseDayRepo } from "./repo/closeday.js";
import { SettingsRepo } from "./repo/settings.js";

export class SqlPosRepo implements PosRepo {
  readonly dz: DrizzleDb;
  readonly catalog: CatalogRepo;
  readonly orders: OrdersRepo;
  readonly contractors: ContractorsRepo;
  readonly credits: CreditsRepo;
  readonly closeday: CloseDayRepo;
  readonly settings: SettingsRepo;

  constructor(readonly db: SqlDriver) {
    this.dz = makeDrizzle(db);
    this.catalog = new CatalogRepo(this);
    this.orders = new OrdersRepo(this);
    this.contractors = new ContractorsRepo(this);
    this.credits = new CreditsRepo(this);
    this.closeday = new CloseDayRepo(this);
    this.settings = new SettingsRepo(this);
  }

  // --- 1. Catalog & Lookups ---
  listCompanies(): Promise<Company[]> { return this.catalog.listCompanies(); }
  listUnitTypes(): Promise<UnitType[]> { return this.catalog.listUnitTypes(); }
  listItems(includeInactive?: boolean): Promise<PricedItem[]> { return this.catalog.listItems(includeInactive); }
  getItem(id: number): Promise<PricedItem | null> { return this.catalog.getItem(id); }
  getItemByKey(key: string): Promise<PricedItem | null> { return this.catalog.getItemByKey(key); }
  createItem(input: ItemInput): Promise<PricedItem> { return this.catalog.createItem(input); }
  updateItem(id: number, patch: ItemPatch): Promise<PricedItem> { return this.catalog.updateItem(id, patch); }
  setItemActive(id: number, active: boolean): Promise<void> { return this.catalog.setItemActive(id, active); }
  setItemOrder(orderedIds: number[]): Promise<void> { return this.catalog.setItemOrder(orderedIds); }
  setTiers(itemId: number, tiers: TierInput[]): Promise<void> { return this.catalog.setTiers(itemId, tiers); }
  restockItem(itemId: number, addQtyMilli: number, note?: string): Promise<PricedItem> { return this.catalog.restockItem(itemId, addQtyMilli, note); }

  // --- 2. Orders ---
  persistOrder(draft: OrderDraft): Promise<Order> { return this.orders.persistOrder(draft); }
  getOrder(id: number): Promise<Order | null> { return this.orders.getOrder(id); }
  listOrders(startMs: number, endMs: number, companyId?: number): Promise<Order[]> { return this.orders.listOrders(startMs, endMs, companyId); }
  listOrdersByBusinessDate(fromDate: string, toDate: string, companyId?: number): Promise<Order[]> { return this.orders.listOrdersByBusinessDate(fromDate, toDate, companyId); }
  voidOrder(orderId: number, at: number, voidedBy?: string): Promise<Order> { return this.orders.voidOrder(orderId, at, voidedBy); }
  createRefundOrder(input: CreateRefundInput): Promise<Order> { return this.orders.createRefundOrder(input); }
  getRefundsForOrder(orderId: number): Promise<Order[]> { return this.orders.getRefundsForOrder(orderId); }
  creditorNamesFor(orderIds: number[]): Promise<Map<number, string>> { return (this.orders as any).creditorNamesFor(orderIds); }
  linesForOrders(orderIds: number[]): Promise<Map<number, OrderLine[]>> { return (this.orders as any).linesForOrders(orderIds); }
  refundInvNosFor(orderIds: number[]): Promise<Map<number, string>> { return (this.orders as any).refundInvNosFor(orderIds); }

  // --- 3. Contractors ---
  listContractors(companyId?: number, opts?: { activeOnly?: boolean }): Promise<Contractor[]> { return this.contractors.listContractors(companyId, opts); }
  getContractor(id: number): Promise<Contractor | null> { return this.contractors.getContractor(id); }
  getContractorByName(name: string, companyId?: number): Promise<Contractor | null> { return this.contractors.getContractorByName(name, companyId); }
  createContractor(input: ContractorInput): Promise<Contractor> { return this.contractors.createContractor(input); }
  updateContractor(id: number, patch: ContractorPatch): Promise<Contractor> { return this.contractors.updateContractor(id, patch); }
  setContractorActive(id: number, active: boolean): Promise<void> { return this.contractors.setContractorActive(id, active); }

  // --- 4. Credits & Repayments ---
  listCredits(companyId?: number, opts?: { outstandingOnly?: boolean }): Promise<Credit[]> { return this.credits.listCredits(companyId, opts); }
  clearCreditsByName(name: string, clearedAt: number, companyId?: number, method?: RepaymentMethod, notes?: string, businessDate?: string, cashierName?: string): Promise<number> { return this.credits.clearCreditsByName(name, clearedAt, companyId, method, notes, businessDate, cashierName); }
  clearCreditsByIds(creditIds: number[], clearedAt: number, companyId?: number, method?: RepaymentMethod, notes?: string, businessDate?: string, cashierName?: string): Promise<number> { return this.credits.clearCreditsByIds(creditIds, clearedAt, companyId, method, notes, businessDate, cashierName); }
  clearCredit(creditId: number, clearedAt: number, method?: RepaymentMethod, businessDate?: string, cashierName?: string): Promise<void> { return this.credits.clearCredit(creditId, clearedAt, method, businessDate, cashierName); }
  recordRepayment(input: RepaymentInput): Promise<Repayment> { return this.credits.recordRepayment(input); }
  listRepayments(opts?: { companyId?: number; businessDate?: string; fromDate?: string; toDate?: string }): Promise<Repayment[]> { return this.credits.listRepayments(opts); }
  listRepaymentsByBusinessDate(fromDate: string, toDate: string, companyId?: number): Promise<Repayment[]> { return this.credits.listRepaymentsByBusinessDate(fromDate, toDate, companyId); }
  getContractorMonthlyStatement(contractorIdOrName: number | string, yearMonth: string, companyId?: number): Promise<ContractorMonthlyStatement> { return this.credits.getContractorMonthlyStatement(contractorIdOrName, yearMonth, companyId); }
  listCreditOrdersForContractor(contractorId: number, companyId?: number, opts?: { upToYearMonth?: string }): Promise<Order[]> { return this.credits.listCreditOrdersForContractor(contractorId, companyId, opts); }
  listRepaymentsForContractor(contractorId: number, companyId?: number, opts?: { upToYearMonth?: string }): Promise<Repayment[]> { return this.credits.listRepaymentsForContractor(contractorId, companyId, opts); }

  // --- 5. CloseDay ---
  getDayClose(businessDate: string, companyId?: number): Promise<DayClose | null> { return this.closeday.getDayClose(businessDate, companyId); }
  closeDay(businessDate: string, opts?: { companyId?: number; auto?: boolean; at?: number; closedBy?: string }): Promise<DayClose> { return this.closeday.closeDay(businessDate, opts); }
  reopenDay(businessDate: string, companyId?: number): Promise<void> { return this.closeday.reopenDay(businessDate, companyId); }
  listUnclosedDays(beforeDate: string, companyId?: number): Promise<string[]> { return this.closeday.listUnclosedDays(beforeDate, companyId); }

  // --- 6. Settings & Outbox ---
  getSetting(key: string): Promise<string | null> { return this.settings.getSetting(key); }
  setSetting(key: string, value: string): Promise<void> { return this.settings.setSetting(key, value); }
  queueEmail(input: { companyId?: number; businessDate: string; subject: string; body: string; attachmentName?: string; attachmentB64?: string; channel?: "drive" | "email" }): Promise<number> { return this.settings.queueEmail(input); }
  listOutbox(businessDate?: string): Promise<Array<{ id: number; companyId: number; businessDate: string; subject: string; attachmentName: string | null; channel: "drive" | "email"; createdAt: number; sentAt: number | null; attempts: number; lastError: string | null }>> { return this.settings.listOutbox(businessDate); }
}
