# Simplification plan

Audit only. This change adds the plan and the screenshots under `docs/simplify-plan/`. No product code moves.

The bar: one purpose on each screen, one architecture for money and storage, one label where the control already says what it is. If a sentence is there so the layout makes sense, change the layout and delete the sentence. Integer cents, milli-unit quantities, ESC/POS and A4 print formats, and the Google Drive snapshot upload stay as they are.

Screenshots were taken from the Vite dev server at `http://localhost:3000` (sql.js + IndexedDB, English locale) in a 1280×800 window. The till is designed for 1920×1080, so the shots are slightly cramped and still show every screen below.

| Screen | File |
| --- | --- |
| Till | [till.png](simplify-plan/till.png) |
| Pay | [pay-dialog.png](simplify-plan/pay-dialog.png) |
| Debt settlement | [debt-settlement.png](simplify-plan/debt-settlement.png) |
| Receipt (opened from History) | [receipt.png](simplify-plan/receipt.png) |
| Held sales | [hold-orders.png](simplify-plan/hold-orders.png) |
| Items admin | [admin.png](simplify-plan/admin.png) |

The pay shot shows a real bug, not just extra copy: the amount caption renders as the raw key `amountToPay`. History column headers render as `receipt`, `time`, and `paymentMethod`. Those keys are missing from `labels.ts`.

## How to read the inventory

Every row is visible copy that is a tagline, a helper sentence, a placeholder doing the job of a label, or a second label on a control that already has a name. Primary button names (`Pay`, `Cash`, `Hold`, `Close Day`) stay. Column headers that only exist to align a figure stay, and the row says so. Empty states that are the whole content of a region stay as one line.

`labels.ts` is the dictionary (`RAW_BILINGUAL_L`, then `en` / `ms` / `zh`). Line numbers below are the call site that paints the string. The top bar already switches 中文 / EN / BM (`TopBar.vue` 161–185). A slash translation on the same control fights that switch. Hardcoded Chinese or Malay on a screen that also calls `L.*` fights it too.

`TextInput.vue` is a button. `placeholder` is the text inside the empty field (line 33). `title` is only the on-screen keyboard heading (line 38). A field with both an outer `<label>` and a placeholder is labeled twice.

## Till

`TillView.vue`, `CartLine.vue`, `ProductCard.vue`, `SpecPickerDialog.vue`, `LainLainDialog.vue`, `NumpadDialog.vue`.

| Copy | Where | Kind | Decision |
| --- | --- | --- | --- |
| `Till / Kaunter` | `TillView.vue:276` | Secondary label, screen-reader only | One word, `Till`. It is not visible. |
| Category second line (`Semua`, `Simen & Bata`, `Papan & Kayu`, …) | `TillView.vue:310-312`, built by `categoryDisplay` at `TillView.vue:65-78` | Secondary label under the category name | Delete the `<span>`. The color bar and the primary name are the button. In English the second line is Malay on purpose (`secondary: entry.bm`). |
| `+ Lain-lain` plus `Misc · Quick Price Input` | `TillView.vue:324-325` (`L.quickInputPriceHelp`) | Helper under the button name | Delete the 12px line. The purple bar and `+ Lain-lain` are the button. |
| Search placeholder `Item or size`, with a Chinese fallback if the key is empty | `TillView.vue:340` | Placeholder-as-instruction | Delete the placeholder. The search icon in the field is the affordance. The `\|\|` Chinese sentence never shows, because the key exists. Delete that fallback too. |
| `No matching items` | `TillView.vue:378` (`L.emptySearchPrompt`) | Empty state | Keep this one line. |
| `No items or sizes match the search keyword. Check spelling or use quick misc below` | `TillView.vue:380-381` (`L.emptySearchHint`) | Helper under the empty state | Delete. The Reset button and the Lain-lain button under it are the recovery. |
| `Clear / Reset` | `TillView.vue:390` | Two names on one button | One word, `Clear`. |
| Cart note button shows `备注`, tooltip `添加整单备注` or `备注: …` | `TillView.vue:441-445` | Hardcoded second language | The button shows the note text when there is one. When there is none, show a file icon only. Delete the Chinese tooltip. Keyboard title at `TillView.vue:631` (`整单备注 / Order Note`) becomes `Note`. |
| `Confirm?` | `TillView.vue:475` | Second press on Clear | Keep. The button itself changes. That is the confirm, not a caption. |
| `Qty / Amount` | `TillView.vue:485` | Column header | Keep. It aligns the two figures on each line. |
| `Tap an item to start` | `TillView.vue:497` (`L.tapToStart`) | Empty-state title | Delete. An empty cart with a total of RM 0.00 and a disabled Pay button is the empty state. |
| `Select items from catalog or search, or tap Quick Misc` | `TillView.vue:498-499` (`L.tillStartGuide`) | Helper | Delete, together with the shopping-bag circle. Lain-lain remains as a button if you want a shortcut; it does not need a sentence. |
| `N sizes` on a card | `ProductCard.vue:90` | Badge | Keep the count and the chevron. It is the control that opens the size picker, not a caption. Spec text at `ProductCard.vue:68-72` is the size itself. Keep. |
| `CartLine.vue` | whole file | — | No tagline or helper. Price, unit, and qty are the line. Leave the component's copy alone. |
| Category name above the size-picker title, and `(N sizes)` after the product name | `SpecPickerDialog.vue:70-73` | Secondary label | Delete the category line and the parenthetical. The title is the product. The grid is the sizes. |
| Filter placeholder `Size or model` | `SpecPickerDialog.vue:82` | Placeholder | Delete. The field is a filter on a list of sizes; the keyboard title `Filter size` (`:81`) becomes `Size`. |
| `No sizes match` | `SpecPickerDialog.vue:111` | Empty state | Keep the one line. |
| `+ Lain-lain (Quick Sale)` | `LainLainDialog.vue:180` | Tagline in the title | Title is `Lain-lain`. |
| `Choose Category` | `LainLainDialog.vue:195` | Section label over the chips | Delete. The chips are the categories (`LAIN_LAIN_TAGS` in `labels.ts:1454-1461`, each one `English / Malay`). Chips become one language via the locale switch. |
| Placeholder `L.itemNamePrompt` | `LainLainDialog.vue:217` | Broken placeholder | The key does not exist (`enterItemNamePrompt` is the real key and is unused). The field paints `itemNamePrompt`. Delete the placeholder. A name is optional because the chip already names the line. |
| `Save to item catalog for future quick tap` | `LainLainDialog.vue:237` | Helper on a checkbox | The checkbox row is the label `Save to catalog`. Delete the rest of the sentence and the ➕. |
| `Original Price` row plus `Restore Original Price RM …` | `NumpadDialog.vue:272-280` | Label plus a button that repeats it | Keep the button `Restore` with the money on it. Delete the left-hand `Original Price:` line. |
| `Enter by Weight/Length` and `Calculate by Customer Tender` with emoji | `NumpadDialog.vue:292-301` | Two mode names | Keep the two buttons. Drop the emoji. The words are the control. |
| `净重/数量:` or `RM` beside the big figure | `NumpadDialog.vue:306-307` | Prefix | Keep `RM` for money. For weight, the unit already sits on the right (`:313-315`). Delete `净重/数量:`. |
| `Customer Tender (RM):` and `Calculated Quantity:` | `NumpadDialog.vue:321-327` | Labels on the two figures in budget mode | Keep both. They are the only names of two different numbers. |
| `Quick Weight:` / `Quick Length:` | `NumpadDialog.vue:336` | Section label over preset keys | Delete. The keys (`1kg`, `5ft`, …) are the presets. |
| `Quick Budget:` | `NumpadDialog.vue:353` | Same, over `RM 10` keys | Delete the label. |
| `OK` under `OK` | `NumpadDialog.vue:376-377` | Second label on the confirm key | Delete the 14px `OK`. One `OK` remains. |

