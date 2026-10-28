# Graph Report - BJ-POS  (2026-10-28)

## Corpus Check
- 165 files · ~170,804 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 6 file(s) not represented in the graph (top: .example 2, .cmd 2, (none) 1)

## Summary
- 1530 nodes · 4163 edges · 75 communities (70 shown, 5 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 92 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `22f6c285`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Core POS Domain Types
- init.ts
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
- cart.ts
- Inventory Restock Dialog
- Order
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
- fmtMoney
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
- Repayment
- Printer Module
- Package Configuration ()
- Hardware Catalog Module
- Tsconfig.Base Module
- repo.ts
- SqlValue
- Admin View & Navigation
- KeyboardDialog Component
- DebtSettlementDialog.vue
- report-view-guards.stress.test.ts
- Electron Builder Config
- Test Suite (renderDeliveryOrderHtml)
- Tsconfig Module
- TopBar.vue
- Electron Main & Preload
- Readme Module
- matchesHardwareSearch
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
- place.ts
- Icon Module
- Package Configuration (pos)
- Pnpm Workspace Module
- env.d.ts
- handleContractorRowClick

## God Nodes (most connected - your core abstractions)
1. `SqlPosRepo` - 73 edges
2. `Order` - 71 edges
3. `getRepo()` - 69 edges
4. `PosError` - 61 edges
5. `vue` - 53 edges
6. `initRepo()` - 49 edges
7. `PosRepo` - 47 edges
8. `PricedItem` - 42 edges
9. `L` - 37 edges
10. `fmtMoney()` - 36 edges

## Surprising Connections (you probably didn't know these)
- `validateInboundInput()` --calls--> `isMeasureUnit()`  [EXTRACTED]
  apps/pos/src/__tests__/restock-ui.stress.test.ts → packages/core/src/money.ts
- `stats` --calls--> `computeStats()`  [EXTRACTED]
  apps/pos/src/components/CloseDayDialog.vue → packages/core/src/stats.ts
- `financialMetrics` --calls--> `computeFinancialMetrics()`  [EXTRACTED]
  apps/pos/src/components/CloseDayDialog.vue → packages/core/src/stats.ts
- `isWeighable` --calls--> `isMeasureUnit()`  [EXTRACTED]
  apps/pos/src/components/RestockDialog.vue → packages/core/src/money.ts
- `inCartQty()` --calls--> `fmtQty()`  [EXTRACTED]
  apps/pos/src/components/SpecPickerDialog.vue → packages/core/src/money.ts

## Import Cycles
- None detected.

## Communities (75 total, 5 thin omitted)

### Community 0 - "Core POS Domain Types"
Cohesion: 0.06
Nodes (91): targetRmResult, order(), clearReturn(), freshRepo(), lineKey(), setMaxReturn(), createFreshDbRepo(), freshRepo() (+83 more)

### Community 1 - "init.ts"
Cohesion: 0.14
Nodes (21): HARDWARE_SEED_ITEMS, ORDERS_COLUMNS_SQL, SCHEMA_SQL, SEED_COMPANIES, SEED_ITEMS, SEED_UNIT_TYPES, SeedItem, SqlDriver (+13 more)

### Community 2 - "Admin View & Navigation"
Cohesion: 0.04
Nodes (45): activeSection, adminCategory, adminSearch, adminSection, allDirectoryEntries, catalog, confirmingDelete, contractorForm (+37 more)

### Community 3 - "Payment Checkout Dialog"
Cohesion: 0.05
Nodes (37): activeContractorName, adhocAddress, adhocName, adhocPhone, adhocTin, applyFinalTotal(), buildPayload(), cart (+29 more)

### Community 4 - "Sales Report Logic"
Cohesion: 0.10
Nodes (25): AggregatedItemRow, AggregatedItemsResult, aggregateFilteredItems(), CashflowAnalysis, computeDonutSlices(), computeRealizedCashflow(), DONUT_CIRCUMFERENCE, DonutResult (+17 more)

### Community 5 - "IPC Driver & DB Boot"
Cohesion: 0.05
Nodes (29): cashierStore, clearReturn(), doConfirmRefund(), emit, error, hasReturnLines, inputStrings, lineKey() (+21 more)

### Community 6 - "Electron Builder Config"
Cohesion: 0.09
Nodes (31): description, devDependencies, electron-builder@^26.15.3, esbuild@^0.28.1, @types/better-sqlite3@^7.6.13, @types/nodemailer@^8.0.1, @types/sql.js@^1.4.9, typescript@^5.6.0 (+23 more)

### Community 7 - "Reporting & Multi-Company State"
Cohesion: 0.07
Nodes (21): aggregatedResult, cashflow, centerStats, detail, donutResult, inspect, loadReport(), loadSalesForTab() (+13 more)

### Community 8 - "Sales Management View"
Cohesion: 0.12
Nodes (12): detail, filteredTransactions, loadSales(), methodCounts, methodFilter, onVoided(), rangeOrders, rangeRepayments (+4 more)

### Community 9 - "Till Register UI"
Cohesion: 0.07
Nodes (20): active, addItem(), cart, catalog, CATEGORY_COLORS, confirmClear, holdOpen, lainLainOpen (+12 more)

### Community 10 - "Product Card & Image Handling"
Cohesion: 0.10
Nodes (22): img, props, singleSpec, sizeCount, title, cart, emit, filterText (+14 more)

### Community 11 - "SQL Repository Queries"
Cohesion: 0.14
Nodes (5): SqlPosRepo, toCredit(), toLine(), toRepayment(), toTier()

### Community 12 - "Orders Dialog & Stress Tests"
Cohesion: 0.24
Nodes (8): LabelKey, MESSAGES, PAY_LABEL, RAW_BILINGUAL_L, PAYMENT_UI, currentLocale, Locale, lucide-vue-next

### Community 13 - "Test Suite (pos-interactions)"
Cohesion: 0.17
Nodes (12): ui, ui, L, loadCompanies(), router, routes, useUi, mockItemTracked (+4 more)

### Community 14 - "Electron Builder Config"
Cohesion: 0.08
Nodes (26): build, appId, asarUnpack, directories, files, linux, mac, nsis (+18 more)

### Community 15 - "cart.ts"
Cohesion: 0.16
Nodes (19): determineCheckoutInvoicePrefix(), shouldAutoTriggerNumpad(), shouldCreateCreditDebt(), clearPendingSale(), loadPendingSale(), loadStoredHolds(), newRequestId(), PendingSale (+11 more)

### Community 16 - "Inventory Restock Dialog"
Cohesion: 0.07
Nodes (28): availableItems, catalog, clearQty(), confirmRestock(), currentStockMilli, emit, errorMessage, inboundMilli (+20 more)

### Community 17 - "Order"
Cohesion: 0.09
Nodes (3): PosRepo, CreateRefundInput, Order

### Community 18 - "Receipt Printing HTML Generator"
Cohesion: 0.17
Nodes (13): escapeHtml(), renderDayReportHtml(), rm(), render(), amt(), PAPER_WIDTH_MM, printableWidthMm(), renderReceiptHtml() (+5 more)

### Community 19 - "Sales Calendar & Date State"
Cohesion: 0.08
Nodes (21): canWeekForward, carried, daysInMonth, isCurrentMonth, isThisWeek, monthCurrentDate, monthEndStr, monthIndex (+13 more)

### Community 20 - "Settings & Configuration UI"
Cohesion: 0.10
Nodes (32): catalog, csvInput, driveReady, emit, escapeCsvCell(), exportItemsCsv(), handlePinKey(), paperOptions (+24 more)

### Community 21 - "CI/CD Windows Build Workflow"
Cohesion: 0.08
Nodes (23): runs-on, steps, GH_TOKEN, jobs, build, name, on, push (+15 more)

### Community 22 - "POS Runtime Dependencies"
Cohesion: 0.09
Nodes (23): dependencies, better-sqlite3@^12.11.1, dayjs@^1.11.21, @fontsource-variable/nunito@^5.1.0, idb-keyval@^6.2.1, lucide-vue-next@^1.0.0, nodemailer@^9.0.3, pinia@^2.2.0 (+15 more)

### Community 23 - "End-of-Day Close Dialog"
Cohesion: 0.13
Nodes (20): getTodayClose(), performReopen(), closedAs, closedAtText, confirmClose(), confirmReopenStep, delivery, deliveryText (+12 more)

### Community 24 - "Database Schema & Tables"
Cohesion: 0.24
Nodes (14): DrizzleDb, companies, contractors, credits, dayCloses, items, orderItems, orders (+6 more)

### Community 25 - "Package Configuration (data)"
Cohesion: 0.11
Nodes (22): dependencies, drizzle-orm@^0.45.2, @yf/core@workspace:*, description, devDependencies, sql.js@^1.12.0, @types/sql.js@^1.4.9, typescript@^5.6.0 (+14 more)

### Community 26 - "LainLainDialog Component"
Cohesion: 0.12
Nodes (20): canSubmit, catalog, catalogError, customName, displayPrice, effectiveName, emit, handleSubmit() (+12 more)

### Community 27 - "NumpadDialog Component"
Cohesion: 0.11
Nodes (17): activeMode, BUDGET_PRESETS, effectiveUnitPriceCents, emit, entry, handleConfirm(), handleResetPrice(), isLength (+9 more)

### Community 28 - "fmtMoney"
Cohesion: 0.13
Nodes (20): cart, displayName, hasCustomPrice, lineDiscountCents, origUnitCents, props, qtyUnit, qtyValue (+12 more)

### Community 29 - "Stock Module"
Cohesion: 0.23
Nodes (18): edgeItems, lowStockCount, outOfStockCount, assertValidRestockQuantity(), compareStockAscending(), DEFAULT_LOW_STOCK_THRESHOLD_MILLI, filterStockItems(), formatStockQty() (+10 more)

### Community 30 - "SendReportDialog Component"
Cohesion: 0.15
Nodes (20): autoCloseUnclosedDays(), DailyReportDelivery, performClose(), queueDailyDriveUpload(), calOpen, date, downloadLocal(), emit (+12 more)

### Community 31 - "Hardware Catalog Module"
Cohesion: 0.14
Nodes (23): statementHtml, formatCents(), formatStatementMonth(), MONTH_NAMES, renderContractorStatementHtml(), BuildDeliveryOrderOptions, Signatories, STORE_BANKS (+15 more)

### Community 32 - "Daily Module"
Cohesion: 0.20
Nodes (14): buildDailyWorkbook(), DAILY_WORKBOOK_TEMPLATE_VERSION, dailyEmailBody(), dailyEmailSubject, HQ_DAILY_HEADERS, hqDailySheet(), INVOICE_ITEMS_HEADERS, invoiceItemsSheet() (+6 more)

### Community 33 - "Orders Dialog & Stress Tests"
Cohesion: 0.12
Nodes (15): cart, confirmDeleteId, doHoldCurrent(), doResume(), emit, labelInput, props, ui (+7 more)

### Community 34 - "Electron Main & Preload"
Cohesion: 0.16
Nodes (10): loadDriveConfig(), deliverDriveRow(), deliverEmailRows(), dotEnv, getSetting(), IMAGE_EXT, processOutbox(), reportRecipients() (+2 more)

### Community 35 - "Datepicker Module"
Cohesion: 0.08
Nodes (29): canNext, cells, cursor, emit, maxMs, monthLabel, pick(), props (+21 more)

### Community 36 - "SQL Repository Queries"
Cohesion: 0.17
Nodes (5): HeldOrderLine, ItemInput, ItemPatch, PricedItem, toItem()

### Community 37 - "Contractors Module"
Cohesion: 0.13
Nodes (17): contractorBalances, computeAllContractorBalances(), computeContractorBalance(), computeCreditBalance(), ContractorBalanceSummary, CreditBalanceSummary, validateContractor(), validateContractorPatch() (+9 more)

### Community 38 - "SQL Repository Queries"
Cohesion: 0.21
Nodes (5): ContractorRow, Contractor, ContractorInput, ContractorPatch, toContractor()

### Community 39 - "ReceiptDialog Component"
Cohesion: 0.14
Nodes (16): canRefund, canVoid, confirmVoid, doVoid(), emit, grossSubtotalCents, hasDo, isRefund (+8 more)

### Community 40 - "Package Configuration (core)"
Cohesion: 0.13
Nodes (16): dependencies, decimal.js@^10.6.0, description, devDependencies, typescript@^5.6.0, vitest@^2.1.0, exports, typescript (+8 more)

### Community 41 - "Repayment"
Cohesion: 0.16
Nodes (9): makeLine(), makeOrder(), aggregateItemSales(), computeFinancialMetrics(), periodRange(), FinancialMetrics, OrderLine, PAYMENT_METHODS (+1 more)

### Community 42 - "Printer Module"
Cohesion: 0.16
Nodes (14): handlePrint(), print(), printDo(), contractorFromOrder(), printDeliveryOrder(), printOrderReceipt(), iframePrint(), printer (+6 more)

### Community 43 - "Package Configuration ()"
Cohesion: 0.12
Nodes (15): description, engines, node, name, packageManager, pnpm, onlyBuiltDependencies, private (+7 more)

### Community 44 - "Hardware Catalog Module"
Cohesion: 0.20
Nodes (13): onCsvSelected(), categoryButtonLabel(), CategoryI18nEntry, HARDWARE_CATEGORIES, HARDWARE_CATEGORY_I18N, HARDWARE_SEARCH_ALIASES, HardwareCategory, HardwareCategoryI18nMap (+5 more)

### Community 45 - "Tsconfig.Base Module"
Cohesion: 0.12
Nodes (15): compilerOptions, declaration, esModuleInterop, isolatedModules, lib, module, moduleResolution, noImplicitOverride (+7 more)

### Community 46 - "repo.ts"
Cohesion: 0.13
Nodes (8): generateDemoOrders(), CreateOrderInput, OrderDraft, TierInput, Company, CustomerType, DayClose, UnitType

### Community 47 - "SqlValue"
Cohesion: 0.18
Nodes (5): Row, SqlValue, SqlJsDatabase, SqlJsDriverOptions, SqlJsStatement

### Community 48 - "Admin View & Navigation"
Cohesion: 0.24
Nodes (10): approvePending(), doDelete(), onSettled(), priceFromRM(), refresh(), saveContractor(), saveEdit(), slugify() (+2 more)

### Community 49 - "KeyboardDialog Component"
Cohesion: 0.19
Nodes (11): backspace(), caps, emit, entry, layer, LETTER_ROWS, ok(), onKeydown() (+3 more)

### Community 50 - "DebtSettlementDialog.vue"
Cohesion: 0.10
Nodes (22): currentBusinessDate(), canAdd, cashierStore, emit, errorMessage, handleAdd(), handleSelect(), newName (+14 more)

### Community 51 - "report-view-guards.stress.test.ts"
Cohesion: 0.18
Nodes (9): computeReportOrderStats(), DONUT_RADIUS, METHOD_COLORS, useSales, createMockLine(), createMockRefundOrder(), createTestLine(), createTestRefundOrder() (+1 more)

### Community 52 - "Electron Builder Config"
Cohesion: 0.18
Nodes (11): scripts, build, dev, dist:linux, dist:mac, dist:win, electron:build, electron:main (+3 more)

### Community 53 - "Test Suite (renderDeliveryOrderHtml)"
Cohesion: 0.39
Nodes (6): renderDeliveryOrderHtml(), mockCompany, mockCompany, sampleDo, CompanyInfo, DeliveryOrder

### Community 54 - "Tsconfig Module"
Cohesion: 0.18
Nodes (10): compilerOptions, jsx, noEmit, paths, types, extends, include, ../../tsconfig.base.json (+2 more)

### Community 55 - "TopBar.vue"
Cohesion: 0.15
Nodes (13): businessDateLabel, closeDayOpen, dateOpen, onDayClosed(), router, sendOpen, settingsOpen, toggleDatePicker() (+5 more)

### Community 56 - "Electron Main & Preload"
Cohesion: 0.31
Nodes (7): accessToken(), base64url(), DriveServiceAccount, DriveUploadConfig, escapeDriveQueryValue(), findFileId(), uploadBytesToDrive()

### Community 57 - "Readme Module"
Cohesion: 0.22
Nodes (6): Vite Application Entry Script, apps/pos, Borneo Jasa POS, 1080p Fixed Touchscreen Layout, packages/core, packages/data

### Community 58 - "matchesHardwareSearch"
Cohesion: 0.25
Nodes (8): matchedItems, filteredItems, filteredInventoryItems, filteredItems, filteredGroups, categoryForGroup(), matchesHardwareSearch(), normalizeHardwareSearchText()

### Community 59 - "Selectinput Module"
Cohesion: 0.22
Nodes (8): display, emit, menuStyle, open, pick(), props, selected, trigger

### Community 60 - "Electron Main & Preload"
Cohesion: 0.20
Nodes (9): comment, compilerOptions, module, moduleResolution, noEmit, types, extends, include (+1 more)

### Community 61 - "Payment Checkout Dialog"
Cohesion: 0.33
Nodes (6): priceCents, targetRmCents, finalTotalCentsPreview, tenderCents, confirmNumpad(), toCents()

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

### Community 69 - "place.ts"
Cohesion: 0.29
Nodes (5): COMPANIES, STORE_ADDRESS, STORE_NAME, companies, currentCompany

### Community 70 - "Icon Module"
Cohesion: 0.67
Nodes (3): POS Application Icon, Bull Brand Mark (Logo), Electron Application Icon Asset

### Community 73 - "env.d.ts"
Cohesion: 0.40
Nodes (4): sql.js/dist/sql-wasm.js, virtual:uno.css, *.vue, *.wasm?url

### Community 74 - "handleContractorRowClick"
Cohesion: 0.67
Nodes (3): handleContractorRowClick(), openAddContractor(), openEditContractor()

## Knowledge Gaps
- **9 isolated node(s):** `../../tsconfig.base.json`, `../../tsconfig.base.json`, `../../tsconfig.base.json`, `../../tsconfig.base.json`, `Vite Application Entry Script` (+4 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 633 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vue` connect `Test Suite (pos-interactions)` to `Core POS Domain Types`, `Admin View & Navigation`, `Payment Checkout Dialog`, `Sales Report Logic`, `IPC Driver & DB Boot`, `Electron Builder Config`, `Reporting & Multi-Company State`, `Sales Management View`, `Till Register UI`, `Product Card & Image Handling`, `Orders Dialog & Stress Tests`, `cart.ts`, `Inventory Restock Dialog`, `Sales Calendar & Date State`, `Settings & Configuration UI`, `POS Runtime Dependencies`, `End-of-Day Close Dialog`, `LainLainDialog Component`, `NumpadDialog Component`, `fmtMoney`, `Stock Module`, `SendReportDialog Component`, `Orders Dialog & Stress Tests`, `Datepicker Module`, `ReceiptDialog Component`, `KeyboardDialog Component`, `DebtSettlementDialog.vue`, `report-view-guards.stress.test.ts`, `TopBar.vue`, `Selectinput Module`, `Topsellercard Module`, `Numberinput Module`, `place.ts`, `env.d.ts`?**
  _High betweenness centrality (0.119) - this node is a cross-community bridge._
- **What connects `../../tsconfig.base.json`, `../../tsconfig.base.json`, `../../tsconfig.base.json` to the rest of the system?**
  _9 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Core POS Domain Types` be split into smaller, more focused modules?**
  _Cohesion score 0.05703263476175581 - nodes in this community are weakly interconnected._
- **Why does `SqlPosRepo` connect `SQL Repository Queries` to `Core POS Domain Types`, `init.ts`, `SQL Repository Queries`, `IPC Driver & DB Boot`, `Contractors Module`, `SQL Repository Queries`, `repo.ts`, `Order`, `report-view-guards.stress.test.ts`, `Database Schema & Tables`, `Stock Module`?**
  _High betweenness centrality (0.062) - this node is a cross-community bridge._
- **Should `init.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.13978494623655913 - nodes in this community are weakly interconnected._
- **Why does `Order` connect `Order` to `Core POS Domain Types`, `Sales Report Logic`, `IPC Driver & DB Boot`, `Reporting & Multi-Company State`, `Sales Management View`, `SQL Repository Queries`, `Orders Dialog & Stress Tests`, `cart.ts`, `Receipt Printing HTML Generator`, `End-of-Day Close Dialog`, `Database Schema & Tables`, `fmtMoney`, `SendReportDialog Component`, `Hardware Catalog Module`, `Daily Module`, `Contractors Module`, `ReceiptDialog Component`, `Repayment`, `Printer Module`, `repo.ts`, `report-view-guards.stress.test.ts`, `Topsellercard Module`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Should `Admin View & Navigation` be split into smaller, more focused modules?**
  _Cohesion score 0.038461538461538464 - nodes in this community are weakly interconnected._