import { describe, expect, it } from "vitest";
import type { CompanyInfo, ContractorMonthlyStatement } from "@yf/core";
import {
  escapeHtml,
  renderContractorStatementHtml,
} from "./renderContractorStatementHtml";

describe("A4 Contractor Monthly Statement HTML Renderer", () => {
  const sampleCompany: CompanyInfo = {
    name: "Borneo Jasa Sdn. Bhd.",
    nameCn: "立強有限公司",
    regNo: "(227533-X)",
    tin: "C7875887040",
    address: "Lot No. 2, Jalan Bariawa, Depan St Margaret Church, P.O. Box 56, 89007 Keningau, Sabah",
    tel: "087-336333 / 016-8335313",
    email: "Borneojasa_sb@yahoo.com",
    bankInfo: "Maybank: 010095302338 | Public Bank: 3103279113",
  };

  const sampleStatement: ContractorMonthlyStatement = {
    contractor: {
      id: 12,
      companyId: 1,
      name: "Mega Builders & Construction",
      phone: "013-8899771",
      tin: "C9988112233",
      address: "Batu 2.5, Jalan Nabawan, 89000 Keningau",
      active: true,
    },
    yearMonth: "2026-10",
    broughtForwardCents: 125000, // RM 1,250.00
    openingDebtCents: 125000,
    creditLines: [
      {
        id: 101,
        orderId: 101,
        date: "2026-10-02",
        invoiceNo: "B-0001",
        description: "Portland Cement 50kg (x20)",
        amountCents: 46000, // RM 460.00
        doNo: "DO-0015",
        itemCount: 1,
      },
      {
        id: 102,
        orderId: 102,
        date: "2026-10-14",
        invoiceNo: "B-0005",
        description: "Deformed Bar 12mm (x10), Wire Mesh (x5)",
        amountCents: 85000, // RM 850.00
        itemCount: 2,
      },
      {
        id: 103,
        orderId: 103,
        date: "2026-10-20",
        invoiceNo: "B-0009",
        description: "[REFUND / 退货] Ref: B-0005 (Wire Mesh x1)",
        amountCents: -15000, // -RM 150.00
        itemCount: 1,
      },
    ],
    monthlyLines: [],
    repaymentLines: [
      {
        id: 42,
        date: "2026-10-18",
        receiptNo: "RP-0042",
        method: "Bank",
        amountCents: 50000, // RM 500.00
        notes: "MBB Cheque #882211",
        cashierName: "Ah Meng",
      },
    ],
    monthlyRepayments: [],
    repayments: [],
    monthCreditsCents: 116000, // RM 1,160.00 (460 + 850 - 150)
    monthRepaymentsCents: 50000, // RM 500.00
    monthNetCents: 66000, // RM 660.00
    closingDebtCents: 191000, // RM 1,910.00 (1,250 + 660)
    totalOutstandingCents: 191000,
  };

  // Wire aliases for complete fidelity
  sampleStatement.monthlyLines = sampleStatement.creditLines;
  sampleStatement.monthlyRepayments = sampleStatement.repaymentLines;
  sampleStatement.repayments = sampleStatement.repaymentLines;

  describe("Header and Company Details", () => {
    it("renders Malaysian company header with SSM reg no and LHDN TIN", () => {
      const html = renderContractorStatementHtml(sampleStatement, sampleCompany);

      expect(html).toContain("Borneo Jasa Sdn. Bhd.");
      expect(html).toContain("立強有限公司");
      expect(html).toContain("(227533-X)");
      expect(html).toContain("C7875887040");
      expect(html).toContain("087-336333 / 016-8335313");
      expect(html).toContain("Borneojasa_sb@yahoo.com");
      expect(html).toContain("Lot No. 2, Jalan Bariawa");
    });

    it("renders Statement title, month in uppercase English, and account reference", () => {
      const html = renderContractorStatementHtml(sampleStatement, sampleCompany);

      expect(html).toContain("Statement of Account");
      expect(html).toContain("PENYATA KIRA-KIRA BULANAN");
      expect(html).toContain("OCTOBER 2026");
      expect(html).toContain("CTR-0012");
      expect(html).toContain("30 Days / 30 Hari");
    });
  });

  describe("Bill-To / Kepada Section", () => {
    it("renders contractor name, TIN, address, and phone correctly", () => {
      const html = renderContractorStatementHtml(sampleStatement, sampleCompany);

      expect(html).toContain("Mega Builders &amp; Construction");
      expect(html).toContain("C9988112233");
      expect(html).toContain("Batu 2.5, Jalan Nabawan, 89000 Keningau");
      expect(html).toContain("013-8899771");
    });

    it("gracefully displays em dash on missing contractor fields", () => {
      const sparseStatement: ContractorMonthlyStatement = {
        ...sampleStatement,
        contractor: {
          id: 99,
          companyId: 1,
          name: "Ad-hoc Builder",
          phone: "",
          tin: "",
          address: undefined,
          active: true,
        },
      };
      const html = renderContractorStatementHtml(sparseStatement);

      expect(html).toContain("Ad-hoc Builder");
      expect(html).toContain("<strong>TIN:</strong> —");
      expect(html).toContain("<strong>Address:</strong> —");
      expect(html).toContain("<strong>Tel:</strong> —");
    });
  });

  describe("Invoices & Repayments Ledger Tables", () => {
    it("renders all credit invoices and negative refund rows with formatted currency", () => {
      const html = renderContractorStatementHtml(sampleStatement, sampleCompany);

      expect(html).toContain("B-0001");
      expect(html).toContain("Portland Cement 50kg (x20)");
      expect(html).toContain("RM 460.00");

      expect(html).toContain("B-0005");
      expect(html).toContain("Deformed Bar 12mm (x10), Wire Mesh (x5)");
      expect(html).toContain("RM 850.00");

      expect(html).toContain("B-0009");
      expect(html).toContain("[REFUND / 退货] Ref: B-0005 (Wire Mesh x1)");
      expect(html).toContain("-RM 150.00");

      // Total row
      expect(html).toContain("Total Month Charges / Jumlah Belian Bulan Ini:");
      expect(html).toContain("RM 1160.00");
    });

    it("renders repayments received with method, cashier, notes, and total", () => {
      const html = renderContractorStatementHtml(sampleStatement, sampleCompany);

      expect(html).toContain("RP-0042");
      expect(html).toContain("Bank");
      expect(html).toContain("Cashier: Ah Meng");
      expect(html).toContain("MBB Cheque #882211");
      expect(html).toContain("RM 500.00");

      // Total payments row
      expect(html).toContain("Total Month Payments / Jumlah Bayaran Bulan Ini:");
    });

    it("renders empty notice row when no purchases or payments exist in month", () => {
      const emptyStatement: ContractorMonthlyStatement = {
        ...sampleStatement,
        creditLines: [],
        monthlyLines: [],
        repaymentLines: [],
        monthlyRepayments: [],
        repayments: [],
        monthCreditsCents: 0,
        monthRepaymentsCents: 0,
        monthNetCents: 0,
        closingDebtCents: 125000,
      };
      const html = renderContractorStatementHtml(emptyStatement, sampleCompany);

      expect(html).toContain("No credit purchases recorded in this month");
      expect(html).toContain("No repayments recorded in this month");
    });
  });

  describe("Financial Summary Box", () => {
    it("renders accurate period rollforward amounts", () => {
      const html = renderContractorStatementHtml(sampleStatement, sampleCompany);

      expect(html).toContain("Brought Forward Balance / Baki Bawa Hadapan:");
      expect(html).toContain("RM 1250.00");

      expect(html).toContain("Add: Total Charges / Tambah: Belian Bulan Ini:");
      expect(html).toContain("+RM 1160.00");

      expect(html).toContain("Less: Total Payments / Tolak: Bayaran Bulan Ini:");
      expect(html).toContain("-RM 500.00");

      expect(html).toContain("Net Movement / Pergerakan Bersih Bulan Ini:");
      expect(html).toContain("RM 660.00");

      expect(html).toContain("CLOSING BALANCE DUE / BAKI AKHIR:");
      expect(html).toContain("RM 1910.00");
    });
  });

  describe("Bank Remittance Notice & Dual Signatures", () => {
    it("renders Maybank and Public Bank remittance instructions", () => {
      const html = renderContractorStatementHtml(sampleStatement, sampleCompany);

      expect(html).toContain("Remittance Instructions / Arahan Bayaran:");
      expect(html).toContain("Maybank: 010095302338 | Public Bank: 3103279113");
      expect(html).toContain("Mega Builders &amp; Construction");
      expect(html).toContain("CTR-0012");
    });

    it("renders dual commercial signature blocks for Store and Contractor", () => {
      const html = renderContractorStatementHtml(sampleStatement, sampleCompany);

      expect(html).toContain("PREPARED BY / DISEDIAKAN OLEH");
      expect(html).toContain("Authorised Signature &amp; Company Chop");
      expect(html).toContain("RECEIVED &amp; CONFIRMED BY / DISAHKAN OLEH");
      expect(html).toContain("Customer Signature, Full Name &amp; Chop");
    });
  });

  describe("Security: XSS Protection", () => {
    it("sanitizes malicious markup in contractor name, particulars, and notes", () => {
      const maliciousStatement: ContractorMonthlyStatement = {
        ...sampleStatement,
        contractor: {
          ...sampleStatement.contractor,
          name: "<script>alert('pwned')</script> Contractor",
          tin: "C123 <tag>",
          address: `123 Main St "quoted" & 'special'`,
        },
        creditLines: [
          {
            id: 1,
            orderId: 1,
            date: "2026-10-01",
            invoiceNo: `B-<img src=x onerror=alert(1)>`,
            description: `<b>Hazardous</b> Paint & Solvent`,
            amountCents: 1000,
            itemCount: 1,
          },
        ],
        monthlyLines: [],
      };
      maliciousStatement.monthlyLines = maliciousStatement.creditLines;

      const html = renderContractorStatementHtml(maliciousStatement);

      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;alert(&#039;pwned&#039;)&lt;/script&gt;");
      expect(html).not.toContain("<img");
      expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
      expect(html).not.toContain("<b>Hazardous</b>");
      expect(html).toContain("&lt;b&gt;Hazardous&lt;/b&gt; Paint &amp; Solvent");
      expect(html).toContain("&quot;quoted&quot; &amp; &#039;special&#039;");
    });
  });

  describe("Print CSS Standards", () => {
    it("includes required A4 print directives and page break avoidance rules", () => {
      const html = renderContractorStatementHtml(sampleStatement, sampleCompany);

      expect(html).toContain("@page {");
      expect(html).toContain("size: A4 portrait;");
      expect(html).toContain("margin: 12mm 15mm;");
      expect(html).toContain("display: table-header-group;");
      expect(html).toContain("page-break-inside: avoid;");
      expect(html).toContain("print-color-adjust: exact;");
    });
  });
});
