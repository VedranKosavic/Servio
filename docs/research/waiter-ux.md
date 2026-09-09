# Research: Waiter app UX (fast order entry)

_Produced 2026-09-08 by the planning workflow; input to PLAN.md. Facts marked as assumptions were not verified._

## (a) Job-to-be-done: a Friday night, start to finish

Roles: **konobar** (waiter, own phone), **šanker** (bartender, optional shared bar device), **vlasnik** (owner). One `shifts` row per venue per business day; a waiter *joins* it (`shift_members`). Every table has at most one open **račun** (`orders.status='open'`), made of locked **ture** (rounds, `order_rounds`) plus one local, unsent draft round per waiter.

1. **19:50 arrive.** Opens the installed PWA on his Android. It is already logged in to the device (30-day cookie); he types his 4-digit PIN. If no shift is open for today, the app offers "Otvori smjenu" (or the šanker/owner already did). He taps "Uđi u smjenu". 2 taps + 4 digits.
2. **20:10 first order, table 7.** Tables grid → tap "7" → item picker opens directly because the bill is empty → taps Kafa, Kafa, Coca-Cola → "Zaključi (3)" → confirm sheet → "Potvrdi". Phone buzzes, toast "Poslano · Sto 7 · Tura 1", back on the tables grid. The round is in the local queue; the sync chip flickers amber then green. Bar sees the round on the bar device/owner dashboard; stock is deducted server-side at lock time.
3. **20:25 shisha.** Table 7 again → "+ Dodaj" → Nargila tile → flavour "Two Apples" (single) → "Dodaj nargilu" → Zaključi → Potvrdi.
4. **21:30 busy.** Twelve tables open, four are his. Tables grid shows his in accent colour with amount and "12 min" since last round; colleagues' tables in neutral with initials. He adds second and third rounds the same way; a Wi-Fi dropout shows "Nema veze – narudžbe se čuvaju", he keeps working; 40 s later the queue flushes.
5. **22:40 coal + refill.** On table 7's bill he taps the shisha line → "Žar" (free, logged) or "Nova lula" (charged). One lock.
6. **23:10 mistakes.** He added Fanta instead of Sprite to a draft: swipe → delete, or tap "Poništi" on the add toast. A locked wrong item: long-press → "Zatraži storno" with reason; the šanker approves with PIN on the bar device or the owner from the dashboard.
7. **23:30 a group moves** from table 3 to 9: "⋯ → Prebaci stavke" → select all → table 9. Logged.
8. **00:15 pay.** Table 7 → "Naplati" → total 47,50 KM → Gotovina → "Primljeno 50" → "Kusur 2,50" or "Ostatak je napojnica" → Potvrdi. Table returns to free.
9. **02:00 shift end.** "Kraj smjene": his open tables must be paid or handed to a colleague; the screen shows *his* pazar by method and "Predaj gotovinu 612,00 KM"; the šanker/owner confirms with their PIN. `shift_handovers` row written; he taps "Odjavi se".

## (b) Screen inventory (wireframes in words)

Global chrome on every screen: top bar = table/screen title (left), **sync chip** (right: green "OK" / amber "Čeka 2" / red "Nema veze"), avatar with initials (tap = switch user on shared device). Primary action is always a full-width 56 px button pinned to the bottom (thumb zone). Back is top-left and also Android hardware back.

**S0 Prijava (PIN).** Big numeric pad (3×4, 64 px keys), 4 dots, name of the device's known user above ("Amar"). On a shared device, an avatar row above the pad (max 8 waiters on shift). No password field; no username typing. After PIN: if no open shift, one button "Otvori smjenu"; else "Uđi u smjenu".

**S1 Stolovi (tables).** Segmented control for zones (`tables.zone`: Unutra / Bašta). Below: 4-column grid of table tiles (min 80×80 px), ordered by `tables.sort`; v1 is a grid, not a drawn floor plan (owner can only order and zone them; drag-to-position is v2). Tile states, always colour + icon + text, never colour alone: **free** (dim outline, number only), **mine** (accent fill, number, "24,50 KM", "12 min"), **colleague's** (neutral fill, initials "EM"), **naplata u toku** (yellow, receipt icon). Filter toggle "Samo moji". Tap tile → S2 (or straight to S3 when the bill is empty). Floating "+ Bez stola" for takeaway/bar sales (`orders.table_id = null`).

