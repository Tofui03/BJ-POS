# Borneo Jasa POS — Frontend Architecture & UI Design System (`design.md`)

> [!IMPORTANT]
> **Design & Engineering Mandate**:
> 1. **Senior-First Touchscreen Ergonomics (`1.0x` Native Zoom)**: Built for a ~60-year-old cashier operating 100% via touchscreen / mouse without a physical keyboard. Large hit targets, two-line bilingual (`EN / BM`) labels, and zero accidental-drag hazards.
> 2. **Strict Chromatic Discipline (No Category Rainbow)**: Following `/design-taste-frontend`, the workspace uses an achromatic / warm-stone ledger palette (`#f7f6f2` ground, `#ffffff` inset sheet, `#131416` primary ink). Categories stay **neutral**—no 8-colour rainbow stripes competing with the RM total. Color is reserved strictly for the **Pay / Bayar CTA (`#1e7b4f`)**, **Discounts / Cancel (`#c4242a`)**, and **Credit / Held Badges (`#92400e`)**.
> 3. **Lean, Controllable Stack & Zero Duplicate Dependencies**: Keep the existing `Vue 3 + UnoCSS + Pinia + vuedraggable` stack, add **`lucide-vue-next`** as the single icon library (replacing all emojis), and keep UI primitives in local source (`src/components/ui/`) without adding heavy layout/splitter or animation libraries.

---

## 1. Canonical Stack & Dependency Governance

| Capability Slot | Canonical Implementation in `@yf/pos` | Governance & System Logic Rule |
| :--- | :--- | :--- |
| **UI Primitives** | Local source in `src/components/ui/*` (UnoCSS + CSS tokens, **shadcn Nova** flat `1px` geometry) | Clean `1px`-bordered surfaces, `8px` card / `6px` control radii, tactile `:active` press states. **Must preserve `TextInput.vue` (`KeyboardDialog`) & `NumberInput.vue` (`NumpadDialog`) on-screen touch triggers**—never replace them with bare `<input>` tags that require a physical keyboard. |
| **Iconography** | **`lucide-vue-next`** (single new dependency) | **100% Lucide outline icons** (`18px–20px`, `1.75px` stroke). **Zero emoji icons** (`🖨`, `📥`, `☁️`, `🔍`, `📮`, `⚠️` are strictly banned). |
| **Layout** | **Fixed 3-Column Flex/Grid** (No draggable splitters) | Till columns are fixed (`216px` category rail · `flex-1` product grid · `440px` cart panel) so the cashier can **never** accidentally drag or collapse a pane on the touchscreen. |
| **Interaction Feedback** | **CSS Hardware-Accelerated Press (`transform: scale(0.99)`)** | Instantaneous `<80ms` tactile feedback via `.press:active` CSS transitions; no runtime animation library overhead. |
| **Drag & Drop** | **`vuedraggable`** (already installed) | Used exclusively for catalogue item reordering in `AdminView.vue` when `adminCategory === "All"` and `adminSearch === ""`. |
| **State Management** | **`pinia`** (already installed) | Single store layer (`useCart`, `useCatalog`, `useSales`, `useUi`). |

---

## 2. Visual System: Framed Achromatic Ledger on Warm Stone

### 2.1 The Shell & The Move ("Tinted L-Frame, Inset White Sheet")
- **The L-Frame (`--ground: #f7f6f2`)**: The top bar (`60px` height) and the left category rail (`216px` width on the Till) share a single warm stone ground (`#f7f6f2`) that prevents glare under fluorescent shop lighting.
- **The Work Sheet (`--surface: #ffffff`)**: The active workspace sits on a crisp white sheet inset `8px` from the window's right and bottom edges, with `12px` outer sheet corners, a `1px solid #e2e4e8` border, and **zero resting drop shadow**.
- **One Loud Thing on Screen**: The **Total RM to collect** (`32px` tabular numerals) and the **green `Pay / Bayar` button (`#1e7b4f`)** are the primary visual anchors on the Till. Category buttons and product tiles never use multi-coloured rainbow stripes.

