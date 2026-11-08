# Borneo Jasa POS — Domain Glossary

Ubiquitous language and domain vocabulary for Borneo Jasa POS.

## Core Domain Terms

### Financials & Measurement
- **Cents**: Integer representation of currency in Malaysian Ringgit cents (e.g. `RM 10.50` is stored as `1050`). No floats in financial arithmetic.
- **MilliUnit**: Measured quantities (weight, length, quantity) stored as integer thousandths (e.g. `1.250 kg` is stored as `1250`).
- **Unit**: Measurement unit type (`kg`, `pcs`, `ft`, `m`, `box`, `roll`, `bag`, `btl`, `set`).

### Sales & Orders
- **Order**: A confirmed transaction containing line items, pricing, payment method, invoice sequence number, and timestamps.
- **OrderDraft**: A pre-persistence order specification containing calculated totals, customer information, and priced lines ready for storage.
- **Invoice Number (`invNo`)**:
  - `A-XXXX`: Walk-in customer sales sequence (e.g. `A-0001`).
  - `B-XXXX`: Contractor / Credit (pay-later) sequence (e.g. `B-0001`).
- **Delivery Order (`doNumber`)**: Running sequence `DO-XXXX` issued for building site deliveries with driver, lorry, and site details.
- **Customer Type**:
  - `walkin`: Retail cash/card/QR buyer.
  - `contractor`: Commercial trade customer with an account or pay-later credit facility.

### Catalog & Pricing
- **Item**: A catalog product with SKU, barcode, unit, base price, and optional stock tracking.
- **PriceTier**: Quantity-based pricing threshold (`minQtyMilli` and unit price in cents).
- **Lain-lain**: Ad-hoc line item for unlisted products, services, or one-off hardware goods.

### Credit & Settlement
- **Credit (Hutang)**: Outstanding debt resulting from a pay-later sale (`method: 'Credit'`).
- **Repayment**: A payment made towards outstanding contractor credit. Supports full settlement or partial splitting of credit rows.
- **Contractor**: Commercial account holder with optional credit limit, phone, and tax identification number (TIN).

### Business Day Lifecycle
- **Business Date**: The operational date (format `YYYY-MM-DD`). Does not switch at midnight; ends only upon an explicit **Close Day** action by the cashier.
- **DayClose**: An immutable record summarizing the day's total cash, non-cash payments, drawer reconciliation, and outbox artifact generation.