**S2 Sto N (table detail).** Header: "Sto 7 · Amar · od 21:05". Body, scrollable: locked rounds, each a collapsible block "Tura 1 · 21:05 · Amar" with lines `2× Kafa 4,00`, modifiers in small grey text ("bez šećera"), shisha lines with flavour chips and a sub-row of service events ("Žar 22:40"); lock icon on the block. Then the highlighted **draft** block "Nova tura – nije poslano" with editable lines: qty stepper (− / n / +), swipe-left = delete with 5 s "Poništi". Sticky bottom: total "Ukupno 47,50 KM" + primary button: "+ Dodaj" when draft is empty, "Zaključi (3) · 12,50 KM" when not; a "⋯" menu: Naplati, Prebaci stavke, Spoji sa stolom, Podijeli račun, Predaj sto kolegi.

**S3 Dodaj (item picker).** Bottom tab strip (thumb-reachable): **Omiljeno** (owner-curated, `products.is_favourite`, max 12), **Nedavno** (last 12 distinct products this user locked today), then categories (`categories.sort`: Kafa, Bezalkoholna, Čaj, Alkohol, Hrana, Nargila). Above the tabs: search field, diacritic-insensitive prefix match on `products.name` and `products.search_aliases` ("kola" → Coca-Cola), max 6 results. Body: 3-column tile grid, tiles ≥ 96 px tall, name at 18 px, price at 14 px, qty badge in the corner. **Tap = add 1** (defaults applied); **tap again = qty+1**; **long-press = modifier sheet**; tiles whose modifier group is `required` open the sheet on the first tap. Sticky bottom strip: "3 stavke · 12,50 KM" + "Pregled" (goes to S2) + "Zaključi". Every add fires a 5 s toast "Dodano: Coca-Cola · Poništi".

**S3a Modifikatori (bottom sheet).** Chips grouped by `modifier_groups` (single- or multi-select, `price_delta`): Led: "sa ledom / bez leda"; Mlijeko: "bez / sa mlijekom"; Veličina: "mali / veliki (+0,50)"; free-text "Napomena" last. Quantity stepper at the bottom, "Dodaj · 3,00 KM" button. Presets marked `is_default` are preselected so a plain tap needs no sheet.

**S4 Nargila (shisha builder).** One scrollable sheet, no wizard pages:
1. Brand/line segmented row (`shisha_lines`: e.g. Al Fakher, Adalya — assumption; owner defines; default line preselected).
2. Flavour chip grid (`shisha_flavours`, filtered by line, `in_stock=false` shown greyed with "Nema"). Tap one = single; tap up to three = mix; header reads "Mix 2/3"; a fourth tap is refused with a shake.
3. Lula (bowl) chips from `shisha_bowl_types` (Standard / Voće +5,00 / Phunnel), default preselected.
4. Napomena chips: Jači, Blaži, Više leda, + free text.
Bottom: "Dodaj nargilu · 15,00 KM" (price = base + bowl delta + mix surcharge if owner sets one). Once locked, the shisha line offers two actions: **Žar** (creates a 0 KM `order_items` row with `product_id` = system product "Žar", `parent_item_id` set; free service, logged for coal tracking) and **Nova lula** (charged product "Nova lula" with `parent_item_id`; price owner-defined, assumption ~50 % of a shisha). Both lock like any round.

**S5 Zaključi (review + lock, bottom sheet).** "Zaključi turu za Sto 7?" — lines with qty, modifiers, prices; total; note field; two buttons: "Potvrdi" (primary, 56 px) and "Nazad". This sheet *is* the review screen; no separate page. After Potvrdi: haptic, toast, return to S1 (setting `return_to_tables_after_lock`, default on). For 10 s the toast carries "Poništi" → creates a whole-round void with `void_reason='undo'`, auto-approved, still logged.

**S6 Prebaci stavke (move).** Checkbox list of locked items of this table ("Sve" toggle) → "Na sto…" → S1-style grid (destination must be a table with an open bill or free) → "Prebaci 3 stavke na sto 9". Draft items can't be moved (just delete and re-add). Each move writes `order_item_moves (item_id, from_order_id, to_order_id, moved_by, moved_at)`.

**S7 Spoji / Podijeli.** *Spoji sa stolom*: pick a target table; all items move, source bill closes with `status='merged_into'` pointing at the target. *Podijeli račun* lives inside payment: mode A "Po stavkama" — tap items to move them to "Račun B" (up to 4 sub-bills), mode B "Na jednake dijelove" — N-stepper. Sub-bills are paid one by one; unpaid remainder stays open.

**S8 Naplata (payment).** Big total. Two 64 px buttons: **Gotovina** / **Kartica**. Cash: quick chips (tačno, 20, 50, 100) plus numpad "Primljeno"; the app shows "Kusur 2,50 KM" with two choices: "Vrati kusur" or "Ostatak je napojnica". Card: amount, optional "Napojnica" field. Confirm button "Naplaćeno 47,50 KM". Writes `payments (order_id, method, amount, received, tip, paid_by, paid_at)`; multiple rows allowed (split). Tip policy: card tips always recorded (they must be paid out); cash tips recorded only if owner setting `track_cash_tips` is on — default off to avoid surveillance feel.

