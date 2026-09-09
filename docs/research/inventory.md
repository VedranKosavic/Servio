# Research: Stock model (stanje šanka)

_Produced 2026-09-08 by the planning workflow; input to PLAN.md. Facts marked as assumptions were not verified._

# Stock model — "stanje šanka"

## 0. Principles

1. **Sellable ≠ stocked.** A menu product (`products`) is what the waiter taps; a stock item (`stock_items`) is what physically sits on the shelf. A recipe (`recipe_lines`) connects them. Most products are 1:1 with one stock item (a bottle) — the model must make that case zero-effort.
2. **One ledger, append-only.** Every change to stock is a row in `stock_movements` with a signed quantity in the item's base unit. Current stock is a SUM. Nothing is ever updated or deleted; mistakes are reversed by a new row.
3. **Integers for money, base units for quantity.** Money in feninga (`INTEGER`, 1 KM = 100 fen). Quantities as `REAL` in the item's base unit (`kom`, `g`, `ml`) — never in packs. Packs are a display/entry convenience.
4. **Never block a sale because of stock.** Stock can go negative; it is a signal, not a lock.
5. `venue_id` on every table, one venue in practice.

## (a) Entity model

**`stock_items`** (SKU / sirovina). Fields: `name` ("Coca-Cola 0.25 flaša", "Al Fakher Dupla jabuka", "Kokos žar 26 mm"), `category` (`pice`, `duhan`, `zar`, `hrana`, `potrosni`), `base_unit` ∈ {`kom`, `g`, `ml`}, `pack_name` ("gajba", "pakovanje", "kutija"), `pack_qty` in base units (24 for a case, 250 for a 250 g tin, 64 for a 1 kg coal box), `avg_cost_fen` per base unit, `last_cost_fen`, `count_method` ∈ {`count`, `weigh`, `estimate`}, `tolerance_qty`, `par_qty`, `reorder_qty`, `is_spot` (in the shift-change top-20), `supplier_id`, `active`. Base unit is frozen once the item has movements.

**`products`** (menu). `kind` ∈ {`simple`, `shisha`, `free_text`}, `category_id`, `name`, `short_name` (≤14 chars for the waiter grid), `price_fen`, `active`, `sort_order`, `is_favourite`, `shisha_grams` (for kind=shisha, e.g. 20), `sells_stock_item_id` (the 1:1 shortcut: when set, the product implicitly has recipe "1 base unit of this item" and no `recipe_lines` are needed).

**`recipe_lines`** (normativ). `product_id`, `stock_item_id`, `qty` in base unit. Examples:

| Product | Lines |
|---|---|
| Coca-Cola 0.25 | `sells_stock_item_id` = Coca-Cola bottle (implicit 1 kom) |
| Espresso | 7 g kafa Doncafe; (optional) 1 kom šećer kesica |
| Gin tonik | 30 ml gin; 1 kom tonik 0.2 |
| Nargila standard | 3 kom žar + `shisha_grams`=20 of the *chosen* tobacco (resolved at order time, see (d)) |
| Dodatni žar | 2 kom žar, price 0 or 1 KM |

