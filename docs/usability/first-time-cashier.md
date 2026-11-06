# First day on the till — Mei

Mei is 19, first shift at a hardware shop in Keningau. She has used a phone POS. She has not used this one. She knows bag prices, nails by the kilogram, and that contractors buy on credit. She does not know the app's words.

This pass is the Acer PM161QT at **1920×1080, 100% scaling, touch**. 1 CSS px = 0.179 mm. Screenshots from the first walk are `mei-*.png` in this folder. The retest, from a fresh shop, is `after-*.png`.

## Findings

| ID | Severity | Task | What happened | Fix |
| --- | --- | --- | --- | --- |
| 1 | Blocker | 4 | Settle offered the whole RM 24.00. Tapping the invoice set it to RM 0.00 and the button died. | An amount keypad. The figure starts at the debt. The first digit replaces it. |
| 2 | Blocker | 3 | Contractors was 0 / 0. There was nobody to pick. | The demo shop has Ali, Chong, and Siti. A production first run stays empty, and credit is one Name field. |
| 3 | Major | 2 | After a custom sale, Others gained Lain-lain at RM 0.00 / pcs. The next tap would have given the goods away. | That internal item is kept for the receipt and hidden from the till. |
| 4 | Major | 1 | The quantity showed 1. "." then 5 became 0.5 kg, not 1.5 kg. | "." keeps the number on screen and starts the fraction. |
| 5 | Major | 1 | "Calculate by Customer Tender" sat next to the weight. RM 100 in that box would have sold about 16 kg. | The two buttons are `kg` and `RM`. |
| 6 | Major | 1 | She saw Change RM 43.00, tapped Cash, and the toast said Paid RM 57.00. | The toast says Change RM 43.00. |
| 7 | Major | 3 | Credit said Paid RM 24.00. | The toast says On credit RM 24.00. |
| 8 | Major | 3 | "New contractor" was a short underline. Name, phone, TIN, and address were blank boxes. | One field, placeholder Name. Saving is automatic. |
| 9 | Major | 5 | Hold opened a list. The sale was still on the till until "Hold this sale". Discard sat opposite Resume. | Park parks. Parked opens the list. Open brings it back. |
| 10 | Major | 7 | The second tap said Confirm?. | It says Cancel sale. |
| 11 | Major | 8 | Close Day was missing from History. The figures were 12 px grey and the confirm step talked about Drive. | Close Day is in the top bar everywhere. Sold is 40 px. The question is "Close today's sales?". |
| 12 | Major | 9 | The page was Owner Sales Report, Gross Merchandise Sales, Realized Inflow, Expected Drawer Cash. | Sales, Sold, Money in, Cash drawer. |
| 13 | Major | 1 | A Series A badge. She had already chosen Walk-in. | Removed. |
| 14 | Major | 1 | Search, the note, and the contractor form needed the physical keyboard or a tiny control. | Search, Name, and Note open the on-screen keyboard. |
| 15 | Minor | 9 | Sold is the whole seeded day, not only her receipts. | Left. See below. |
| 16 | Polish | 1 | The line reads "2 bag". | Left. |

## Tasks

| # | Before | After | Taps after |
| --- | --- | --- | --- |
| 1 | Finished, with four wrong turns. | Pass. 2 bags + 1.5 kg = RM 57.00. Change RM 43.00. | 18 |
| 2 | Finished. Side effect: a RM 0.00 card. | Pass. Paid RM 8.00. The card is gone. | 11 |
| 3 | Finished only by inventing a person. | Pass on the demo shop. Picked Ali. On credit RM 24.00. A production first run starts empty and takes one Name. | 6 |
| 4 | Fail. | Pass. Receive RM 10.00, owed RM 24.00. | 5 |
| 5 | Finished, after a second confirmation. | Pass. Park, sell to someone else, Open, pay. | 11 |
| 6 | Finished, by typing into a number box. | Pass. + once on the cement line. | 6 |
| 7 | Finished. The word was Confirm?. | Pass. Cancel sale. Total RM 0.00. | 4 |
| 8 | Finished. She had to be back on the till, and Drive meant nothing. | Pass. Day closed. Date reads 05 Nov 2026. | 3 |
| 9 | A number was on screen. It was not her shift. | Pass as "the figure is labelled Sold". The seed is still inside it. | 1 |

### 1. Cement and nails, cash

She tapped Cement twice. The second tap made 2 bags. That part was already right.

Search "nail", Common Nail, then the sizes. The first time she tapped "Size or model" and a keyboard covered the six sizes (`mei-05-size-or-model.png`). She cancelled and picked 2" at RM 6.00 / kg.

The quantity opened on 1. She tapped "Calculate by Customer Tender" (`mei-08-customer-tender.png`), backed out, then "." and 5. The line became 0.5 kg (`mei-10-dot.png`, `mei-11-five.png`). She cleared and typed 1.5. Total RM 57.00.

