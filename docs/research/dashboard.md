# Research: Owner dashboard & reporting

_Produced 2026-09-08 by the planning workflow; input to PLAN.md. Facts marked as assumptions were not verified._

# Owner dashboard & reporting — "Šank"

## 1. The owner's questions, ranked

Ranked by (frequency × money at stake). 1–3 are asked every day on a phone; 4–5 are the reason the app exists and are answered weekly on a laptop; 6–9 are weekly/monthly.

| # | Question (bs) | Answered by |
|---|---|---|
| 1 | Koliki je pazar danas / ove smjene? | `promet` today, split gotovina/kartica, vs same-weekday 4-week average |
| 2 | Je li kasa tačna? | `razlika u kasi` = counted − expected, per shift, history per closer |
| 3 | Ko radi i šta se dešava sada? | Live page: staff on shift, open tables, last order timestamp |
| 4 | Gdje nestaje roba? | `manjak` in KM per stock item, per count period; per-shift quick counts |
| 5 | Ko ima sumnjive brojke? | Per-waiter deviations vs venue median with min sample size |
| 6 | Šta se prodaje, šta ne? | Item velocity (units/open hour), dead items (0 sales / 30 d) |
| 7 | Koje arome idu? | Flavour ranking with delta vs previous period |
| 8 | Kad je gužva? | Weekday × hour heatmap of promet and orders |
| 9 | Šta naručiti od dobavljača? | Days-of-cover and suggested order vs par level |

## 2. Information architecture

### Conventions (apply everywhere)
- **Business day (poslovni dan)** starts at 06:00. A shift belongs to the business day of `shifts.opened_at`. "Danas" = the current business day, never the calendar date (a Saturday shift ending 03:00 Sunday is Saturday).
- **Shift (smjena)** is the atomic accountability unit. On close, a `shift_summaries` row is written (all numbers below) and becomes immutable; corrections go into `adjustments` (reason, by, at) and are shown as a separate line, never edited in place. History pages read summaries; Live/Today compute from raw rows.
- **Time-range presets**: Danas · Jučer · Ova sedmica · Prošla sedmica · Ovaj mjesec · Prošli mjesec · Zadnjih 30 dana · Prilagođeno. Toggle "Uporedi s prethodnim periodom". Presets are query params (`?from=&to=&cmp=1`) so the owner can bookmark/share.
- **Refresh**: Live polls `GET /api/owner/live` every 15 s (`useIntervalFn`); everything else fetches on navigation. No websockets in v1.
- **Assumed tables** (from the data-model track; column names used below): `shifts(id, venue_id, opened_at, closed_at, opened_by, closed_by, opening_float, cash_declared, cash_expected, variance)`, `orders(id, shift_id, table_id, waiter_id, opened_at, locked_at, paid_at, status open|paid|voided)`, `order_lines(id, order_id, item_id, flavour_id, qty, unit_price, comp, voided_at, void_reason, voided_by)`, `payments(order_id, method cash|card, amount)`, `items(id, category, price, cost_price, active)`, `item_components(item_id, stock_item_id, qty_per_unit)`, `stock_items(id, unit, par_level, cost_price, risk)`, `stock_movements(stock_item_id, type sale|delivery|count|waste|adjust, qty_delta, ref_id, by_user, at)`, `stock_counts(id, shift_id, kind quick|full, at)`, `shift_staff(shift_id, user_id, role, clocked_in, clocked_out)`, `alert_events`.

### Core formulas
- `promet` (gross sales) = Σ `qty × unit_price` over lines with `voided_at IS NULL AND comp = 0` in orders with `status = 'paid'`, in window.
- `gratis` (comps) = same, `comp = 1`. `storno_nakon_naplate` = lines/orders voided with `voided_at > paid_at` (count + KM).
- `otvoreno` (unpaid) = Σ lines of `status = 'open'` orders. `prosječan račun` = promet / paid orders. `stavke po računu` = non-void lines / paid orders.
- `cash_expected` = `opening_float` + Σ cash payments − Σ `payouts` (isplate iz kase, e.g. paying a delivery from the till). `variance` = `cash_declared − cash_expected`. `variance_pct` = variance / Σ cash payments.
- Theoretical consumption per stock item = Σ `order_lines.qty × item_components.qty_per_unit` (non-void). Expected stock = last count + deliveries − theoretical − recorded waste. `manjak` = counted − expected; `manjak_km` = manjak × `cost_price` (negative = missing). `shrinkage_pct` = −manjak / (last count + deliveries).
- `days_of_cover` = current stock / mean daily consumption (last 28 business days). `suggested_order` = max(0, par_level − current + consumption_per_day × lead_days). Default `lead_days = 3`.
- `promet_per_hour` per waiter = promet of their orders / hours from `shift_staff`.

