import {
  businessDateFor,
  computeFinancialMetrics,
  localDateStr,
  STORE_ADDRESS,
  type DayClose,
  type Order,
} from "@yf/core";
import { getRepo } from "./db";
import { driveConfigured, getPaperWidthMm } from "./settings";
import { buildDailyExcelB64, dailyReportBody, dailyReportSubject } from "./report/daily";
import { renderDayReportHtml } from "./printing/renderDayReportHtml";
import { printHtml } from "./printing/printer";

// Close Day orchestration. The business day is defined by the Close Day button:
// closing prints the day report, queues the HQ Drive upload, and pushes any later
// sale to the next day (see @yf/core closeday.ts for the stamping rule).

/** The business day a sale made right now belongs to. */
export async function currentBusinessDate(companyId: number): Promise<string> {
  const repo = await getRepo();
  const today = localDateStr(Date.now());
  const closed = await repo.getDayClose(today, companyId);
  return businessDateFor(Date.now(), closed != null);
}

export async function getTodayClose(companyId: number): Promise<DayClose | null> {
  const repo = await getRepo();
  return repo.getDayClose(localDateStr(Date.now()), companyId);
}

export type DailyReportDelivery = "sent" | "queued";

async function queueDailyDriveUpload(
  companyId: number,
  companyName: string,
  businessDate: string,
  orders: Order[],
  repayments: import("@yf/core").Repayment[],
  auto: boolean,
): Promise<DailyReportDelivery> {
  const repo = await getRepo();
  // Stable artifact name → idempotent Close Day (retry or re-close after reopen
  // updates the outbox row and overwrites the same Drive file).
  const attachmentName = `${companyName.replace(/\s+/g, "-")}-close-day-${businessDate}.xlsx`;
  await repo.queueEmail({
    companyId,
    businessDate,
    channel: "drive",
    subject: dailyReportSubject(companyName, businessDate, auto),
    body: dailyReportBody(companyName, businessDate, auto, computeFinancialMetrics(orders, repayments)),
    attachmentName,
    attachmentB64: buildDailyExcelB64(orders, repayments),
  });

  // Nudge the main-process Drive uploader; offline stays queued for retry.
  if (await driveConfigured()) {
    await window.drive?.process().catch(() => undefined);
  }
  const current = (await repo.listOutbox(businessDate)).find(
    (row) =>
      row.companyId === companyId &&
      row.attachmentName === attachmentName &&
      row.channel === "drive",
  );
  return current?.sentAt != null ? "sent" : "queued";
}

/**
 * Close a business day: record the close, queue the HQ Drive workbook, and (for a
 * manual close) print the paper day report. Returns that day's orders.
 */
export async function performClose(
  businessDate: string,
  opts: { companyId: number; companyName: string; auto?: boolean; print?: boolean; closedBy?: string },
): Promise<{ orders: Order[]; delivery: DailyReportDelivery }> {
  const repo = await getRepo();
  const [orders, repayments] = await Promise.all([
    repo.listOrdersByBusinessDate(businessDate, businessDate, opts.companyId),
    repo.listRepaymentsByBusinessDate(businessDate, businessDate, opts.companyId),
  ]);
  const alreadyClosed = await repo.getDayClose(businessDate, opts.companyId);
  if (!alreadyClosed) {
    const closedBy =
      opts.closedBy ??
      (typeof sessionStorage !== "undefined"
        ? sessionStorage.getItem("pos.cashier") || undefined
        : undefined);
    await repo.closeDay(businessDate, { companyId: opts.companyId, auto: opts.auto ?? false, closedBy });
  }
  const delivery = await queueDailyDriveUpload(
    opts.companyId,
    opts.companyName,
    businessDate,
    orders,
    repayments,
    opts.auto ?? alreadyClosed?.auto ?? false,
  );
  if (opts.print && !alreadyClosed) {
    const paperWidthMm = await getPaperWidthMm();
    await printHtml(
      renderDayReportHtml({
        storeName: opts.companyName,
        storeAddress: STORE_ADDRESS,
        businessDate,
        orders,
        repayments,
        paperWidthMm,
      }),
    ).catch(() => {}); // a printer problem must not block the close
  }
  return { orders, delivery };
}

/** Undo today's close (PIN-gated in the UI). */
export async function performReopen(companyId: number): Promise<void> {
  const repo = await getRepo();
  await repo.reopenDay(localDateStr(Date.now()), companyId);
}

/**
 * The forgot-to-close fallback, run at app launch: any past business day with
 * sales but no close record is closed automatically and its workbook queued for
 * Drive upload flagged "auto-closed". Nothing is printed. Skips quietly when
 * Drive isn't configured yet (e.g. browser dev).
 */
export async function autoCloseUnclosedDays(): Promise<string[]> {
  const repo = await getRepo();
  const today = localDateStr(Date.now());
  const closedDates: string[] = [];
  for (const company of await repo.listCompanies()) {
    for (const date of await repo.listUnclosedDays(today, company.id)) {
      const orders = await repo.listOrdersByBusinessDate(date, date, company.id);
      const repayments = await repo.listRepaymentsByBusinessDate(date, date, company.id);
      await repo.closeDay(date, { companyId: company.id, auto: true });
      await queueDailyDriveUpload(company.id, company.name, date, orders, repayments, true);
      closedDates.push(date);
    }
  }
  return closedDates;
}