## Pay

`PayDialog.vue`. Confirmed on [pay-dialog.png](simplify-plan/pay-dialog.png): bilingual title, `A-Sequence`, the literal `amountToPay:`, tender caption, example placeholder, emoji on every pay button.

| Copy | Where | Kind | Decision |
| --- | --- | --- | --- |
| `收银结账 / Pembayaran` and `算便宜一点 / 改总价 (Genapkan RM)` | `PayDialog.vue:265` | Bilingual title | Walk-in/contractor screen title is `Pay`. The round-off screen title is `Total`. |
| `A-Sequence` / `B-Sequence` pill | `PayDialog.vue:271` | Secondary label | Delete the pill. The invoice number is on the receipt after pay. Staff do not choose the prefix here. |
| `Simpan` under `OK` | `PayDialog.vue:313-314` | Second label | Delete `Simpan`. |
| `Walk-in Cash` and `Contractor & Delivery Order` with emoji | `PayDialog.vue:351`, `:365` | Mode buttons | Keep the words. Drop the emoji. These two buttons are the layout that replaces the step headings below. |
| `amountToPay:` | `PayDialog.vue:371` | Broken secondary label | Key is missing from `labels.ts`. Delete the caption. The RM figure is the amount. |
| `(已优惠 -RM …)` | `PayDialog.vue:377` | Chinese caption beside the total | Delete the parenthetical. The round-off button and the negative discount inside that screen already show a discount. |
| `Round Off Total` with emoji | `PayDialog.vue:389` | Button | Keep the words. Drop the emoji. |
| Tooltip `清除整单优惠` and button `Restore Original Price` | `PayDialog.vue:395-398` | Second language plus a long undo name | Button is `Clear`. Delete the tooltip. |
| `Cash Tender & Change:` | `PayDialog.vue:406` | Section label | Delete. Exact / RM 10 / RM 20 / RM 50 / RM 100 are the tender keys, and Change or Short appears on the right when a tender is set. |
| Placeholder `e.g. Deliver to site morning / Driver note / Special instruction` | `PayDialog.vue:441` | Placeholder-as-instruction | Delete. Put a one-word label `Note` on the field (`TextInput` title becomes `Note`). Same for the contractor note at `:599-602`. |
| `Print A4 Delivery Order` disclosure | `PayDialog.vue:491` | The control | Keep. It opens the address fields. Drop the emoji. |
| Field titles `送货地址 / Site Address`, `罗里车牌 / Lorry No.`, `司机姓名 / Driver` and placeholders `Site Address`, `No. Lori (e.g. QAA 1234)`, `Driver Name` | `PayDialog.vue:496-499` and again `:585-588` | Bilingual title plus placeholder that repeats it | One label each: `Address`, `Lorry`, `Driver`. Delete placeholders. The plate format does not need an example; staff know their own plates. |
| `1. Choose Contractor` | `PayDialog.vue:508` | Step tagline | Delete the number and the heading. The search field and the selected-name row are step 1. |
| `选择已有商户` / `+ 临时输入新工程商` | `PayDialog.vue:514` | Hardcoded toggle | One word on the button: `New` or `List`, following the locale switch. |
| Search title `搜索工程商 / Cari Kontraktor`, placeholder `输入名称 / 电话 / TIN` | `PayDialog.vue:543-544` | Bilingual label plus instructional placeholder | Label `Find`. Delete the placeholder. |
| `No matching contractor found. Tap above to enter new` | `PayDialog.vue:559` | Helper | Delete. An empty list plus the `New` button is the state. |
| `商户全名 / Nama Penuh *`, `电话 / Tel`, `税号 / TIN`, `地址 / Alamat` and placeholders `Ah Seng Construction`, `012-3456789`, `C 1234567890`, `Alamat Penuh` | `PayDialog.vue:565-570` | Bilingual labels plus example placeholders | Labels `Name`, `Phone`, `TIN`, `Address`. Name is required by disabling Credit until it is filled, which the code already does (`:611`). Delete the asterisk sentence and the placeholders. |
| `Save to contractor directory for future use` | `PayDialog.vue:573` | Helper on a checkbox | Checkbox label is `Save`. |
| `2. Issue Delivery Order` | `PayDialog.vue:581` | Step tagline | The checkbox label is `Delivery order`. Delete the number. |
| `采购单号 / PO No.` and placeholder `PO No.` | `PayDialog.vue:589` | Label plus placeholder that repeats it | Label `PO`. Delete the placeholder. |
| `Show Prices on DO` | `PayDialog.vue:593` | Checkbox | Keep. It changes the printed page. No extra hint (`hidePricesHint` is unused; see below). |
| `3. Payment Method` | `PayDialog.vue:607` | Step tagline | Delete. The Credit button and the four method buttons are the choice. |
| Emoji on Credit, Cash, Card, QR, Bank | `PayDialog.vue:451-479` and `:614-649` | Decoration that repeats the word | Drop the emoji. The two blocks (walk-in 2×2, contractor 1+4) stay, because walk-in has no Credit and contractor leads with Credit. |

`DebtSettlementDialog.vue` is the other half of this screen group. Confirmed on [debt-settlement.png](simplify-plan/debt-settlement.png).

