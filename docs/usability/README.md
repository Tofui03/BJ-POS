# Cashier usability

## Hardware

The counter screen is an **Acer PM161QT**. These numbers replace the earlier 15" / 1366×768 assumption.

| | |
| --- | --- |
| Panel | 15.6" IPS, 1920×1080 at 60 Hz, 10-point capacitive touch |
| Pixel pitch | 0.179 mm. Active area 344×194 mm. About 141 ppi |
| Brightness / colour | 220 nits, 800:1, 45% NTSC, anti-glare |
| Stand | Kickstand, tilted back 30–40° |

At 100% scaling, 1 CSS pixel is 0.179 mm.

- 10 mm is 56 CSS px. That is the minimum touch target. Pay, Cash, and the numpad keys are larger.
- 2 mm is 12 CSS px. That is the minimum gap between adjacent targets, with more around a destructive one.
- 16 px of text is 2.9 mm. Amounts, item names, and the total have to be readable from about 50–60 cm on a tilted screen.

Windows at 125% (the likely default on this panel) lays the same page out in a 1536×864 CSS viewport. One CSS pixel is then 0.22375 mm, so the same control is physically larger. The shop may never change the scaling, so 100% has to work on its own.

Both viewports were driven with touch and no hover:

- 1920×1080, `deviceScaleFactor` 1
- 1536×864, `deviceScaleFactor` 1.25

State is not carried by colour alone, or by a light grey sitting on white. Totals and the amount due are near-black on white (ink `#0f172a`), which clears WCAG AAA at the sizes used. A 1 px line is not the only signal for a selection. Nothing in the nine tasks depends on hover, a right-click, or a long-press.

## Who hit what

Both people walked the same nine tasks. Mei's retest is the 100% viewport. Aunty's retest is the 125% viewport. Both used touch only.

| ID | Severity | Task | Finding | Mei | Aunty | After |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Blocker | 4 | No way to pay part of a debt. Tapping the invoice cleared the amount. | yes | yes | Amount keypad. Receive RM 10 of RM 24. |
| 2 | Blocker | 6 | Return quantity was a native number box. The spinner did nothing. | typed | blocked | − / number / + at 56 px. One tap adds one unit. |
| 3 | Blocker | 3 | A fresh shop had no contractors. | yes | yes | Ali, Chong, and Siti are seeded. |
| 4 | Major | 2 | A custom sale added a tappable Lain-lain at RM 0.00. | yes | yes | That card is not on the till. |
| 5 | Major | 1 | "." on a quantity of 1 produced 0.5 kg. | yes | yes | 1, then ".", then 5 is 1.5. |
| 6 | Major | 1 | "Calculate by Customer Tender" would sell by the cash in hand. | yes | yes | The two modes are the unit and RM. |
| 7 | Major | 1 | Change disappeared. The toast said Paid, not the change. | yes | yes | Toast says Change RM 43.00. |
| 8 | Major | 3 | A credit sale said Paid. | yes | yes | Toast says On credit RM 24.00. |
| 9 | Major | 3 | New contractor was a 21 px link. The form was four blank fields. | yes | yes | One Name field. The debt is saved on that person. |
| 10 | Major | 5 | Hold did not park the sale. Resume and Discard sat on the same card. | yes | yes | Park is one tap. Open brings it back. Delete is a second tap at the other end. |
| 11 | Major | 7 | Clearing a sale asked "Confirm?". | yes | yes | The second tap says Cancel sale. |
| 12 | Major | 8 | Close Day lived only on the till, in 12 px grey, and mentioned Drive. | yes | yes | Close Day is on every screen. Sold is 40 px / 7.2 mm. The question is "Close today's sales?". |
| 13 | Major | 9 | History was an Owner Sales Report. | yes | yes | The screen is Sales. The big figure is Sold. Cash drawer is its own figure. |
| 14 | Major | 1 | Series A / B meant nothing. | yes | yes | The badge is gone. |
| 15 | Major | layout | At 1536 the price was cut off (`RM 24.00 / b…`). | — | yes | Three columns at 1536, prices wrap. `RM 24.00 / bag` is fully visible. |
| 16 | Major | touch | Pay, the numpad, and the cart controls were under 10 mm, or closer than 2 mm. | yes | yes | Till and Pay have no control under 56 CSS px. Numpad keys are 64 px with a 12 px gap. |
| 17 | Major | pay | A double tap on Cash could have written two sales. | tested | tested | One sale. Covered by `tests/e2e/one-sale-per-pay.test.ts` and a 90 ms double tap on Cash. |
| 18 | Minor | 9 | Sold still includes the seeded demo day, so it is not "what I rang". | yes | yes | Left. The labels are plain. The seed is still in the day. |
| 19 | Minor | report | Overview still has 30×30 px inspect icons (5.4×5.4 mm at 100%). | yes | yes | Left. Return on a receipt is 56 px. Those icons are the owner list. |
| 20 | Polish | 1 | The cart says "2 bag". | yes | yes | Left. |
| 21 | Polish | 3 | The directory still has a TIN column. | yes | yes | Left. She does not have to fill it. |

## Retest

Fresh shop, touch, no physical keyboard. The same path for both viewports.

| Task | After taps | Result |
| --- | --- | --- |
| 1. Two bags of cement, 1.5 kg of nails, RM 100 cash | 18 | RM 57.00. Change RM 43.00. One sale after a double tap on Cash. |
| 2. Something not in the catalogue, RM 8 | 11 | Paid RM 8.00. No RM 0.00 card. |
| 3. Goods on credit | 6 | Ali was already in the list. Toast: On credit RM 24.00. |
| 4. Part of the debt | 5 | Receive RM 10.00 against Owed RM 24.00. |
| 5. Park, serve someone else, finish the first sale | 11 | Park once. Open. Pay. |
| 6. Return one bag | 6 | + once. Refund completed. |
| 7. Cancel a sale that is still on the till | 4 | Clear, then Cancel sale. Total RM 0.00. |
| 8. Close the day | 3 | 05 Nov 2026. Close today's sales? Day closed. |
| 9. How much was sold | 1 | Sold and Cash drawer are on the Sales screen. |

`pnpm test` — core 236, data 158, pos 410, all passed.
`pnpm typecheck` — passed.
`pnpm --filter @yf/data exec vitest run --dir ../../tests/e2e` — 116 passed, including one sale for two concurrent pays with the same request id.

## Measurements at 100%

1 CSS px = 0.179 mm. Taken from the 1920×1080 touch pass.

| What | px | mm |
| --- | --- | --- |
| Till controls under 56 px | 0 | — |
| Pay controls under 56 px | 0 | — |
| Numpad key | 64 | 11.5 |
| Gap between numpad keys | 12 | 2.1 |
| Gap between Park and Pay | 16 | 2.9 |
| Item price | 22 | 3.9 |
| Till total (RM 57.00) | 38 | 6.8 |
| Close Day Sold | 40 | 7.2 |
| Close Day Cash drawer | 32 | 5.7 |
| Sales Sold | 32 | 5.7 |

At 125% the CSS sizes are the same and each pixel is 0.22375 mm, so Sold at 32 px is 7.2 mm. The 1536×864 till also had no control under 56 CSS px, and `RM 24.00 / bag` was not clipped.