### 2.2 Canonical CSS Tokens (`:root`)
```css
:root {
  /* Surfaces (Warm Stone L-Frame + Crisp White Sheet) */
  --ground: #f7f6f2;          /* TopBar + Left Category Rail */
  --surface: #ffffff;         /* Inset main sheet, cards, inputs */
  --raised: #f3f4f6;          /* Secondary well, inline cart tray, keypad tile */
  --active: #e5e7eb;          /* Selected table row / neutral active pill */

  /* Hairlines & Controls */
  --border: #e2e4e8;          /* 1px card & sheet edge */
  --rule: #eef0f2;            /* 1px table row divider */
  --control: #c8ccd0;         /* 1.5px interactive button/input border */

  /* Typography Ink (all pass ≥ 4.5:1 WCAG AA on #ffffff and #f7f6f2) */
  --text: #131416;            /* Primary ink: item names, totals, active labels */
  --muted: #52555a;           /* Secondary: BM bilingual line, unit suffix, spec */
  --faint: #686b70;           /* Placeholders, table headers */

  /* Semantic Action Hues (Strictly reserved — no category rainbow) */
  --primary: #131416;         /* Active category border, primary utility action */
  --positive: #1e7b4f;        /* Forest Green — Pay / Bayar CTA & completed status */
  --negative: #c4242a;        /* Signal Red — Cancel, Delete, Discount deduction */
  --warning: #92400e;         /* Amber Ink — Credit / Hutang & Held order badge */

  /* Status Pill Pairs (Pale tint + dark same-hue ink) */
  --pill-positive-bg: #dcfae5; --pill-positive-ink: #04250e;
  --pill-negative-bg: #ffedea; --pill-negative-ink: #831c1e;
  --pill-warning-bg: #fffbeb;  --pill-warning-ink: #92400e;
  --pill-neutral-bg: #ebedee;  --pill-neutral-ink: #353736;

  /* Geometry & Senior Touch Sizing (@ 1.0x Native Zoom) */
  --radius-sheet: 12px;
  --radius-card: 8px;
  --radius-control: 6px;
  --control-height: 52px;     /* Standard touch button / input height */
  --cat-btn-height: 56px;     /* Two-line bilingual category button height */
  --cta-height: 60px;         /* Primary Pay / Numpad key height */
  --row-height: 56px;         /* Table & cart row minimum pitch */
}
```

### 2.3 Typography & Numeric Discipline
- **UI Sans (`--font-sans`)**: `'Plus Jakarta Sans', 'Inter', system-ui, sans-serif`.
- **Tabular Numerals (`tabular-nums`)**: Every RM amount (`RM 24.00`), quantity (`2.5 kg`), and invoice number (`08-1005`) uses `font-variant-numeric: tabular-nums`.
- **Invoice Number Format**: Always rendered as **`08-1005`** (`MM-XXXX`, no `#` prefix) across the Till, History table, Receipt dialog, and Excel export so screen and paper match 1:1.

---

## 3. Exact Hardware Categories & Two-Line Bilingual Rail

In `packages/core/src/hardware-catalog.ts`, the catalogue filters on **9 exact `HARDWARE_CATEGORIES`**.
To ensure the senior cashier can read both English and Bahasa Melayu without truncation, the Left Category Rail is **`216px` wide**, and every button (`56px` tall) renders a **two-line bilingual label** (Line 1: English `15px` `font-700` `--text`; Line 2: BM `13px` `font-500` `--muted`).

| `HardwareCategory` Key | Line 1 (EN — `15px` Bold) | Line 2 (BM — `13px` Muted) | Visual Styling |
| :--- | :--- | :--- | :--- |
| `"All"` | `All` | `Semua` | Neutral tile (`--surface` when active, `3px` `--text` left bar) |
| `"Cement & Brick"` | `Cement & Brick` | `Simen & Bata` | Neutral tile (no rainbow) |
| `"Board & Wood"` | `Board & Wood` | `Papan / Kayu` | Neutral tile |
| `"Tank, Roof & Gutter"` | `Tank, Roof & Gutter` | `Tangki, Atap & Gutter` | Neutral tile |
| `"Door & Frame"` | `Door & Frame` | `Pintu & Bingkai` | Neutral tile |
| `"Plastic Pipe"` | `Plastic Pipe` | `Paip Plastik` | Neutral tile |
| `"Metal Pipe"` | `Metal Pipe` | `Paip Besi` | Neutral tile |
| `"Fence & Steel"` | `Fence & Steel` | `Pagar & Besi` | Neutral tile |
| `"Lain-lain"` *(Catalogue)* | `Others` | `Lain-lain` | Neutral tile (filters the 21 seeded sundries: Silicone, Paku, Tape, etc.) |
| **`+ Lain-lain` *(Pinned Bottom)*** | **`+ Lain-lain`** | **`Barang Lain (Taip Harga)`** | Dashed/distinct `1.5px solid var(--text)` utility button at the bottom of the rail → opens `LainLainDialog.vue` |