| Copy | Where | Kind | Decision |
| --- | --- | --- | --- |
| `DEBT SETTLEMENT` eyebrow | `DebtSettlementDialog.vue:115-116` | Tagline above the contractor name | Delete. The dialog opens from Settle on that row. Header is the name and the RM figure (`:118-123`). |
| `Outstanding Invoices (n)` | `:129-130` | Section label | Delete the heading. Each row is `Inv #`, the date, and the amount. The count is the number of rows. |
| `Settlement Payment Method` | `:177-178` | Section label | Delete. Cash, Bank Transfer, and QR are the method. |
| `Notes (optional)` and placeholder `e.g. Bank transfer ref / payment receipt` | `:226-227` | Label plus instructional placeholder | Label `Note`. Delete `(optional)` and the placeholder. |
| `No outstanding debt for this contractor` | `:171` | Empty state | Keep the one line. |
| `Confirm Settlement (RM …)` | `:248` | Button that repeats the header figure | Button is `Settle`. The header already shows the amount. |

## Receipt, held sales, history

`ReceiptDialog.vue`, `RefundDialog.vue`, `HoldOrdersDialog.vue`, `SalesView.vue`. Receipt and history confirmed on [receipt.png](simplify-plan/receipt.png). Held sales confirmed on [hold-orders.png](simplify-plan/hold-orders.png).

| Copy | Where | Kind | Decision |
| --- | --- | --- | --- |
| `Return` / `Receipt` plus the invoice number | `ReceiptDialog.vue:144` | Title | Keep. It is the document name. |
| `Cancelled` | `:149` | Status | Keep the chip. It is the state of the document. |
| `RETURN / 退货` | `:155` | Second language on a chip | One word, `Return`. |
| `Refund for Receipt #…` | `:163` | Second line under the title | Keep. It is a link to the original sale, which the title does not show. |
| `Item` / `Qty` / `Amount` | `:201-204` | Column headers | Keep. |
| `Print receipt / Cetak resit` | `:259` | Bilingual button | `Print`. |
| `Print DO / Cetak Nota Penghantaran` | `:269` | Bilingual button | `Print DO`. |
| `Return / Refund / 退货` | `:279` | Three languages on one button | `Return`. |
| `Ref: Receipt … · Cash` under the return title | `RefundDialog.vue:235-236` | Secondary line | Keep the invoice number on the title (`Return A-0029`). Delete the method from this line; the channel row below shows it. |
| `Loading return details...` | `:249` | Status | One word, `Loading`. |
| `Specify quantities to return` | `:258` | Helper | Delete. Each row has the qty field, `Max (All)`, and `Clear`. |
| `Unit Price / Bought / Remaining` sentence | `:270-273` | Helper line of three facts | Keep the three facts; they are the row. Drop the words that the numbers already sit next to only if a layout puts qty and money on the row without a sentence. Smallest layout change: one line `RM 24.00/bag · 1 left`. Delete `Bought` when it equals the original qty and the remaining figure is what the cashier edits. |
| `Refund Amount` under the line money | `:280` | Caption | Delete. The negative RM figure is the amount. |
| `Return Qty:` | `:285` | Label on the only input in the row | Delete. The input is the qty. The unit at `:296` stays. |
| `Refund Channel (Matches Original):` | `:321` | Helper label | Label is the method name alone. Delete the parenthetical. |
| `Credit Balance Reversal / 赊账额度冲减` | `:327` | Bilingual substitute for `Credit` | Show `Credit`, same as the other methods. |
| `Refund will automatically reduce the contractor outstanding debt on this order` | `:331` | Helper | Delete. A Credit return writes the reversal in `createRefundOrder`. The method name is the explanation. |
| `Total Refund Amount:` | `:338` | Label on the figure | `Total`. |
| `Cancel / 取消` and `Processing...` / `Confirm Refund (-RM …)` | `:351-359` | Bilingual button and a button that repeats the total | `Cancel` and `Refund`. |
| `Quick tag:` | `HoldOrdersDialog.vue:152` | Label over chips | Delete. |
| Chips `Walk-in / Masuk`, `Loading Lorry / Muat Lori`, `Contractor / Kontraktor`, `Checking Size / Semak Saiz` | `HoldOrdersDialog.vue:154-160`, strings at `labels.ts:1447-1452` | Bilingual chip labels | One language per chip, via the locale switch. |
| Placeholder `Customer / lorry / note` | `HoldOrdersDialog.vue:140` | Placeholder-as-instruction | Label `Note` (the keyboard title at `:139`). Delete the placeholder. |
| `Hold this sale` | `:147` | Button | `Hold`. The dialog title is already Held. |
| `No held sales` | `:170` | Empty state | Keep the one line. |
| `Current sale (n)` and the total | `:128-131` | The sale being parked | Keep. It is the object of Hold. |
| `Sales Lookup & Reprint` | `SalesView.vue:128` | Tagline | Delete the `<h1>`. This route is History (`TopBar.vue:76`). The date and the row count (`:130`) stay. |
| Placeholder `Search Inv No, Contractor, Note or Amount` | `SalesView.vue:183` | Placeholder-as-instruction | Delete. Search icon only, same as the till. |
| Header `receipt / Inv No` | `SalesView.vue:201` | Broken key plus a second name | `L.receipt` is not a label key, so the header paints `receipt / Inv No` (visible on the screenshot). Delete the header. The `A-0029` column is the invoice. |
| Header `time` | `:202` | Broken key | Delete. The date-time column is the time. |
| Header `Items & Customer` | `:203` | Column name | Keep a short `Sale` only if the column still needs a name after the broken headers go. The chips (item count, contractor, note, voided) are the cell. Prefer no header. |
| Header `paymentMethod` | `:204` | Broken key | Delete. The method chip is the cell. |
| `All` filter with no locale | `:145` | Button | Use `L.allFilter` (the key exists and is unused). Not a deletion; it is the control's name. |
| `🔙 退货 (原单 #…)` | `:231` | Hardcoded status | `Return` plus the original invoice number. |
| `Repayment` and `Credit Repayment` | `:265-268` | Hardcoded row labels | `Repayment` is the row type. Delete the fallback `Credit Repayment` when the name is missing; show the name or `Repayment` alone. |
| `Details / Return` and `Reprint Receipt` | `:299`, `:307` | Buttons | Keep. They are the two actions. `Reprint Receipt` can be `Print` once the icon is there. |

## Admin, contractors, restock, settings

`AdminView.vue` is 1,484 lines and three jobs (catalogue, stock, contractors). Confirmed on [admin.png](simplify-plan/admin.png) and behind the debt dialog.