### Page 1 — Uživo (Live)
Widgets: (1) **Now strip**: promet so far today, open tables count + `otvoreno` KM, cash_expected, storna/gratis today (count), staff on shift with clock-in time. (2) **Stolovi**: grid of tables coloured by state (free / open <1 h / open 1–3 h / open >3 h / no activity 90 min); tap → order detail. (3) **Zadnjih 20 stavki**: live feed of locked lines (time, table, waiter, item, KM), voids in red, comps in amber. (4) **Alerts today** (from `alert_events`) with acknowledge button. Drill-downs: table → order → audit timeline (created, each line added, locked, paid, voided, by whom, at). Time range: fixed to today.

### Page 2 — Danas / Smjena (Today / Shift)
Shift picker (today's shifts; usually one). Widgets: promet (gotovina / kartica / gratis), paid orders, prosječan račun, stavke po računu, category split (piće / hrana / nargila) as a 100 % stacked horizontal bar, top 10 items, top 5 flavours, per-waiter table (promet, orders, avg bill, storna, gratis, hours, promet/h), cash box (float, cash sales, payouts, expected, declared, variance — declared/variance only after close), storna list with reasons, comps list. Comparison chip on every number: "vs isti dan prošle 4 sedmice ±%". Drill: any number → filtered order list.

### Page 3 — Historija (History / Trends)
Uses `shift_summaries`. Widgets: promet by business day (bars, last 30, 7-day rolling line), same for orders and avg bill; weekday × hour heatmap (last 8 weeks; metric toggle promet / orders / shishas); cash variance per shift (lollipop, coloured by `closed_by`); shifts table (date, opened/closed, closer, promet, cash, card, gratis, storna, variance) with CSV export; item velocity table with 14-day sparklines and "mrtvi artikli" filter; flavour ranking with delta arrows. Drill: day → Page 2 for that day; item → item detail (sales over time, by hour, by waiter).

### Page 4 — Roba (Stock)
Widgets: **Stanje šanka** table (stock item, unit, current, par, days_of_cover, status ok / nisko / kritično); **Manjak** diverging bar in KM by item for the selected count period, plus table (expected, counted, manjak, manjak_km, shrinkage_pct); **Prijem robe** list (supplier, invoice no., total, entered by); **Popisi** list (quick / full, by, at, total manjak_km); **Prijedlog narudžbe** (suggested_order > 0 items, editable qty, export CSV to send to supplier). Drill: stock item → movement ledger (every `stock_movements` row with the referencing order/delivery/count). Rule: `risk = 1` items (tobacco, spirits, energy drinks, coal boxes; ≈10 items) get a **quick count at every shift close** (brzi popis) so manjak is attributable per shift; full inventura weekly.

### Page 5 — Osoblje (Staff)
Per-waiter cards for the range: promet, hours, promet/h, orders, avg bill, items/order, storna per 100 orders (count, KM), gratis per 100 orders, cash variance on shifts they closed, quick-count manjak_km on shifts they worked. **Odstupanja** panel: a metric is flagged only when (a) waiter has ≥ 10 shifts in range, (b) value > 2× venue median or > median + 2 MAD, (c) the flag text explains which comparison fired ("storna 6.1/100 vs prosjek 1.8"). No score, no ranking, no "sumnjiv" label — the word in the UI is "odstupanje" (deviation). Drill: waiter → their shifts → orders; each flagged void shows the void reason and the waiter's note (§7).

### Page 6 — Meni & Postavke
Items CRUD (name, category, price, cost_price, active, components), flavours (active, sort order), tables, stock items (unit, par, risk, cost), staff (role, PIN reset, active), alert rules (§3 thresholds), venue (name, business-day start, currency — all `venue_id`-scoped so venue 2 is a row, not a rewrite).

### Mobile vs desktop
- **Mobile (phone) = "Puls"**: one screen, five numbers in 2×3 tiles: Promet danas · Otvoreno (n stolova / KM) · Gotovina u kasi (očekivano) · Storna/gratis danas · Ko radi. Below: alert list, then "Zadnje stavke" feed. Bottom tabs: Puls · Smjena · Roba · Više. Charts on mobile are limited to the daily bars and the flavour list; tables become cards; heatmap is desktop-only (link "otvori na računaru").
- **Desktop**: left nav (six pages), top bar with range presets and compare toggle, 12-column grid; tables are dense with sticky headers and inline CSV buttons.

## 3. Alerting

Channel: **Telegram first** (Vedran already has grammy; history persists, works on laptop; inline buttons "Otvori smjenu" / "Ignoriši"). Web push second, for the PWA on the phone, same payload. Assumption: the owner uses Telegram; Viber is dominant in BiH, so confirm before building — if Viber is required, keep the same `alert_events` pipeline and swap the sender.

| Rule key | Fires when (default) | Mode |
|---|---|---|
| `void_after_payment` | any line/order voided after `paid_at` | Immediate; if > 3 in 10 min → one batched message |
| `comp_large` | single comp > 20 KM, or comps in shift > 50 KM | Immediate (single), once per shift (sum) |
| `cash_variance` | at close, \|variance\| > max(10 KM, 1 % of cash sales) | Immediate, with the closing summary |
| `stock_variance` | at count, item manjak_km < −20 KM or shrinkage > 5 % | One message per count listing offenders |
| `shift_closed` | always | Immediate: the "pazar" message (promet, cash, card, gratis, storna, variance, top flavour) |
| `table_stale` | order open > 4 h, or no new line for 2 h while open | Digest every 60 min, only for tables not already reported |
| `stock_below_par` | current < par | Daily digest at 10:00 |
| `no_orders` | ≥ 3 tables open and no line locked for 45 min, 19:00–01:00 | Max once per 2 h |
| `discount_large` | price override > 20 % | Immediate |

Anti-spam: `alert_events(rule_key, ref_type, ref_id, sent_at, acknowledged_at)` deduplicates on `(rule_key, ref_id)`; per-rule cooldown column; quiet hours 03:00–10:00 (only `shift_closed` and `cash_variance` pass); hard cap 6 immediate pushes/hour, overflow collapses into a digest; Telegram button "Tiho do sutra" mutes non-critical rules until next business day. All thresholds live in `alert_rules(venue_id, rule_key, enabled, threshold, cooldown_min, channel)`.

## 4. Charts and exports

Library: Apache ECharts via `vue-echarts` (heatmap built in, works in Nuxt with `<ClientOnly>`); sparklines as inline SVG.

| Question | Chart |
|---|---|
| Promet over time | Vertical bars per business day + 7-day rolling line; ghost bars for compare period |
| Busiest times | Weekday × hour heatmap (7 × 20 cells, 06:00–02:00), sequential colour, value in cell on hover |
| Per-waiter | Horizontal bars promet/h sorted; dot plot of storna/100 and gratis/100 with a vertical venue-median line |
| Flavour ranking | Horizontal bars sorted by count, delta chip vs previous period; toggle share % |
| Item velocity | Table with 14-day sparkline column, sortable |
| Stock leakage | Diverging horizontal bars manjak_km by item (missing = left, red) |
| Cash variance | Lollipop per shift on a zero line, colour = closer |
| Category mix | 100 % stacked horizontal bar per day |

No pies, no gauges, no 3D.

Exports (CSV, UTF-8 **with BOM**, `;` delimiter, so Excel on a Bosnian locale opens č/ć/š correctly; Excel workbook later via SheetJS):
1. `smjene.csv`: shift_id, business_date, opened_at, closed_at, opened_by, closed_by, promet, cash, card, gratis, storna_count, storna_km, opening_float, payouts, cash_expected, cash_declared, variance.
2. `dnevni_pazar.csv` (for the accountant): business_date, cash, card, total, gratis, note "interni izvještaj — nije fiskalni".
3. `prodaja_po_artiklu.csv`: item, category, qty, promet, gratis_qty, gratis_km, storno_qty.
4. `stavke.csv` (line detail): line_id, at, business_date, shift_id, table, waiter, item, flavour, qty, unit_price, total, comp, voided_at, void_reason, voided_by.
5. `kretanje_robe.csv`: at, stock_item, type, qty_delta, unit, cost, ref_type, ref_id, by.
6. `prijem_robe.csv`: date, supplier, invoice_no, stock_item, qty, unit_cost, total.
7. `popis.csv`: count_id, at, kind, stock_item, expected, counted, manjak, manjak_km.

## 5. Scripted reviews

**Jutarnji pregled (5 minutes, phone):**
1. Open Telegram → read last night's `shift_closed` message (30 s). Variance within tolerance? If not, tap "Otvori smjenu".
2. Puls → Smjena (jučer): compare chip vs same weekday; if −20 % or worse, check hours worked and staff count (1 min).
3. Storna & gratis list: read every reason; anything with no reason or "greška" more than twice → note the waiter for a conversation (1 min).
4. Roba → Brzi popis from last close: any red row → open its movement ledger, see which shift it drifted in (1 min).
5. Roba → Prijedlog narudžbe: accept/adjust, export CSV, send to supplier (1 min).
6. Alerts: acknowledge all so tonight starts clean (30 s).

**Zatvaranje smjene (end of shift; closer = šanker, owner reads later):**
1. App blocks close while any order is `open` → closer resolves tables (pay or void with reason).
2. Closer enters `cash_declared` (counted till) and `payouts`; app shows expected and variance immediately, closer may add a note.
3. Brzi popis: the ~10 risk items, one numeric field each (≤ 2 min).
4. Tap "Zaključi smjenu" → `shift_summaries` written, Telegram "pazar" message sent, every waiter's "Moja smjena" summary becomes final.
5. Owner, when reading: variance → storna → quick-count manjak → per-waiter table, in that order; anything flagged is answered next morning, not by message at 02:00.

## 6. Deliberately out of v1
Profit/margin dashboards (needs reliable cost prices first — collect them, don't chart them); sales forecasting; labour cost; targets/goals; multi-venue comparison views (keep `venue_id`, hide the switcher); custom dashboard builder; websockets; hourly staff scheduling; customer/loyalty data; weather overlays; leaderboards by name; a "suspicion score"; PDF reports; Excel workbooks (CSV first); tips tracking; supplier price history.

## 7. Waiter transparency (fairness)
Principle: **every per-person number the owner sees, the person sees about themselves, first.** Screens in the waiter app:
- **Moja smjena** (live): my promet, my orders, my open tables and KM, my storna (with reasons), my gratis, hours since clock-in. Same formulas, same words as the owner's Page 5.
- **Sažetak** at close: the finalised numbers plus "vs moj prosjek" (own 30-day average), not vs colleagues.
- **Moja historija**: last 30 shifts as a list with promet/h and storna count.
- **Napomena**: if any of my storna/comps triggered an alert, I see it and can attach a note the owner sees on the same row — accountability with a right of reply.
- No leaderboard, no colleague numbers in v1. If the team wants a friendly ranking later, it is opt-in per venue in settings.

## 8. Priority

**MVP (ship with the waiter app):** business-day/shift conventions and `shift_summaries` snapshot; mobile Puls (5 tiles + alerts + feed); Smjena page with cash box, per-waiter table, storna/gratis lists; shift close flow with quick count; Telegram `shift_closed`, `void_after_payment`, `cash_variance`, `comp_large`; Roba: stanje šanka, prijem, popis with manjak_km; exports 1, 2, 4, 7; waiter Moja smjena + Sažetak; alert dedupe + quiet hours.

**Second (weeks 3–6):** Historija bars and shifts table; flavour ranking; item velocity + dead items; Osoblje deviations panel with min-sample rule; `stock_variance`, `table_stale`, `stock_below_par`, `no_orders` rules; suggested order; exports 3, 5, 6; web push.

**Later:** heatmap; cash-variance lollipop by closer; compare-period ghosts; Excel workbook; margin views once cost prices are trustworthy; multi-venue switcher; opt-in team ranking.
