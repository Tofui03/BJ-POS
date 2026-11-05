# Touch only — Aunty Lim

Aunty Lim is 60. She helps at the same shop. The counter screen is the only thing she uses: no mouse, no keyboard, no right-click, no hover. She reads English slowly. Void, hold, recall, settle, SKU, and outbox do not mean anything to her. When she is unsure she taps the biggest thing. Sometimes she taps twice. Her finger lands a little off the centre.

The panel is the Acer PM161QT. Her retest is **1536×864, Windows at 125%** (`deviceScaleFactor` 1.25, touch). At that scaling 1 CSS px is 0.22375 mm, so a 56 px control is 12.5 mm. The shop may leave the PC at 100%, where the same 56 px is only 10.0 mm, so the bar is the CSS size, not the 125% size. Mei's retest is that 100% viewport. Both are in [the hardware note](README.md).

First-look shots are `aunty-00-1536.png` and the double-tap sequence. The full retest is `after-*.png` in this folder.

## Findings

| ID | Severity | Task | What happened | Fix |
| --- | --- | --- | --- | --- |
| 1 | Blocker | 4 | Same as Mei. No amount, and the invoice row was an 18 px checkbox. | Amount keypad. The invoice is not a checkbox. Receive is 56 px tall. |
| 2 | Blocker | 6 | The return quantity was a 110×38 number input. Spinner taps did nothing. She cannot use the physical keyboard. | − and + are 56×56 (10 mm at 100%, 12.5 mm at 125%). Tapping the number opens the pad. |
| 3 | Blocker | 3 | Nobody in the directory, and New contractor was 21 px tall (3.8 mm). | Ali, Chong, Siti. New is a 56 px button. One Name field on the on-screen keyboard. |
| 4 | Major | layout | At 1536 a card was 165 px wide and the price truncated to `RM 24.00 / b…`. She could charge the wrong unit. | The grid is `auto-fill` with a 240 px minimum. At 1536 that is three columns. The price wraps and reads `RM 24.00 / bag`. |
| 5 | Major | 1 | Numpad keys were about 56 px with an 8 px gap (1.4 mm). "." on a shown 1 dropped the 1. | Keys are 64 px (11.5 mm at 100%) with a 12 px / 2.1 mm gap. "." keeps the 1. |
| 6 | Major | 1 | A double tap on Cash. | One receipt. The second tap hits a lock that is set before the save, and a second save with the same request id returns the first sale. |
| 7 | Major | touch | Remove was 34 px (6.1 mm). − / + were 44×40 with no gap. Note, Parked, and Clear were 46 px (8.2 mm). | Remove, −, the quantity, and + are 56 px with 12 px between them. The cart header buttons are 56 px. |
| 8 | Major | 5 | Hold was a second screen, and Discard sat on the same card as Resume. | Park is one tap, 68 px tall, 16 px from Pay. Delete is the far button and asks again. |
| 9 | Major | 8 and 9 | 12 px grey labels (2.1 mm) on a dim 220-nit panel, and a 1 px divider between the two figures. | Sold is 40 px / 7.2 mm in ink. Cash drawer is 32 px / 5.7 mm inside a 2 px border, not a hairline. |
| 10 | Minor | report | The sales overview still has 30×30 px icons. At 100% that is 5.4 mm. At 125% it is 6.7 mm. | Left. Her return button on a receipt is 56 px. |
| 11 | Polish | 1 | "2 bag". | Left. |

Hover styles on the product cards were removed. A selected card has a 4 px ink border and a × count, not a grey wash and not a tooltip. Nothing in the nine tasks is behind a long-press.

## Tasks

Same taps as Mei, on the 125% viewport. Fresh shop. Touch only.

| # | Result | Taps |
| --- | --- | --- |
| 1 | Pass. RM 57.00, change RM 43.00, one sale. | 18 |
| 2 | Pass. Paid RM 8.00. No RM 0.00 card. | 11 |
| 3 | Pass. On credit RM 24.00. Ali is the only Ali. | 6 |
| 4 | Pass. Receive RM 10.00. | 5 |
| 5 | Pass. Park, then Open. | 11 |
| 6 | Pass. + once. Refund completed. | 6 |
| 7 | Pass. Cancel sale. The till total is RM 0.00. | 4 |
| 8 | Pass. Day closed. | 3 |
| 9 | Pass for finding Sold and Cash drawer. The number still includes the seeded day. | 1 |

### What she sees

The till at 1536. Prices are whole words. Custom item is on the rail. Pay is the wide green control.

![Till at 1536×864](after-00-till.png)

1.5 kg stayed 1.5. The total is RM 57.00. −, the quantity, and + are separate.

![1.5 kg in the cart](after-01-qty.png)

The debt screen. The big figure is what she is receiving. Owed RM 24.00 stays under it, so the red number is not the only signal. Cash is a black button with the word Cash.

![Receive RM 10](after-04-amount.png)

The directory after the credit sale. Three people. Ali owes RM 24.00, in red and in digits. There is no second Ali.

![Ali, Chong, Siti](after-04-directory.png)

## Size

Measured on the 100% pass, because that is the stricter one. 1 CSS px = 0.179 mm.

| Control | Before | After |
| --- | --- | --- |
| Category button | 56 px tall, 13 px label (2.4 mm), bilingual and cut off | at least 64 px, 18 px (3.2 mm), English |
| Product price | 20 px, clipped at 1536 | 22 px / 3.9 mm, full text at both viewports |
| Cart − / + | 44×40, touching | 56×56, 12 px apart |
| Remove | 34×34 / 6.1 mm | 56×56 / 10.0 mm |
| Pay | 68 px / 12.2 mm | 68 px, and the label includes the amount |
| Numpad key | ~60 px, 8 px gap | 64 px / 11.5 mm, 12 px / 2.1 mm gap |
| New contractor | 21 px tall | 56 px |
| Return quantity | 38 px native input | 56 px −, number, + |
| Close Day Sold | 30 px terracotta, label 14 px grey | 40 px / 7.2 mm, label 16 px ink |
| Till total | 38 px | 38 px / 6.8 mm, ink on white |

At 125% every one of those is physically larger by 1.25. The 1536 till and the pay dialog had no button under 56 CSS px.

The total and the amount due are `#0f172a` on white, above WCAG AAA at these sizes. Disabled Pay is a pale button and it does not show an amount. Credit is the word Credit. Cancelled is the word Cancelled. A selected category is a black fill, not a tint.

## Double tap

On the RM 57.00 cash sale the Cash button was tapped twice, 90 ms apart. History showed one receipt for that sale. `tests/e2e/one-sale-per-pay.test.ts` sends two saves with the same request id at the same time and asserts one order row.

## Left

- Sold and Cash drawer include the seeded demo sales.
- The overview's per-row inspect icons are still 30 px. By Revenue and By Qty are 30 px tall. She does not need them to read Sold or to return an item.
- "2 bag", and the TIN heading on the directory.