| Copy | Where | Kind | Decision |
| --- | --- | --- | --- |
| `Items / Barangan` | `AdminView.vue:535` | Hardcoded second language on the tab | `Items`. The locale switch covers Malay. |
| Page title `Items` plus tabs `Item Catalog`, `Inventory Overview`, `Pending Items` | `:558`, `:572`, `:585`, `:603` | Title that repeats the selected tab | Delete the `<h1>`. The selected tab is the title. |
| `(filtered / total)` and the low-stock chips | `:613-636` | Counts | Keep the counts. They are data. Drop the bell emoji on Pending (`:603`). |
| Search placeholder `Item or size` | `:667` and again `:811` | Placeholder | Delete. Same treatment as the till. The keyboard title `Search` (`:666`) stays for the keyboard only. |
| Contractor search placeholder `Search contractor name, phone, or TIN…` | `:1134` | Placeholder-as-instruction | Delete. Label on the keyboard is `Find`. |
| `Temporary items created via Quick Misc…` | `:1016` (`L.pendingReviewDesc`) | Helper under the tab | Delete. The tab name and the rows are the queue. |
| `待审核 / Pending` | `:1052` | Bilingual status chip | `Pending`. |
| `No pending items` with a party emoji | `:1086` | Empty state | Keep the sentence. Drop the emoji. |
| `Item (e.g. Plywood, PVC Pipe, Cement)` and placeholder `e.g. Plywood` | `:1281-1286` | Helper in the label plus example placeholder | Label `Item`. Delete the parenthetical and the placeholder. |
| `Size (optional — e.g. 4 x 8 x 9mm, 1 inch, 50 kg)` and placeholder `e.g. 4 x 8 x 9mm` | `:1291-1296` | Same | Label `Size`. Delete the parenthetical and the placeholder. Empty size is already valid. |
| `Price (RM)` | `:1306` | Unit in the label | Label `Price`. The `RM` prefix on `NumberInput` (`:1310`) is the unit. |
| `Delete {name}?` plus `It will disappear from the till and this list. Past sales and reports keep it` | `:1355-1357` | Confirm title plus helper | Keep both. The second sentence is the consequence of a soft delete, and the layout cannot show historical receipts from here. |
| `Name *`, `Phone (Optional)`, `TIN (Tax ID) (Optional)`, `Address (Optional)` and four `e.g.` placeholders | `:1388-1423` | Required/optional helper plus examples | Labels `Name`, `Phone`, `TIN`, `Address`. Delete asterisks, `(Optional)`, and placeholders. Disable Save until the name is non-empty (the validator in `packages/core/src/contractors.ts` already rejects an empty name). |
| `Select item to restock` | `RestockDialog.vue:217` | Helper | Delete. The search field and the list are the picker. |
| Placeholder `Search name or scan barcode` | `:225` | Placeholder-as-instruction | Delete. This input is a real `<input>`, so the blinking cursor is the affordance. Barcode scanners type into a focused field without a sentence. |
| `SKU: {key} · unit` | `:241-242` and `:273-275` | Second line under the name | Delete `SKU:`. The key is an internal id (`hw_14`). Staff pick by name. Keep unit and price on the selected-item row (`:274-275`) because inbound qty is in that unit. |
| `Quick Presets` | `:348` | Section label | Delete. The `+5`, `+10`, … keys are the presets. |
| `Current Stock` / `Inbound Addition` / `Resulting Stock` block | `:373-399` | Three figures | Keep the three numbers. They are the inbound math. The labels stay because three stacked quantities are ambiguous without them. |
| `* Inbound Stock: Tracked Only` | `:405` | Helper when stock was untracked | Delete the sentence. The resulting figure changing from `0 (Untracked)` to a quantity is the transition. |
| Placeholder `e.g. DO-8812 / Lian Seng Hardware` | `:417` | Example placeholder | Label `Supplier`. Delete the placeholder. |
| `A4 Portrait Standard Document (Malaysian Commercial Format)` | `MonthlyStatementDialog.vue:289` | Tagline in the footer | Delete. The iframe is an A4 page. The print button says `Print Statement`. |
| `本月 / Current` | `:213` | Bilingual button | `This month`. |
| `Export Daily Excel / Laporan Excel` | `SendReportDialog.vue:112` | Bilingual title | `Excel`. |
| `Close Day already uploads automatically. Use this only to download or resend manually.` | `:113-114` | Helper | Delete. Download and Resend are the two buttons. |
| `Date` above the date button | `:119` | Label that repeats the date on the button | Delete. The button shows `04 Nov 2026`. |
| `Receipt printer, Google Drive & Item Catalog.` | `SettingsDialog.vue:221` | Tagline under Settings | Delete. |
| `Enter 4-digit PIN to access Owner Sales Report` | `:231` | Helper under the report button | Delete. `View Report` asks for the PIN on the next state (`:260`). |
| PIN prompts `输入老板 PIN 码 / Enter Owner PIN`, `验证原 PIN 码 / Verify Old PIN`, `设置新 4 位 PIN 码 / Set New 4-digit PIN`, `取消 / Cancel` | `:260-271` | Bilingual instructions | One line each: `PIN`, `Old PIN`, `New PIN`, `Cancel`. The four dots are the field. |
| Language block 中文 / EN / BM | `:303-328` | Duplicate of the top bar | Delete the block. `TopBar.vue:161-185` is the switch. |
| `Receipt paper width / Saiz kertas resit` | `:333` | Bilingual label | `Paper`. The select shows the widths. |
| `Google Drive Daily Report` | `:338` | Section title | `Drive`. |
| `Connected (DRIVE_FOLDER_ID & Service Account configured)` | `:342` | Helper | `Connected`. The env names are an operator detail, not a till caption. |
| `Not configured — you can still download the daily Excel…` | `:346-347` | Helper paragraph | Delete. The Excel button on History and Report is the download. Unconfigured Drive shows no Connected mark. |
| `Upload / Resend Daily Report to Drive` | `:357` | Button | `Resend`. |
| `Item Catalog CSV / Katalog Barangan CSV` and `Batch import or backup items catalogue via CSV.` | `:364-366` | Bilingual title plus helper | Title `Items`. Delete the sentence. Buttons become `Import` and `Export` (`:384`, `:392`). |
| `TopBar.vue` business-date tooltip `Business Date / Tarikh Jualan` | `TopBar.vue:220` | Tooltip second language | Delete the tooltip. The date is on the chip. |