**S9 Kraj smjene (handover).** List of "Moji otvoreni stolovi" (each: "Naplati" / "Predaj kolegi"); blocked until empty. Then "Moj pazar": Gotovina 612,00 · Kartica 84,00 · Storna 2 · Ture 41. Button "Predaj gotovinu" → šanker/owner PIN pad → `shift_handovers (shift_id, user_id, cash_declared, confirmed_by, at)` → "Odjavi se". Waiter sees his own numbers only, never colleagues'.

**S10 Promijeni korisnika (shared device).** Avatar grid → PIN. Drafts are keyed `user_id + table_id` in local storage, so switching never shows or loses another waiter's draft.

## (c) Speed rules

**Tap budget** (from the tables grid, table already open, defaults applied; "lock" = Zaključi + Potvrdi = 2):

| Order | Taps |
|---|---|
| 2× kafa | table 1 + Kafa 2 + lock 2 = **5** |
| Nargila (single flavour, standard bowl) + 2× Coca-Cola | 1 + Nargila 1 + flavour 1 + Dodaj 1 + Cola 2 + lock 2 = **8** |
| Mix nargila (2 flavours, fruit bowl) + čaj sa mlijekom | 1 + 1 + 2 + bowl 1 + Dodaj 1 + Čaj (opens required sheet) 1 + mlijeko 1 + Dodaj 1 + lock 2 = **11** |
| Žar on an existing shisha | 1 + line 1 + Žar 1 + lock 2 = **5** (Nova lula same) |
| Pay cash, exact | 1 + Naplati 1 + Gotovina 1 + "tačno" 1 + Potvrdi 1 = **5** |

Rules: any of the top-12 products must be ≤ 2 taps from the picker; a table's picker opens with the last-used tab; empty-bill tables skip S2.

**One hand, big targets.** Primary button, tabs, search and the numpad all in the bottom 40 % of the screen; minimum target 48×48 px, 8 px gaps; primary buttons 56 px; no gestures other than swipe-to-delete (always with a visible alternative). Wake Lock API keeps the screen on while in S2/S3. Haptic (`navigator.vibrate`) on lock and on error.

**Bad Wi-Fi.** Drafts live only on the device (IndexedDB via `idb-keyval`; Pinia state hydrated from it). A locked round becomes a queue entry `{client_round_id: uuid, order_client_id, table_id, items[], locked_at, locked_by}`, POSTed with the UUID; the server upserts on `order_rounds.client_round_id`, so retries never duplicate. Queue flushes on `online`, on visibility change and every 15 s; failures back off. Prices are snapshotted into `order_items.unit_price` from the cached catalog at lock time; the catalog is cached with a version stamp and refreshed on each sync. The sync chip states: green "Sinkronizovano", amber "Čeka slanje (n)", red "Nema veze – narudžbe se čuvaju"; a red chip never blocks adding or locking. Tables grid shows "Stanje od 21:34" when stale; payments require connectivity (a payment while offline is queued with a visible "Naplata čeka slanje" badge on the table, and the table stays yellow until confirmed).

**Mistake prevention.** 5 s undo on every add and delete in a draft; swipe-delete needs a full swipe plus the undo toast, never a bare tap; the lock sheet shows the full round and the total; 10 s "Poništi" after lock (logged, auto-approved); no silent deletes anywhere — removal after lock is always a `void_requests` row (`item_id, requested_by, reason, status, decided_by`) rendered as a struck-through line, so the bar sees it too. Quantity edits after lock are voids plus new lines, never in-place rewrites.

**Dark lounge.** Dark theme is the only theme (near-black `#0e0e12` background, off-white text, ≥ 7:1 contrast for names and prices); no large light surfaces; body text 18 px, tile names 18–20 px, amounts 24 px; no weights under 500; state = colour + icon + label; touch feedback is a brightness flash, not a subtle shade change.

## (d) What the waiter cannot do, and how the UI says so

Not allowed: edit or delete locked lines; change any price or add discounts; reopen a paid bill; void without approval; see others' pazar; delete tables or products; open/close the shift (owner/šanker only, setting-dependent).

Presentation rules: forbidden actions are never invisible or greyed without explanation. Locked lines carry a lock icon; long-press shows a sheet whose first line says "Zaključene stavke se ne mijenjaju" and whose only actions are "Zatraži storno" and "Prebaci na drugi sto". There is no price field anywhere in the waiter app; "Kuća časti" (on the house) exists as a preset that needs the šanker/owner PIN on the spot (Loyverse-style one-time elevation) and is logged as a 100 % discount with `approved_by`. Copy is neutral and short — never "nemate pravo", but "Ovo potvrđuje šanker". Everything the waiter did is visible to the waiter on his own bill history, so accountability is symmetric.