Pay showed Series A, an empty control that opened "Order Note" (`mei-18-mystery-check.png`), and the change only while the dialog was open (`mei-20-rm100.png`). Cash replaced it with "Paid RM 57.00" (`mei-21-cash.png`).

After: the modes are `kg` and `RM`. "." on 1 starts 1.5. The toast is the change. A second tap on Cash, 90 ms later, did not write a second sale.

![Quantity is 1.5 kg and the total is RM 57.00](after-01-qty.png)

![Change RM 43.00](after-01-change.png)

### 2. Not in the catalogue

Search "tape" said "No matching items" and nothing else (`mei-22-search-tape.png`). She opened Items → Add, which is a catalogue form (`mei-24-items-add.png`), and backed out. Custom item is at the bottom of the category list. After she sold RM 8, Others showed Lain-lain at RM 0.00 (`mei-32-others-after-custom.png`).

After: the empty search has a Custom item button, and the RM 0.00 card does not appear.

### 3. On credit

The directory was empty (`mei-33-contractors.png`). "New contractor" was 112×21 px. The form had no visible labels (`mei-37-new-contractor.png`). She typed a name and the toast said Paid.

After, on the demo shop: Ali, Chong, and Siti are listed. One Name field if the person is new. The toast says On credit.

A production first run does not insert those three. The credit screen opens on the Name field (56 px). Typed on the on-screen keyboard, then Credit. The directory afterwards has only that person.

![Empty credit list, one Name field, 1920×1080](prod-03-name.png)

![On credit RM 24.00](prod-03-credit.png)

![On credit](after-03-credit.png)

### 4. Part of the debt

Debt Settlement showed the full RM 24.00. There was no amount. Tapping the row cleared the checkbox and the total became RM 0.00 (`mei-46-tap-invoice-amount.png`). Statement failed with contractor "-1" (`mei-48-statement.png`).

After: the amount is the whole debt until she types. 1 then 0 is RM 10.00. Receive posts that much and leaves the rest.

![RM 10 of RM 24](after-04-amount.png)

### 5. Customer went to the car

Note is a note, not a park. Hold opened "Held (0)" with the sale still in the cart (`mei-54-hold.png`). She had to tap "Hold this sale". Resume and Discard were the two ends of the card (`mei-59-open-held.png`).

After: Park is one tap. The header says Parked (1). Open puts the sale back.

### 6. A return

History is a long report. The receipt she wanted was mixed with the seeded afternoon sales. Details / Return was 107×40. The quantity was a number input; the spinner did not change it (`mei-67-return-qty.png`). She could type, so she finished.

After: Return opens the receipt, Refund opens − / the number / +. One + is one bag.

### 7. Cancel

There is no Cancel on a sale that has not been paid. Clear, at the top of the cart, becomes a red second tap. The first time that tap said Confirm? (`mei-74-clear.png`). A paid receipt uses Cancel sale, then Confirm Cancel (`mei-80-cancel-sale.png`).

After: the second tap on the cart says Cancel sale. The total goes back to RM 0.00.

![Cart cleared](after-07-cleared.png)

### 8. Close the day

Close Day was only on the till. The sold figure included every seeded sale. Realized Inflow was 12 px on a grey panel (`mei-86-close-day.png`). The next step said the report uploads to Drive (`mei-87-do-close.png`).

After: Close Day is on every page. The date is 05 Nov 2026. Sold is 40 px (7.2 mm). Cash drawer is 32 px (5.7 mm), in ink, not grey. The confirm step is "Close today's sales?" with Back and Yes, close day 16 px apart.

![Close Day](after-08-summary.png)

### 9. What sold today

She landed on Owner Sales Report. Gross Merchandise Sales was about RM 16,742, which she had not rung. Cash RM 81 matched her drawer and was labelled Expected Drawer Cash.

After: the page title is Sales. The ring is Sold. Cash drawer is its own number. Both are still the whole business day, demo sales included. Taking the demo day out would change what the report is, so it was left. She can tell Sold from Cash drawer. She cannot yet see a figure that is only her own receipts.

## Words she did not know

Hold, Held, Resume, Discard, Series, TIN, Debt Settlement, Settle, Ad-hoc, Gross Merchandise Sales, Realized Inflow, Expected Drawer Cash, Owner Sales Report, Drive, Calculate by Customer Tender, Details / Return, Refund Channel.

The till now says Park, Parked, Open, Cancel sale, Name, kg, RM, Receive, Sold, Cash drawer, Sales.

## What was left

- Sold and Cash drawer still add the seeded demo sales to her shift.
- The sales overview still has 30×30 px icons beside each row (5.4 mm). The return path she uses is 56 px.
- "2 bag" is still not "2 bags".
- The directory table still has a TIN heading. The credit sale does not ask for one.