---

## 4. Screen-by-Screen Blueprints & Required Dialogs

### 4.1 App Shell & TopBar (`TopBar.vue`)
- Sits on `--ground` (`#f7f6f2`), `60px` tall.
- **Left**:
  - Static shop name **`Borneo Jasa Sdn. Bhd.`** (`18px` `font-700`, no company switcher).
  - Navigation buttons (`48px` tall, with Lucide icons):
    - On Till (`mode === 'till'`): `History / Rekod` (`History` icon → `/dashboard`), `Items / Barang` (`Package` icon → `/item`).
    - On other pages (`sales`, `report`, `admin`): Primary dark button `← Till / Kaunter` (`ArrowLeft` icon → `/`) + sibling links (`History`, `Report`, `Items`).
- **Right**:
  - On Till: `Close Day / Tutup Hari` (`CalendarCheck` icon → opens `CloseDayDialog.vue`) + **Live Business Date Badge** bound to **`maxDate`** from `salesDate.ts` (not wall-clock `todayStr`).
    - *Logic fix*: After `Close Day` is run for `22 Oct`, `maxDate` advances to `23 Oct` (`carried > todayStr`). Binding the badge to `maxDate` ensures the Till date badge always matches the `businessDate` stamped on new invoices and the next day's Excel report!
  - On History / Report / Items: `Settings / Tetapan` (`Settings` icon → opens `SettingsDialog.vue`) + interactive `DatePicker` trigger (on `sales` and `report`, bounded by `maxDate`).

---

### 4.2 Screen 1: The Till (`TillView.vue`)

Fixed 3-column layout (`216px` Left Category Rail · `flex-1` Center Product Grid · `440px` Right Current Sale Panel):

1. **Left Category Rail (`216px` fixed width, on `--ground`)**:
   - Vertical stack of the 9 `HARDWARE_CATEGORIES` two-line bilingual buttons (`56px` height, `6px` radius).
   - Active button: `--surface` (`#ffffff`) background, `1.5px solid var(--text)` border, and a `4px` `--text` (`#131416`) left bar. Inactive buttons sit quietly on `--ground` with `--text` / `--muted` labels.
   - **Pinned Bottom Action**: `+ Lain-lain / Barang Lain` button (`PlusCircle` Lucide icon) that opens `LainLainDialog.vue`.

2. **Center Product Grid (`ProductCard.vue`)**:
   - **Top Search Bar (Mandatory for 268–1,000 SKUs)**: Uses `TextInput.vue` with a `Search` Lucide icon (tapping opens `KeyboardDialog.vue` for touchscreen typing while also accepting physical keyboard typing) + `Clear / Padam` button (`X` icon) when non-empty. Filters by item name and size/spec.
   - **Product Cards**: **3 columns** on `1024px–1279px`; **4 columns** on `≥ 1280px` (`112px` card height, `10px` gap).
     - Top: Item Name (`16px` `font-700` `--text`, 2-line clamp) + single-item size/spec (`13px` `--muted`).
     - Bottom: Price (`RM 24.00/bag` in `15px` `font-700` `tabular-nums` `--text`) or `N sizes / saiz ›` badge (`--raised` pill) when `group.items.length > 1`.

