# Borneo Jasa POS — Senior-First 1080p UI/UX & Architecture Spec (`DESIGN.md`)

> [!IMPORTANT]
> **Antigravity Execution Mandate (Read First)**:
> 1. **Target Persona**: Built for a **60-year-old hardware store Aunty** and counter workers who are unfamiliar with computers. The mental model must mirror a **physical Casio calculator + paper ledger**. Zero hidden drawers, zero mode-switching confusion, and zero tiny hit targets.
> 2. **Target Hardware**: **15.6-inch Full HD Touchscreen / Monitor (`1920 × 1080` @ `1.0x` zoom)**. Every pixel of the 1920×1080 canvas must be utilized with generous spacing, large typography (`18px–36px`), and fixed non-jumping layouts.
> 3. **DDD & Backward-Compatible Persistence**: Keep all business math in `@yf/core` (integer `Cents` and `Milli`). Any SQLite schema updates in `@yf/data` (`packages/data/src/init.ts`) must be 100% non-destructive so existing store data is never lost.

---

## 1. Core Business & Domain Upgrades (`@yf/core` & `@yf/data`)

### 1.1 Four Explicit Cash/Immediate Payment Methods + Credit
The store requires 4 distinct immediate payment methods plus Contractor Credit:
- **`Cash`** (现金 / Tunai)
- **`Card`** (刷卡 / Kad)
- **`QR`** (扫码 / QR)
- **`Bank`** (银行转账 / Bank Transfer — displayed in UI & reports as **`Bank Transfer`**)
- **`Credit`** (记账欠款 / Hutang — for Contractors)

**Implementation Rules for Antigravity**:
1. **`packages/core/src/types.ts`**:
   - Update `PAYMENT_METHODS = ["Cash", "Card", "QR", "Bank", "Credit"] as const`.
   - Update `REPAYMENT_METHODS = ["Cash", "Card", "QR", "Bank"] as const`.
2. **`packages/core/src/schema.ts` & `packages/data/src/init.ts`**:
   - Update `SCHEMA_SQL` so `orders.method` allows `('Cash','Card','QR','Bank','Credit')` and `repayments.method` allows `('Cash','Card','QR','Bank')`.
   - In `init.ts`, safely migrate existing `orders` and `repayments` tables if their old `CHECK` constraint lacks `'Card'` (preserve all existing rows, IDs, and timestamps).
3. **`apps/pos/src/labels.ts` & `apps/pos/src/payments.ts`**:
   - Add `card` label (`zh: "刷卡"`, `en: "Card"`, `ms: "Kad"`, `bi: "Card / Kad"`).
   - Update `qr` label (`zh: "二维码 QR"`, `en: "QR"`, `ms: "QR"`, `bi: "QR"`).
   - Update `bank` label (`zh: "银行转账"`, `en: "Bank Transfer"`, `ms: "Pindahan Bank"`, `bi: "Bank Transfer"`).
   - Ensure `PAY_LABEL`, `PAYMENT_UI`, `renderReceiptHtml.ts`, `renderDayReportHtml.ts`, and `daily.ts` (Excel export) support `"Card"` and display `"Bank Transfer"` cleanly.

---

## 2. 15.6" Full HD (`1920 × 1080`) Ergonomic Grid & Typography System

### 2.1 Viewport Budget (`1920 × 1080`, Zero Page Scroll)
- **TopBar Height**: `68px` fixed.
- **Main Workspace Height**: `1012px` (`calc(100vh - 68px)`), divided into a **Fixed 3-Column Layout**:
  1. **Left Category Rail**: **`252px` fixed width**. Fits all 9 hardware categories + pinned `+ Lain-lain` button vertically with **zero scrolling** (`68px` height per button, `8px` gap).
  2. **Center Product Grid**: **`flex-1` (~`1128px` width)**. Displays a large search bar (`64px` height) at top and a **4-column product grid** (`grid-template-columns: repeat(4, minmax(0, 1fr))`, `12px` gap, `132px` card height).
  3. **Right Current Sale (Cart) Panel**: **`540px` fixed width**. Wide enough to display Item Name, clickable `[ Unit Price ]` box, `[-] [ Qty ] [+]`, Line Total, and `[ ✕ ]` on a single clean row without truncation or expandable trays.

