# Borneo Jasa POS

Offline point of sale for Borneo Jasa Sdn. Bhd., a hardware and building-materials shop in Keningau, Sabah. The till is a desktop app aimed at a 15.6" 1080p touchscreen. It prints thermal receipts and A4 delivery orders, and it keeps stock, sales, and contractor credit in a local SQLite file. A sale does not need a network connection.

## Stack

- Vue 3, Vue Router, Pinia, UnoCSS
- Electron, with `better-sqlite3` in the main process
- sql.js for browser development (snapshot stored in IndexedDB)
- Drizzle ORM on a small async SQL driver
- Vitest
- pnpm workspaces, Node.js 22

## Layout

```
packages/core    Money, quantities, pricing, orders, receipts. No I/O.
packages/data    SQLite schema, migrations, and SqlPosRepo.
apps/pos         Vue till and the Electron main process.
```

The screen talks to one repository. In Electron, statements go over IPC to `better-sqlite3`. On the Vite dev server, the same repository runs on sql.js. Pricing and order rules do not know which driver is underneath.

## Design notes

- Money is integer cents. Measured quantities (kg, ft, metre) are integer milli-units, so 1.250 kg is `1250`. `decimal.js` is used only where the UI converts to and from those integers, so rounding stays in one place.
- The business day ends when someone presses Close Day, not at midnight. Sales after a close count toward the next day. Schema changes add columns. They do not replace the shop database (`%APPDATA%/borneo-jasa-pos/borneo-jasa-pos.sqlite` on Windows).
- Payment methods are cash, card, QR, bank transfer, and contractor credit (hutang). Walk-in checkout and contractor / delivery-order checkout are separate screens in the pay dialog. A delivery order prints as two half-page copies on one A4 sheet (store copy and customer copy), with signature lines.
- Close Day writes an Excel workbook and queues it for a private Google Drive folder, with a SQLite snapshot next to it. The queue retries while the till is open. Older installs can still send the same outbox row by email.
- Renderer writes share one IPC queue, so two transactions cannot interleave `BEGIN` and `COMMIT`.
- The till is a fixed 1920×1080 layout at 1× zoom: category rail, product grid, cart. Controls are large because the screen is a touchscreen at a busy counter. Copy is in Chinese, English, Malay, or a bilingual mix.

## Run

```bash
corepack enable pnpm
pnpm install
pnpm dev          # Vite on http://localhost:3000
pnpm test
pnpm typecheck
pnpm build        # production bundle for the Vue app
```

Windows installer and portable exe:

```bat
build-windows.cmd
```

The script fast-forwards `main`, then installs from the lockfile, tests, typechecks, and runs `electron-builder`. Output lands in `apps/pos/release/`.

`update-windows.cmd` builds first and only then silent-installs over `C:\Program Files\Borneo Jasa POS`. If the build fails, the installed till is left alone. `update-windows.cmd reboot` reboots into kiosk mode after a successful install.

GitHub Actions builds the same Windows artifacts when a `v*` tag is pushed, or when the workflow is started by hand.

Copy `apps/pos/.env.example` onto the till (user-data directory, next to the executable, or the working directory in development). Set `DRIVE_FOLDER_ID` and the path to a Google service-account key. Do not commit that `.env` file.

`pnpm test` runs Vitest in `@yf/core`, `@yf/data`, and `@yf/pos`.