3. **Right Current Sale Panel (`440px` fixed width, `CartLine.vue`)**:
   - **Header (`52px`)**: `Current Sale / Jualan Semasa` + `Held / Simpan (N)` button (highlighted in `--pill-warning-bg` when `cart.heldOrders.length > 0`, opens `HoldOrdersDialog.vue`) + 2-step `Clear / Kosongkan` button.
   - **Unselected Cart Row**:
     - Left: `displayName` (`line.customName || line.item.name`, `16px` `font-600`) + unit price subline (`RM 24.00/bag`). When `lineDiscountCents > 0`, displays `<s>RM 26.00</s> RM 24.00/bag (-RM 4.00)` in `--negative`.
     - Center: `−` (`44px×44px`, steps `-1`) · **`Qty` button** (`58px×44px`, shows `2` or `2.5`, tapping opens `NumpadDialog.vue` in decimal `'qty'` mode) · `+` (`44px×44px`, steps `+1`).
     - Right: Line total (`RM 48.00`, right-aligned `tabular-nums`) + `X` delete button (`40px×40px`).
   - **Selected Cart Row (Inline Quick-Adjust Tray — replaces `ItemAdjustSheet.vue`)**:
     - Highlighted with `1.5px solid var(--text)` border and `--raised` (`#f3f4f6`) fill; auto-scrolls into view.
     - Expands a compact inline bar directly inside the selected row (no duplicate `+1` button since `+` is already on the row):
       - **Quick Bulk Qty**: **`− 5`** · **`+ 5`** · **`+ 10`** (`42px` tall tactile buttons calling `cart.step(line.uid, delta)`).
       - **Price Override**: **`Change Price / Tukar Harga`** (`Tag` Lucide icon, opens `NumpadDialog` in `'price'` mode) + **`Reset / Asal`** (shown when `hasCustomPrice(line)` and `line.item.key !== LAIN_LAIN_KEY`).
   - **Checkout Footer**:
     - When `cart.totalDiscountCents > 0`: shows `Subtotal` (`cart.grossSubtotalCents`) and `Discount / Diskaun` (`-cart.totalDiscountCents` in `--negative`).
     - **Total Row**: `Total / Jumlah` label + **`RM 120.00`** (`32px` `font-800` `tabular-nums` `--text`).
     - **Action Row (`60px` tall)**:
       - `Hold / Simpan` (`136px` wide, secondary button with `PauseCircle` icon — parks current cart immediately).
       - **`Pay / Bayar`** (`flex-1`, `--positive` `#1e7b4f` solid green fill, white `20px` `font-700` text — the single loud filled CTA on the screen).

---

### 4.3 All 6 Required Till Dialogs (Complete Blueprint)

Every dialog renders on a centered `--surface` (`#ffffff`) card with `12px` radius, `1px solid var(--border)`, and backdrop `rgba(19, 20, 22, 0.45)`:

1. **Spec Picker Dialog (`SpecPickerDialog.vue`)**:
   - Triggered when tapping a `ProductCard` with `group.items.length > 1` (e.g., `Plywood — 4 x 8 x 9mm`, `12mm`, `18mm`).
   - Displays group title at top + a 2-column grid of large touch buttons (`64px` min-height) showing the spec (`item.size || item.name`), unit (`item.unit`), and right-aligned price (`RM XX.XX`). Tapping immediately adds the item to the cart and closes the dialog.

2. **Intuitive Decimal Numpad Dialog (`NumpadDialog.vue`)**:
   - Used for **Quantity** (`mode = 'qty'`, supports whole numbers like `3 bag` AND decimals like `2.5 kg` / `10.5 ft`), **Unit Price Override** (`mode = 'price'`), and **Cash Received / Discount** (`NumberInput.vue`).
   - **Strict Decimal Entry Rule**: Typing `3` means **`3`** (never `0.03` ATM-cent shifting). Includes an explicit **`.`** decimal key, `C` (clear), `⌫` (backspace), and a green `OK / Confirm` button.

3. **On-Screen Virtual + Physical Keyboard Dialog (`KeyboardDialog.vue`)**:
   - Opened whenever any `TextInput.vue` is tapped (Search bar, Creditor Name, Lain-lain custom note, Item Name/Size/Unit in Admin).
   - Supports clicking on-screen QWERTY keys with mouse/touchscreen **and** typing on a physical keyboard (`Enter` confirms, `Escape` cancels).

4. **`+ Lain-lain` Custom Item Dialog (`LainLainDialog.vue`)**:
   - Top: Quick-tap hardware category tags (`Lain-lain`, `Skru / Screw`, `Paku / Nail`, `Upah / Labour`, `Tambang / Delivery`, `Potong / Cut`) + optional `TextInput` custom label.
   - Bottom: Built-in decimal price keypad (`3` = `RM 3`, `.5` = `RM 3.50`) + green `Add / Tambah` button that adds a cart line with `LAIN_LAIN_KEY` (`"hw_lain_lain"`).

5. **Held Bills Dialog (`HoldOrdersDialog.vue`)**:
   - Lists parked carts (`cart.heldOrders`) with timestamp, item preview (`line.customName || line.itemSnapshot.name`), and total RM.
   - **Rule B Enforcement**: If the active cart currently has items (`cart.lines.length > 0`), the `Resume / Sambung` button is disabled and an amber banner explains: *"Current sale has items — Hold or Clear it before resuming a held bill."*
   - Discard uses a 2-step confirmation button (`Delete` → `Confirm Delete?`).

