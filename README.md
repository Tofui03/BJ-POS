# Borneo Jasa POS — Hardware Store Point-of-Sale System

A resilient, offline-first Point-of-Sale (POS) desktop workstation engineered specifically for hardware and building material supply stores (五金建材零售与工程批发).

Built as a high-performance monorepo using **Vue 3, UnoCSS, Electron, and SQLite (WAL mode)**, with strict Domain-Driven Design (DDD) business invariants and zero cloud runtime dependencies.

---

## Architecture & Monorepo Layout

```
yft-pos/
├── packages/
│   ├── core/         @yf/core — Pure TypeScript domain logic (no I/O, no DB).
│   │                 Money calculations in integer cents, quantity pricing tiers,
│   │                 dual-copy A4 Delivery Order builders, and PosRepo contracts.
│   └── data/         @yf/data — Drizzle ORM schema and SqlPosRepo implementation.
│                     Driver-agnostic persistence layer (runs against better-sqlite3 or browser sql.js).
└── apps/
    └── pos/          @yf/pos — Desktop Kiosk application.
        ├── electron/ Main process & Preload bridge (better-sqlite3, silent printing, Drive sync).
        └── src/      Touch-optimized Vue 3 single-page application with keyboard shortcuts.
```

### Why this architecture?
1. **Offline Sovereignty & Data Safety**: All inventory, sales records, and contractor credit ledgers reside on a local SQLite database (`borneo-jasa-pos.sqlite`) located in the OS `%APPDATA%` space. It operates without internet access and is never overwritten or reset during git code updates.
2. **Deterministic Domain Core**: Pricing rules, integer cent accounting, whole-bill rounding, and delivery order state machines are verified by over 250 unit, integration, and stress tests.
3. **IPC Mutex Queue**: Front-end asynchronous writes over IPC are strictly serialized to prevent interleaved transaction anomalies or rollback conflicts.

---

## Key Features

- **Touch & Hardware Keyboard Ergonomics**: Optimized for senior operators and busy counters. Rapid quantity entry, shifted decimal numpads, and quick category filtering.
- **Contractor & Credit Ledger (Hutang)**: Comprehensive tracking of contractor debts, partial repayments, and balance statements with dedicated B-series invoices.
- **Dual-Copy A4 Delivery Orders (DO)**: Print-ready single-sheet A4 documents featuring identical half-page copies (Store Copy / Customer Copy) with cut lines and triple signature blocks (Issued / Delivered / Received).
- **80mm Thermal Receipt Pipeline**: Standardized Malaysian tax invoice layout, clean registration formatting, and fully sanitized HTML thermal printing.
- **Close Day & Cloud Disaster Recovery**: Single-click daily close generating multi-sheet formatted Excel audit workbooks. Automatically uploads both the workbook and a live SQLite database snapshot to a private Google Drive folder for offsite backup.

---

## Getting Started

### Prerequisites
- Node.js 22 LTS
- pnpm 10 (`corepack enable pnpm`)

### Development
```bash
# Install workspace dependencies
pnpm install

# Run Vue dev server in browser mode
pnpm dev

# Run full test suite across all workspace packages
pnpm test

# Type-check TypeScript across all packages
pnpm typecheck
```

---

## Windows Building & Remote Deployment

The repository includes turnkey scripts designed for one-command builds and unattended remote SSH updates at the store till:

### 1. Build Installer and Portable Executable
```cmd
build-windows.cmd
```
* Pulls latest `main` via `--ff-only`.
* Runs locked dependency installation, test suites, and strict type-checking.
* Compiles the native Electron bundle with `better-sqlite3` into `apps/pos/release/`.

### 2. Silent Remote Update
```cmd
update-windows.cmd
```
* Compiles the new version, shuts down the running till app, executes silent NSIS reinstallation, and restarts the kiosk cleanly.
* Use `update-windows.cmd reboot` over SSH to restart the machine directly into Windows Kiosk mode.

---

## License & Security
Private business software designed for Borneo Jasa Hardware. Publicly shared for open architectural review, peer auditing, and technical evaluation.