Unit conversions live only in `pack_qty`: case→bottle (24), kg→g (1000), l→ml (1000), coal box→pieces (64 for 26 mm cubes, 72 for 25 mm — [verified on retail listings](https://myhookahusa.com/cocous-natural-coconut-charcoal-26mm-cubes/); owner confirms his brand once). Every entry screen shows "packs + loose" inputs ("2 gajbe + 7 flaša" → 55) and stores base units. Pour size for spirits defaults to 30 ml (0.03 l is the usual measure in BiH — assumption, owner-editable).

**`locations`**: seeded with one row `šank`; a second row `magacin` can be added later. `stock_movements.location_id` is required from day 1 so transfers are just two movements later.

## (b) Stock-movements ledger

`stock_movements` (append-only): `id`, `venue_id`, `location_id`, `stock_item_id`, `type`, `qty_delta` (signed, base unit), `unit_cost_fen` (snapshot of `avg_cost_fen` at write time; for deliveries the invoice cost), `ref_type` + `ref_id` (`order_line`, `delivery`, `waste`, `count`, `transfer`, `return`), `shift_id`, `user_id`, `reverses_id` (nullable), `note`, `occurred_at`, `created_at`.

`type` ∈ `opening` (+), `delivery` (+, prijem robe), `sale` (−), `sale_storno` (+, reversal of a sale row), `waste` (−, kalo/rastur), `transfer_out`/`transfer_in`, `count_adjust` (±, inventura), `return_supplier` (−, povrat), `correction` (±, owner-only, note required).

Header tables give the humans something to look at:

- **`deliveries`** (prijem robe): `supplier_id`, `invoice_no`, `delivered_at`, `photo_path` (invoice photo, stored on the VPS disk), `total_fen`, `entered_by`, `status` (`draft`/`posted`). `delivery_lines`: `stock_item_id`, `packs`, `loose`, `qty` (computed), `unit_cost_fen` per base unit (entered as price per pack, divided). Posting writes one `delivery` movement per line and updates the moving average. Screen: pick supplier → tap items (recent items for that supplier first) → packs/loose/price per pack → "Proknjiži". ~6 taps per line.
- **`waste_events`** (kalo/rastur): `stock_item_id`, `qty`, `reason` ∈ {`razbijeno`, `isteklo`, `prosuto`, `gratis` (comped to a guest), `degustacija`, `ostalo`}, `note`, `photo_path`, `user_id`, `shift_id`. Waiters may log waste; the owner sees it on the shift report. Comps flow through waste with reason `gratis` so "free drinks for friends" become visible instead of vanishing as variance.
- **Sale consumption** is automatic. On order lock (`orders.status → locked`), in the same SQLite transaction: for each `order_lines` row, resolve the recipe (implicit 1:1, `recipe_lines`, or shisha resolution), write one `sale` movement per stock item with `ref_id = order_line_id`, `shift_id` = the current shift. Storno of a line writes `sale_storno` rows referencing the originals via `reverses_id`. Recipe edits affect only future orders; past movements keep their quantities.
- **Transfers** (later): one `transfer_out` at magacin and one `transfer_in` at šank, same `ref_id`.
- **Supplier returns** (later): `return_supplier` movement plus a `returns` header with the credit note number.

**Current stock**: `SELECT stock_item_id, SUM(qty_delta) … GROUP BY` with an index on `(venue_id, location_id, stock_item_id)`. At a few hundred sale rows a night this is instant for years; add a cached `stock_levels` table only if the dashboard ever feels slow. A nightly job (the existing cron pattern) recomputes and logs any drift.

## (c) Stock counts (inventura / popis)

`stock_counts`: `kind` ∈ {`full`, `spot`}, `location_id`, `shift_id` (the shift being closed), `status` ∈ {`draft`, `submitted`, `confirmed`}, `counted_by`, `witnessed_by` (incoming waiter), `confirmed_by` (owner/manager), timestamps. `stock_count_lines`: `stock_item_id`, `theoretical_qty` (snapshot at submit), `counted_qty`, `variance_qty`, `unit_cost_fen`, `variance_fen`, `method`, `note`.

Rules:

- **Theoretical** = SUM of all movements at that location up to `submitted_at` (opening + deliveries − sales − waste ± transfers ± prior adjustments). It is snapshotted into the line so later reversals don't rewrite history.
- **Spot count** ("brzi popis") at every shift change: the `is_spot` items (≈20: every spirit bottle, beer, top 5 sodas, tobacco open packs, coal). Screen is one scrollable list, item name + big number field + pack/loose toggle; theoretical is *hidden* until submit (blind count, otherwise people type the expected number). Target: 3–5 minutes.
- **Full inventura**: all active items, monthly or when the owner wants; same screen, filter off.
- **Who**: the outgoing waiter/bartender counts; the incoming one taps "Potvrđujem stanje" (`witnessed_by`) — two people, two taps, both names on the record. The owner confirms in the dashboard; confirming with "Primijeni" writes `count_adjust` movements for every line with variance ≠ 0. Waiters cannot write adjustments.
- **Tolerance**: per item `tolerance_qty` (bottles 0; open spirit bottles 30 ml; tobacco 15 g per open pack; coal 4 kom). Line is green within tolerance, red beyond. Per-shift threshold: total |variance_fen| beyond 10 KM (owner-configurable, `venues.variance_alert_fen`) triggers a Telegram push to the owner. A red line requires a note before submit.
- **Fairness**: variance is reported per *shift* (which people were on it), not silently per person; the same list is visible to the staff on that shift. A 30-day cumulative variance per item is what actually catches leakage (one bottle a week is invisible in a single shift).
- **Open bottles**: `count_method = estimate` in tenths (a 0.7 l bottle at "0.4" → 280 ml) or `weigh` later.

## (d) Shisha specifics

- **Tobacco**: one stock item per flavour, `base_unit = g`, `category = duhan`, plus `brand` ("Al Fakher", "Adalya", "Serbetli"). Pack sizes vary (50/200/250/1000 g) — `pack_qty` is the *usual* pack; the delivery screen lets you override the pack size per line ("5 × 250 g + 1 × 1 kg" → 2250 g).
- **Products**: "Nargila standard" (`kind = shisha`, `shisha_grams = 20`, recipe 3 kom coal), "Nargila premium" (25 g, other brands, higher price), "Dopuna lule" (15 g, 2 kom coal, cheaper). Grams per bowl live on the *product*; a brand that packs differently gets its own product. Optional `brand_grams_override` per brand — later.
- **Order line for shisha** stores `flavour_ids` (1–3 stock items) in `order_line_options`. Consumption splits `shisha_grams` equally (2 flavours → 10 g + 10 g). Unequal mixes are noise at this scale; don't build a UI for it.
- **Coal**: base unit `kom`, pack = box (64/72/96 pieces depending on size). "Dodatni žar" is a product so extra coal is counted, even at price 0.
- **Counting open packs**: MVP = estimate quarters (tin looks ¼/½/¾ full → 62/125/187 g of a 250 g tin, item shows "3 puna + 1 otvoreno ½"). Later = `weigh`: owner buys a kitchen scale; `tare_g` on the item (empty tin weight); enter gross weight, app subtracts tare. Tobacco tolerance is wide anyway (moisture, leftover in bowls).
- **KPI**: actual g/bowl = tobacco consumed (deliveries − Δstock) ÷ bowls sold, per week. Recipe says 20; if reality drifts to 30, either someone is overpacking or tobacco leaves the building. This single number is worth more than per-flavour precision.

## (e) Cost and margin

- **Moving average** on `stock_items.avg_cost_fen`, updated at delivery posting: `new_avg = (on_hand × avg + qty_in × cost_in) / (on_hand + qty_in)`; if `on_hand ≤ 0`, `new_avg = cost_in`. `last_cost_fen` is also kept for the price-change alert ("Coca-Cola je poskupila 8 %"). No FIFO/lots — nothing here expires fast enough to justify it.
- Costs are what the owner pays per pack, PDV included (he isn't reclaiming VAT through this app; keep it simple).
- Every `sale` movement snapshots `unit_cost_fen`, so **COGS per shift** = `SUM(−qty_delta × unit_cost_fen)` over `sale` and `sale_storno` rows in that shift. Adding `waste` and `count_adjust` rows gives "stvarni trošak" (real cost) vs "teoretski" — the gap in KM is the leakage number for the shift report.
- **Gross margin per product** = `price_fen − Σ(recipe qty × avg_cost_fen)`, computed live in the menu screen ("Gin tonik: 6.00 KM, trošak 1.42, marža 76 %"). Dashboard tables: margin by product, by category, by shift; products with margin < 50 % highlighted.

## (f) Reorder alerts and par levels

`par_qty` (target on Thursday before the weekend), `reorder_qty` (minimum), `lead_days` (later). "Lista za nabavku" screen: items with `on_hand ≤ reorder_qty`, grouped by supplier, suggested order = `ceil((par − on_hand) / pack_qty)` packs, one tap "Kopiraj" to paste into a Viber/WhatsApp message to the supplier (no supplier integration). Daily 10:00 Telegram digest to the owner via the existing bot: "Ispod minimuma: Rosa 0.5 (7 kom), Al Fakher Grožđe menta (40 g)". Later: days-of-cover = on_hand ÷ 14-day average consumption, and a Thursday "vikend priprema" list.

## (g) Menu management

- **`categories`**: `name`, `sort_order`, `colour`, `kind` ∈ {`pice`, `hrana`, `nargila`, `ostalo`}. Waiter screen tabs come from this table.
- **`products`** as above; owner screen is a list per category with inline price edit, active toggle, star for favourite, drag-sort on desktop (`sort_order` integer, gaps of 10).
- **`price_history`**: `product_id`, `price_fen`, `valid_from`, `valid_to`, `changed_by`. Editing a price closes the old row and opens a new one. `order_lines.unit_price_fen` is always a snapshot, so a change at 22:00 never touches the 21:30 orders; the waiter sees the new price on the next order. UI offers "Važi od: odmah / od sljedeće smjene".
- **Favourites**: "Brzi izbor" grid on the waiter's first screen = manually starred products plus the top sellers of the last 30 days (`is_favourite` OR auto-computed, owner can hide the auto part).
- Deactivating keeps history; deleting is only allowed if the product has zero order lines.

## (h) Day-1 onboarding (under an hour)

Wizard "Postavljanje lokala", 5 steps, resumable:

1. **Lokal** (2 min): name, one location, coal box size, default pour 30 ml, spot-count threshold KM.
2. **Meni iz šablona** (15 min): a seeded template for a BiH shisha lounge — ~10 categories and ~70 typical products (Espresso, Kafa s mlijekom, Nescafe, Cedevita, Coca-Cola 0.25, Fanta, Sprite, Rosa 0.5, Sarajevsko 0.33, Nikšićko, Jelen, Rakija, Vodka, Gin, Whisky, Jägermeister, Gin tonik, Vodka Redbull, Nargila standard/premium, Dopuna, Dodatni žar, Ostalo). Checklist grid: one tap to include, one field for price. Untouched rows stay inactive. Bottle products auto-create their 1:1 stock item; recipe products come with default recipes (7 g, 30 ml, 20 g + 3 žar) editable later.
3. **Aromе** (5 min): pick brands, paste flavours as a comma-separated list per brand → stock items in grams.
4. **Dobavljači** (3 min): names and what they deliver (optional).
5. **Početno stanje** (20–30 min): the full-count screen over all stock items, packs + loose, optional cost per pack. Submit writes `opening` movements and seeds `avg_cost_fen`. Items left blank start at 0 and are flagged "nije prebrojano".

CSV import/export (`naziv, kategorija, cijena, jedinica, pakovanje, stanje, nabavna_cijena`) is a "later" item — the template covers this venue, and CSV is for the second venue.

## (i) Table sketch (SQLite / Drizzle)

```
venues(id, name, currency='BAM', variance_alert_fen, default_pour_ml, created_at)
locations(id, venue_id, name, sort_order)
suppliers(id, venue_id, name, phone, note, active)
categories(id, venue_id, name, kind, colour, sort_order, active)
products(id, venue_id, category_id, name, short_name, kind, price_fen,
         sells_stock_item_id?, shisha_grams?, is_favourite, sort_order, active,
         created_at, updated_at)
price_history(id, venue_id, product_id, price_fen, valid_from, valid_to?, changed_by)
stock_items(id, venue_id, name, category, brand?, base_unit, pack_name, pack_qty,
            avg_cost_fen, last_cost_fen, count_method, tare_g?, tolerance_qty,
            par_qty?, reorder_qty?, supplier_id?, is_spot, active, created_at)
recipe_lines(id, venue_id, product_id, stock_item_id, qty)
order_line_options(id, venue_id, order_line_id, stock_item_id)   -- shisha flavours
stock_movements(id, venue_id, location_id, stock_item_id, type, qty_delta,
                unit_cost_fen, ref_type?, ref_id?, shift_id?, user_id, reverses_id?,
                note?, occurred_at, created_at)
  INDEX (venue_id, location_id, stock_item_id), INDEX (shift_id), INDEX (ref_type, ref_id)
deliveries(id, venue_id, location_id, supplier_id?, invoice_no?, delivered_at,
           photo_path?, total_fen, status, entered_by, posted_at?)
delivery_lines(id, venue_id, delivery_id, stock_item_id, pack_qty_used, packs, loose,
               qty, unit_cost_fen)
waste_events(id, venue_id, location_id, stock_item_id, qty, reason, note?, photo_path?,
             shift_id?, user_id, created_at)
stock_counts(id, venue_id, location_id, kind, shift_id?, status, counted_by,
             witnessed_by?, confirmed_by?, started_at, submitted_at?, confirmed_at?, note?)
stock_count_lines(id, venue_id, count_id, stock_item_id, theoretical_qty, counted_qty,
                  variance_qty, unit_cost_fen, variance_fen, method, note?)
```

Orders, shifts and users are owned by other specialists; this model needs only `orders.status`, `order_lines(product_id, qty, unit_price_fen, storno_at?)`, `shifts.id`, `users.id`.

## Edge cases

- **Negative stock** (wrong recipe, forgotten delivery, wrong pack size): allow the sale, write the movement, show the item in a dashboard list "U minusu" with the likely cause ("zadnji prijem prije 9 dana"). The next count's `count_adjust` corrects it; the variance is shown in KM so the owner sees the cost of sloppy data entry.
- **Late delivery entry** (invoice posted after a confirmed count already included the goods): warn on `delivered_at < last confirmed count`; the owner picks "Već prebrojano" → the app writes the `delivery` movement (for cost/average) plus an equal negative `correction` so stock stays as counted.
- **Price change mid-shift**: solved by `unit_price_fen` snapshot on the order line; shift report groups by price if two prices occurred.
- **Product with no recipe and no 1:1 item**: sale records revenue only, no movement; dashboard list "Proizvodi bez normativa" nags until fixed; the onboarding wizard forces a choice for every included product.
- **"Ostalo" free-text item**: `kind = free_text`, waiter types name + price (2 fields, min 2 taps + typing), stored on `order_lines.free_text`; no stock movement; shift report lists them; the weekly digest suggests "Toplu čokoladu ste prodali 11× kao Ostalo — dodati u meni?".
- **Recipe changed after sales**: old movements untouched; margin history recalculates from snapshots, not current recipe.
- **Storno after the count period closed**: the reversal is dated now, so the previous shift stays slightly wrong and this one slightly right; the 30-day cumulative view absorbs it. Don't backdate.
- **Base-unit mistakes**: base unit locked after the first movement; changing it means creating a new item and deactivating the old one.
- **Shisha flavour out of stock**: still allowed; tobacco goes negative and shows up in "U minusu".

## MVP vs later

**MVP (build now)**: `categories`, `products` (simple/shisha/free_text), `price_history`, `stock_items` with base + pack unit, implicit 1:1 recipes and `recipe_lines`, single location, `stock_movements` with types `opening/delivery/sale/sale_storno/waste/count_adjust/correction`, deliveries with invoice number and photo, waste with reasons incl. `gratis`, spot count and full count with blind entry + witness + owner confirm, moving-average cost, COGS and margin per product/shift, "U minusu", "Bez normativa" and "Ispod minimuma" lists, onboarding wizard with the seeded template, shisha flavours in grams with equal mix split and coal pieces, open-pack quarters.

**Later**: second location and transfers, supplier returns, weigh-based counting with tare, par-level suggested orders grouped by supplier + Telegram digest, days-of-cover, CSV import/export, unequal mixes, per-brand grams override, cached `stock_levels`, FIFO/lots and expiry, per-person variance analytics (only after the per-shift version has proven fair in practice), multi-venue switching.