6. **Payment & Whole-Bill Discount Dialog (`PayDialog.vue`)**:
   - **Top Amount Header**: Shows `Total / Jumlah` (`cart.totalCents`). If discounted, shows struck-through `Subtotal` (`cart.grossSubtotalCents`) and `-Discount` in `--negative`.
   - **Whole-Bill Discount / Rounding Toggle (`Diskaun / Genapkan`)**:
     - Mode 1: **Final Total (`Harga Akhir RM`)** — e.g. subtotal `RM 123.00`, type `120` → auto-calculates `RM 3.00` bill discount.
     - Mode 2: **Discount Amount (`Tolak Diskaun RM`)** — e.g. type `3` → subtracts `RM 3.00`.
   - **4 Payment Method Tabs (`Cash / Tunai`, `Bank`, `QR`, `Credit / Hutang`)**:
     - `Cash`: Quick-tender buttons (`Exact`, next RM notes) + `Cash Received` `NumberInput` + Change Due (`Baki`) display.
     - `Credit / Hutang`: Shows a mandatory **`Customer Name / Nama Pelanggan`** `TextInput` (tapping opens `KeyboardDialog.vue`). The `Confirm Sale` button stays disabled until `creditorName.trim().length > 0`.

---

### 4.4 Screen 2: Sales History & Daily Ledger (`SalesView.vue` & `ReportView.vue`)

- **Header Row**:
  - Left: `Sales Ledger / Rekod Jualan` + segmented period control (`Day`, `Weekly`, `Monthly` — bound to existing `tab` ref `"date" | "week" | "month"` in `SalesView.vue`).
  - Right:
    - **`Download Excel` (`Download` Lucide icon)**: Primary utility button to save `.xlsx` locally.
    - **`Resend to Drive / Hantar Semula Drive` (`RefreshCw` / `CloudUpload` Lucide icon)**: Styled as a quiet secondary/retry button (`--raised` background) with tooltip/label clarifying that `Close Day` already sends the daily report automatically, and this button is only for manual re-sending.
- **Block 1: 5-Card KPI & Payment Filter Strip**:
  - Uses `activeStats` (`tab === 'month' ? sales.monthStats : sales.rangeStats`).
  - 5 cards: `All / Semua` (`activeStats.totalCents`), `Cash / Tunai`, `Bank`, `QR`, `Credit / Kredit`. Clicking any card filters the transactions table below by payment method in-place.
- **Block 2: Two-Column Ledger Body (`60%` Transactions Table · `40%` Items Sold Ranking)**:
  - **Transactions Table**:
    - Columns: `Inv No` (**`08-1005`**, no `#`), `Time`, `Items` (`N items` + amber creditor badge `o.creditorName` for Credit sales + `-RM X.XX` discount tag), `Method` pill, `Amount` (right-aligned `tabular-nums`, struck through if `o.voidedAt != null`).
    - Clicking a row opens `ReceiptDialog.vue` (Print receipt or 2-step `Cancel sale` if the business day is not closed).
  - **Items Sold Ranking (`TopSellerCard.vue`)**:
    - Ranked table of items sold (`Item`, `Qty`, `Amount` in `tabular-nums`). Tapping a row opens `OrdersDialog.vue` (with invoice numbers formatted as `08-1005`, no `#`).

---

### 4.5 Screen 3: Items & Pricing Catalogue (`AdminView.vue`) & Settings (`SettingsDialog.vue`)
- **`AdminView.vue`**:
  - Top bar: `Items & Pricing / Barang & Harga` + item count on left; `Import CSV` (`Upload` icon) + `+ Add / Tambah` (`Plus` icon) on right.
  - Filter row: `TextInput` search (`KeyboardDialog` enabled) + horizontal row of the 9 neutral `HARDWARE_CATEGORIES` filter pills.
  - Table: `Drag` (`GripVertical` icon, active when `All` & no search), `Item` (Name + Size/Spec badge), `Unit`, `Price (RM)` (right-aligned `tabular-nums`), `Delete` (2-step confirmation button).
  - Clicking a row opens the **4-Field Item Modal** (`Item Name`, `Size / Spec`, `Unit`, `Price RM`).
- **`SettingsDialog.vue`**:
  - Clean modal containing only the **Receipt Paper Width** selector (`80mm` vs `58mm`).
