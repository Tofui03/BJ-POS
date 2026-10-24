import { isMeasureUnit, type PaymentMethod, type Unit } from "@yf/core";

/**
 * Determines whether selecting an item in the till catalog should automatically
 * trigger the NumpadDialog for immediate weight/length entry.
 * Per R4: weighable (kg) and measurable (ft, meter, m) units trigger numpad immediately.
 */
export function shouldAutoTriggerNumpad(unit: Unit | string | null | undefined): boolean {
  if (!unit) return false;
  const u = String(unit).trim().toLowerCase();
  return isMeasureUnit(u as Unit) || u === "kg" || u === "ft" || u === "meter" || u === "m";
}

/**
 * Determines whether checkout should issue an A-series (walk-in cash/anonymous)
 * or B-series (contractor / credit) tax invoice.
 * Per R2: Walk-in defaults to A-sequence; contractor presence generates B-sequence.
 */
export function determineCheckoutInvoicePrefix(
  customerType?: "walkin" | "contractor" | null,
  contractorName?: string | null,
): "A" | "B" {
  // The Walk-in tab is always the A sequence, even if a contractor name is
  // still filled in from the other tab.
  if (customerType === "walkin") return "A";
  if (customerType === "contractor" || Boolean(contractorName?.trim())) {
    return "B";
  }
  return "A";
}

/**
 * Determines whether a checkout payment method should create a debt record in the credits table.
 * Per R2: Contractors paying with Cash, Bank, or QR do NOT create credit debt; only Credit does.
 */
export function shouldCreateCreditDebt(method: PaymentMethod): boolean {
  return method === "Credit";
}