`OrdersDialog.vue` (opened from the report) has hardcoded `Sales` (`:40`), `Total` (`:45`), and `No matching orders.` (`:95`). Keep `Sales` and `Total` as the names of the two figures. Keep one empty line.

## Report and close day

`ReportView.vue`, `CloseDayDialog.vue`.

| Copy | Where | Kind | Decision |
| --- | --- | --- | --- |
| `Owner Sales Report` | `ReportView.vue:244` | Screen title | Keep. The route is behind a PIN and is not the till. |
| Donut tooltip `Click to reset filter` and visible `Reset ✕` | `:326`, `:340-341` | Helper | Delete both. Tapping the center already resets (`:325`). |
| `100% Flow` | `:371` | Tagline | Delete. |
| `Choose how to pay` | `:378` (`L.choosePay`) | Wrong reused label | Delete. The rows are a filter, not a checkout. |
| `Total (All Channels)` and a `100%` chip | `:388-389` | Secondary label | The row is `Total` plus the money and the count. Delete `(All Channels)` and the 100% chip. |
| `Cash Sales + Repay - Refund` | `:454` | Formula helper under drawer cash | Delete. The tile title and the figure stay. Repayments and refunds are the next two tiles. |
| `records (Cashflow in)` and `returns deducted` | `:475`, `:496` | Helper suffixes on counts | The count alone, next to the money. Delete the parenthetical. |
| `Reconciled (0 drift)` badge beside Net Sales | `:668-671` | Jargon badge | Delete. Show `Variance` only when the number is not zero (`L.reconciliationDrift` already exists and is unused). |
| Search placeholder `Search items` | `:534` | Placeholder | Delete. |
| `Close today's sales?` plus `The report prints and uploads to Drive. New sales count as tomorrow.` | `CloseDayDialog.vue:203-204` | Question plus helper | Keep the question. Delete the hint. The button is `Close Day`, and the queue/upload result already has its own states (`driveSent`, `driveQueued` at `:143-144`). |
| Metric captions on the close summary (`Sales`, `Gross Sales`, `Realized Inflow`, `Drawer Cash`) | `:181-197` | Labels on figures | Keep. Four numbers need names. Do not add a fifth sentence. |

`CashierDialog.vue` is not mounted. Nothing imports it. Its helpers (`selectCashierHelp` at `:95`, `cashierRequiredWarning` at `:123`, `noCashiersRegistered` at `:168`, placeholder `e.g. Ah Ming / Siti / Tan` at `:182`) go away when the component is deleted. See dead code below. Do not mount it just to keep the sentences.

## Dictionary that nothing paints

77 keys in `RAW_BILINGUAL_L` have no `L.<key>` use outside `labels.ts`. They are the previous creditor-on-the-till copy, weigh/tare copy, and labels that `PayDialog.vue` replaced with hardcoded bilingual strings. Delete the keys and the `en` / `ms` / `zh` entries together.

`change`, `short`, `received`, `payLater`, `dashboard`, `menu`, `send`, `payCash`, `quantity`, `selectedItem`, `outOfStock`, `addStock`, `bulk`, `newCreditor`, `creditorName`, `creditorPlaceholder`, `previousCreditors`, `noCreditors`, `noCreditorMatch`, `reopenPin`, `now`, `wrongPin`, `lainLainTitle`, `resetPrice`, `finalTotal`, `enterFinalTotal`, `enterDiscount`, `clearDiscount`, `uploadDrive`, `cashier`, `selectCashier`, `switchCashier`, `cashierAuditHint`, `onDuty`, `weightQtyTare`, `targetRmBudget`, `netWeight`, `quickLength`, `quickRm`, `targetRm`, `computedQuantity`, `tierDiscountApplied`, `walkInCustomer`, `selectContractor`, `partnerContractors`, `noPhone`, `orEnterAdhoc`, `saveAsPartner`, `issueDo`, `doEnabled`, `doDetails`, `siteAddress`, `lorryPlate`, `driverName`, `contractorPo`, `showPricesOnDo`, `hidePricesHint`, `selectContractorPayMethod`, `pleaseSelectContractor`, `cashCalc`, `invoiceSequence`, `quickRestock`, `newStock`, `stockQuantity`, `stockThreshold`, `lowStockCount`, `allCategories`, `reconciliationDrift` (keep this one; the report plan uses it), `prevMonth`, `nextMonth`, `lorryNo`, `poNumber`, `allFilter` (keep; History should use it), `resetFilter`, `currentMonth`, `salesTab`, `qtySold`.

Five call sites use keys that are not in the dictionary. They render the key name. Confirmed for three of them on the screenshots.

| Call | Where | Decision |
| --- | --- | --- |
| `L.amountToPay` | `PayDialog.vue:371` | Delete the caption. |
| `L.itemNamePrompt` | `LainLainDialog.vue:217` | Delete the placeholder. |
| `L.receipt` | `SalesView.vue:201` | Delete the header. |
| `L.time` | `SalesView.vue:202` | Delete the header. |
| `L.paymentMethod` | `SalesView.vue:204` | Delete the header. |

`currentLocale` starts as `"bi"` (`settings.ts:23`) and `loadLocale` (`:26-34`) falls through to `"en"` unless the database stored `bi`. The top bar cannot select `bi`. `RAW_BILINGUAL_L` and the proxy branch at `labels.ts:1394-1395` are a second language system next to `en` / `ms` / `zh`. After the hardcoded slash strings are gone, delete the `bi` locale and the raw bilingual table. `i18n-localization.stress.test.ts` locks `bi` today, so that deletion updates those assertions in the same change.

## SqlPosRepo and getRepo()

`SqlPosRepo` is one class, 1,530 lines, 49 methods (`packages/data/src/sql-repo.ts:162`). The static-analysis edge count is the fan-in of that class plus the types it throws and returns. It is not 73 different responsibilities.

The Electron IPC contract is not a method list. The renderer builds SQL and sends it through `createIpcDriver` (`apps/pos/src/ipc-driver.ts`). Main handles `db:all`, `db:values`, `db:run`, `db:meta`, `db:reset` (`apps/pos/electron/main.ts:53-91`). sql.js in Vite uses the same `SqlDriver`. Splitting the class into files does not change channel names, statement shape, or the schema. `getRepo()` (`apps/pos/src/db.ts:19-22`) stays a singleton that returns `Promise<SqlPosRepo>`.

### Call sites of getRepo()

50 production `await getRepo()` calls in 19 files. Tests add more, which is where a 69-edge count comes from. The function is four lines. The edge count is import fan-out.