### 2.2 Senior-First Typography & Hit-Target Tokens (`styles.css`)
```css
:root {
  /* Warm Stone L-Frame + Crisp White Sheet */
  --ground: #f5f4f0;
  --surface: #ffffff;
  --raised: #f0f2f5;
  --active: #e2e8f0;

  /* High-Contrast Borders (Visible for 60yo eyes) */
  --border: #d8dce3;
  --rule: #e6e8ec;
  --control: #94a3b8;

  /* Ink Hierarchy */
  --text: #0f172a;
  --muted: #475569;
  --faint: #64748b;

  /* Semantic Action Hues */
  --positive: #15803d; /* Pay CTA Green */
  --negative: #b91c1c; /* Delete / Cancel / Discount Red */
  --warning: #b45309;  /* Held / Credit Amber */

  /* 15.6" 1080p Senior Touch Sizing */
  --control-height: 58px;
  --cat-btn-height: 68px;
  --cta-height: 68px;
  --row-height: 68px;
}
```

### 2.3 Category Color-Coding (Left Semantic Accent Bar — No Full Rainbow)
To help Aunty locate categories by muscle and color memory without creating visual clutter, each category button in `TillView.vue` keeps a clean surface (`#ffffff` when active, `#fafaf9` when inactive) but features a 10px solid left color bar (`border-left-width: 10px`):

| `HardwareCategory` | Left Accent Bar Color | ZH / EN / BM |
| :--- | :--- | :--- |
| `"All"` | `#1e293b` (Slate Dark) | 全部 / All / Semua |
| `"Cement & Brick"` | `#c2410c` (Brick Terracotta) | 洋灰与砖 / Cement & Brick |
| `"Board & Wood"` | `#854d0e` (Timber Brown) | 木板木材 / Board & Wood |
| `"Tank, Roof & Gutter"` | `#0284c7` (Water Sky Blue) | 水槽屋顶 / Tank, Roof & Gutter |
| `"Door & Frame"` | `#7c2d12` (Mahogany) | 门与门框 / Door & Frame |
| `"Plastic Pipe"` | `#0d9488` (PVC Teal) | 塑料水管 / Plastic Pipe |
| `"Metal Pipe"` | `#475569` (Steel Grey) | 铁管白铁 / Metal Pipe |
| `"Fence & Steel"` | `#4338ca` (Indigo Iron) | 铁网钢材 / Fence & Steel |
| `"Lain-lain"` | `#6d28d9` (Sundries Purple) | 杂项 / Others |

---

## 3. Component-by-Component Simplification Specs (For 60yo Aunty)

### 3.1 Cart Row (`CartLine.vue` & `TillView.vue`) — KILL THE EXPANDABLE TRAY
**Problem**: Workers do not understand -5, +5, +10, and clicking a row to expand a hidden tray with Change Price is jarring and causes layout shifts.
**New Design (100% Direct Manipulation)**:
1. **Delete the inline expandable tray (`v-if="selected"`) completely**. Delete the `-5`, `+5`, `+10` buttons and the `Change Price` button.
2. Every cart row is a single, rock-solid horizontal row (`min-height: 68px`, `padding: 10px 12px`) with 4 clear zones:
   - **Zone 1 (Item Info, flex-1)**: Item Name (17px bold) + unit badge.
   - **Zone 2 (Direct Unit Price Button)**: A tactile, calculator-key-styled button `[ RM 24.00 / bag ✎ ]` (height: 48px, border: 1.5px solid `var(--control)`, background: `var(--raised)`).
     - **Action**: Tapping this price box immediately opens `NumpadDialog.vue` in **Unit Price** mode! If the price was overridden, show the original price struck through above it and a `[ 恢复原价 / Reset ]` button inside the Numpad dialog.
   - **Zone 3 (Direct Quantity Controls)**:
     - `−` button (`48px × 48px`, steps -1).
     - Tactile Quantity Box `[ 2 ]` or `[ 2.5 kg ]` (min-width: 72px, height: 48px, font-size: 18px bold, border: 1.5px solid `var(--control)`, background: `#ffffff`). Tapping this box immediately opens `NumpadDialog.vue` in **Quantity** mode!
     - `+` button (`48px × 48px`, steps +1).
   - **Zone 4 (Line Total & Remove)**:
     - Line Total (`RM 48.00`, 18px extra-bold, right-aligned w-105px).
     - Remove `[ ✕ ]` button (`44px × 44px`, pale red hover/active).