## (e) Shared device vs own phone

`devices (id, venue_id, label, mode: 'personal'|'shared', bound_user_id, last_seen_at)`.
- **Personal:** cookie session bound to one user; PIN once per shift and after 30 min idle; drafts persist across app restarts; push notification "Storno odobren / odbijen".
- **Shared bar device:** `mode='shared'`; every screen shows the active user's avatar top-right; auto-return to the PIN pad after 60 s idle or on lock (so the next waiter is never the previous one); switching = tap avatar → tap name → 4 digits (~6 taps, under 3 s). Attribution is per round (`order_rounds.locked_by`), never per device. The šanker's device also gets the extra "Odobri storno" and "Potvrdi predaju" actions.

## (f) Borrowed interaction patterns

- **Loyverse – open tickets saved instead of paid, named tickets as tables, PIN panel for one-time elevated access.** Our round/lock model is the open-ticket model; PIN-on-the-spot is how "Kuća časti" and void approvals stay fast without logging the waiter out.
- **Loyverse – favourites grid on smartphones.** A curated 12-tile home tab is what keeps the top orders at ≤ 2 taps.
- **Square – required modifiers force a choice before the item is added; offline sales stored locally and submitted when connectivity returns.** Our required-sheet tiles and the UUID queue are the same idea.
- **Toast – Send/Stay/Hold and item-level actions on tap (quantity, repeat, delete, special request); per-device local storage when offline.** Our draft/lock split and the line-tap sheet copy this; Hold is intentionally omitted (no kitchen).
- **Lightspeed K-Series – transfer items or the whole order to another table, only after they have been sent; split by items or into equal parts.** Adopted as-is (moves only for locked items).
- **SumUp – register a tip automatically when the amount received exceeds the bill.** Our "Ostatak je napojnica" choice on the cash screen. (SumUp offline behaviour not verified; not relied upon.)

## 10 UX invariants to lock into the plan

1. A round is either a local draft (freely editable, on one device, one user) or locked (immutable); nothing in between.
2. Locking is always exactly two taps: "Zaključi" then "Potvrdi" on a sheet that shows every line and the total.
3. Each of the top-12 products is reachable in ≤ 2 taps from the picker; the five benchmark orders stay within the budgets above.
4. No silent deletes: post-lock removals are void rows with reason and approver; even the 10 s undo is a logged void.
5. Prices are snapshotted at lock and the waiter app has no price input; discounts require another person's PIN.
6. Offline never blocks adding or locking; every locked round has a client UUID and the server upserts on it; the sync chip is always visible.
7. Every action is attributed to a user, never to a device; shared devices return to the PIN pad after 60 s idle.
8. Primary actions live in the bottom 40 % of the screen, ≥ 56 px tall; every gesture has a visible button alternative.
9. Status is never conveyed by colour alone; dark theme only, ≥ 7:1 contrast, 18 px minimum text.
10. A waiter sees everything about his own work (rounds, voids, pazar) and nothing about colleagues' money; owner-only views stay out of the waiter app entirely.

Sources: [Loyverse open tickets](https://help.loyverse.com/help/open-tickets), [Loyverse split ticket](https://help.loyverse.com/help/how-split-open-ticket-loyverse-pos), [Loyverse access rights / PIN panel](https://help.loyverse.com/help/how-manage-access-rights-employees), [Loyverse open ticket sync](https://help.loyverse.com/help/tickets-synchronizations), [Toast Send/Stay/Hold](https://support.toasttab.com/en/article/Differences-Between-the-Send-Stay-and-Hold-Buttons), [Toast ordering screens](https://support.toasttab.com/en/article/New-POS-Experience-Ordering-Screens), [Toast offline mode](https://doc.toasttab.com/doc/platformguide/adminOfflineModeOverview.html), [Square open tickets](https://squareup.com/help/us/en/article/5337-use-open-tickets-with-square), [Square passcodes](https://squareup.com/help/us/en/article/8357-require-passcodes-at-point-of-sale), [Lightspeed transfers](https://k-series-support.lightspeedhq.com/hc/en-us/articles/10032856591643-Transferring-items-and-orders-to-other-tables), [Lightspeed split bill](https://resto-support.lightspeedhq.com/hc/en-us/articles/226405708-Splitting-a-bill), [SumUp tips](https://help.sumup.com/en-GB/pos/articles/75000112645-tips-management)