| File | Calls |
| --- | --- |
| `apps/pos/src/settings.ts` | 9 |
| `apps/pos/src/views/AdminView.vue` | 8 |
| `apps/pos/src/business.ts` | 6 |
| `apps/pos/src/components/SettingsDialog.vue` | 5 |
| `DebtSettlementDialog.vue`, `MonthlyStatementDialog.vue`, `ReceiptDialog.vue`, `RefundDialog.vue`, `SendReportDialog.vue`, `stores/cashier.ts`, `stores/sales.ts` | 2 each |
| `CloseDayDialog.vue`, `place.ts`, `LainLainDialog.vue`, `PayDialog.vue`, `RestockDialog.vue`, `stores/cart.ts`, `stores/catalog.ts`, `TillView.vue` | 1 each |

Do not split `getRepo`. Views should stop growing new calls. Catalogue reads already go through `stores/catalog.ts`. Sales history already goes through `stores/sales.ts`. Admin, settings, pay, receipt, refund, restock, and debt still open the repo themselves. Moving those behind the existing stores is a later, separate change. Doing it in the same PR as the file split makes every Vue file look modified and hides a real SQL mistake.

### Method sizes

The class is uneven. Most methods are thin. Four are the mass:

| Method | Lines | What it owns |
| --- | --- | --- |
| `persistOrder` | 307–458 (152) | Idempotency key, A/B invoice sequence, contractor snapshot, DO number, stock deduction, credit row, all inside one `db.tx` |
| `createRefundOrder` | 1031–1169 (139) | Refund guards, negative order, stock return, credit reduction, its own transaction |
| `recordRepayment` | 568–674 (107) | Balance check, repayment row, credit update |
| `listCreditOrdersForContractor` | 1371–1455 (85) | Statement source rows |

`voidOrder` (946–1010), `toOrder` (863–921), `queueEmail` (1283–1337), and `listRepaymentsForContractor` (1456–1504) are the next tier. `clearCreditsByName` (721–743) is only called from tests. The UI settles with `clearCreditsByIds` (`DebtSettlementDialog.vue:83`). Keep the method. The interface stays.

Held sales are not in this class. They live in `localStorage` in `stores/cart.ts` (`HELD_STORAGE_KEY`, lines 118–132). A "held orders" SQL module would be a new feature. Do not add one.

### Proposed modules

`SqlPosRepo` remains the class everyone constructs (`init.ts` `initRepo`, `getRepo`). Methods become short delegations so the public surface and the export path `@yf/data` stay put. New files are implementation, not a second interface.

| Module | Methods | Lines today, roughly |
| --- | --- | --- |
| `sql/catalog.ts` | `listCompanies`, `listUnitTypes`, `listItems`, `getItem`, `getItemByKey`, `createItem`, `updateItem`, `setItemActive`, `setItemOrder`, `setTiers`, `restockItem`, `attachTiers` | ~140 |
| `sql/orders.ts` | `persistOrder`, `getOrder`, `listOrders`, `listOrdersByBusinessDate`, `voidOrder`, `getRefundsForOrder`, `createRefundOrder`, plus `toOrder`, `linesForOrders`, `refundInvNosFor` | ~550 |
| `sql/contractors.ts` | `listContractors`, `getContractor`, `getContractorByName`, `createContractor`, `updateContractor`, `setContractorActive` | ~100 |
| `sql/credit.ts` | `listCredits`, `recordRepayment`, `clearCredit`, `clearCreditsByIds`, `clearCreditsByName`, `listRepayments`, `listRepaymentsByBusinessDate`, `listCreditOrdersForContractor`, `listRepaymentsForContractor`, `getContractorMonthlyStatement`, `creditorNamesFor` | ~450 |
| `sql/close-day.ts` | `getDayClose`, `closeDay`, `reopenDay`, `listUnclosedDays`, `toDayClose` | ~100 |
| `sql/settings.ts` | `getSetting`, `setSetting`, `queueEmail`, `listOutbox` | ~100 |

Shared, and not copied into each file:

- Row mappers at `sql-repo.ts:67-160` (`toItem`, `toTier`, `toLine`, `toContractor`, `toRepayment`, `toCredit`).
- `makeDrizzle` and the `SqlDriver` transaction (`db.tx`). Each public method keeps its own transaction. A helper must not call `tx` again inside one.
- Invoice and DO sequence queries, currently inline in `persistOrder` (`:334-342` and `:376-379`). One function, called inside the order transaction. Refunds that allocate a number use the same function. Two copies will drift and can issue the same `A-` number.
- Stock writes. `planStockDeduction` already lives in `packages/core`. The SQL that applies it is inside `persistOrder`, `voidOrder`, `createRefundOrder`, and `restockItem`. One `applyStock(tx, itemId, deltaMilli)` used by those four. Restock stays a catalog method. It calls the helper. It does not move into the order module.
- Credit insert on a Credit sale stays inside the `persistOrder` transaction. The orders module may call a `insertCredit(tx, …)` function from the credit module. The credit module must not open a second transaction for that call.
- `PosRepo` in `packages/core/src/repo.ts`. No signature changes. Optional methods `listCreditOrdersForContractor` and `listRepaymentsForContractor` stay optional so existing fakes keep compiling.

### Risks

- A sequence or stock update that leaves the transaction will double-apply under the IPC mutex. The mutex in `ipc-driver.ts:57-59` serializes transactions. It does not make two transactions one.
- `toOrder` re-derives tier flags from current price tiers (`toLine`, `:99-101`). Moving it must not start storing those flags.
- `init.ts` is 522 lines of migrations. Leave it. A split that "cleans up" migrations can drop a column on a shop database that already has sales.
- Tests import `SqlPosRepo` and call methods directly (`packages/data/src/repo.integration.test.ts` and the stress tests). The class has to keep every method. File-private functions are fine. A new interface that tests must be rewritten against is not.
- Drizzle is a query builder over `SqlDriver` (`packages/data/src/drizzle.ts`). Some queries are already raw SQL (invoice sequence, DO sequence). Leave that mix. Unifying on one style is churn.

### What the edge counts are not

`Order` (`packages/core/src/types.ts:112`) is wide because a sale, a delivery order, a refund, and a statement line are the same row. Splitting it into four types would add mapping at every boundary. Leave it.

`PosError` (`packages/core/src/errors.ts`) is nine lines. The 61 edges are `throw new PosError` across pricing, stock, orders, and the repo. One error type is the right shape. Subclasses would be a new abstraction.

`PricedItem` is `Item` plus `tiers`. Pricing and the catalogue both need that. Leave it.