### 3.2 + Lain-lain Dialog (`LainLainDialog.vue`) — 3-SECOND CALCULATOR ENTRY + 1-TAP SAVE TO CATALOG
**Problem**: Too many fields, units, and reverse-math options. Aunty just wants to key in an amount (e.g., RM 15) and add it to the bill, or optionally save a new item to the database without slowing down the customer.
**New Design**:
1. Remove unit selector (pcs/kg/ft/meter) and reverse weight calculation from `LainLainDialog.vue` (default to 1 pcs at the entered RM price; if she needs more qty, she can tap the Qty box in the cart!).
2. Layout (Clean 2-Step Calculator):
   - **Top — 6 Big Category Tags** (height: 54px, 16px bold): 杂项 Lain-lain (default selected), 螺丝 Skru, 铁钉 Paku, 人工 Upah, 车油 Tambang, 切割 Potong.
   - **Optional Custom Name Row**: A single clean TextInput ("输入商品名称 (选填) / Nama Barang").
   - **⚡ Instant Catalog Save Toggle (Solves Missing DB Items!)**:
     - Whenever Aunty types a custom item name (or selects a tag), show a single large, friendly checkbox pill (height: 52px): `[ ☐ 顺便存入商品库，下次直接点 / Simpan ke senarai barang ]`
     - If checked, when she taps **Add / 加入账单**, the app automatically calls `repo.createItem(...)` in the background (using the entered name, price, pcs unit, and "Lain-lain" category) and refreshes `useCatalog()`, while immediately adding the item to the cart! Zero extra modal, zero waiting time for the customer!
   - **Bottom — Giant RM Numpad**: Big display showing RM 0.00 (36px bold) + 0–9 decimal keypad + green **加入账单 / Tambah (Enter)** button (68px height).

### 3.3 Weighing & Quantity Numpad (`NumpadDialog.vue`) — REMOVE TARE (KASAR/BEKAS) CLUTTER
**Problem**: Physical scales in hardware stores already have a TARE button. Showing Gross (Kasar) and Tare (Bekas) dual inputs on screen confuses Aunty and risks typing weight into the Tare box.
**New Design**:
1. Remove the Gross vs Tare dual input boxes from `NumpadDialog.vue` (keep `deductTare` in `@yf/core` so unit tests pass, but the UI directly takes the Net Weight/Quantity).
2. For Weighable/Length Items (kg, ft, meter):
   - Top toggle has only 2 plain-language big buttons (56px height):
     - `⚖️ 按重量/长度输入 (Ikut Berat / Panjang)` (Default)
     - `💵 按客人给的钱算 (Ikut Harga RM)` (For "Give me RM 10 of nails")
   - Directly below the display screen, show **5 Giant Quick-Tap Preset Pills** (height: 54px, font-size: 17px bold):
     - For kg: `100g (0.1)` · `250g (0.25)` · `500g (0.5)` · `1 kg` · `5 kg`
     - For ft / meter: `1` · `3` · `5` · `10` · `20`
3. For Unit Price Override Mode (`mode === 'price'`):
   - If the item has a catalog base price, show a prominent `[ ↺ 恢复原价 RM XX.XX ]` button at the top so Aunty can undo a price change in one tap.

### 3.4 Checkout & Payment Dialog (`PayDialog.vue`) — CLEAN 2-MODE ISOLATION & 1-TAP ROUNDING
**Problem**: Mixing Walk-in cash calculation, dual discount modes, Contractor search, ad-hoc contractor fields, and DO forms into one crowded view overwhelms Aunty.
**New Design**:
1. **Top Customer Type Switcher** (64px tall segmented tabs):
   - **Tab 1 (Default — 80% of sales)**: `🚶 散客现结 / Walk-in`
   - **Tab 2**: `🚚 工程商 / 开送货单 (Contractor & DO)`
2. **Simplified Whole-Bill Discount ("算便宜一点 / 抹零")**:
   - Remove the confusing 2-mode toggle (Final Total vs Minus Discount).
   - Next to the Total RM amount, place one clear button: `[ ✂️ 算便宜一点 / 改总价 (Genapkan RM) ]`.
   - Tapping it opens a numpad where Aunty simply types the Final RM Total she agreed with the customer (e.g. Bill is RM 123.00, she types 120 → system automatically sets `discountCents = 300` and shows `原价 RM 123.00 | 优惠 -RM 3.00 | 实收 RM 120.00`).
