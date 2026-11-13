import type { Receipt } from "@yf/core";
import { renderReceiptHtml } from "./renderReceiptHtml";
import { getPaperWidthMm, getReceiptPrinter } from "../settings";

// Swappable printer boundary — mirrors how SqlDriver abstracts storage.
//  - Electron: the main process prints the HTML silently to the configured
//    (or default) printer (window.printing bridge) — no dialog, ever.
//  - Browser dev: hidden iframe + the OS print dialog (silent in Chrome/Edge
//    launched with --kiosk-printing).

/** Print a standalone HTML document (receipt or day report). */
export function printHtml(
  html: string,
  deviceName?: string,
  pageSize?: "A4" | { width: number; height: number },
): Promise<void> {
  if (window.printing) {
    return window.printing.printHtml(html, deviceName || undefined, pageSize).then((r) => {
      if (!r.ok) throw new Error(r.error || "print failed");
    });
  }
  return iframePrint(html);
}

export interface ReceiptPrinter {
  readonly label: string;
  print(receipt: Receipt): Promise<void>;
}

/** The active printer for receipts. */
export const printer: ReceiptPrinter = {
  label: typeof window !== "undefined" && window.printing ? "System printer (silent)" : "Browser / OS printer",
  // Every sale needs one receipt for the customer and one for the cashier.
  // Send two sequential jobs so a thermal printer finishes the first roll before
  // receiving the second.
  print: async (receipt) => {
    const html = renderReceiptHtml(receipt, await getPaperWidthMm());
    const deviceName = await getReceiptPrinter();
    const receiptPageSize = { width: 80_000, height: 297_000 };
    await printHtml(html, deviceName, receiptPageSize);
    await printHtml(html, deviceName, receiptPageSize);
  },
};

function iframePrint(html: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const iframe = document.createElement("iframe");
    Object.assign(iframe.style, {
      position: "fixed",
      right: "0",
      bottom: "0",
      width: "0",
      height: "0",
      border: "0",
    });
    document.body.appendChild(iframe);

    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      setTimeout(() => iframe.remove(), 500);
      resolve();
    };

    const win = iframe.contentWindow;
    const doc = win?.document;
    if (!win || !doc) {
      iframe.remove();
      resolve();
      return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    win.onafterprint = cleanup;
    // Let layout/fonts settle, then print. Fallback cleanup if onafterprint
    // never fires (varies by browser).
    win.requestAnimationFrame(() => {
      win.focus();
      win.print();
      setTimeout(cleanup, 2000);
    });
  });
}