`PosRepo` is the seam that lets core tests fake storage. It should stay one interface. The file split is behind it.

## Other wins, by value then risk

1. **Delete the broken and unused labels in the same PR as each screen.** High value, low risk. `amountToPay` is on screen today. The 77 unused keys and the `bi` table are a 1,400-line dictionary with four copies of every string. Risk: `i18n-localization.stress.test.ts`, `pos-interactions.test.ts`, `settings-consolidation.stress.test.ts`, `contractor-navigation.stress.test.ts`, `inventory-overview.stress.test.ts`, and `restock-ui.stress.test.ts` assert HTML strings. Update them in the same commit. They are source snapshots, not behavior tests.

2. **Delete unreachable UI.** High value, low risk.
   - `CashierDialog.vue` is never imported. `useCashier` still records a name onto orders (`stores/cart.ts:564`) but nothing can set it. Delete the dialog. Keep the store fields that orders already write, so a later cashier button can set `currentCashier` without bringing the helper copy back.
   - `SalesSummaryPanel.vue` and `TopSellerCard.vue` are never imported. ReportView replaced them. Delete both files.
   - `TopBar.vue:30` and `:228`: `sendOpen` is never set true. The Send Report dialog in the top bar cannot open. Settings has the real one (`SettingsDialog.vue:411`). Delete the top-bar instance.
   - `adjustTail`, `stepTail`, `setTail` (`stores/cart.ts:338-356`) and `missingTail` (always `null`, `:358`) are the old fish-shop tail count. No view calls them. Delete the three functions. Keep the `tailCount` field on the line and the column, because old databases and refund math still store it (`packages/core/src/schema.ts:192` documents the fish seed). Dropping the column is a migration. Out of scope.

3. **One Lain-lain tag list.** `LAIN_LAIN_TAGS` is copied in `labels.ts:1454` and `packages/core/src/hardware-catalog.ts:19`. The dialog imports the labels copy. Hardware-catalog's copy is unused. Delete the unused one. Low risk.

4. **Walk-in and contractor delivery fields are the same six inputs pasted twice** (`PayDialog.vue:495-501` and `:584-594`). After the copy cut, one block rendered for both modes. Medium value, low risk if the Credit-only fields (PO, show price) stay behind `customerType === 'contractor'`.

5. **Fish catalogue still seeds tests.** `LEGACY_SEED_ITEMS` in `packages/core/src/schema.ts:199-211` (tilapia, ayam, milk, durian) is what `packages/data` tests pass as `seedItems`. Production seed is `HARDWARE_SEED_ITEMS` (`schema.ts:214`, 253 rows). Leave the legacy list until a test PR points the data tests at a handful of hardware fixtures. High churn, easy to break stock and tier tests for no shop-facing gain. Do it last, or not at all.

6. **`tests/e2e` is not in the workspace.** `pnpm test` is `pnpm -r test` and never sees `tests/e2e/`. The four files pass when pointed at Vitest (below). Wire them in only if you want CI to run them. The repo has no test CI. `.github/workflows/build-windows.yml` builds the installer and does not run `pnpm test`.

7. **Do not split `AdminView.vue` for its own sake.** 1,484 lines is three templates in one file (catalogue, pending, contractors) plus two editors. After the copy cut, extract the contractor directory and the item editor only if the file is still hard to move through. A split that preserves behavior is fine. A redesign of stock is not part of this.

Leave `init.ts` migrations, `hardware-catalog.ts` seed data, print HTML, and Drive upload alone.

## Tests run for this audit

Commands that exist:

| Command | What it runs |
| --- | --- |
| `pnpm test` | `pnpm -r test`. Vitest in `@yf/core`, `@yf/data`, `@yf/pos`. |
| `pnpm typecheck` | `tsc --noEmit` in core and data, `vue-tsc --noEmit` in the app. |
| `pnpm dev` | Vite on port 3000. Used for the screenshots. |
| `pnpm build` | Not run. It is the production Vue bundle plus `vue-tsc`. |
| `tests/e2e/*.test.ts` | No package script. Not part of `pnpm test`. |

`pnpm test` passed, exit 0.

```
packages/core test:  Test Files  13 passed (13)
packages/core test:       Tests  235 passed (235)
packages/core test:    Duration  1.07s

packages/data test:  Test Files  11 passed (11)
packages/data test:       Tests  158 passed (158)
packages/data test:    Duration  4.49s

apps/pos test:  Test Files  31 passed (31)
apps/pos test:       Tests  419 passed (419)
apps/pos test:    Duration  8.87s
EXIT:0
```

812 tests. `pnpm typecheck` passed, exit 0, all three packages `Done`.

The e2e files also passed when run by hand:

```
pnpm --filter @yf/data exec vitest run --dir /workspace/tests/e2e

 Test Files  4 passed (4)
      Tests  115 passed (115)
```

### What the critical flows have

| Flow | Covered now | Gap |
| --- | --- | --- |
| Cash checkout | `persistOrder` with `method: "Cash"` in `tests/e2e` and `packages/data` integration tests. Cart total math in `stores/cart.test.ts`. | No test opens `PayDialog` and clicks Cash. SSR tests only assert source strings. |
| Bank transfer | e2e tiers use `method: "Bank"`. | Same: repo only, no dialog. |
| QR | e2e tiers use `method: "QR"`. | Same. |
| Card | Receipt HTML, daily Excel, and a contractor unit fixture set `method: "Card"`. | No `persistOrder` test uses Card. The column is generic, so Cash covers the write. A single Card persist in `sql-repo.test.ts` would close it. There is still no dialog test. |
| Hutang / Credit | e2e and `statement.integration.test.ts` persist Credit, list open credits, and settle. `DebtSettlementDialog` calls `clearCreditsByIds`. | No test renders the settlement dialog or the contractor half of `PayDialog`. |
| Hold / recall | `stores/cart.test.ts` holds, recalls, merges, and discards in memory. | No test renders `HoldOrdersDialog`. Held sales are `localStorage`, so a repo test cannot see them. |
| Refund | `createRefundOrder` guards in `packages/data/src/sql-repo.test.ts`, `refund-guards.stress.test.ts`, `void-sales.stress.test.ts`, `multiline-refund.stress.test.ts`. | No test renders `RefundDialog` qty entry. |
| Void | `voidOrder` rejects refunds, double voids, and settled credit in the data tests. `ReceiptDialog.vue:74` is the UI call. | No test clicks Cancel sale. |
| Close day | `packages/core/src/closeday.test.ts` and data tests around `closeDay` / `reopenDay`. `business.ts` queues the xlsx. | No test renders `CloseDayDialog`. Drive upload has `electron/drive-upload.test.ts` for the query-string escaper only. |
| CSV import / export | `parseHardwareCsv` roundtrip in `settings-consolidation.stress.test.ts`. SSR HTML asserts the buttons exist (`pos-interactions.test.ts`, `settings-consolidation.stress.test.ts`). | No test runs `SettingsDialog` `onCsvSelected` against a file. The buttons moving or being renamed will fail the string asserts, which is intended. |