3. **When in `🚶 散客现结 / Walk-in` Tab (Ultra-Clean & Fast)**:
   - Hide all Contractor directory lists and TIN/Address inputs!
   - Show the Cash Change Helper at top: Quick tender pills (`[ 刚好 Exact ]`, `[ RM 10 ]`, `[ RM 20 ]`, `[ RM 50 ]`, `[ RM 100 ]`) + large `找零 / Baki: RM XX.XX` display.
   - Show 4 Giant Payment Confirm Buttons (height: 76px, font-size: 22px bold, 2×2 grid):
     1. `💵 现金 / Cash` (Forest Green `#15803d` primary button)
     2. `💳 刷卡 / Card` (High-contrast button)
     3. `📱 二维码 / QR` (High-contrast button)
     4. `🏦 银行转账 / Bank Transfer` (High-contrast button)
   - *(Optional toggle at bottom of Walk-in)*: A quiet button `[ 📄 需要打印 A4 送货单 (Issue DO) ]` in case a walk-in customer buys bulk materials for delivery.
4. **When in `🚚 工程商 (Contractor)` Tab**:
   - Step 1: Search/select an existing Partner Contractor card (or tap `[ + 临时输入新工程商 ]` to expand the Name/Phone/TIN inputs).
   - Step 2: Optional `[ 📄 开具 A4 送货单 (Issue DO) ]` toggle (Site Address, Lorry Plate, Driver, Show/Hide Price).
   - Step 3: 5 Payment Buttons: `记账欠款 (Credit / Hutang)` (Amber highlight) + `Cash` + `Card` + `QR` + `Bank Transfer`.

### 3.5 Frictionless Hold / Recall (`HoldOrdersDialog.vue` & `cart.ts`) — AUTO-SWAP, NEVER BLOCK
**Problem**: Previously, if the current cart had 1 item, the `Resume / 取单` button in `HoldOrdersDialog.vue` was disabled (`cart_not_empty`), causing Aunty to panic and think the computer froze.
**New Design**:
- In `HoldOrdersDialog.vue`, the `[ 取回此单 / Resume ]` button is **ALWAYS enabled**!
- When Aunty clicks Resume on Held Bill A while the current cart has items, automatically hold the current cart first (with an auto-note like `"自动暂存 / Auto-held"`) and immediately load Held Bill A into the active cart! Show a friendly toast: `"已自动暂存刚才的账单，并取回此单"`.
- *(Note: Keep `cart.resumeHeld()` programmatic default compatible with unit tests, and pass `"swap"` from `HoldOrdersDialog.vue` UI so UI users are never blocked).*

### 3.6 De-cluttered TopBar (`TopBar.vue`) & Center-Screen Confirmation Modals
1. **TopBar Simplification**:
   - Keep `TopBar.vue` clean (68px height):
     - Left: Shop Name + Primary Navigation (`← 收银台 Till`, `查单 History`, `工程商账本 Contractors`, `商品库 Items`, `报表 Report`).
     - Right: Language Switcher (中文 | EN | BM), On-Duty Cashier Badge (`👤 Ah Ming`), `日结 Close Day` (on Till), and `⚙️ 设置 Settings`.
   - Ensure all TopBar buttons have min-height: 50px and font-size: 16px with generous padding (`px-16px`) for 1080p touch accuracy.
2. **Quick "Reprint Last Receipt" on Till (`TillView.vue`)**:
   - In the Cart header (next to Held and Clear), if a sale was completed in this session (`cart.lastOrder`), show a convenient `[ 🖨 重印上一单 ]` button so Aunty can reprint a jammed receipt in 1 tap without leaving the Till.

---

## 4. Verification Checklist for Antigravity

1. `PAYMENT_METHODS` includes `"Cash"`, `"Card"`, `"QR"`, `"Bank"`, `"Credit"`, and all UI buttons, thermal receipts, day reports, and Excel sheets format `"Card"` and `"Bank Transfer"` properly.
2. `CartLine.vue` has no expandable bottom drawer, no -5/+5/+10 buttons, and allows direct 1-tap editing on both the Unit Price box and the Quantity box.
3. `LainLainDialog.vue` is a streamlined calculator with quick tags and a 1-tap "Save to Item Catalog (Simpan ke Barang)" checkbox that persists the item to SQLite without extra modals.
4. `NumpadDialog.vue` removes the confusing Gross/Tare dual boxes and presents direct weight/length entry with 5 large preset buttons + Target RM mode.
5. `PayDialog.vue` uses a single "Final Total (改总价/抹零)" discount flow and cleanly separates Walk-in 4-method checkout (Cash, Card, QR, Bank Transfer) from Contractor/DO checkout.
6. `HoldOrdersDialog.vue` never disables the Resume button when the cart has items (auto-swaps cleanly).
7. Run `pnpm test` and `pnpm typecheck` — all unit, stress, and E2E tests must pass 100%.
