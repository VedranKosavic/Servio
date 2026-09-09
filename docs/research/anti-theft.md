# Research: Anti-theft & accountability system

_Produced 2026-09-08 by the planning workflow; input to PLAN.md. Facts marked as assumptions were not verified._

# Anti-theft & accountability system — Šank

## 0. Design stance (three sentences)

Every KM and every gram enters the system once, at the source, as an immutable event; every number the owner sees is derived from those events, never typed. The app detects **patterns over shifts**, not single acts — one missing Coca-Cola proves nothing, a waiter whose stock variance is 3× the venue median for four weeks does. Rules are published inside the app ("Pravila"), flags are shown to the person who triggers them at the moment they trigger them, and the same numbers the owner sees about a waiter are visible to that waiter.

## (a) Theft & leakage vectors

Strength scale: **H** = fully visible in-app data, exposes the act itself; **M** = exposed statistically over several shifts or via stock counts; **L** = app only narrows suspicion; process needed.

| # | Vector (bs) | Data the app must capture | Report / alert that exposes it | Str. | Residual risk |
|---|---|---|---|---|---|
| 1 | Order never entered, cash pocketed (*neevidentirana narudžba*) | Blind close counts of high-value SKUs (`stock_count_lines`), recipe per item (`item_components`), `orders.shift_id`, coal count per shift | **Stock variance per shift**: expected consumption (Σ sold × recipe) vs counted, per SKU, in KM; **Revenue/hour** vs venue median for that weekday; coal-per-bowl ratio | M | Items without a countable SKU (coffee, water, syrups); needs weekly full inventura and cameras for proof |
| 2 | Under-recording (2 of 4 drinks entered) | Same as #1 + `order_lines` count per table | Items-per-table and avg ticket per waiter vs their own 30-day median; stock variance | M | Same as #1 |
| 3 | Entering orders only when the owner is watching (*radi samo kad je gazda tu*) | `owner_presence(shift_id, from, to)` — owner toggles "Tu sam / Otišao" (1 tap) in admin app; every `order_events.created_at` | "Prihod/sat: vlasnik prisutan vs. odsutan" per waiter, 4-week window; alert if ratio < 0.6 | M | Owner must toggle honestly; use cameras' table count as second signal (process) |
| 4 | Void after payment (*storno nakon naplate*) | `order_events` type `void_line`/`void_order` with `reason_code`, `seconds_since_lock`, `was_paid`, `authorised_by`, `device_id` | Void list with age & payer state; per-waiter **void %** (voided value / gross); any void with `was_paid=1` without owner PIN lands in *Zahtijeva pažnju* and **still counts in expected cash** | H | None inside the app; the waiter can only avoid it by not recording at all (→ #1) |
| 5 | Removing lines after lock "by mistake" repeatedly | Same event stream; `self_void` counter per waiter per shift | Alert at > 3 self-voids/shift or > 3 % of gross | H | — |
| 6 | Free drinks/shisha to friends (*častim*, *na račun kuće*) | `order_lines.charged_amount = 0`, `comp_reason`, `authorised_by_user_id` | **Comp %** per waiter; comps during owner-absent hours; comps by reason | H if recorded; else → #1 | Unrecorded comps are unrecorded orders; stock variance catches them statistically |
| 7 | Staff drinking/over-pouring (*popio na šanku*, *duplo sipa*) | `comp_reason='staff_drink'` lines with allowance `venue_settings.staff_drinks_per_shift`; spirits tracked in ml with `recipe_ml` | Staff-drink count per person; spirits variance in ml per shift (bottle weigh at close) | M | Pour size is physical: needs measured pourers (*mjerice*) — process |
| 8 | Taking stock home (*iznosi robu*) | Close counts of tobacco (g), spirits (bottles + open-bottle weight), energy drinks, cigarettes; `stock_movements` for every delivery | Shift stock variance in KM per SKU; weekly full inventura vs running book stock | M–H for units (cans, packs); L for open items | Locked storage (*magacin*) and owner-received deliveries |
| 9 | Fake breakage/waste (*lom*, *kalo*, *rastur*) | `stock_movements.type='waste'` with `reason_code`, `actor`, `qty`, optional photo; over `venue_settings.waste_pin_threshold_km` (e.g. 10 KM) requires owner PIN | Waste per shift per actor; waste as % of consumption; alert > 1 % | H on the record, L on the truth | Keep the broken bottle for the owner (process) |
| 10 | Bartender under-packs bowls and sells the "extra" off-book (*tanka lula*) | `item_components(item_id='shisha', sku='tobacco_<flavour>', qty_g=15)`; tobacco counted in **grams** on a kitchen scale at open/close; bowls sold; coals used | **g/bowl actual** = tobacco consumed ÷ bowls sold. Under-packing → g/bowl drops below recipe (< 12 g); off-book bowls with normal packing → g/bowl rises (> 18 g). Both flagged. **Coal/bowl** as second ratio (~3 per bowl + top-ups; assumption) | M | Needs a 10 KM scale and discipline; flavour mixes blur per-flavour numbers, so track total tobacco g + per-flavour packs opened |
| 11 | Waiter brings own tobacco/cans and sells them at the venue (*svoja roba*) | Nothing missing from stock — only revenue/hour, coal/bowl, occupancy | Revenue/hour vs 4-week median; coal/bowl > recipe; shisha/hour vs venue median | L | Cameras, mystery guest, spot visits — process only |
| 12 | Short-changing / overcharging guests (*zakidanje kusura*, *naplatio više*) | Prices only from `items.price`; waiter cannot type a price; "Pokaži račun" screen shows the itemised total to the guest | Cannot be detected in-app | L | Visible price list, show-the-bill habit, mystery guest |
| 13 | Manipulating stock counts to match expected | Counts are **blind** (expected hidden until submitted); `stock_counts.counted_by`; weekly count needs two `counted_by` | "Sumnjivo savršeno" alert: variance exactly 0 on ≥ 5 consecutive counts by same counter; count-vs-count drift | M | Owner does random spot counts (`type='spot'`, app picks 5 random SKUs) |
| 14 | Waiter–bartender collusion (drinks made without an order) | Bar makes only from the app order feed (*Šank ekran*, later); stock counts | Stock variance; revenue/hour | M | Both can also collude on the count → owner counts high-value SKUs himself weekly |
| 15 | Dine-and-dash blamed for pocketed cash (*gost pobjegao*) | Order closed with `status='unpaid'`, reason, owner PIN or `pending_review` | Unpaid count & value per waiter; unpaid still counts against expected cash until owner approves | H on record | Truth needs cameras |
| 16 | Logging in as someone else / shared phone confusion | `users.pin_hash`, `devices(id, user_id, label, user_agent, revoked_at)`, `device_id` on every event | Alert: same user active on 2 devices within 5 min; new device registered during a shift | H | Waiters sharing PINs — rule: shared PIN = both responsible |
| 17 | "App was down, we used paper" | Offline-first queue; `client_created_at` + `created_at` (server); `sync_lag_s` | Gap alert: open shift with 0 locked orders for > 45 min while `owner_presence` absent; sync lag > 10 min flagged | M | Spare cheap phone at the bar; rule: no order without the app |
| 18 | Backdating / moving orders between shifts | Server-set `created_at`; `shift_id` immutable; no client-set business time | Impossible by construction; audit list of `sync_lag_s > 600` | H | — |
| 19 | Drawer skim at close (*fali pazar*) | `shifts.expected_cash_km`, `counted_cash_km`, `cash_diff_km`, closer's PIN; per-waiter `waiter_settlements` | Cash variance per shift and per waiter; 4-week trend | H on amount | Attribution needs single-person cash custody (per-waiter pouch) |
| 20 | Free-form discount abuse | No typed discounts; `discounts(id, name, pct, requires_pin, hours)`; `order_lines.discount_id`, `authorised_by` | Discount value per waiter per reason | H | — |
| 21 | Fake delivery quantities / supplier kickback | `deliveries(supplier, invoice_no, photo, entered_by)` — owner-only entry | Cost per unit trend per supplier | M | Owner receives goods; out of MVP scope |
| 22 | Tips confusion used as cover (*bakšiš*) | Rule in "Pravila": tips are the waiter's, never in the drawer; `charged_amount` only | Not a detection item; removes an excuse | — | — |

## (b) Rules engine

**Order lifecycle.** `draft` (lives only in the waiter's phone, Pinia + IndexedDB) → `locked` (POST `/api/orders`, server sets `locked_at`) → `paid` or `unpaid` or `voided`. Adding lines to a locked order is normal (guests order more) and produces new `order_lines` rows with their own `locked_at`; nothing is ever edited in place.

**Immutability.** `orders`, `order_lines`, `order_events`, `stock_movements`, `stock_counts`, `cash_movements`, `audit_log` are append-only. Enforce in the DB, not only in code — a Drizzle migration `.sql` adds:

```sql
CREATE TRIGGER order_events_no_update BEFORE UPDATE ON order_events
BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER order_events_no_delete BEFORE DELETE ON order_events
BEGIN SELECT RAISE(ABORT, 'append-only'); END;
```
(same pair for each listed table). Status fields such as `orders.status` are the only mutable columns and are recomputed from events by the server. `order_events` columns: `id, venue_id, shift_id, order_id, order_line_id?, type, payload_json, actor_user_id, device_id, client_created_at, created_at, seconds_since_lock`. Event types: `lock, add_lines, void_line, void_order, comp_line, discount_line, pay, mark_unpaid, transfer_table, note, review_approve, review_reject`.

**Void / cancel policy (*storno*).**
- Reason codes (enum, no free text except `other` which requires a note ≥ 5 chars): `guest_changed_mind` (gost se predomislio), `wrong_entry` (greška u unosu), `not_served` (nije posluženo), `complaint` (reklamacija), `walked_out` (gost otišao bez plaćanja), `other`.
- **Self-void window:** the waiter may void alone within **120 s** of that line's `locked_at` and only if the order is unpaid. Counter `self_void_count` per waiter per shift; > 3 → flag.
- Outside the window, or after `pay`: requires an **owner PIN** typed on the waiter's phone (owner physically present) — or, if absent, the void is stored with `review_status='pending'`. **A pending void does not reduce expected cash or expected stock.** The waiter is told on screen: "Storno čeka odobrenje — ulazi u tvoj pazar dok gazda ne odobri." This single rule removes the incentive for post-payment voids.
- Owner resolves pending voids in the day review (`review_approve` / `review_reject` event); approved voids then adjust the shift's expected cash retroactively, with the shift's `cash_diff_km` recomputed and the old value kept in the event.

**Comps and discounts.** No zero-priced items in the catalog. "Na račun kuće" is a **line flag**: `order_lines.unit_price` (list price snapshot), `charged_amount = 0`, `comp_reason` ∈ `owner_guest, staff_drink, complaint, promo`, `authorised_by_user_id`. `staff_drink` is self-authorised up to `venue_settings.staff_drinks_per_shift` (e.g. 2), beyond that owner PIN. `owner_guest` always owner PIN. Discounts come only from the `discounts` table (`pct` or `fixed_km`, `requires_pin`, `valid_from_hour/to_hour`). The waiter UI never shows a price input.

**Price-change audit.** `items.price` is current; `item_price_history(item_id, price, valid_from, changed_by)` is written by the same transaction. Only role `owner` may change prices, catalog or recipes; each change also goes to `audit_log(entity, entity_id, action, before_json, after_json, actor, device, created_at)`. Lines always carry the price snapshot, so history never rewrites.

**Actor, device, time.** Login = pick your name + 4-digit PIN (`users.pin_hash`, argon2/bcrypt), cookie session bound to a `devices` row; the owner can revoke a device. Server time is authoritative; offline orders keep `client_created_at` and the server stores both plus `sync_lag_s`. Roles: `owner, waiter, bartender` (`manager` later). Every table has `venue_id` from day one; one row in `venues` now.

## (c) The SHIFT model (*smjena*)

Tables: `shifts(id, venue_id, opened_at, opened_by, closed_at, closed_by, status: open|closing|closed|reviewed, starting_float_km, expected_cash_km, counted_cash_km, cash_diff_km, card_total_km, closing_note, reviewed_by, reviewed_at)`; `shift_members(shift_id, user_id, role, joined_at)`; `cash_movements(shift_id, type: float_in|payout|drop, amount_km, actor, note)`; `stock_counts(id, shift_id, type: open|close|spot|full, counted_by, second_counter?, created_at)`; `stock_count_lines(count_id, sku_id, counted_qty, expected_qty, unit, diff_qty, diff_km)`; `waiter_settlements(shift_id, user_id, expected_km, handed_over_km, diff_km, settled_at, accepted_by)`.

**Cash custody.** `venue_settings.cash_custody = 'per_waiter' | 'pooled'`. Recommend **per_waiter** (each waiter carries their own pouch, hands over at close) because it makes cash variance attributable; `pooled` is the same flow with one settler.

**Open (*otvaranje smjene*).** Bartender or owner taps "Otvori smjenu" → enters `starting_float_km` (e.g. 100) → optional opening count of the **high-value list** (`skus.track_at_close = 1`: tobacco in g, spirits by bottle + open-bottle weight, energy drinks, cigarettes, ~10–15 SKUs, 2 min). Prefilled from the previous close count; edits logged. Exactly one open shift per venue; a waiter's first order auto-joins them to it; if none is open the waiter is prompted to open one.

**During.** Orders bind to `shift_id`. Owner dashboard streams live.

**Close (*zatvaranje smjene*), 5 steps, ~6 min:**
1. All open tables resolved: paid / voided / `unpaid` (reason + PIN or pending).
2. **Blind cash count**: each waiter enters `handed_over_km`; the app reveals `expected_km` and `diff_km` only after submission. Card total typed from the terminal's Z report if a terminal exists.
3. **Blind stock count** of the high-value list; tobacco weighed in grams.
4. Summary: `expected_cash = starting_float + Σ cash charged_amount (paid) − Σ cash refunds (approved voids of paid lines) − Σ payouts + Σ float_in`. `|diff| > max(5 KM, 1 %)` requires `closing_note`. Stock: `expected = open_count + deliveries − Σ(sold × recipe) − approved waste`; diff shown in units and KM.
5. Sign-off: closer's PIN → `status='closed'`. Owner reviews next morning → `status='reviewed'`; nothing closed can be edited, only annotated (`note` events).

## (d) Metrics that are fair and hard to game

Computed only from locked events, per waiter per shift, then rolled to 7/30 days. Each metric is shown against **two baselines**: the waiter's own 30-day median and the venue median for the same weekday — so a slow Tuesday never looks like theft.

| Metric (bs) | Definition | Why hard to game |
|---|---|---|
| Prihod (revenue) & prihod/sat | Σ charged_amount / hours in shift_members | Baseline-normalised |
| Prosječan račun (avg ticket) | revenue / paid orders | Under-recording lowers it visibly |
| Stavki po stolu (items/table) | lines / distinct tables | Same |
| Storno % | voided value / gross value; plus `self_void_count` | Pending voids count as not voided |
| Na račun kuće % | comp value / gross, excl. `owner_guest` | Owner's own guests don't taint staff |
| Razlika pazara (cash variance) | Σ diff_km, and count of shifts with \|diff\| > 5 KM | Blind count, per-waiter custody |
| Nargile/sat | bowls / hours | Cross-checked by g/bowl and coal/bowl |
| Nenaplaćeni stolovi | unpaid count & KM | Needs PIN or review |
| Odnos prisutan/odsutan | revenue/hour with owner present ÷ absent | Only meaningful after 4 weeks |

**Presentation without surveillance hell.**
- Waiters see **only their own** "Moja smjena" and "Moj mjesec" screens, plus the venue-level totals. No leaderboard, no ranking, no per-minute activity feed.
- Thresholds are published in "Pravila" (storno > 3 %, comps > 2 %, cash diff > 5 KM, g/bowl outside 12–18): crossing one shows a yellow band and the text "označeno za razgovor" — a conversation, not a sanction. Red only after 3 flagged shifts in 30 days.
- No silent flags: the app tells the waiter at the moment an action will be flagged.
- **Shared bonus** (`venue_settings.bonus_pool_km`, e.g. 200 KM/month): paid out pro rata to hours when the month's total cash variance is within ±0.5 % of cash sales **and** high-value stock variance within 2 % of cost. This makes honest staff police leakage themselves, which is the only thing that actually fixes collusion.

## (e) What the app cannot catch — process instead

- **Off-book goods** (waiter's own tobacco/cans, #11): invisible to stock. Needs a camera on the bar and shisha prep station, coal-per-bowl as a proxy, a monthly mystery guest (a friend pays cash, the owner checks the order is in the app 10 minutes later).
- **Cash between guest and waiter** (short-changing, overcharging): printed price list on every table, the "Pokaži račun" screen habit, mystery guest.
- **Pour size**: measured pourers on spirits; weigh open bottles at spot counts.
- **Counts by the thief**: the owner personally does the weekly full inventura (or two people together) and random spot counts of 5 SKUs; the app only provides the blind form.
- **Deliveries**: the owner (not staff) receives and enters goods for now.
- **Whole-staff collusion**: only revenue/hour vs. observed occupancy and cameras reveal it; the shared bonus lowers the incentive.
- **Physical cash**: a locked drawer, one pouch per waiter, banking the pazar daily.
- **Bad environment**: no app fixes it; publishing the rules and the bonus formula, and never accusing from a single shift's number, is the app's contribution.

## (f) The owner's 5-minute day review (*Pregled dana*)

One screen, mobile-first, opened from a Telegram digest sent at close (grammy bot, ~8 lines with a deep link):

1. **Header (30 s):** pazar total, cash vs card, `cash_diff_km` with colour, high-value stock diff in KM, bowls sold with g/bowl and coal/bowl.
2. **Zahtijeva pažnju (2 min):** pending voids, unpaid tables, waste entries, comps above threshold, new devices, sync gaps, "sumnjivo savršeno" counts — each with Odobri / Odbij / Bilješka buttons (1 tap each).
3. **Po konobaru (1 min):** one strip per waiter — revenue, storno %, comp %, cash diff — coloured against baselines.
4. **Trend (30 s):** 14-day sparklines of revenue/hour, stock variance KM, cash variance KM.
5. **Pregledano** button → `status='reviewed'`, optional note. Done.

## MVP: the 10 must-have controls

1. Append-only `order_events` / `order_lines` with actor, device, server timestamp, SQLite triggers blocking UPDATE/DELETE.
2. Offline-first order queue keeping `client_created_at` + `sync_lag_s`; gap alert.
3. Void policy: reason codes, 120 s self-void, otherwise owner PIN or `pending` — pending voids still count in expected cash.
4. Comps and staff drinks as explicit lines with `comp_reason`, `authorised_by`, per-shift allowance.
5. No typed prices or discounts; price snapshot per line; `item_price_history` + `audit_log`.
6. Shift open/close with starting float, **blind** per-waiter cash settlement, expected vs counted, mandatory note above tolerance, PIN sign-off.
7. Blind close count of a 10–15 SKU high-value list with expected-vs-counted in units and KM.
8. Shisha recipe (g tobacco, coals) per item; g/bowl and coal/bowl per shift.
9. Per-user PIN login, `devices` registry with revoke; every event carries `device_id`.
10. *Pregled dana* screen with *Zahtijeva pažnju* queue, per-waiter strip, Telegram digest.

**Can wait:** full inventura workflow with second counter and two-person sign-off; waste photos; deliveries with supplier invoices and cost prices; owner-presence analysis; shared bonus calculator; bar order-feed screen (*Šank ekran*); spot-count random picker; hash-chained events; `manager` role; multi-venue switching (schema already has `venue_id`).

**Assumptions to verify with the owner:** 15 g tobacco per bowl (public sources put a standard bowl at 10–20 g, ~15 g typical — [Dschinni](https://dschinni-shisha.com/en/blogs/news/wie-viel-tabak-pro-kopf-shisha), [Al Fakher](https://alfakherflavors.com/blogs/news/how-much-shisha-to-put-in-hookah)); ~3 coals per bowl plus top-ups; 5 KM / 1 % cash tolerance; that waiters carry their own cash pouch; that a card terminal prints a Z report.