There is no browser click-through suite. `pos-interactions.test.ts` uses `renderToString`. Copy PRs have to update those string expects. They do not prove a cashier can check out.

## Revised PR sequence

PR 1 is this document.

The original follow-ups are right, with three corrections. Held sales are not a `SqlPosRepo` domain. Pay and debt are where the bilingual hardcoding is worst, so they should not wait behind a large admin rewrite. Admin is big enough to be its own PR after receipt and held sales. Report, close day, and settings are the same disease and were missing from the list.

Each UI PR updates the SSR string tests that mention the deleted sentences. Each PR ends green on `pnpm test` and `pnpm typecheck`.

### PR 2 — Split SqlPosRepo by domain

Files: `packages/data/src/sql-repo.ts` becomes a facade plus `packages/data/src/sql/catalog.ts`, `orders.ts`, `contractors.ts`, `credit.ts`, `close-day.ts`, `settings.ts`, and a small `map.ts` for the row mappers. `packages/data/src/index.ts` keeps exporting `SqlPosRepo`. No edit to `packages/core/src/repo.ts`, `apps/pos/electron/main.ts`, `preload.ts`, or `ipc-driver.ts`.

Size: about 1,500 lines moved, a few dozen lines of delegation added. No behavior change.

Acceptance: `pnpm test` and `pnpm typecheck`. `git diff` on `packages/core/src/repo.ts` and on the `ipcMain.handle("db:` lines is empty. A Credit persist, a refund, a `clearCreditsByIds`, and a `closeDay` from the existing data tests still pass (they are already in `pnpm test`).

### PR 3 — Till

Files: `TillView.vue`, `ProductCard.vue` only if a comment is tempting (no copy change expected), `SpecPickerDialog.vue`, `LainLainDialog.vue`, `NumpadDialog.vue`, the `L.*` keys those templates use, `labels.ts` tag lists. `CartLine.vue` has nothing to remove.

Size: a few hundred lines deleted, almost no new lines. The layout change is removing second lines, not a new grid.

Acceptance: `pnpm test` (string asserts updated). On `pnpm dev`: search with an empty placeholder still filters, a multi-size card opens the picker, Lain-lain adds a line, the numpad sets kg and a budget qty, Hold and Pay still open.

### PR 4 — Pay and debt settlement

Files: `PayDialog.vue`, `DebtSettlementDialog.vue`, and the label keys they use. Extract the shared delivery-order fields while the copy comes out.

Size: `PayDialog.vue` is 657 lines. Expect it to lose roughly 150 lines of titles, emoji, and step headings, and to gain one shared field block.

Acceptance: `pnpm test`. On `pnpm dev`, from a one-line cart: Cash, Card, QR, and Bank each produce a History row with that method; Contractor plus a name plus Credit produces an open balance; Settle on that contractor records a repayment and the balance goes to zero. The amount caption is gone (no `amountToPay` on screen).

### PR 5 — Receipt, refund, held sales, history

Files: `ReceiptDialog.vue`, `RefundDialog.vue`, `HoldOrdersDialog.vue`, `SalesView.vue`, `labels.ts` (`HOLD_TAGS`, the five missing keys deleted rather than added).

Size: about 200–400 lines of copy, no new components.

Acceptance: `pnpm test`. `stores/cart.test.ts` still passes. On `pnpm dev`: hold a sale, start another, recall the first, discard one; open a receipt from History; return part of a qty; void a cash sale that has no return. History headers no longer show the words `receipt`, `time`, or `paymentMethod`.

### PR 6 — Admin, contractors, restock, settings

Files: `AdminView.vue`, `RestockDialog.vue`, `MonthlyStatementDialog.vue`, `SettingsDialog.vue`, `SendReportDialog.vue`, `TopBar.vue` (remove the dead Send Report instance and the duplicate language block's partner in settings).

Size: the largest UI diff because `AdminView.vue` is 1,484 lines. Touch copy and the dead top-bar dialog only. Do not restructure the three admin sections in this PR.

Acceptance: `pnpm test`, including the CSV roundtrip test with its button strings updated. On `pnpm dev`: edit an item, restock it, add a contractor, export CSV, import that CSV, open settings and confirm paper width still saves. Drive upload behavior unchanged.

### PR 7 — Report and close day

Files: `ReportView.vue`, `CloseDayDialog.vue`, `OrdersDialog.vue` only for the hardcoded empty string if it should use the existing label. Delete `SalesSummaryPanel.vue` and `TopSellerCard.vue` here if PR 6 did not already remove unused files. They are unused either way.

Size: a few hundred lines, mostly deletions in `ReportView.vue` (690 lines).

Acceptance: `pnpm test`, including `report-view.stress.test.ts` and `daily.test.ts` (Excel columns unchanged). On `pnpm dev`: day, week, and month still total the same money; Close Day still writes the xlsx and queues it. Variance text appears only when the figure is not zero.

### PR 8 — Dead fish-shop surface, only if PR 2–7 are in

Files: `stores/cart.ts` tail helpers, unused `LAIN_LAIN_TAGS` in `hardware-catalog.ts`, `CashierDialog.vue` deletion, then the `bi` locale removal in `labels.ts` and `settings.ts`.

Size: small, but `labels.ts` is 1,462 lines and the `bi` deletion touches every key's raw entry. Do it after the screens no longer hardcode slash strings, or the raw table is still doing work.

Acceptance: `pnpm test` and `pnpm typecheck`. An existing shop database still opens (`init.ts` untouched). `tailCount` still round-trips on an old order in `repo.integration.test.ts`.

Leave `LEGACY_SEED_ITEMS` in place unless a later test-only PR swaps fixtures. That PR must not change production seed.

### Explicitly not scheduled

- Integer cents and milli-unit quantities.
- ESC/POS receipt bytes and A4 delivery-order HTML.
- Google Drive folder upload, the outbox, and the SQLite snapshot beside the xlsx.
- Rewriting `PosRepo`, `Order`, `PosError`, or `PricedItem`.
- A held-order table in SQLite.
- Moving every `getRepo()` call in the same PR as the SQL split.
