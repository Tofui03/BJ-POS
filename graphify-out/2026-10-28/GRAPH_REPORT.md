# Graph Report - BJ-POS  (2026-10-28)

## Corpus Check
- 166 files · ~166,064 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 6 file(s) not represented in the graph (top: .example 2, .cmd 2, (none) 1)

## Summary
- 1523 nodes · 4134 edges · 73 communities (67 shown, 6 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 92 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Core POS Domain Types
- Report Rendering Tests
- Admin View & Navigation
- Payment Checkout Dialog
- Sales Report Logic
- IPC Driver & DB Boot
- Electron Builder Config
- Reporting & Multi-Company State
- Sales Management View
- Till Register UI
- Product Card & Image Handling
- SQL Repository Queries
- Orders Dialog & Stress Tests
- Test Suite (pos-interactions)
- Electron Builder Config
- Cart Line Item Component
- Inventory Restock Dialog
- Core Repository Interfaces
- Receipt Printing HTML Generator
- Sales Calendar & Date State
- Settings & Configuration UI
- CI/CD Windows Build Workflow
- POS Runtime Dependencies
- End-of-Day Close Dialog
- Database Schema & Tables
- Package Configuration (data)
- LainLainDialog Component
- NumpadDialog Component
- RefundDialog Component
- Stock Module
- SendReportDialog Component
- Hardware Catalog Module
- Daily Module
- Orders Dialog & Stress Tests
- Electron Main & Preload
- Datepicker Module
- SQL Repository Queries
- Contractors Module
- SQL Repository Queries
- ReceiptDialog Component
- Package Configuration (core)
- MonthlyStatementDialog Component
- Printer Module
- Package Configuration ()
- Hardware Catalog Module
- Tsconfig.Base Module
- End-of-Day Close Dialog
- Settings Module
- Admin View & Navigation
- KeyboardDialog Component
- DebtSettlementDialog Component
- Receipt Module
- Electron Builder Config
- Test Suite (renderDeliveryOrderHtml)
- Tsconfig Module
- SQL Repository Queries
- Electron Main & Preload
- Readme Module
- CashierDialog Component
- Selectinput Module
- Electron Main & Preload
- Payment Checkout Dialog
- Topsellercard Module
- Tsconfig Module
- Tsconfig Module
- Numberinput Module
- Test Suite (cashier)
- Test Suite (shift-handoff)
- Decimalkeypad Module
- Toast Module
- Icon Module
- Package Configuration (pos)
- Pnpm Workspace Module

## God Nodes (most connected - your core abstractions)
1. `SqlPosRepo` - 73 edges
2. `Order` - 70 edges
3. `getRepo()` - 69 edges
4. `PosError` - 61 edges
5. `vue` - 53 edges
6. `initRepo()` - 49 edges
7. `PosRepo` - 47 edges
8. `PricedItem` - 42 edges
9. `L` - 37 edges
10. `fmtMoney()` - 35 edges

## Surprising Connections (you probably didn't know these)
- `validateInboundInput()` --calls--> `isMeasureUnit()`  [EXTRACTED]
  apps/pos/src/__tests__/restock-ui.stress.test.ts → packages/core/src/money.ts
- `qtyValue` --calls--> `fmtQty()`  [EXTRACTED]
  apps/pos/src/components/CartLine.vue → packages/core/src/money.ts
- `qtyUnit` --calls--> `unitLabel()`  [EXTRACTED]
  apps/pos/src/components/CartLine.vue → packages/core/src/money.ts
- `stats` --calls--> `computeStats()`  [EXTRACTED]
  apps/pos/src/components/CloseDayDialog.vue → packages/core/src/stats.ts
- `totalDiscountCents` --calls--> `orderTotalDiscountCents()`  [EXTRACTED]
  apps/pos/src/components/ReceiptDialog.vue → packages/core/src/orders.ts

## Import Cycles
- None detected.

## Communities (73 total, 6 thin omitted)

### Community 0 - "Core POS Domain Types"
Cohesion: 0.06
Nodes (80): targetRmResult, shouldCreateCreditDebt(), EditDraft, buildDeliveryOrder(), DeliveryOrderLine, sampleOrder, PosError, deductTare() (+72 more)

### Community 1 - "Report Rendering Tests"
Cohesion: 0.07
Nodes (46): order(), clearReturn(), freshRepo(), lineKey(), setMaxReturn(), createFreshDbRepo(), createTestLine(), createTestRefundOrder() (+38 more)

### Community 2 - "Admin View & Navigation"
Cohesion: 0.04
Nodes (48): activeSection, adminCategory, adminSearch, adminSection, allDirectoryEntries, catalog, confirmingDelete, contractorForm (+40 more)

### Community 3 - "Payment Checkout Dialog"
Cohesion: 0.05
Nodes (37): activeContractorName, adhocAddress, adhocName, adhocPhone, adhocTin, applyFinalTotal(), buildPayload(), cart (+29 more)

### Community 4 - "Sales Report Logic"
Cohesion: 0.09
Nodes (28): AggregatedItemRow, AggregatedItemsResult, aggregateFilteredItems(), CashflowAnalysis, computeDonutSlices(), computeRealizedCashflow(), computeReportOrderStats(), DONUT_CIRCUMFERENCE (+20 more)

### Community 5 - "IPC Driver & DB Boot"
Cohesion: 0.08
Nodes (12): boot(), createIpcDriver(), DriveBridge, ImagesBridge, MailerBridge, PrintingBridge, ScopedSqlDriver, SqliteBridge (+4 more)

### Community 6 - "Electron Builder Config"
Cohesion: 0.09
Nodes (31): description, devDependencies, electron-builder@^26.15.3, esbuild@^0.28.1, @types/better-sqlite3@^7.6.13, @types/nodemailer@^8.0.1, @types/sql.js@^1.4.9, typescript@^5.6.0 (+23 more)

### Community 7 - "Reporting & Multi-Company State"
Cohesion: 0.07
Nodes (20): companies, currentCompany, useSales, centerStats, detail, inspect, loadReport(), loadSalesForTab() (+12 more)

### Community 8 - "Sales Management View"
Cohesion: 0.08
Nodes (24): closeDayOpen, dateOpen, onDayClosed(), router, sendOpen, settingsOpen, toggleDatePicker(), dateLabel (+16 more)

### Community 9 - "Till Register UI"
Cohesion: 0.07
Nodes (20): active, addItem(), cart, catalog, CATEGORY_COLORS, confirmClear, holdOpen, lainLainOpen (+12 more)

### Community 10 - "Product Card & Image Handling"
Cohesion: 0.10
Nodes (23): img, priceSummary, props, singleSpec, sizeCount, title, cart, emit (+15 more)

### Community 11 - "SQL Repository Queries"
Cohesion: 0.14
Nodes (4): CreateRefundInput, Order, SqlPosRepo, toLine()

### Community 12 - "Orders Dialog & Stress Tests"
Cohesion: 0.13
Nodes (17): clearQty(), stepQty(), L, LabelKey, MESSAGES, PAY_LABEL, RAW_BILINGUAL_L, PAYMENT_UI (+9 more)

### Community 13 - "Test Suite (pos-interactions)"
Cohesion: 0.12
Nodes (16): sql.js/dist/sql-wasm.js, virtual:uno.css, *.vue, *.wasm?url, router, routes, mockItemTracked, mockItemUntracked (+8 more)

### Community 14 - "Electron Builder Config"
Cohesion: 0.08
Nodes (26): build, appId, asarUnpack, directories, files, linux, mac, nsis (+18 more)

### Community 15 - "Cart Line Item Component"
Cohesion: 0.11
Nodes (23): cart, displayName, hasCustomPrice, lineDiscountCents, origUnitCents, props, qtyUnit, qtyValue (+15 more)

### Community 16 - "Inventory Restock Dialog"
Cohesion: 0.09
Nodes (24): availableItems, catalog, confirmRestock(), currentStockMilli, emit, errorMessage, inboundMilli, isValid (+16 more)

### Community 17 - "Core Repository Interfaces"
Cohesion: 0.09
Nodes (6): PosRepo, Company, Repayment, RepaymentInput, UnitType, toRepayment()

### Community 18 - "Receipt Printing HTML Generator"
Cohesion: 0.16
Nodes (13): renderDayReportHtml(), rm(), render(), amt(), PAPER_WIDTH_MM, printableWidthMm(), renderReceiptHtml(), receipt (+5 more)

### Community 19 - "Sales Calendar & Date State"
Cohesion: 0.08
Nodes (22): canWeekForward, carried, daysInMonth, isCurrentMonth, isThisWeek, maxDate, monthCurrentDate, monthEndStr (+14 more)

### Community 20 - "Settings & Configuration UI"
Cohesion: 0.11
Nodes (23): catalog, csvInput, driveReady, emit, escapeCsvCell(), exportItemsCsv(), handlePinKey(), onCsvSelected() (+15 more)

### Community 21 - "CI/CD Windows Build Workflow"
Cohesion: 0.08
Nodes (23): runs-on, steps, GH_TOKEN, jobs, build, name, on, push (+15 more)

### Community 22 - "POS Runtime Dependencies"
Cohesion: 0.09
Nodes (23): dependencies, better-sqlite3@^12.11.1, dayjs@^1.11.21, @fontsource-variable/nunito@^5.1.0, idb-keyval@^6.2.1, lucide-vue-next@^1.0.0, nodemailer@^9.0.3, pinia@^2.2.0 (+15 more)

### Community 23 - "End-of-Day Close Dialog"
Cohesion: 0.12
Nodes (22): DailyReportDelivery, getTodayClose(), performClose(), performReopen(), closedAs, closedAtText, confirmClose(), confirmReopenStep (+14 more)

### Community 24 - "Database Schema & Tables"
Cohesion: 0.17
Nodes (17): TierInput, SqlDriver, DrizzleDb, makeDrizzle(), companies, contractors, credits, dayCloses (+9 more)

### Community 25 - "Package Configuration (data)"
Cohesion: 0.11
Nodes (22): dependencies, drizzle-orm@^0.45.2, @yf/core@workspace:*, description, devDependencies, sql.js@^1.12.0, @types/sql.js@^1.4.9, typescript@^5.6.0 (+14 more)

### Community 26 - "LainLainDialog Component"
Cohesion: 0.12
Nodes (20): canSubmit, catalog, catalogError, customName, displayPrice, effectiveName, emit, handleSubmit() (+12 more)

### Community 27 - "NumpadDialog Component"
Cohesion: 0.11
Nodes (18): activeMode, BUDGET_PRESETS, effectiveUnitPriceCents, emit, entry, handleConfirm(), handleResetPrice(), isLength (+10 more)

### Community 28 - "RefundDialog Component"
Cohesion: 0.13
Nodes (20): cashierStore, clearReturn(), doConfirmRefund(), emit, error, hasReturnLines, inputStrings, lineKey() (+12 more)

### Community 29 - "Stock Module"
Cohesion: 0.19
Nodes (19): edgeItems, lowStockCount, outOfStockCount, assertValidRestockQuantity(), compareStockAscending(), DEFAULT_LOW_STOCK_THRESHOLD_MILLI, filterStockItems(), formatStockQty() (+11 more)

### Community 30 - "SendReportDialog Component"
Cohesion: 0.17
Nodes (17): autoCloseUnclosedDays(), queueDailyDriveUpload(), calOpen, date, downloadLocal(), emit, note, props (+9 more)

### Community 31 - "Hardware Catalog Module"
Cohesion: 0.14
Nodes (18): statementHtml, COMPANIES, STORE_ADDRESS, STORE_NAME, formatCents(), formatStatementMonth(), MONTH_NAMES, renderContractorStatementHtml() (+10 more)

### Community 32 - "Daily Module"
Cohesion: 0.18
Nodes (15): buildDailyWorkbook(), DAILY_WORKBOOK_TEMPLATE_VERSION, dailyEmailSubject, HQ_DAILY_HEADERS, hqDailySheet(), INVOICE_ITEMS_HEADERS, invoiceItemsSheet(), setFormulaOrZero() (+7 more)

### Community 33 - "Orders Dialog & Stress Tests"
Cohesion: 0.12
Nodes (15): cart, confirmDeleteId, doHoldCurrent(), doResume(), emit, labelInput, props, ui (+7 more)

### Community 34 - "Electron Main & Preload"
Cohesion: 0.16
Nodes (10): loadDriveConfig(), deliverDriveRow(), deliverEmailRows(), dotEnv, getSetting(), IMAGE_EXT, processOutbox(), reportRecipients() (+2 more)

### Community 35 - "Datepicker Module"
Cohesion: 0.13
Nodes (16): canNext, cells, cursor, emit, maxMs, monthLabel, pick(), props (+8 more)

### Community 36 - "SQL Repository Queries"
Cohesion: 0.16
Nodes (6): HeldOrderLine, ItemPatch, Item, PricedItem, toItem(), toTier()

### Community 37 - "Contractors Module"
Cohesion: 0.19
Nodes (14): contractorBalances, computeAllContractorBalances(), computeContractorBalance(), computeCreditBalance(), ContractorBalanceSummary, CreditBalanceSummary, validateContractor(), allocateRepayment() (+6 more)

### Community 38 - "SQL Repository Queries"
Cohesion: 0.18
Nodes (6): ContractorRow, validateContractorPatch(), Contractor, ContractorInput, ContractorPatch, toContractor()

### Community 39 - "ReceiptDialog Component"
Cohesion: 0.13
Nodes (15): canRefund, canVoid, confirmVoid, doVoid(), emit, grossSubtotalCents, hasDo, isRefund (+7 more)

### Community 40 - "Package Configuration (core)"
Cohesion: 0.13
Nodes (16): dependencies, decimal.js@^10.6.0, description, devDependencies, typescript@^5.6.0, vitest@^2.1.0, exports, typescript (+8 more)

### Community 41 - "MonthlyStatementDialog Component"
Cohesion: 0.15
Nodes (15): canGoNext, contractors, emit, loadContractors(), loading, loadStatement(), nextMonth(), prevMonth() (+7 more)

### Community 42 - "Printer Module"
Cohesion: 0.17
Nodes (13): handlePrint(), print(), printDo(), contractorFromOrder(), printDeliveryOrder(), printOrderReceipt(), iframePrint(), printer (+5 more)

### Community 43 - "Package Configuration ()"
Cohesion: 0.12
Nodes (15): description, engines, node, name, packageManager, pnpm, onlyBuiltDependencies, private (+7 more)

### Community 44 - "Hardware Catalog Module"
Cohesion: 0.20
Nodes (14): categoryButtonLabel(), CategoryI18nEntry, HARDWARE_CATEGORIES, HARDWARE_CATEGORY_I18N, HARDWARE_SEARCH_ALIASES, HARDWARE_SEED_ITEMS, HardwareCategory, HardwareCategoryI18nMap (+6 more)

### Community 45 - "Tsconfig.Base Module"
Cohesion: 0.12
Nodes (15): compilerOptions, declaration, esModuleInterop, isolatedModules, lib, module, moduleResolution, noImplicitOverride (+7 more)

### Community 46 - "End-of-Day Close Dialog"
Cohesion: 0.27
Nodes (7): currentBusinessDate(), assertCanCloseDay(), businessDateFor(), filterPushedRecordIds(), localDateStr(), nextDateStr(), DayClose

### Community 47 - "Settings Module"
Cohesion: 0.20
Nodes (11): ui, loadCompanies(), emailConfigured(), getPin(), getReportRecipients(), loadLocale(), loadMoneyEntry(), moneyEntry (+3 more)

### Community 48 - "Admin View & Navigation"
Cohesion: 0.22
Nodes (14): loadCredits(), loadContractors(), getRepo(), approvePending(), doDelete(), onReorder(), onSettled(), priceFromRM() (+6 more)

### Community 49 - "KeyboardDialog Component"
Cohesion: 0.19
Nodes (11): backspace(), caps, emit, entry, layer, LETTER_ROWS, ok(), onKeydown() (+3 more)

### Community 50 - "DebtSettlementDialog Component"
Cohesion: 0.17
Nodes (10): confirmSettlement(), emit, loading, method, notes, openCredits, props, selectedCreditIds (+2 more)

### Community 51 - "Receipt Module"
Cohesion: 0.31
Nodes (11): lineDiscountCents(), orderGrossSubtotalCents(), orderTotalDiscountCents(), buildReceipt(), BuildReceiptOptions, cleanCompanyRegNo(), formatReceiptDate(), isValidDate() (+3 more)

### Community 52 - "Electron Builder Config"
Cohesion: 0.18
Nodes (11): scripts, build, dev, dist:linux, dist:mac, dist:win, electron:build, electron:main (+3 more)

### Community 53 - "Test Suite (renderDeliveryOrderHtml)"
Cohesion: 0.35
Nodes (7): escapeHtml(), renderDeliveryOrderHtml(), mockCompany, mockCompany, sampleDo, CompanyInfo, DeliveryOrder

### Community 54 - "Tsconfig Module"
Cohesion: 0.18
Nodes (10): compilerOptions, jsx, noEmit, paths, types, extends, include, ../../tsconfig.base.json (+2 more)

### Community 55 - "SQL Repository Queries"
Cohesion: 0.22
Nodes (3): ValidatedRepayment, RepaymentMethod, toCredit()

### Community 56 - "Electron Main & Preload"
Cohesion: 0.31
Nodes (7): accessToken(), base64url(), DriveServiceAccount, DriveUploadConfig, escapeDriveQueryValue(), findFileId(), uploadBytesToDrive()

### Community 57 - "Readme Module"
Cohesion: 0.22
Nodes (6): Vite Application Entry Script, apps/pos, Borneo Jasa POS, 1080p Fixed Touchscreen Layout, packages/core, packages/data

### Community 58 - "CashierDialog Component"
Cohesion: 0.27
Nodes (9): canAdd, cashierStore, emit, errorMessage, handleAdd(), handleSelect(), newName, onBackdropClick() (+1 more)

### Community 59 - "Selectinput Module"
Cohesion: 0.22
Nodes (8): display, emit, menuStyle, open, pick(), props, selected, trigger

### Community 60 - "Electron Main & Preload"
Cohesion: 0.20
Nodes (9): comment, compilerOptions, module, moduleResolution, noEmit, types, extends, include (+1 more)

### Community 61 - "Payment Checkout Dialog"
Cohesion: 0.29
Nodes (7): priceCents, targetRmCents, finalTotalCentsPreview, tenderCents, confirmNumpad(), priceCentsFrom(), toCents()

### Community 62 - "Topsellercard Module"
Cohesion: 0.29
Nodes (6): maxAmount, props, sales, showAll, top, totalCents

### Community 63 - "Tsconfig Module"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, rootDir, extends, include, ../../tsconfig.base.json

### Community 64 - "Tsconfig Module"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, rootDir, extends, include, ../../tsconfig.base.json

### Community 65 - "Numberinput Module"
Cohesion: 0.40
Nodes (5): emit, money, onConfirm(), open, props

### Community 70 - "Icon Module"
Cohesion: 0.67
Nodes (3): POS Application Icon, Bull Brand Mark (Logo), Electron Application Icon Asset

## Knowledge Gaps
- **9 isolated node(s):** `../../tsconfig.base.json`, `../../tsconfig.base.json`, `../../tsconfig.base.json`, `../../tsconfig.base.json`, `packages/core` (+4 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 632 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vue` connect `Test Suite (pos-interactions)` to `Report Rendering Tests`, `Admin View & Navigation`, `Payment Checkout Dialog`, `Sales Report Logic`, `Electron Builder Config`, `Reporting & Multi-Company State`, `Sales Management View`, `Till Register UI`, `Product Card & Image Handling`, `Orders Dialog & Stress Tests`, `Cart Line Item Component`, `Inventory Restock Dialog`, `Sales Calendar & Date State`, `Settings & Configuration UI`, `POS Runtime Dependencies`, `End-of-Day Close Dialog`, `LainLainDialog Component`, `NumpadDialog Component`, `RefundDialog Component`, `Stock Module`, `SendReportDialog Component`, `Orders Dialog & Stress Tests`, `Datepicker Module`, `ReceiptDialog Component`, `MonthlyStatementDialog Component`, `Settings Module`, `KeyboardDialog Component`, `DebtSettlementDialog Component`, `CashierDialog Component`, `Selectinput Module`, `Topsellercard Module`, `Numberinput Module`, `Toast Module`?**
  _High betweenness centrality (0.116) - this node is a cross-community bridge._
- **What connects `../../tsconfig.base.json`, `../../tsconfig.base.json`, `../../tsconfig.base.json` to the rest of the system?**
  _9 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Core POS Domain Types` be split into smaller, more focused modules?**
  _Cohesion score 0.06435006435006435 - nodes in this community are weakly interconnected._
- **Why does `SqlPosRepo` connect `SQL Repository Queries` to `Core POS Domain Types`, `Report Rendering Tests`, `SQL Repository Queries`, `IPC Driver & DB Boot`, `SQL Repository Queries`, `End-of-Day Close Dialog`, `Core Repository Interfaces`, `SQL Repository Queries`, `Database Schema & Tables`?**
  _High betweenness centrality (0.058) - this node is a cross-community bridge._
- **Should `Report Rendering Tests` be split into smaller, more focused modules?**
  _Cohesion score 0.07324244854317027 - nodes in this community are weakly interconnected._
- **Why does `Order` connect `SQL Repository Queries` to `Core POS Domain Types`, `Report Rendering Tests`, `Sales Report Logic`, `Reporting & Multi-Company State`, `Sales Management View`, `Orders Dialog & Stress Tests`, `Cart Line Item Component`, `Receipt Printing HTML Generator`, `End-of-Day Close Dialog`, `Database Schema & Tables`, `RefundDialog Component`, `SendReportDialog Component`, `Hardware Catalog Module`, `Daily Module`, `Contractors Module`, `ReceiptDialog Component`, `Printer Module`, `Receipt Module`, `Topsellercard Module`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **Should `Admin View & Navigation` be split into smaller, more focused modules?**
  _Cohesion score 0.03896103896103896 - nodes in this community are weakly interconnected._