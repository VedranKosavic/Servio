# Šank — Korak 2 backend implementation contract

**Status:** the single document an implementing agent follows for Korak 2. It merges the five package designs (auth, shifts/cash, payments/adjustments, stock, sync/log/admin/deploy), applies every critical and major review finding (or rejects it in §14), and is consistent with the code shipped in Korak 1 (commit `739cab7`).

**Vedran's decision, which overrides every design where they differ:** there are exactly **two roles** — `admin` and `radnik`. (Until `0005_radnik.sql` there were three: `waiter` and `bartender` were separate values with identical permissions, and the migration maps both onto `radnik`. The paragraphs below are the post-0005 contract; the sentences elsewhere in this document that still say "waiter" or "bartender" are describing the floor, the tables and the settings keys, which kept their names.)

- `admin` (*Vlasnik*) — special permissions: the owner dashboard and every live read, approvals (voids, comps, unpaid write-offs, payouts, settlements), catalogue and prices, deliveries and stock corrections, users/devices/settings, the Dnevnik. He never appears on, and never shares, a staff screen: his landing is `/admin`. He may still open `/konobar` and `/sanker` by hand, because the owner also serves tables — that is a guard question and `ROUTE_ROLES` answers it, not the landing rule.
- `radnik` (*Radnik*) — everybody else: orders, prep tickets, own shift settlement, stock view, waste below the thresholds, counts as custodian. **Which screen he is on tonight is not a property of his account.** It is a `ScreenMode` — `konobar | sanker` — chosen after the PIN and stored on his **session** (`sessions.mode`), so a reload at 02:00 lands him where he was and moving from the bar to the floor at midnight is one `POST /api/auth/mode`, not a logout. Both screens stay open to every worker. `shared/landing.ts` is the one place that turns role + mode into a destination, and `null` means the chooser.
- The one thing that was ever *not* identical between the old two floor roles — the bartender being a default approver — was never a role rule. It is `settings.approver_roles`, the fine gate in front of the seven routes of §7 (`/shifts/:id/closing`, `/shifts/:id/close`, `/shifts/:id/float`, `/cash-movements/:id/decide`, `/adjustments/:id/decide`, `/shifts/:id/settlements/:sid/accept`, `/stock/waste/:id/approve`). It now ships as `['admin','radnik']`, because whoever is on the šank closes the shift and decides a storno at 01:00 and an owner asleep at home cannot — which makes that setting the only thing standing between a worker and somebody else's money. An owner who wants the approvals to himself drops `radnik` from it in *Postavke*, and the services then refuse a worker with `NOT_APPROVER` even though `ROUTE_ROLES` let him through the door. `ROUTE_ROLES` is the coarse gate; the setting is the fine one.
- Korak 1's role value `'owner'` is renamed to `'admin'` everywhere, with `UPDATE users SET role = 'admin' WHERE role = 'owner'` inside the Korak 2 migration. There is no `manager` role and there never was one.
- Every person has an account with a PIN, and **the PIN identifies the person**: the first screen is a pad and nothing else, `POST /api/auth/pin` takes `{ pin, mode? }` and names nobody, and the server resolves the digits against the active users of the enrolled device's venue. A PIN is therefore **unique among the active users of a venue**, and **every PIN in a venue has the same number of digits** — `requirePinFree` refuses a duplicate at create-user and reset-PIN with 409 `PIN_TAKEN`, and a differing length with 409 `PIN_LEN_MIXED`. Unique alone is not enough: `2222` and `222299` are two distinct PINs and neither hash collides, but the pad fires on a fixed number of taps, so the six-digit typist's fourth tap would send `2222` and be signed in as whoever holds it. One length per venue makes that prefix unreachable and lets the pad fire on the real length from the first tap. Changing a venue from four digits to six therefore means clearing the PINs first — three taps in *Osoblje*, once, ever. It is a check inside the transaction rather than a unique index because the stored value is a per-row-salted scrypt hash: two hashes of the same PIN never collide, so there is nothing for an index to compare. Deactivated people do not hold a PIN against anybody, and `updateUser` drops a returning person's stale PIN rather than trust it. Admins additionally have email + password (that is the only way into `/admin` on a laptop).

Route paths keep the word `owner` (`/api/owner/live`, `/api/owner/log`) because they name the *owner dashboard* screens of PLAN §11 — the **role** guarding them is `admin`. Do not rename the paths; do not accept `'owner'` as a role value anywhere.

---

## 1. Scope of Korak 2, and what stays for Korak 3

### In Korak 2

| Area | What lands |
|---|---|
| Auth & tenant | devices, enrol codes, sessions, PIN + password login, lockout, rate limits, `server/middleware/tenant.ts`, deny-by-default role map, dev convenience |
| Shifts & cash | auto-open shift, members, cash movements, blind per-waiter settlement with `expectedCash`, close / force close, `shift_summaries` with `by_category`/`by_user`, drill-down |
| Money | `payments` (cash/card, covers, reversals), unpaid tabs and their decision, `line_adjustments` (voids and comps, self-void window, approver PIN, restock) |
| Orders | `createOrder` rewritten once: actor from session, shift attach, `shift_seq`, clamped client timestamps, comps at lock, coal child lines, costed stock movements |
| Stock | typed deliveries, waste, spot/full counts (submit → confirm → `count_adjust`), corrections, theoretical stock, on-hand, category and nargila reports |
| Sync | `changes` feed + `GET /api/changes?since=`, ETag on heavy GETs, device heartbeat, `bus.emit` hook points |
| Log | `log_entries` written inside the same transaction as the event, admin-only read (*Dnevnik*) |
| Alerts | `alert_events` as the in-app attention record — the 13 `ALERT_RULE_KEYS` of §9, queued and never sent anywhere (§9) |
| Admin | CRUD for products, categories, tables, stock items, recipes, users, devices, settings, `price_history` |
| Owner reads | `/api/owner/live` (Puls), shift list + shift detail + lines, stock, categories, nargila |
| Ops | `deploy/` copied from snajper, systemd unit, rsync deploy with health gate, hourly + daily SQLite backups, nightly task |
| UI | one final package: PIN login start screen, `user_id` removed from every body, one `/api/changes` poll |

### Explicitly Korak 3 (do not build)

Chat (`chat_*`), uploads, roster (`shift_templates`, `roster_*`, `swap_requests`), receipt scanning (`delivery_scans`, `supplier_aliases`), `locations` and transfers, `rules` + acknowledgements, free-text products, partial-quantity voids, count drafts on the server and the witness step, settlement corrections/chains, in-app alert acknowledgement and outcomes, nightly summary recompute (`drift`), SSE, `stock_below_par`.

**One consequence worth naming, because it shapes §6.10.** In-app acknowledgement is Korak 3, so Korak 2's owner screen must never show a row that no tap can clear. `OwnerLive` therefore has **two** lists, not one: `attention[]` holds only rows with a decide route (a pending void, comp, payout, `float_out`, unpaid tab, settlement, count), and every other flag — clock skew, an early close, a stale device, an uncovered payment, a shift with no opening count — goes into `flags[]`, which is **derived from a time window** (the open shift, or the last 24 h when none is open) and self-clears when the condition stops being true or the shift closes. Nothing accumulates, and no `acknowledged_at` column is needed. PLAN F13's ★ `flag_outcome` kind and `POST /api/owner/attention/dismiss` are Korak 3 with it.

---

## 2. Conventions

**Ids.** `id TEXT PRIMARY KEY`, a uuid from `newId()` (`server/utils/ids.ts`). Rows born on a phone additionally carry `client_id TEXT NOT NULL` with `UNIQUE(venue_id, client_id)`: `tabs`, `orders`, `payments`, `line_adjustments`, `waste_events`, `deliveries` (§3.2 says why a "desktop" route still needs one) and the queueable unpaid mark. Replaying the same `client_id` returns **200** with the stored result and `already_applied: true` — never 409. The replay lookup is the first statement inside the transaction, before any insert.

**Money.** `INTEGER` feninga in `*_fen`. Per-unit costs are `INTEGER` **milli-feninga** in `*_mfen` (`unit_cost_mfen`), because 30 KM per 700 ml is 4,286 mfen/ml and rounding it to 4 fen/ml loses 2,20 KM on one bottle. Reports multiply and divide by 1000 exactly once, at the end: `round(Σ qty × unit_cost_mfen / 1000)`. Money never becomes a float.

**A price never comes from a request body** (PLAN §8 rule 2). That is the rule, and it is narrower than "no money in a body": what a phone may never send is the **value of a thing the catalogue already prices** — `unit_price_fen`, `charged_fen`, a line total, a tab total, a promet. Those are snapshotted from `products`/`stock_items` at lock and recomputed on every read. What a body *must* carry, because only a human standing at the till knows it, is a **declaration or an amount of physical cash**: `amount_fen` (payment, `float_in`/`float_out`, payout, pickup), `declared_fen` (settle), `cash_counted_fen` (close), `card_total_fen` (review), `line_cost_fen` (what the supplier actually charged), `{ fen }` (opening float). Every one of those is validated against something the server computed — `amount_fen > remaining_fen` is 422 `OVERPAY`, `declared_fen` is compared to `expectedCash`, `cash_counted_fen` to `venueExpected`, `card_total_fen` to Σ card payments — and every one is `z.int().min(0).max(10_000_000)`. There is exactly one body money field the server cannot check, `POST /api/drafts/discard`'s `total_fen` (§6.1) — it describes a cart the server never saw. It is therefore written into a log entry and **summed into nothing**, which is the only reason it is allowed at all.

**Quantities.** `REAL` in the item's own base unit (`kom`/`g`/`ml`).

**Time.** Every timestamp that *records when the server acted* is an ISO-8601 UTC string written by the server (`nowIso()`), taken **once** per transaction and reused: `created_at`, `closed_at`, `decided_at`, `submitted_at`, `confirmed_at`, `sent_at`. Local time and the business day live in `shared/dates.ts`: `businessDate(utcIso, tz, startHour)`, `localTime(utcIso, tz)`, `localDate(utcIso, tz)`, `cutoffIso(businessDate, tz, startHour)` — built on `Intl.DateTimeFormat(...).formatToParts` with `hourCycle: 'h23'`. No business code calls `getHours()`.

**Exactly three timestamps arrive in a body**, because they record when something happened in the *world* and the server was not there: `client_created_at` (a queued round, payment, unpaid mark or waste event), `deliveries.delivered_at` (the invoice date), and `POST /api/stock/corrections { occurred_at? }` (a stock fix the owner back-dates). All three are `z.iso.datetime()`, all three are **clamped by the same helper** before they touch a column or a bracket:

```ts
// shared/dates.ts — one clamp, three callers
export function clampEventAt(claimed: string | undefined, now: string, maxLagH: number,
                             skewS = 0): string   // → [now − maxLagH·3600s, now]
```

`client_created_at` gets the device's `clock_skew_s`; `delivered_at` and `occurred_at` get `skewS = 0` (they are typed by a human, not stamped by a clock). A value in the future is always wrong, so the upper clamp is `now`; a value older than `max_sync_lag_h` is clamped up and the row is stamped `late_sync = 1`. `sync_lag_s = (now − client_created_at_adj)/1000`. Only the clamped value is ever compared to anything — in particular `theoreticalAt` and the count brackets in §6.8 see clamped `occurred_at` only, so a mistyped year cannot move a count's theoretical stock. `POST /api/stock/waste`'s `client_created_at?` is read by `logWaste` for exactly this and stored on the movement's `occurred_at`.

**Client timestamps are claims, not facts.** The server stores the claim verbatim (`client_created_at`) *and* the clamped value it actually uses (`client_created_at_adj = clampEventAt(claim, now, max_sync_lag_h, device.clock_skew_s)`). Both columns exist so a phone with a wrong clock leaves evidence instead of a silently-corrected row.

**venue_id.** Every business table carries `venue_id TEXT NOT NULL REFERENCES venues(id)`. No handler reads a venue from a body; `event.context.venueId` comes from `server/middleware/tenant.ts`. `currentVenueId(db)` survives only for `seed-cli.ts` and tests.

**Errors.** Services throw `SankError(status, code, message)`; routes wrap with `guard()`; the body is `{ code, message }` (plus `data` where documented). `SankError` gains an optional fourth argument `data?: Record<string, unknown>` merged into the response `data`. New helpers in `server/utils/errors.ts`: `unauthorized(code, msg)` 401, `forbidden(code, msg)` 403, `unprocessable(code, msg, data?)` 422, `locked(code, msg, retryAfterS)` 423, `tooMany(retryAfterS)` 429. Codes are `SCREAMING_SNAKE`.

**Two barrels, one per-package fragment each.** `shared/errors.ts` and `shared/types.ts` are the two files every package would otherwise have to edit, which contradicts "no package edits another's files" in §12. Both are split the way the schemas already are:

```ts
// shared/errors.ts — WP0 owns this file and nothing in it but the barrel
export const ERROR_MESSAGES: Record<string, string> = {
  ...COMMON_ERRORS, ...AUTH_ERRORS, ...MONEY_ERRORS, ...SHIFT_ERRORS,
  ...STOCK_ERRORS, ...SYNC_ERRORS, ...ADMIN_ERRORS,
}
// shared/errors/auth.ts — WP1 owns this one
export const AUTH_ERRORS = {
  INVALID_PIN: 'Pogrešan PIN.',
  LOCKED: 'PIN je zaključan. Pokušaj ponovo za {retry_after_s} s.',
  ADMIN_DEVICE_ONLY: 'Vlasnik se PIN-om prijavljuje samo na svom telefonu.',
  // …
} as const
```

`shared/types.ts` is the same barrel over `shared/types/{auth,money,shifts,stock,sync,admin,owner}.ts`; it holds only re-exports plus the four cross-package names (`Role`, `Actor`, `LogKind`, `ChangeEntity`) and the constants. Every response type named in §7 is **shaped** in the §6 subsection that returns it and lives in that package's fragment.

`tests/unit/errors.test.ts` (beside `route-roles.test.ts`) greps `server/services/**` and `server/api/**` for every `SankError(`, `conflict(`, `forbidden(`, `unauthorized(`, `unprocessable(`, `locked(` literal, and asserts each code has a non-empty Bosnian sentence in `ERROR_MESSAGES` — and, the other way, that no message is orphaned. Without it a code reaches the phone as raw `TAB_TABLE_MISMATCH`.

**Roles.** `type Role = 'admin' | 'radnik'` in `shared/types.ts`, next to `type ScreenMode = 'konobar' | 'sanker'`. Authorization is **deny-by-default** through one table:

```ts
// shared/routeRoles.ts
export type RouteRole = Role[] | 'public' | 'any'
export const ROUTE_ROLES: Record<string, RouteRole> = {
  'POST /api/auth/pin': 'public',
  'GET  /api/tables/state': 'any',
  'POST /api/adjustments/:id/decide': ['admin', 'radnik'],
  'POST /api/shifts/:id/force-close': ['admin'],
  // …one line per route in §7
}
```

`tenant.ts` normalises `method + path` (uuid segments → `:id`), looks the route up and **403s when the key is absent**. A new route is dead until it is declared. `tests/unit/route-roles.test.ts` walks `server/api/**` and asserts the two sets match exactly. Per-handler `requireRole(actor, ...roles)` stays as belt and braces.

**The actor.** One shape, in `server/services/types.ts`:

```ts
export interface Actor {
  venueId: string
  userId: string
  role: Role
  sessionId: string
  sessionKind: 'admin' | 'staff'   // 'admin' = email+password session, no device
  deviceId: string | null
  deviceBoundUserId: string | null // personal device: whose it is
  borrowed: boolean
}
```

**Signatures.** Mutations `service(db: Db, venueId: string, actor: Actor, body)`; reads `service(db: Queryable, venueId: string, …)`; internal helpers that must run inside a caller's transaction `helper(tx: Tx, venueId: string, …)`. `venueId` is always the second argument even though `actor` carries it — the reads have no actor and one convention beats two.

**Transactions.** better-sqlite3 is synchronous; one Node process; `db.transaction((tx) => { … })` bodies contain no `await`, no `db.*`, no network. Every multi-row write is one transaction. `log(tx, …)`, `bump(tx, …)` and `queueAlert(tx, …)` take `Tx` (not `Queryable`) so the type system forbids calling them outside one: an entry exists only if the event committed.

**The transaction that rejects must not carry the evidence.** A row written inside a transaction that then throws is rolled back — that is the property `orders.test.ts` relies on. So anything that must survive a rejection (failed PIN attempts, duplicate-payment attempts) is written by its **own top-level transaction on `db`, before the throw**, never inside the transaction being rejected. `recordAttempt(db: Db, …)` and `verifyPinMetered(db: Db, …)` are typed to take `Db` so the broken shape does not compile.

**Triggers.** All in `server/database/triggers.sql`, `DROP TRIGGER IF EXISTS` + `CREATE`, re-applied at every boot after `migrate()`. Guards are split in two so that adding a mutable column never means editing a boolean: `<t>_frozen_cols` (a short list of columns that may never change) and `<t>_status_guard` (the allowed transitions). Names are enumerated in `shared/constants.ts` `TRIGGER_NAMES`; `tests/unit/triggers.test.ts` has one raw-SQL refusal per rule and `schema.test.ts` asserts every name exists in `sqlite_master`.

**Migrations.** `drizzle-kit generate` only, never `push`. Korak 2 ships **one** migration, `0001_korak2.sql`, produced by WP0. Two hard rules learned the expensive way:

1. A column added to an existing table that carries `REFERENCES` must be **nullable with no default** — under `foreign_keys=ON` SQLite refuses `ADD COLUMN … NOT NULL DEFAULT '' REFERENCES users(id)` ("Cannot add a REFERENCES column with non-NULL default value"), and `openDatabase()` sets that pragma before migrating. Backfill with an `UPDATE` in the same migration file and enforce NOT NULL with a `BEFORE INSERT` trigger.
2. Korak 2 never changes an existing column's type or nullability, because drizzle-kit rebuilds the table (`__new_x` copy → drop → rename), which drops every trigger mid-migration and fights the foreign keys. A test greps the new migration for `__new_` and fails.

**Tests.** vitest, node env, `openDatabase(':memory:')` + `seed(db)` through `makeFixture()`. Extend the fixture, never mock the database. Every new transaction gets an atomicity test (force a throw mid-way → zero rows) and every phone-born mutation a replay test (two calls → one row). Existing invariant tests are never weakened; a change to one needs a sentence in the PR naming the invariant that moved.

**Language.** Bosnian in every UI string and log title (PLAN §12 labels verbatim). English in identifiers, codes, comments and this document.

---

## 3. Schema

One migration, `server/database/migrations/0001_korak2.sql`, generated from `server/database/schema.ts` by WP0. Everything below is Drizzle-style; snake_case column names are what lands in SQLite.

### 3.1 Changed tables

**`venues`** — add `settings_json TEXT NOT NULL DEFAULT '{}'`.

**`users`** — add (all nullable or defaulted, so `ADD COLUMN` needs no rebuild):

| column | type | note |
|---|---|---|
| `pin_hash` | `TEXT` | `scrypt$N$r$p$<salt hex>$<hash hex>`; NULL = cannot log in |
| `pin_len` | `INTEGER NOT NULL DEFAULT 4` | 4 or 6; Zod enforces, no trigger. **Uniform inside a venue**: `requirePinFree` refuses a PIN of a different length to the ones the venue's active accounts already use (409 `PIN_LEN_MIXED`), because the pad has to fire on a fixed number of taps and a six-digit PIN whose first four are somebody else's would sign that somebody else in on the fourth. `GET /api/auth/pin-len` is where the pad reads the one number. |
| `pin_set_at` | `TEXT` | |
| `pin_pepper_v` | `INTEGER NOT NULL DEFAULT 1` | which `PIN_PEPPER` the stored hash was made with; §5.3 rotates by re-hashing at next login |
| `password_hash` | `TEXT` | admins only |
| `email` | `TEXT` | lowercase, trimmed |
| `log_seen_at` | `TEXT` | Dnevnik badge |
| `created_at` | `TEXT NOT NULL DEFAULT ''` | backfilled by `UPDATE users SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE created_at = ''` |

`role` keeps its column and gains the migration statement `UPDATE users SET role = 'admin' WHERE role = 'owner';`. The Drizzle enum became `['admin','waiter','bartender']` in Korak 2 and `['admin','radnik']` in `0005_radnik.sql`, which remaps both floor values and `shift_members.role` with them. Index: `users_email_uq` = `CREATE UNIQUE INDEX users_email_uq ON users(email) WHERE email IS NOT NULL`.

**`categories`** — add `kind TEXT NOT NULL DEFAULT 'ostalo'` (`pice|hrana|nargila|ostalo`), `note_chips_json TEXT NOT NULL DEFAULT '[]'`, `active INTEGER NOT NULL DEFAULT 1`.

**`products`** — add `short_name TEXT`, `search_aliases TEXT NOT NULL DEFAULT ''`, `staff_drink_allowed INTEGER NOT NULL DEFAULT 0`, `shisha_grams_measured_at TEXT`, `created_at TEXT NOT NULL DEFAULT ''` (backfilled), `updated_at TEXT`. `kind` stays `simple|shisha` (`free_text` is Korak 3).

**`stock_items`** — `kind` enum gains `hrana`; add `category_id TEXT REFERENCES categories(id)`, `brand TEXT`, `avg_cost_mfen INTEGER NOT NULL DEFAULT 0`, `last_cost_mfen INTEGER NOT NULL DEFAULT 0`, `count_method TEXT NOT NULL DEFAULT 'count'` (`count|weigh`), `tare_g REAL`, `tolerance_qty REAL NOT NULL DEFAULT 0`, `par_qty REAL`, `available INTEGER NOT NULL DEFAULT 1`. Index `stock_items_category_idx (venue_id, category_id)`.

**Costs, honestly.** The dev seed gives all 19 items a *plausible placeholder* cost so tests and the laptop have non-zero variance, and `POST /api/admin/stock-items` requires `last_cost_mfen > 0` for a **new** item. Neither of those prices the **live** venue: the 19 rows already in the owner's database were seeded in Korak 1 with `avg_cost_mfen = 0`, and nothing in Korak 1 or Korak 2 would have changed them. A zero cost silently turns off `variance_fen`, `waste_events.cost_fen`, `stock_variance_fen`, *utrošak* and the `count_confirmed` alert. Three things close that hole, and all three are in Korak 2:

1. `POST /api/stock/opening` (§6.8) — the *Početno stanje* screen's route: the owner reads out 19 purchase prices once, and it writes one `opening` movement plus the cost per item.
2. `PATCH /api/admin/stock-items/:id { last_cost_mfen }` also seeds `avg_cost_mfen` when it is still 0 (a cost you correct before the first delivery is the cost you had all along).
3. The readers **fall back rather than silently zeroing**: `unitCost(item) = item.avg_cost_mfen || item.last_cost_mfen || 0`, and a row priced by the fallback (or by nothing) is flagged `estimated: true` all the way to the screen (§6.8). `confirmCount`'s 422 `PRICE_MISSING` then fires only on the genuinely unpriced item, and names it.

`schema.test.ts` asserts the seed leaves no `stock_items` row with `avg_cost_mfen = 0 AND last_cost_mfen = 0`.

**`tabs`** — add `shift_id TEXT REFERENCES shifts(id)`, `assigned_to TEXT REFERENCES users(id)`, `offered_to TEXT REFERENCES users(id)`, `late_sync INTEGER NOT NULL DEFAULT 0`, `unpaid_reason TEXT`, `unpaid_by TEXT`, `unpaid_approved_by TEXT`, `pending_review INTEGER NOT NULL DEFAULT 0`, `unpaid_client_id TEXT`, `fiscal_status TEXT NOT NULL DEFAULT 'none'`, `fiscal_ref TEXT`. `status` enum widens to `open|paid|unpaid|voided`. `table_id` **stays NOT NULL** (every tab sits on a table in v1). New indexes `tabs_shift_idx (venue_id, shift_id, status)`, `tabs_unpaid_client_uq UNIQUE(venue_id, unpaid_client_id) WHERE unpaid_client_id IS NOT NULL`, `tabs_assigned_idx (venue_id, assigned_to, status)`. The partial unique `(venue_id, table_id) WHERE status='open'` stays, so an `unpaid` tab frees the table exactly like a `paid` one.

`assigned_to` is **nullable in DDL and never NULL in fact**: the migration backfills `UPDATE tabs SET assigned_to = opened_by WHERE assigned_to IS NULL` and the `tabs_assigned_required` trigger refuses an insert without it (a `REFERENCES` column cannot be `ADD COLUMN … NOT NULL`, §2 migration rule 1). So **there is no `tabAssignee()` fallback helper** — every reader uses `tab.assigned_to` directly, and `resolveTab` sets it explicitly on every insert (§6.1 step 7). A fallback no row can reach is a branch no test can cover.

Three pieces of surface here are **reserved and never written in Korak 2**, and are marked as such in `schema.ts` comments so nobody hunts for the writer: `status = 'voided'` (two services throw `TAB_VOIDED` on it, nothing sets it — voiding a whole tab is Korak 3; today the last line's void empties it), `fiscal_status` / `fiscal_ref` (there is no fiscal device, CLAUDE.md), and `orders.source` (always `'app'`; `'import'` and `'scan'` are Korak 3). `tabs.offered_to` is **not** reserved — §6.2's handover writes it.

**`orders`** — add `shift_id TEXT REFERENCES shifts(id)`, `shift_seq INTEGER`, `device_id TEXT REFERENCES devices(id)`, `client_created_at TEXT`, `client_created_at_adj TEXT`, `sync_lag_s INTEGER NOT NULL DEFAULT 0`, `late_sync INTEGER NOT NULL DEFAULT 0`, `post_settle INTEGER NOT NULL DEFAULT 0`, `source TEXT NOT NULL DEFAULT 'app'`. Indexes `orders_shift_seq_uq UNIQUE(venue_id, shift_id, shift_seq)`, `orders_shift_locker_idx (venue_id, shift_id, locked_by)`.

**`order_lines`** — add `comp_reason TEXT` (`staff_drink|owner_guest|complaint|promo`), `authorised_by TEXT REFERENCES users(id)`, `parent_line_id TEXT REFERENCES order_lines(id)` (*Dodatni žar* points at its bowl). `product_id` stays NOT NULL. `flavours_json` stands — a JSON array of stock-item ids on the line, read with `json_each` by the nargila report; there is no `order_line_flavours` table (accepted simplification, PLAN §6).

**`stock_movements`** — `type` enum becomes `opening|delivery|sale|sale_storno|late_sync|waste|count_adjust|correction|return_supplier`; add `unit_cost_mfen INTEGER NOT NULL DEFAULT 0`, `shift_id TEXT REFERENCES shifts(id)`. `user_id` stays nullable (the seed's `opening` rows have none). New index `stock_movements_shift_idx (venue_id, shift_id)`. No `location_id` in v1.

### 3.2 New tables

**`devices`** — `id`, `venue_id`, `label TEXT NOT NULL`, `token_hash TEXT NOT NULL` (sha256 hex of a 32-byte random token; the raw token exists only in the `sank_d` cookie), `mode TEXT NOT NULL` (`personal|shared`), `bound_user_id TEXT REFERENCES users(id)`, `enrolled_at TEXT NOT NULL`, `enrolled_by TEXT`, `revoked_at TEXT`, `revoked_by TEXT`, `locked_at TEXT`, `last_seen_at TEXT`, `app_version TEXT`, `standalone INTEGER`, `pending_count INTEGER NOT NULL DEFAULT 0`, `oldest_pending_at TEXT`, `clock_skew_s INTEGER NOT NULL DEFAULT 0`. Indexes `devices_token_uq UNIQUE(token_hash)` (a bare token is looked up before we know the venue), `devices_venue_idx (venue_id, revoked_at)`, `devices_bound_idx (venue_id, bound_user_id)`.

**`enrol_codes`** — `id`, `venue_id`, `code TEXT NOT NULL` (6 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`), `mode TEXT NOT NULL`, `bound_user_id TEXT`, `label TEXT NOT NULL`, `created_by TEXT NOT NULL`, `created_at TEXT NOT NULL`, `expires_at TEXT NOT NULL` (+10 min), `uses_left INTEGER NOT NULL DEFAULT 2`. `enrol_codes_code_uq UNIQUE(code)`, `enrol_codes_venue_idx (venue_id, expires_at)`.

**`sessions`** — `id` (uuid), `venue_id`, `user_id TEXT NOT NULL`, `device_id TEXT` (NULL for admin email sessions), `token_hash TEXT NOT NULL`, `kind TEXT NOT NULL` (`admin|staff`), `borrowed INTEGER NOT NULL DEFAULT 0`, `created_at`, `last_seen_at`, `expires_at TEXT NOT NULL`, `revoked_at TEXT`, `ip TEXT`, `user_agent TEXT`. `sessions_token_uq UNIQUE(token_hash)`, `sessions_user_idx (venue_id, user_id, expires_at)`, `sessions_device_idx (device_id)`. Not a ledger: the nightly task deletes rows with `expires_at < now − 30 d`.

**`auth_attempts`** — append-only lockout evidence. `id`, `venue_id`, `device_id TEXT`, `user_id TEXT`, `ip TEXT NOT NULL`, `kind TEXT NOT NULL` (`pin|password|enrol|approve|reset`), `ok INTEGER NOT NULL`, `created_at`. Index `(venue_id, device_id, user_id, created_at)`.

**`shifts`** — `id`, `venue_id`, `business_date TEXT NOT NULL` (`YYYY-MM-DD`), `opened_at NOT NULL`, `opened_by NOT NULL`, `auto_opened INTEGER NOT NULL DEFAULT 0`, `stock_custodian_id TEXT`, `status TEXT NOT NULL DEFAULT 'open'` (`open|closing|closed|reviewed`), `closing_started_at`, `closing_started_by`, `closed_at`, `closed_by`, `closed_kind TEXT` (`normal|forced`), `opening_float_override_fen INTEGER`, `cash_counted_fen INTEGER`, `card_total_fen INTEGER`, `closing_note TEXT`, `reviewed_by`, `reviewed_at`, `created_at NOT NULL`. Indexes `shifts_one_open_uq UNIQUE(venue_id) WHERE status IN ('open','closing')`, `shifts_venue_date_idx (venue_id, business_date, opened_at)`.

**`shift_members`** — `id`, `venue_id`, `shift_id NOT NULL`, `user_id NOT NULL`, `role TEXT NOT NULL` (snapshot), `joined_at NOT NULL`, `left_at`, `left_at_source TEXT` (`manual|auto`). `shift_members_uq UNIQUE(venue_id, shift_id, user_id)` — `joinShift` is `INSERT … ON CONFLICT DO NOTHING`.

**`cash_movements`** — `id`, `venue_id`, `shift_id NOT NULL`, `type TEXT NOT NULL` (`float_in|float_out|payout|owner_pickup|refund`), `amount_fen INTEGER NOT NULL` (always > 0; the type carries the sign), `user_id NOT NULL` (whose money it is: the waiter receiving a `float_out`, the requester of a `payout`), `created_by NOT NULL` (who wrote the row), `reason TEXT`, `note TEXT`, `status TEXT NOT NULL` (`pending|approved|rejected`), `decided_by`, `decided_at`, `ref_type TEXT`, `ref_id TEXT`, `created_at NOT NULL`. Index `(venue_id, shift_id, type, status)`. `float_in`, `owner_pickup` and `refund` are born `approved`; `payout` **and `float_out`** are born `pending` (a cash obligation needs the receiver's acknowledgement — see §6.5).

**`waiter_settlements`** — `id`, `venue_id`, `shift_id NOT NULL`, `user_id NOT NULL`, `declared_fen INTEGER NOT NULL`, `expected_at_declare_fen INTEGER NOT NULL`, `breakdown_json TEXT NOT NULL`, `summary_json TEXT NOT NULL`, `accepted_by`, `accepted_at`, `self_sealed INTEGER NOT NULL DEFAULT 0`, `unsent_reported_json TEXT NOT NULL DEFAULT '{}'` (what the phone claimed at settle: `outbox_len` and each device's `pending_count` — evidence if it later contradicts itself), `device_id TEXT`, `late INTEGER NOT NULL DEFAULT 0`, `created_at NOT NULL`. `waiter_settlements_uq UNIQUE(venue_id, shift_id, user_id)` — one per person per shift; a correction is Korak 3.

**`shift_summaries`** — `shift_id NOT NULL`, `venue_id NOT NULL`, `version INTEGER NOT NULL`, `reason TEXT NOT NULL` (`close|decision|late`), `promet_fen`, `cash_fen`, `card_fen`, `comp_fen`, `void_count`, `void_fen`, `self_void_count`, `self_void_fen`, `unpaid_fen`, `expected_cash_fen`, `outstanding_fen`, `counted_cash_fen`, `diff_fen`, `stock_variance_fen`, `waste_fen`, `bowls INTEGER`, `tobacco_g REAL`, `coals INTEGER`, `by_category_json TEXT NOT NULL`, `by_user_json TEXT NOT NULL`, `computed_at NOT NULL`; `PRIMARY KEY (shift_id, version)`. Purely numeric JSON — names are joined at read.

**`payments`** — append-only. `id`, `venue_id`, `tab_id NOT NULL`, `shift_id TEXT`, `client_id TEXT NOT NULL`, `method TEXT NOT NULL` (`cash|card`), `amount_fen INTEGER NOT NULL` (negative only on a reversal), `received_fen INTEGER`, `tip_fen INTEGER NOT NULL DEFAULT 0`, `covers_json TEXT NOT NULL DEFAULT '[]'` (order `client_id`s as sent), `paid_by NOT NULL`, `approved_by TEXT` (required on a negative row), `device_id TEXT`, `reverses_id TEXT`, `adjustment_id TEXT`, `post_settle INTEGER NOT NULL DEFAULT 0` (the payer had already settled this shift — §6.3), `client_created_at`, `client_created_at_adj`, `created_at NOT NULL`. Indexes `payments_client_uq UNIQUE(venue_id, client_id)`, `payments_tab_idx (venue_id, tab_id)`, `payments_shift_user_idx (venue_id, shift_id, paid_by, method)`.

**`line_adjustments`** — one transition. `id`, `venue_id`, `order_line_id NOT NULL`, `tab_id NOT NULL` (denormalised so tab money is one query), `client_id TEXT NOT NULL`, `kind TEXT NOT NULL` (`void|comp`), `reason TEXT NOT NULL`, `note TEXT`, `qty REAL NOT NULL`, `amount_fen INTEGER NOT NULL`, `restock INTEGER NOT NULL`, `requested_by NOT NULL`, `device_id TEXT`, `seconds_since_lock INTEGER NOT NULL`, `was_paid INTEGER NOT NULL`, `status TEXT NOT NULL` (`pending|applied|rejected`), `auto INTEGER NOT NULL DEFAULT 0`, `approved_by TEXT`, `decided_on_device_id TEXT`, `foreign_device INTEGER NOT NULL DEFAULT 0`, `decided_at TEXT`, `decided_in_shift_id TEXT`, `refund_kind TEXT NOT NULL DEFAULT 'none'` (`none|from_waiter|from_drawer`), `created_at NOT NULL`. Indexes `line_adjustments_client_uq UNIQUE(venue_id, client_id)`, `line_adjustments_line_uq UNIQUE(venue_id, order_line_id) WHERE status IN ('pending','applied')` (whole-line voids in v1), `(venue_id, tab_id, status)`, `(venue_id, requested_by, created_at)`, `line_adjustments_pending_idx (venue_id, created_at) WHERE status = 'pending'`.

**`deliveries`** — `id`, `venue_id`, `client_id TEXT NOT NULL`, `supplier_name TEXT NOT NULL`, `invoice_no TEXT`, `delivered_at TEXT NOT NULL`, `total_fen INTEGER NOT NULL DEFAULT 0`, `status TEXT NOT NULL DEFAULT 'posted'` (`draft|posted`; `draft` exists for the Korak 3 scan flow and is never written in Korak 2), `source TEXT NOT NULL DEFAULT 'manual'`, `scan_id TEXT`, `note TEXT`, `entered_by NOT NULL`, `posted_by`, `posted_at`, `reversed_at`, `reversed_by`, `reversal_note TEXT`, `created_at NOT NULL`. Indexes `deliveries_client_uq UNIQUE(venue_id, client_id)`, `(venue_id, delivered_at)`, `(venue_id, status)`. The `client_id` is not ceremony: `bartender_can_receive_goods` is seeded `true` in dev and §5.7 keeps `POST /api/stock/deliveries` working for the bartender, which means a phone on café wifi. Without a replay key, one retried post books 12 crates twice and silently doubles the moving average's numerator. It takes the standard replay-first statement inside the transaction, like `orders` and `payments`.

**`delivery_lines`** — `id`, `venue_id`, `delivery_id NOT NULL`, `stock_item_id NOT NULL`, `pack_qty_used REAL`, `packs REAL NOT NULL DEFAULT 0`, `loose REAL NOT NULL DEFAULT 0`, `qty REAL NOT NULL` (server-computed `packs × pack_qty_used + loose`), `line_cost_fen INTEGER NOT NULL` (the exact invoice amount), `unit_cost_mfen INTEGER NOT NULL` (`round(line_cost_fen × 1000 / qty)`), `note TEXT`. Index `(venue_id, delivery_id)`.

**`waste_events`** — `id`, `venue_id`, `stock_item_id NOT NULL`, `client_id TEXT NOT NULL`, `qty REAL NOT NULL`, `reason TEXT NOT NULL` (`razbijeno|isteklo|prosuto|degustacija|ostalo`), `note TEXT`, `cost_fen INTEGER NOT NULL`, `shift_id TEXT`, `user_id NOT NULL`, `needs_approval INTEGER NOT NULL DEFAULT 0`, `approved_by`, `approved_at`, `created_at NOT NULL`. `UNIQUE(venue_id, client_id)`, indexes `(venue_id, shift_id)`, `(venue_id, created_at)`.

**`stock_counts`** — `id`, `venue_id`, `kind TEXT NOT NULL` (`spot|full`), `phase TEXT NOT NULL` (`open|close|adhoc`), `shift_id TEXT`, `status TEXT NOT NULL DEFAULT 'submitted'` (`submitted|confirmed`), `counted_by NOT NULL`, `witnessed_by TEXT`, `witnessed_at TEXT` (columns reserved; no route in Korak 2), `confirmed_by`, `confirmed_at`, `override_by TEXT`, `submitted_at TEXT NOT NULL`, `note TEXT`. Indexes `stock_counts_shift_phase_uq UNIQUE(venue_id, shift_id, phase) WHERE phase IN ('open','close')` — a shift has at most one opening and one closing count, and a second submit is 409 `COUNT_EXISTS` rather than two rows racing to be "the" opening count; `(venue_id, shift_id, phase)`, `(venue_id, status, submitted_at)`. `phase='adhoc'` is deliberately outside the unique index: a spot count can happen five times a night.

**`stock_count_lines`** — append-only, born at submit. `id`, `venue_id`, `count_id NOT NULL`, `stock_item_id NOT NULL`, `counted_packs REAL`, `counted_loose REAL`, `weighed_g REAL`, `counted_qty REAL NOT NULL`, `theoretical_qty REAL NOT NULL` (snapshot at `submitted_at`), `variance_qty REAL NOT NULL`, `unit_cost_mfen INTEGER NOT NULL`, `variance_fen INTEGER NOT NULL`, `applied_adjust REAL`, `note TEXT`. `UNIQUE(venue_id, count_id, stock_item_id)`, index `(venue_id, stock_item_id, count_id)`. `applied_adjust` is the one column a confirm may set (trigger below).

**`log_entries`** — the Dnevnik. `id`, `venue_id`, `kind TEXT NOT NULL`, `title_bs TEXT NOT NULL`, `body_json TEXT NOT NULL`, `ref_type TEXT`, `ref_id TEXT`, `actor_id TEXT` (NULL = *Sistem*), `device_id TEXT`, `shift_id TEXT`, `business_date TEXT NOT NULL`, `resolves_id TEXT`, `created_at NOT NULL`, `redacted_at TEXT`. Indexes `(venue_id, created_at, id)`, `(venue_id, kind, created_at)`, `(venue_id, actor_id, created_at)`, `(venue_id, ref_type, ref_id)`, `(venue_id, shift_id)`, `(venue_id, resolves_id)`.

**`alert_events`** — `id`, `venue_id`, `rule_key TEXT NOT NULL`, `ref_type TEXT NOT NULL`, `ref_id TEXT NOT NULL`, `payload_json TEXT NOT NULL`, `created_at NOT NULL`, `send_after TEXT NOT NULL`, `sent_at TEXT`, `attempts INTEGER NOT NULL DEFAULT 0`, `last_error TEXT`. `UNIQUE(venue_id, rule_key, ref_type, ref_id)` — the dedupe key; `alert_events_unsent_idx (venue_id, sent_at, send_after)`. Since §9 lost its sender, `sent_at`, `attempts` and `last_error` are unwritten leftovers kept only to avoid a table rebuild.

**`price_history`** — `id`, `venue_id`, `product_id NOT NULL`, `price_fen INTEGER NOT NULL`, `valid_from NOT NULL`, `valid_to TEXT`, `changed_by TEXT`. `price_history_open_uq UNIQUE(venue_id, product_id) WHERE valid_to IS NULL`, index `(venue_id, product_id, valid_from)`. The seed inserts one open row per product.

**`changes`** — the sync cursor, deliberately **not** a ledger. `seq INTEGER PRIMARY KEY AUTOINCREMENT`, `venue_id NOT NULL`, `entity TEXT NOT NULL`, `entity_id TEXT`, `created_at NOT NULL`. Index `(venue_id, seq)`. No triggers; the nightly task runs a plain `DELETE FROM changes WHERE created_at < ?`. `triggers.sql` carries a comment naming `changes`, `sessions` and `enrol_codes` as the tables that are cursors, not history.

**`task_runs`** — `id`, `venue_id`, `task TEXT NOT NULL`, `business_date TEXT NOT NULL`, `ran_at NOT NULL`, `ok INTEGER NOT NULL`, `error TEXT`. `UNIQUE(venue_id, task, business_date)` — how an hourly task does a once-a-day job exactly once.

### 3.3 Global unique indexes

`shared/constants.ts`:

```ts
export const GLOBAL_UNIQUE_INDEXES = [
  'venues_slug_uq',        // one slug per installation
  'users_email_uq',        // an email identifies a person before a venue is known
  'enrol_codes_code_uq',   // the phone has no venue yet
  'devices_token_uq',      // a bare cookie token is looked up before the venue
  'sessions_token_uq',     // same
] as const
```

`schema.test.ts` asserts: every table except `venues`, `changes`, `task_runs`, `__drizzle_migrations` and `sqlite_sequence` has a `venue_id` column; and every unique index **that the schema declares** and whose first column is not `venue_id` is in that list.

"That the schema declares" is load-bearing. `PRAGMA index_list(<table>)` returns three origins — `c` (a `CREATE INDEX` we wrote), `u` (a `UNIQUE` column constraint) and `pk` (the index SQLite makes for a primary key). Every table here has `id TEXT PRIMARY KEY`, so every table also has a `sqlite_autoindex_<table>_1` with `unique: 1, origin: 'pk'`, and `shift_summaries`' composite `PRIMARY KEY (shift_id, version)` adds another. A test that does not filter would fail on essentially every table on the first run. So:

```ts
const declared = indexList(db, table).filter(i => i.unique === 1 && i.origin === 'c')
```

Primary keys are checked separately and trivially: every `PRIMARY KEY` is either `id` or, for `shift_summaries`, `(shift_id, version)` — both scoped by a `venue_id` column that the first assertion already requires.

### 3.4 triggers.sql — the complete Korak 2 rule set

Existing (unchanged): `order_lines_no_update/no_delete`, `stock_movements_no_update/no_delete`, `orders_no_delete`, `tabs_no_delete`.

**`orders_update_guard`** (rewritten): all columns `OLD.x IS NEW.x` except the one allowed transition `prepared_at`/`prepared_by` NULL → NOT NULL, once. The new columns (`shift_id`, `shift_seq`, `device_id`, `client_created_at`, `client_created_at_adj`, `sync_lag_s`, `late_sync`, `post_settle`, `source`) are all in the frozen list.

**`orders_shift_required`** `BEFORE INSERT ON orders WHEN NEW.shift_id IS NULL OR NEW.shift_seq IS NULL → RAISE(ABORT,'orders: shift_id and shift_seq required')` — this is how a column that cannot be declared NOT NULL becomes NOT NULL. Same shape for `payments_shift_required` and `tabs_assigned_required` (`NEW.assigned_to IS NULL`).

**These three triggers only work because WP0 makes the writer real in the same PR.** A trigger that demands `shift_id` on every `orders` insert bricks the Korak 1 `createOrder` that WP0's own done-when must keep green — WP3 rewrites that service, but WP3 merges later. So WP0 does not ship the trigger and leave the code broken, and it does not ship the code and leave the trigger for WP3 to add to a file WP0 owns. WP0 ships **both**: the three triggers *and* the four-line change to the existing `createOrder`/`resolveTab` that satisfies them (`ensureOpenShift` → `shift_id`, `nextShiftSeq` → `shift_seq`, `assigned_to = actor.userId` on the tab insert), against the real minimal `ensureOpenShift` and `insertMovement` in `contracts.ts`. §12 lists that change in WP0's contents; WP3 then rewrites the file it inherits.

**`tabs_frozen_cols`** — `id, venue_id, client_id, opened_by, opened_at, shift_id` may never change.
**`tabs_status_guard`** — allowed:
- `open → open` (move to another table, reassign, `pending_review` flip) with `closed_at IS NULL`;
- `open → paid|unpaid|voided` with `closed_at`/`closed_by` NULL → set;
- `unpaid → paid` (collected later) with `table_id`, `closed_at`, `closed_by`, `unpaid_by`, `unpaid_reason` unchanged;
- `status` unchanged on a closed tab, changing only `pending_review`, `unpaid_approved_by`, `fiscal_*`.
Everything else `RAISE(ABORT,'tabs: illegal transition')`. No branch has `OLD.status='paid' AND NEW.status<>'paid'`: **a paid tab never reopens**, and the Korak 1 test that proves it keeps passing unchanged.

**`payments_no_update` / `payments_no_delete`** — append-only.
**`payments_reversal_needs_approver`** `BEFORE INSERT WHEN NEW.amount_fen < 0 AND NEW.approved_by IS NULL → RAISE(ABORT,'payments: a reversal needs approved_by')`.

**`line_adjustments_update_guard`** — only `pending → applied|rejected`, once, with `decided_at` and `approved_by` NOT NULL; the columns that may move alongside the status are `approved_by, decided_on_device_id, foreign_device, decided_at, decided_in_shift_id, restock, refund_kind`; every other column `OLD.x IS NEW.x`. `line_adjustments_no_delete`.

**`shifts_frozen_cols`** — `id, venue_id, business_date, opened_at, opened_by, auto_opened, created_at`.
**`shifts_status_guard`** — `open → open|closing|closed`, `closing → open|closing|closed`, `closed → closed|reviewed` (review sets `reviewed_by`/`reviewed_at` NULL → value and may set `closing_note`, `card_total_fen`), `reviewed → reviewed` (only `closing_note`). A closed shift can never go back to `open`. `shifts_no_delete`.

**`shift_members_update_guard`** — only `left_at`/`left_at_source` NULL → set, once. `shift_members_no_delete`.
**`cash_movements_update_guard`** — only `status pending → approved|rejected` with `decided_by`/`decided_at` NULL → set. `cash_movements_no_delete`.
**`waiter_settlements_update_guard`** — only `accepted_by`/`accepted_at` NULL → set, once. `waiter_settlements_no_delete`.
**`shift_summaries_no_update` / `_no_delete`** — append-only.

**`stock_counts_update_guard`** — only `submitted → confirmed`, once, setting `confirmed_by`, `confirmed_at`, and optionally `override_by`, `note`, `witnessed_by`, `witnessed_at`. `stock_counts_no_delete`.
**`stock_count_lines_update_guard`** — only `applied_adjust` NULL → value, once (written by the confirm); every other column frozen. `stock_count_lines_no_delete`.

**`deliveries_update_guard`** — `draft → posted` (sets `posted_by`, `posted_at`), or `posted` + `reversed_at IS NULL → reversed_at/reversed_by NOT NULL` (the one reversal), nothing else. `deliveries_no_delete`.
**`delivery_lines_no_update` / `_no_delete`** — append-only (simpler and safer than a cross-table sub-select on the header).

**`waste_events_update_guard`** — only `approved_by`/`approved_at` NULL → set, once. `waste_events_no_delete`.
**`log_entries_no_delete`**; **`log_entries_update_guard`** — only a redaction: `redacted_at` NULL → value together with new `title_bs`/`body_json`; every other column frozen.
**`alert_events_update_guard`** — only `sent_at` (NULL → value), `attempts`, `last_error`, `send_after` may change. `alert_events_no_delete`.
**`price_history_update_guard`** — only `valid_to` NULL → value. `price_history_no_delete`.
**`auth_attempts_no_update` / `_no_delete`** — append-only.

No triggers on `changes`, `sessions`, `enrol_codes`, `devices`, `task_runs`, `recipe_lines`, catalogue tables — a comment at the top of that block says why (cursors and mutable configuration; the ledgers they point at are the history).

### 3.5 `settings_json` defaults

`shared/settings.ts` exports `DEFAULT_SETTINGS` and a Zod schema whose keys are all optional; `getSettings(q, venueId)` returns `{ ...DEFAULT_SETTINGS, ...JSON.parse(settings_json) }`. No service parses `settings_json` itself. An unknown key in a PATCH is a 400.

```ts
export const DEFAULT_SETTINGS = {
  timezone: 'Europe/Sarajevo', business_day_start_hour: 6,
  closing_time: '03:00', early_close_min: 60,
  void_self_window_s: 300, self_void_max_per_shift: 5, self_void_max_fen: 3000,
  bartender_approve_window_s: 900,
  staff_drinks_per_shift: 2, staff_drink_max_fen: 300,
  cash_tolerance_fen: 500, cash_tolerance_pct: 1,
  variance_alert_fen: 1000,
  waste_pin_threshold_fen: 1000, waste_shift_fen: 2000, waste_events_per_shift_per_user: 3,
  comp_large_fen: 2000, comp_shift_fen: 5000, void_bartender_shift_fen: 3000,
  payout_owner_fen: 5000,
  payment_methods: ['cash'] as ('cash'|'card')[],
  cash_custody: 'per_waiter', track_cash_tips: false,
  approver_roles: ['admin', 'radnik'] as Role[],
  payout_approver_roles: ['admin'] as Role[],
  allow_cross_waiter_rounds: true,
  bartender_can_receive_goods: false,
  show_venue_totals_to_staff: false,
  shared_device_idle_s: 300, heartbeat_fresh_s: 600,
  clock_skew_alert_s: 300, max_sync_lag_h: 12,
  grams_per_bowl_default: 20, gpb_band_pct: 15, coals_per_bowl_alert: 5,
}
```

The dev seed writes `{"bartender_can_receive_goods": true}` so the existing `/sanker` delivery screen keeps working; production keeps the default `false`.

---

## 4. Sync

One Node process, no Redis, no queues, no WebSockets. Polling in v1 with two mechanisms: a venue-wide monotonic sequence, and an ETag that lets an unchanged poll cost one indexed `MAX(seq)`.

### 4.1 The change feed

`server/services/changes.ts`:

```ts
export type ChangeEntity =
  | 'table' | 'prep' | 'stock' | 'count' | 'shift' | 'adjustment'
  | 'menu' | 'settings' | 'user' | 'device' | 'log'

export function bump(tx: Tx, venueId: string, entity: ChangeEntity, entityId?: string): number
export function maxSeq(db: Queryable, venueId: string): number
export function getChanges(db: Queryable, venueId: string, actor: Actor, since: number): ChangesResult
```

`bump` inserts one `changes` row and returns its `seq`. It is called **inside** every mutating transaction, after the business rows. A mutating transaction without a `bump` is a bug, and `tests/unit/changes-coverage.test.ts` proves it: one fixture call per non-GET route (except `/api/auth/*` and the heartbeat) asserting `maxSeq` grew.

`getChanges` is deliberately small:

```sql
SELECT entity, MAX(seq) AS seq FROM changes
WHERE venue_id = ? AND seq > ? GROUP BY entity;
```

If `since = 0`, or `since` is below `MIN(seq)` for the venue (the prune has passed it), the answer is `full: true` and every snapshot. Otherwise the set of entities present decides what is attached:

| entity | attached |
|---|---|
| `table` | `tables_state` (the full `GET /api/tables/state` payload) |
| `prep` | `prep` |
| `stock` | `stock` (the whole array — 19 items; there is no partial mode) |
| `count` | `counts: [{ id, status, phase }]` |
| `shift` | `shift: ShiftBrief` — the same object `/api/tables/state` returns (§6.2), so the two never disagree |
| `adjustment` | `pending: { adjustments, unpaid, payouts, settlements }` — admins and bartenders only |
| `menu` \| `settings` | `menu_version` (= `MAX(seq)` over those two entities) — the client refetches `/api/bootstrap` |
| `log` | `log_max_at` — admins only |
| `user` \| `device` | `me` (a session refresh) |

The shape, in `shared/types/sync.ts` (WP5's fragment) — the snapshot fields are the payloads named in the table above, each present only when its entity moved:

```ts
export interface ChangesResult {
  seq: number                       // the largest seq in this answer; the client's next cursor
  full: boolean                     // since = 0, or the cursor fell behind the prune
  changes: { entity: ChangeEntity, seq: number }[]
  tables_state?: TablesStateResponse       // §6.2
  prep?: { seq: number, open: PrepOrder[], done: PrepOrder[] }
  stock?: StockItemView[]
  counts?: { id: string, status: string, phase: string }[]
  shift?: ShiftBrief | null                // §6.2 — the same object /api/tables/state returns
  pending?: { adjustments: number, unpaid: number, payouts: number, settlements: number }
  menu_version?: number
  log_max_at?: string
  me?: MeContext
}
```

Response: `{ seq, full, changes: [{ entity, seq }], …snapshots }`. The rows are keys, never data: every payload is re-read from the ledgers inside the same request, so a stale phone can never apply an old snapshot over a newer one — it only ever advances the largest `seq` it has seen.

`server/utils/bus.ts` exports `bus = new EventEmitter()`; services call `bus.emit(venueId, { seq, entity })` **after** `db.transaction()` returns (never inside — the rows are not committed yet). In Korak 2 the only listener is the alert drainer; a Phase 5 SSE endpoint plugs in here and touches no business logic.

### 4.2 ETag

`server/utils/etag.ts`:

```ts
export function withEtag<T>(event: H3Event, tag: string, produce: () => T): T | undefined
```

Sets `ETag: W/"<tag>"`; when `If-None-Match` matches it sets 304 and returns `undefined` (no body, no further DB read).

**The tag must depend on everything the body depends on.** The default tag is therefore the **role-and-user** one, and a route opts out only if its body provably varies by neither:

```ts
const tag = `${maxSeq(db, venueId)}-${actor.role}-${actor.userId.slice(0, 8)}`
```

`/api/changes`, `/api/bootstrap`, `/api/owner/live` **and `/api/tables/state`** all use it — the last one because `TableState.assigned_to_initials` drives a colleague's tile differently from your own and `shift.my_settled` / `shift.my_open_tabs` are literally the actor's numbers. `/api/owner/live` appends `-${Math.floor(Date.now() / 60_000)}` because table ages and stale-device badges move with the clock even when nothing is written.

`server/middleware/tenant.ts` sets, on every `/api/` response, **`Cache-Control: private, no-cache`** and `Vary: Cookie`. The flag matters: `no-store` forbids the browser from keeping the response at all, which means it has no validator to put in `If-None-Match` and the whole 304 path above is dead code. `no-cache` means "store it, but never serve it without revalidating" — exactly what an ETag needs, and equally private. `deploy/nginx.conf` adds `proxy_no_cache 1; proxy_cache_bypass 1;` under `location /api/` so no *shared* cache holds a copy, and the service worker is **network-only** for `/api/` — an offline outbox replays writes; it must never serve a cached read. Together those keep a shared bar tablet (Emir, then Haris, then Amar in one browser profile) from showing one person's numbers to the next: the private store is per-browser, and every read revalidates with the new person's cookie, whose tag differs by `actor.userId`.

Tagged routes: `/api/changes`, `/api/bootstrap`, `/api/tables/state`, `/api/prep`, `/api/stock`, `/api/owner/live`, `/api/owner/shift/:id`, `/api/owner/stock`, `/api/owner/log` (tag = `max_at`).

### 4.3 Heartbeat

`POST /api/devices/heartbeat` every 60 s while visible and after every successful flush. `services/devices.ts`:

```ts
export function heartbeat(db: Db, venueId: string, deviceId: string, body: HeartbeatBody, at = nowIso()): HeartbeatResult
```

One transaction: `UPDATE devices SET pending_count, oldest_pending_at, last_seen_at = at, app_version, standalone, clock_skew_s = clamp(round((at − body.client_now)/1000), −3600, 3600)`. When `|clock_skew_s| > settings.clock_skew_alert_s`, `queueAlert(tx, 'clock_skew', { type:'device', id: deviceId + ':' + businessDate })` and `log(tx, { kind:'clock_skew' })` — the unique key makes it once per device per business date. **The heartbeat never bumps `changes`** (it would invalidate every waiter's ETag every 60 s). Returns `{ server_now, clock_skew_s, seq, shift_closing, revoked: false }`.

`pending_count` is a number the policed device reports about itself, so it is treated as a hint and as evidence (recorded in `waiter_settlements.unsent_reported_json`), never as the only control — see the post-settlement rule in §6.4.

### 4.4 What each client polls

| Client | Every | Call |
|---|---|---|
| `/konobar` waiter | 15 s while visible, on open, on `visibilitychange` | `GET /api/changes?since=<seq>` — one call; `tables_state`, `shift` and `menu_version` arrive inside it |
| `/sanker` bartender | 15 s | the same call; uses `prep`, `pending`, `stock` |
| any device | 60 s | `POST /api/devices/heartbeat` (its own timer, no ETag) |
| `/admin` Puls | 15 s | `GET /api/owner/live` with `If-None-Match`; when `log_max_at` moves past the cursor, one `GET /api/owner/log?after=` |
| `/admin` other pages | on open | their own read route, ETagged |

There is no second timer anywhere. `GET /api/bootstrap` is fetched once at boot and again only when `menu_version` moves.

---

## 5. Auth and tenant

### 5.1 Flows

**Admin, laptop (`/admin`).** `POST /api/auth/admin/login { email, password }` → **`verifyMetered(kind: 'password')`** → `sessions(kind='admin', device_id NULL, expires_at = now + 30 d)` → `Set-Cookie sank_s`. Sliding: extended to `now + 30 d` at most once per 24 h. A wrong email and a wrong password both answer 401 `INVALID_CREDENTIALS` after a constant-time dummy verify — but both also leave a committed `auth_attempts` row, and five of them lock the pair for 60 s. An email+password login is the one door with no device cookie in front of it, so it is the one that must count its failures.

**Device enrolment.** An admin mints a code in `/admin` (`POST /api/admin/enrol-codes`); the phone posts it to `POST /api/devices/enrol { code, label?, app_version? }` → **`verifyMetered(kind: 'enrol')`** → `uses_left − 1` → a `devices` row (mode, `bound_user_id` and label come from the code) → `Set-Cookie sank_d` (365 d). The response carries the venue and the list of active staff so the lock screen has names before any session exists. A 6-character code from a 32-letter alphabet is 10⁹ candidates, which is plenty — but only while somebody is counting the guesses, and `uses_left` counts successes, not failures.

**A path with no `auth_attempts` row is a path with no lockout.** That is why all three doors go through one verifier below, and why `auth.test.ts` asserts a committed row for each of them.

**Staff PIN.** `POST /api/auth/pin { user_id, pin, borrow? }` with a valid `sank_d`:
1. lockout state for `(device_id, user_id)`;
2. the user is active and in the device's venue and has a `pin_hash`;
3. **admin PIN rule**: an `admin` may PIN-login only on a device whose `bound_user_id` is himself (403 `ADMIN_DEVICE_ONLY`) — a PIN typed on a waiter's phone is captured once and approves everything afterwards. The dev device is exempt;
4. personal device: the bound user gets a 14 h session; another person needs `borrow: true` (403 `NOT_YOUR_DEVICE`) and gets `borrowed = 1`, 2 h;
5. shared device: any staff, 14 h, `borrow` ignored;
6. verify → session → `Set-Cookie sank_s`.

**Logout.** `POST /api/auth/logout` revokes the session (`sessions.revoked_at`) and clears `sank_s` only — the device stays enrolled. **It does not touch `shift_members`.** On the shared bar tablet, *Promijeni korisnika* (S10) is a logout, and it happens a dozen times a night: ending Emir's `shift_members` row every time he hands the tablet to Haris would end his *Moji sati* at 21:40, and `shift_members_update_guard` allows `left_at` to be set exactly once, so rejoining could never undo it. Leaving a shift is its own deliberate act — `POST /api/shifts/:id/leave`, or the `left_at_source='auto'` sweep inside `closeShift`.

### 5.2 Metered secret verification — the one rule that makes lockout real

A failed attempt written inside the transaction that throws is rolled back, so the lockout would count nothing and a 4-digit PIN would fall in hours. Therefore **one exported verifier for all three secrets**, and it owns its own transactions:

```ts
// server/services/auth.ts — note the Db, not Tx: this cannot be called inside another transaction
export type AttemptKind = 'pin' | 'password' | 'enrol' | 'approve'

export function verifyMetered(db: Db, venueId: string | null, args: {
  kind: AttemptKind,
  /** What the failures are counted against — see the table below. */
  subject: { deviceId: string | null, userId: string | null, ip: string, handle?: string },
  /** The stored hash, or null when the subject does not exist (dummy verify, same timing). */
  stored: string | null,
  /** Whose salt the hash is bound to: `users.id`, or the enrol code's own id. */
  saltId: string,
  plain: string,
  now?: string,
}): void   // returns on success; throws 401 { fails_left } / 423 LOCKED { retry_after_s }

/** The pin-shaped call every service already makes. Thin wrapper, same rules. */
export function verifyPinMetered(
  db: Db, venueId: string, userId: string, deviceId: string | null,
  pin: string, ctx: { ip: string, kind: 'pin' | 'approve', now?: string },
): void
```

Order inside it: `lockoutState()` (one indexed SELECT) → refuse early if locked → scrypt compare (always, even when `stored` is null, against a fixed dummy hash, so an unknown email and a wrong password take the same time) → `db.transaction(tx => recordAttempt(tx, …ok))` → on the 10th consecutive failure `log('lockout')`, on the 15th `UPDATE devices SET locked_at` (only when there **is** a device) → then throw. `auth.ts` exports no raw comparison, and no route calls `verifySecret` directly.

| kind | counted against | thrown on failure | 15th failure |
|---|---|---|---|
| `pin`, `approve` | `(device_id, user_id)` | 401 `INVALID_PIN { fails_left }` | `devices.locked_at` |
| `password` | `(ip, handle = lowercased email)` — there is no device and the user may not exist | 401 `INVALID_CREDENTIALS` (never `fails_left`: it would confirm the email) | nothing to lock; the 423 stands on `(ip, handle)` |
| `enrol` | `(ip, handle = the submitted code)` | 400 `ENROL_CODE_INVALID` | — |

`lockoutState(q, subject, now)` counts `ok = 0` rows for the subject since `last_clear`, where `last_clear = MAX(created_at)` over rows with `kind='reset'` for the user (any device, NULL-safe `IS`) or `ok=1` for that exact subject. Two windows, written down in `shared/constants.ts`: `LOCKOUT_WINDOW_S = 900` for the 5-fail (60 s) and 10-fail (900 s) step-ups; the 15-fail **device lock is unwindowed**, so pacing cannot evade it.

**Getting back in.** An unwindowed lock with no key is a bar tablet that dies at 23:00 on a Saturday and stays dead. Two things clear it, and `auth.test.ts` proves both:

- `resetPin` (`POST /api/admin/users/:id/pin`) writes the `kind='reset'` row **and** runs `UPDATE devices SET locked_at = NULL WHERE venue_id = ? AND locked_at IS NOT NULL AND id IN (<the devices this user failed on since his last success>, <the device he is bound to>)`, with `log('device_unlocked')` per device cleared. Resetting Emir's PIN unlocks the tablet Emir locked.
- `POST /api/admin/devices/:id/unlock` (`ROUTE_ROLES: ['admin']`) clears `locked_at` on one device with `log('device_unlocked')`, for the case where the locked-out person is not the one you want to re-PIN. It does **not** clear `auth_attempts` — the evidence stays, only the door reopens.

**Every route whose body carries a PIN goes through the verifier** and is rate-limited: `POST /api/adjustments`, `POST /api/adjustments/:id/decide`, `POST /api/shifts/:id/settle`, `POST /api/shifts/:id/close`, `POST /api/cash-movements/:id/decide`, `POST /api/stock/waste`. On the two `decide` routes and on settle the PIN is optional in the body (the deciding admin may be on his own session), and the rule is: **if a PIN key is present and non-empty, it goes through the verifier — there is no path that reads a PIN and skips it.**

The list lives in `shared/constants.ts` as `PIN_BEARING_ROUTES`, and `tests/unit/pin-routes.test.ts` makes it self-maintaining: it walks **`shared/schemas/*.ts`** (the barrel has no bodies of its own since §12 split it) for every exported Zod object with a key matching `/(^|_)pin$/` — which catches `pin` and the settle body's `receiver_pin` alike — and asserts the route that uses it is in `PIN_BEARING_ROUTES`, and that every route in the list appears in `ROUTE_ROLES`. Without this, any logged-in waiter could loop `POST /api/adjustments` with `approver_user_id = <admin>` and walk the 6-digit space in minutes.

### 5.3 Password and PIN hashing

`server/utils/password.ts`, `node:crypto` only:

```ts
export function hashSecret(plain: string, userId: string): string   // scrypt$N$r$p$salt$hash
export function verifySecret(plain: string, userId: string, stored: string): boolean
export function hashToken(raw: string): string                       // sha256 hex
export function newToken(): string                                   // 32 random bytes, hex
export function newEnrolCode(): string
```

Two properties a junior must not lose:
- **salt** (per user, stored in the string) defeats rainbow tables;
- **pepper** defeats a stolen database file. The scrypt input is `hmacSha256(process.env.PIN_PEPPER, userId + ':' + plain)`, and `PIN_PEPPER` lives only in `/opt/sank/.env`. A 4-digit PIN is 10 000 candidates — without a pepper, one copy of an hourly backup is every PIN in the venue. `users.pin_pepper_v INTEGER NOT NULL DEFAULT 1` lets the pepper be rotated by re-hashing at next login.
- Cost: `N = 2 ** Number(process.env.SANK_SCRYPT_LOG2N ?? 14)`. `vitest.config.ts` sets `SANK_SCRYPT_LOG2N=10` in `test.env`, and `seed.ts` memoises its six hashes in module scope, so a 200-test suite does not spend a minute in scrypt. `N` is part of the stored string, so verification needs no flag.

### 5.4 Cookies, IP, rate limits

`server/utils/auth.ts` is the only file that touches cookies. `SESSION_COOKIE = 'sank_s'`, `DEVICE_COOKIE = 'sank_d'`; flags `httpOnly, sameSite: 'lax', path: '/', secure: cookieSecure(), maxAge` 30 d / 365 d. `cookieSecure()` **defaults to true** and is turned off only by `COOKIE_SECURE=0` (set in the dev `.env`, never on the VPS) — the previous design keyed it on `NODE_ENV === 'production'`, which the systemd unit did not set.

`clientIp(event)`: `x-real-ip`, else the **last** element of `x-forwarded-for`, else the socket address — and forwarded headers are read only when `process.env.TRUST_PROXY === '1'`. `deploy/nginx.conf` sets `proxy_set_header X-Forwarded-For $remote_addr;` (overwrite, not append) and `X-Real-IP $remote_addr`. Otherwise every limiter bucket is chosen by the attacker with one header.

`server/utils/rate-limit.ts` — snajper's `createBurstLimiter` **copied verbatim, which means its real signature**, not a paraphrase of it (`~/Projects/snajper/server/utils/rate-limit.ts`):

```ts
export function createBurstLimiter(limit: number, windowSeconds: number,
                                   maxKeys?: number): BurstLimiter
export interface BurstLimiter {
  take(key: string | number, count: number, now?: number): number  // granted, 0 = refused
  remaining(key: string | number, now?: number): number
  reset(): void
  size(): number
}
```

Two things a junior will get wrong once: `take` returns **how many slots were granted** (`take(key, 1) === 0` is the refusal), and `now` is in **whole seconds**, not milliseconds — `Math.floor(Date.now() / 1000)`, which is what the module's own `seconds()` default does. Passing `Date.now()` makes every window look aeons old and the limiter never refuses anything. In-memory `Map`, oldest windows evicted at `maxKeys`, reset on restart; the comment explaining `maxKeys` comes across with the file.

Instances, all in seconds: `authLimiter = createBurstLimiter(10, 60)` keyed by the `sank_d` token hash when present else the IP; `pinLimiter = createBurstLimiter(10, 60)` keyed by `deviceId + ':' + approverUserId` on PIN-bearing routes; `ordersLimiter = createBurstLimiter(60, 60)` keyed by `deviceId ?? sessionId`. Over the limit → 429 `RATE_LIMITED` with `Retry-After: 60`.

**Limiters are never disabled — they are widened.** The earlier "skipped when `import.meta.dev`" made the last line of defence behind three critical auth findings the one thing that never ran on Vedran's machine *or* in CI, since vitest is a dev environment too. Instead the limits themselves come from `shared/constants.ts` and are multiplied in dev:

```ts
const DEV_MULTIPLIER = import.meta.dev ? 20 : 1   // two dev browsers, one real rule
export const authLimiter = createBurstLimiter(10 * DEV_MULTIPLIER, 60)
```

The code path is identical everywhere, so `tests/unit/rate-limit.test.ts` can exercise it with `vi.useFakeTimers()` and an explicit `now` argument, and `tenant.test.ts` can prove that a PIN-bearing route consumes `pinLimiter` for `(deviceId, approverUserId)`.

### 5.5 Middleware

`server/middleware/tenant.ts` is 15 lines of glue with explicit `import { getCookie, setCookie } from 'h3'`; all the logic sits in a pure function that a unit test can call:

```ts
// server/services/auth.ts
export function authorizeRequest(db: Db, req: {
  path: string, method: string, cookies: { s?: string, d?: string },
  ip: string, now: string,
}): { ok: true, actor?: Actor, device?: DeviceRow, slideTo?: string }
  | { ok: false, status: number, code: string }
```

Order: (1) not `/api/` → pass; (2) route in `ROUTE_ROLES` with `'public'` → resolve the device if the route needs one (`/api/auth/pin`, `/api/auth/pin-len`) and pass; (3) resolve the session by `sha256(sank_s)`: missing/expired → 401 `NO_SESSION`, revoked → 401 `SESSION_REVOKED`, device revoked or locked → 401 `DEVICE_REVOKED` (and both cookies are cleared), staff session whose `device_id` ≠ the presented device → 401 `DEVICE_MISMATCH`; (4) `ROUTE_ROLES` lookup → **absent = 403 `FORBIDDEN`**, role not in the list = 403 `FORBIDDEN` ("Samo vlasnik" for admin-only paths); (5) `event.context.venueId/actor/device`, slide the admin session if due, apply the limiters, set `Cache-Control: private, no-cache` and `Vary: Cookie`.

`event.context.venueId` comes from the session row (admin) or the device row (staff). No handler ever reads `venue_id` from a body.

The three shapes every screen boots from live in `shared/types/auth.ts` (WP1's fragment), and `getMe(q: Queryable, venueId, actor): MeContext` in `services/auth.ts` is the only thing that builds them — `GET /api/me`, `POST /api/auth/pin`, `POST /api/auth/admin/login` and `GET /api/bootstrap` all return the same objects, so the client has one parser:

```ts
export interface MeUser {          // never carries pin_hash, password_hash or email
  id: string, name: string, initials: string, role: Role,
  active: boolean, pin_len: 4 | 6, has_pin: boolean,
}
export interface DeviceBrief {
  id: string, label: string, mode: 'personal' | 'shared',
  bound_user_id: string | null, locked_at: string | null,
  pending_count: number, clock_skew_s: number,
}
export interface MeContext {
  user: MeUser
  session: { id: string, kind: 'admin' | 'staff', expires_at: string, borrowed: boolean }
  device: DeviceBrief | null                       // null on an admin email session
  venue: { id: string, name: string, slug: string, settings: Settings }
  seq: number
}
```

`GET /api/auth/users` returns `MeUser[]` with `has_pin` and nothing else, and it is `'any'` — **behind a session**. It used to be `public`, because the lock screen drew faces; the lock screen is a pad now and draws nothing, so what was left was every person's name, initials and **role** readable by whoever holds an enrolled phone, which is a map of which of the three PINs opens the dashboard. Its three callers (*Otpis*'s approver list, *Raspored*'s team column, `useAdjustments`) all read it after a login already.

The one thing a pad may read before a session is `GET /api/auth/pin-len` → `{ pin_len: 4 | 6 }` — `public`, device required, and it names nobody, counts nobody and says only how many digits the café types, which anybody standing at the bar can watch a waiter do. The pad cannot work without it: a pad that guessed four while the venue typed six would send four digits of somebody's PIN as if they were the whole thing.

### 5.6 Dev convenience

`POST /api/dev/enrol` — finds or creates the venue's `label='dev'` shared device, mints a fresh token, sets `sank_d`, and returns `{ device, venue }`. (It returned the staff list until the roster went behind a session; `EnrolResult` carries no `users`.) It is gated on a **positive opt-in**: `if (process.env.SANK_DEV_ENROL !== '1') throw apiError(404, 'NOT_FOUND', 'not found')`. It is a POST, it is in `ROUTE_ROLES` as `'public'`, and it never exists on the VPS because `/opt/sank/.env` does not set the variable. (The earlier "404 when `NODE_ENV==='production'`" design would have handed an enrolled device cookie to the internet, because the systemd unit never set `NODE_ENV`.)

Seed (dev and tests): admin `haris@lounge.ba` / password `1111`; PINs Haris 1111, Amar 2222, Emir 3333, and — under `SANK_SEED_CAST=full`, which is what the Playwright database wants — Lejla 4444, Dino 5555, Tarik 6666. All four digits, because a venue's PINs are one length. `seed(db, { devSecrets: boolean })` is an explicit argument — `seed-cli.ts` passes `process.env.NODE_ENV !== 'production'`, the fixture passes `true`. With `devSecrets: false` users are inserted with `pin_hash NULL` and the CLI prints "postavi PIN-ove u /admin". No device is ever seeded; a token in the database file is a key.

### 5.7 How the existing routes change

- Bodies lose `user_id` entirely: `createOrderBody`, `markPreparedBody` (`{}`), `createDeliveryBody` (which **keeps** its `client_id`). `payTabBody` disappears with its route: WP3 deletes `server/api/tabs/[id]/pay.post.ts` in the same PR that lands `POST /api/payments`, rather than leaving a wrapper with no `client_id` — the whole idempotency of a payment rests on `payments_client_uq`, and a body of `{}` has nothing to replay on. See §7.
- Services take `(db, venueId, actor, body)`. `actor.userId` becomes `orders.locked_by`, `stock_movements.user_id`, `tabs.opened_by`/`assigned_to`, `payments.paid_by`; `actor.deviceId` becomes `orders.device_id`.
- GET handlers read `event.context.venueId` instead of `currentVenueId(useDb())`.
- `GET /api/bootstrap` gains `me: MeUser`, `device`, `shift`, `menu_version`, `seq`; `users` is selected column by column so no `*_hash` can leak. A test walks every response of every route and fails on any key matching `/_hash$|token|password|pepper/`.
- `POST /api/prep/:orderId/done` and `POST /api/stock/deliveries` keep working for the bartender (`ROUTE_ROLES: ['admin','waiter','bartender']` for prep; deliveries are `['admin']` plus the bartender when `bartender_can_receive_goods`).

---

## 6. Services

One subsection per file. Every mutation names the transaction it owns; helpers taking `Tx` run inside a caller's transaction.

### 6.1 `server/services/orders.ts` — the lock

`createOrder(db: Db, venueId: string, actor: Actor, body: CreateOrderBody): CreateOrderResult`, one transaction, top to bottom:

1. replay by `(venue_id, client_id)` → the stored result with `already_applied: true`;
2. table active (404 `TABLE_NOT_FOUND`);
3. `at = nowIso()`; `clientAt = clampClientAt(body.client_created_at, device.clock_skew_s, at, settings.max_sync_lag_h)`;
4. `shift = ensureOpenShift(tx, venueId, actor, at, clientAt)` — **always the currently open shift**; `clientAt` only decides the `business_date` of a shift this call is itself creating. A round can never open a shift on a past date;
5. `post_settle = hasLiveSettlement(tx, venueId, shift.id, actor.userId)` — this does **not** refuse (see §6.4); when true the order is stamped `post_settle = 1`, `late_sync = 1`, and a non-quiet `log('late_after_settle')` + `queueAlert('late_after_settle')` are written;
6. `seq = nextShiftSeq(tx, venueId, shift.id)`;
7. `tab = resolveTab(...)` — by `tab_client_id`, else the open tab on the table, else insert. Every tab it inserts is stamped `assigned_to = actor.userId` and `shift_id = shift.id` (the `tabs_assigned_required` trigger refuses it otherwise). Three fixes to Korak 1:
   - a tab found by `tab_client_id` whose `table_id` differs from the body's is 409 `TAB_TABLE_MISMATCH` (today it silently charges another table, and once `moveTab` exists a stale phone would keep doing it);
   - a `paid`/`unpaid` tab found by `tab_client_id`, or a `clientAt` older than the table's last `closed_at`, opens a **new** tab with `late_sync = 1, status='unpaid', pending_review = 1, unpaid_reason='late_sync'` (PLAN F3 step 5) instead of throwing `TAB_CLOSED`. That branch is not silent: it writes a non-quiet **`log('late_after_close')`** `{ tab_id, order_id, shift_id, amount_fen, count }` — the source of §11's *Nakon zatvaranja* block and of the owner card "2 ture stigle nakon zatvaranja · Amar · 38,00 KM" — and, when the shift it attaches to is already `closed` or `reviewed`, `writeSummaryVersion(tx, venueId, shift.id, 'late', at)` so the shift's numbers move with it. `count` is how many late tabs this actor already has on this shift, so the card can say "2 ture" without a second query;
   - the response returns the canonical `tab_id` **and `tab_client_id`** so the phone can adopt it;

7b. **Cross-waiter locking is allowed and recorded, never silent.** When the resolved tab already exists and `tab.assigned_to !== actor.userId`, the round is accepted if `actor.role !== 'waiter' || settings.allow_cross_waiter_rounds` (default `true` — during a rush anybody carries anybody's tray, and refusing would lose the sale) and otherwise 403 `NOT_ASSIGNED`. Accepted or not, the accepted case writes a **quiet** `log('cross_waiter_lock')` `{ tab_id, order_id, assigned_to, locked_by }` and surfaces one `attention[]`-adjacent `flags[]` row on Puls. This matters because `markUnpaid` now refuses on someone else's tab (403 `NOT_ASSIGNED`) and `waiterExpected` is keyed on `unpaid_by`: without the entry, a waiter can pile his rounds onto a colleague's tab and the money lands on the colleague's line with nothing anywhere saying who ordered it;
8. insert `orders` (`shift_id`, `shift_seq`, `device_id`, `client_created_at`, `client_created_at_adj`, `sync_lag_s`, `late_sync`, `post_settle`, `source: 'app'`);
9. per line `insertLine`: snapshot `name`/`unit_price_fen` from the product, `charged_fen = price × qty`; validate flavours as today; `parent_line_id` from the body for a *Dodatni žar* row; a `comp_reason` of `staff_drink` passing `staffDrinkAllowed()` (or `owner_guest` from an `admin` actor) locks at `charged_fen = 0` with `authorised_by`, any other draft comp locks at full price and writes a `pending` `line_adjustments(kind='comp')` row in the same transaction, so a rejected comp costs nothing to undo. That row needs a `client_id` and the order body carries none, so it is **derived, not minted**: `client_id = line.id + ':comp'`. The line id is itself a phone-minted uuid unique in the venue, so the derived key is unique too, and a replayed order produces the same key — the replay guard on `line_adjustments_client_uq` holds even if the outer replay check is ever bypassed;
10. per resolved component `insertMovement(tx, …, type: 'sale', unit_cost_mfen: item.avg_cost_mfen, shift_id, occurred_at: clientAt)`;
11. `bump('table')`, `bump('prep')`, `bump('stock')`.

Returns `{ order_id, tab_id, tab_client_id, shift_id, shift_seq, order_total_fen, tab_total_fen, late_sync, post_settle, already_applied }`.

`orderLineInput` gains `id: uuid` (the phone mints line ids so a queued void can name a line the server has not seen), `comp_reason?`, `parent_line_id?`; `createOrderBody` gains `client_created_at?` and drops `user_id`.

**`discardDraft(db, venueId, actor, body): { ok: true }`** — the one route that writes nothing but a log entry. F10 step 1 will not let a shift close while a draft cart sits unlocked on somebody's phone: the waiter either locks it or taps *Odbaci*, and *Odbaci* must leave a trace, or the closing check is a check on nothing. It takes `{ table_id, lines, total_fen }` (all three describe a cart the server has never seen, so `total_fen` is **evidence, not money** — it is written into the log body and never summed into anything), validates the table, writes a quiet `log('draft_discarded')`, and does **not** `bump` — no ledger row moved. One transaction, no idempotency key: discarding the same phantom cart twice is two honest entries.

### 6.2 `server/services/tabs.ts`

```ts
export function tabMoney(q: Queryable, venueId, tabId): TabMoney
// { total_fen, pending_void_fen, paid_fen, remaining_fen }
// total     = Σ order_lines.charged_fen − Σ applied line_adjustments.amount_fen
// remaining = total − Σ pending void amount_fen − Σ payments.amount_fen (reversals are negative)
export function getTablesState(q, venueId, actor): TablesStateResponse
export function getTab(q, venueId, tabId, actor): TabDetail
export function markUnpaid(db, venueId, actor, body: MarkUnpaidBody): UnpaidResult
export function decideUnpaid(db, venueId, actor, tabId, body): Tab
export function moveTab(db, venueId, actor, tabId, body): Tab
export function assignTab(db, venueId, actor, tabId, body: { user_id: string }): Tab
export function acceptTab(db, venueId, actor, tabId): Tab
export function pendingFor(q, venueId, now): AttentionItem[]   // unpaid tabs awaiting a decision
```

**`TableState` and its envelope — the one read every waiter screen is built from.** Korak 1 returned a bare array of `{ table_id, tab_id, total_fen, opened_by_name, opened_at, last_order_at }`, which cannot draw a single one of S1's new states. Both shapes live in `shared/types/money.ts`:

```ts
export interface TableState {
  table_id: string
  tab_id: string | null
  tab_client_id: string | null      // the phone adopts this after an offline lock
  total_fen: number                 // tabMoney().total_fen
  remaining_fen: number             // what is still owed — the number on the tile
  assigned_to: string | null        // user id; null only when tab_id is null
  assigned_to_initials: string | null  // "A.H." — the colleague badge on the tile
  opened_by_name: string | null
  opened_at: string | null
  last_order_at: string | null
  pending_review: boolean           // yellow tile: naplata čeka
  late_sync: boolean                // amber kasno badge
  offered_to: string | null         // set → "Nudi ti: Sto 7 · Prihvati" for that user
}

export interface ShiftBrief {
  id: string
  status: 'open' | 'closing' | 'closed' | 'reviewed'
  business_date: string
  closing: boolean                  // someone tapped Zatvori smjenu
  closer_name: string | null
  my_settled: boolean               // the actor has a waiter_settlements row (F13(b))
  my_open_tabs: number              // his own open tabs — the Završi smjenu bar's counter
}

export interface TablesStateResponse { seq: number, shift: ShiftBrief | null, tables: TableState[] }
```

The last two fields of `ShiftBrief` and `assigned_to*` are why `getTablesState` takes an `actor` and why its ETag carries the user (§4.2). `tests/unit/api-shapes.test.ts` asserts every field above, by name, on a fixture with two waiters and one offered tab.

**Handover (S2's ⋯ *Predaj sto kolegi*, S1's *offered* tile).** Two small routes, both **online-only** (there is no offline queue for them — a handover the colleague has not seen yet is not a handover) and both on `open` tabs:

- `POST /api/tabs/:id/assign { user_id }` — the actor must be `tab.assigned_to` or `admin` (403 `NOT_ASSIGNED`); the target is active staff in the venue and not the actor (400 `INVALID_TARGET`); sets `offered_to = user_id`; quiet `log('tab_offered')`; `bump('table')`. Re-offering to somebody else just overwrites; passing the current holder's own id clears the offer.
- `POST /api/tabs/:id/accept {}` — the actor must be `tab.offered_to` (403 `NOT_OFFERED`); sets `assigned_to = actor.userId`, `offered_to = NULL`; non-quiet `log('tab_handed')` `{ tab_id, from, to }`; `bump('table')`.

The `tabs_status_guard`'s `open → open` branch already permits both columns to move. Money does not follow the tab: rounds stay attributed to whoever locked them (`orders.locked_by`), so `summarizeUser` and `waiterExpected` are untouched by a handover. What moves is responsibility for what happens *next* — who may mark it unpaid, and whose *Završi smjenu* bar still counts it.

`tabMoney` is the only place that computes a tab's money; `tabTotal` becomes `tabMoney(...).total_fen` so no Korak 1 test is deleted. `markUnpaid` is **queueable**: the route is `POST /api/tabs/unpaid` with `{ client_id, tab_client_id, reason, note?, client_created_at? }` (a phone may mark a tab the server has never seen), it resolves the tab like `resolveTab`, requires `actor.userId === tab.assigned_to` or `admin` (403 `NOT_ASSIGNED`), requires `remaining_fen > 0` (409 `NOTHING_TO_MARK`), sets `status='unpaid', pending_review=1, unpaid_by, unpaid_reason, unpaid_client_id, closed_at, closed_by`, and is idempotent by `unpaid_client_id`. `decideUnpaid` is admin-only: `otpis` clears `pending_review` and stamps `unpaid_approved_by`; `naplatiti` writes only the log entry and leaves the tab pending until a payment lands.

The two remaining shapes, in `shared/types/money.ts`:

```ts
export interface TabDetail {
  tab: Tab
  money: TabMoney
  orders: { id, client_id, shift_seq, locked_by, locked_by_name, at, late_sync,
            lines: { id, name_snapshot, note, flavour_names: string[], qty,
                     unit_price_fen, charged_fen, comp_reason: string | null,
                     status: 'ok'|'storno'|'storno_na_cekanju'|'gratis',
                     adjustment_id: string | null }[] }[]
  payments: { id, method, amount_fen, paid_by, paid_by_name, at, reverses_id: string | null }[]
}
export interface UnpaidResult { tab: Tab, already_applied: boolean }
```

### 6.3 `server/services/payments.ts`

```ts
export function createPayment(db, venueId, actor, body: CreatePaymentBody): PaymentResult
export function insertReversal(tx: Tx, venueId, adj, approvedBy: string, at: string): string
export function resolvePaymentShift(tx: Tx, venueId, tab, clientAtAdj): string
```

`createPayment`, one transaction: replay by `client_id`; resolve the tab by `tab_client_id` else `tab_id`; a `paid` tab → **write the `pay_duplicate_attempt` log entry in its own top-level transaction first**, then throw 409 `TAB_ALREADY_PAID { paid_by, at }` (a log call inside the rejected transaction would roll back with it); `voided` → 409 `TAB_VOIDED`; `method ∈ settings.payment_methods` else 400 `METHOD_NOT_ALLOWED`; every id in `covers_order_client_ids` is an order `client_id` of this tab else 400 `INVALID_COVERS`; `amount_fen > remaining_fen` → 422 `OVERPAY { remaining_fen }`; `shift_id = resolvePaymentShift(...)` (the tab's shift while it is `open|closing`, else the current open shift); insert; when `remaining − amount === 0` the tab flips to `paid` in the same transaction (never later by a sweep) and `pending_review` clears on the `unpaid → paid` branch; when another user's round on the tab is not covered, `pending_review = 1` and a quiet `log('pay_uncovered')`; `log('payment_taken')` is **not** written (thousands a week, PLAN F13); `bump('table')`, `bump('shift')`.

Returns `PaymentResult = { payment_id, tab_id, tab_client_id, tab_status, total_fen, paid_fen, remaining_fen, change_fen, post_settle: boolean, already_applied: boolean }`.

**Taking money after your own settlement** is the mirror of §6.1 step 5, and it needs the same treatment for the same reason. PLAN F10 step 2 refuses it with 409 `SETTLED`; open decision 4 changed the *lock* path to accept-and-flag but left the *pay* path untouched, which is the worst of both — a settled waiter takes 40 KM in cash, the row lands with `paid_by = u`, his `waiterExpected` silently rises after the reveal he already signed, and nothing anywhere says why the envelope is short. So `payments` gains **`post_settle INTEGER NOT NULL DEFAULT 0`** and `createPayment` sets it from `hasLiveSettlement(tx, venueId, shiftId, actor.userId)`, exactly like the order path: the payment is accepted, stamped, and it writes a non-quiet `log('late_after_settle')` `{ payment_id, tab_id, amount_fen, method }` plus `queueAlert('late_after_settle')`. `expectedCash` names the resulting movement in its own term (`post_settle_cash_fen`, §6.5) so the *Smjena* strip can say *"nakon predaje: +40,00 KM"* instead of leaving a bare discrepancy. `settlements.test.ts` pins it: settle, then pay 40 in cash → the settlement row is byte-identical, `expectedCash` for that user is +40, and one `late_after_settle` entry exists.

`insertReversal` is called **only** from an adjustment decision whose `refund_kind = 'from_waiter'`: `amount_fen = −adj.amount_fen`, `method` = cash when the tab has a positive cash payment else card, `reverses_id` = the newest positive payment of that method, `paid_by = adj.requested_by`, **`approved_by = the deciding actor`** (the `payments_reversal_needs_approver` trigger refuses a negative row without one), `adjustment_id = adj.id`.

### 6.4 `server/services/adjustments.ts`

```ts
export function requestAdjustment(db, venueId, actor, body: CreateAdjustmentBody): AdjustmentResult
export function decideAdjustment(db, venueId, actor, adjustmentId, body: DecideAdjustmentBody): AdjustmentResult
export function applyAdjustment(tx: Tx, venueId, adj, at): void
export function listPending(q, venueId, actor): PendingAdjustment[]
export function staffDrinkAllowed(tx: Tx, venueId, userId, shiftId, product, amountFen): boolean
export function pendingFor(q, venueId, now): AttentionItem[]
```

```ts
export interface PendingAdjustment {
  id, kind, reason, note: string | null, qty, amount_fen, restock, was_paid,
  seconds_since_lock, status, auto,
  order_line_id, line_name: string, tab_id, table_name: string,
  requested_by, requested_by_name, created_at,
  can_decide: boolean,          // this actor, this role, this window
}
export interface AdjustmentResult {
  adjustment: PendingAdjustment, tab_total_fen: number, tab_remaining_fen: number,
  applied: boolean, already_applied: boolean,
}
```

**Whole-line voids in v1.** The body has no `qty` and no `amount_fen`; the service sets `qty = line.qty`, `amount_fen = line.charged_fen` (0 for a comped line). The partial unique `line_adjustments_line_uq` makes a second live adjustment on the same line a 409 `LINE_ALREADY_ADJUSTED`. The `qty` and `amount_fen` columns stay so partial voids can arrive later with no migration.

`requestAdjustment`, one transaction after any PIN check (which runs **before** it, on `db`, through `verifyPinMetered`): line → order → tab; `seconds_since_lock = floor((now − order.created_at)/1000)`; `was_paid` = the tab is `paid` or a payment covers this order; `restock` = void with reason in `wrong_entry|guest_changed_mind|not_served` → 1, everything else 0, comps always 0; `reason='other'` needs `note.length ≥ 5`. Decision, in order:

1. **auto self-void** — `kind='void'`, `actor.userId === order.locked_by`, `was_paid = 0`, tab `open`, `seconds_since_lock ≤ void_self_window_s`, **and** `order.prepared_at IS NULL`, **and** the actor is under `self_void_max_per_shift` and `self_void_max_fen` for this shift → `applied, auto = 1`. Failing any of the three new conditions is not an error: it falls through to `pending` with the same sheet copy ("Ide šankeru"), and crossing a cap writes a non-quiet `log('self_void_capped')`. A bowl the bartender has already lit cannot go back in the jar, which is exactly what separates a genuine miskey from a sale being unwound;
2. **staff drink** — `kind='comp', reason='staff_drink'`, own line, `staffDrinkAllowed()` → `applied, auto = 1`;
3. **approver PIN in the body** — approver active, `role ∈ settings.approver_roles`, `approver ≠ actor` unless the actor is `admin`; an admin PIN is accepted only when `actor.deviceBoundUserId === approver` (403 `ADMIN_PIN_FOREIGN_DEVICE`); a bartender additionally needs `seconds_since_lock ≤ bartender_approve_window_s`, otherwise the request falls through to pending (not an error). `foreign_device = actor.deviceBoundUserId === approver ? 0 : 1`;
4. otherwise **pending**, quiet `log('void_requested'|'comp_requested')`.

`decideAdjustment`: row `pending` else 409 `ALREADY_DECIDED`; `actor.userId ≠ requested_by` unless `admin` (403 `SELF_APPROVAL`); an `admin` needs `sessionKind='admin'` or his own bound device (403 `ADMIN_FOREIGN_DEVICE`); a bartender needs the window (403 `WINDOW_EXPIRED`, copy "Ide vlasniku"); a waiter → 403 `FORBIDDEN`. Body: `{ outcome: 'applied'|'rejected', restock?, refund?: 'none'|'from_waiter'|'from_drawer', note? }`.

`applyAdjustment` does exactly three things and no longer guesses about money:
- `kind='void' && restock=1` → for every `stock_movements` row with `type='sale', ref_type='order_line', ref_id=line.id`, one `sale_storno` with the opposite `qty_delta`, the same `unit_cost_mfen`, `ref_type='line_adjustment'`, `ref_id=adj.id`, `user_id = approved_by`, `occurred_at = at`, through `insertMovement`;
- `refund_kind='from_waiter'` → `insertReversal` (the waiter physically hands cash back; his `waiterExpected` drops and the row carries a second name);
- `refund_kind='from_drawer'` → `cash.insertRefund(tx, …)` (`cash_movements(type='refund')`).

`refund_kind='none'` (the default) writes **no money row at all**: a void changes what the *guest* owes; returning cash is a physical act that needs its own signed row. The previous design credited the requester automatically on every `was_paid=1` void, which let a waiter collect 50 KM, record it honestly, then have the void hand the 50 KM back to him on paper. A paid tab stays `paid` in every case; its `remaining_fen` may go negative after a post-settlement void and that is the derived term, documented in `tabMoney`.

`listPending` scopes by role: admin and bartender see all pending with `can_decide`; a waiter sees only his own, never another waiter's money.

### 6.5 `server/services/shifts.ts` and `cash.ts`

```ts
// shifts.ts
export function currentShift(q, venueId): ShiftRow | null
export function ensureOpenShift(tx: Tx, venueId, actor, at, clientAt?): { shift: ShiftRow, created: boolean }
export function joinShift(tx: Tx, venueId, shiftId, userId, role, at): void
export function nextShiftSeq(tx: Tx, venueId, shiftId): number
export function hasLiveSettlement(q, venueId, shiftId, userId): boolean
export function setCustodian(tx: Tx, venueId, shiftId, userId): void
export function openShift(db, venueId, actor, body): ShiftRow
export function startClosing(db, venueId, actor, shiftId): ShiftRow
export function closeShift(db, venueId, actor, shiftId, body): CloseResult
export function forceClose(db, venueId, actor, shiftId, body): CloseResult
export function reviewShift(db, venueId, actor, shiftId, body): ShiftRow
export function leaveShift(db, venueId, actor, shiftId): { left_at: string }
export function shiftBrief(q, venueId, actor): ShiftBrief | null   // §6.2's envelope, one query
export function listOwnerShifts(q, venueId, from, to): OwnerShiftRow[]
export function pendingFor(q, venueId, now): AttentionItem[]  // unsettled waiters on a closing shift
```

Shapes (`shared/types/shifts.ts`):

```ts
export interface CloseResult {
  shift: ShiftRow, summary_version: number,
  missing_settlements: { user_id, name }[], outstanding_fen: number,
  expected_fen: number, counted_fen: number | null, diff_fen: number | null,
  within_tolerance: boolean,
}
export interface OwnerShiftRow {
  id, business_date, status, opened_at, closed_at: string | null,
  promet_fen: number, diff_fen: number | null,
}
export interface CashMovement {
  id, type, amount_fen, user_id, user_name, created_by, created_by_name,
  reason: string | null, note: string | null, status, decided_by: string | null,
  decided_at: string | null, created_at: string,
}
```

`ensureOpenShift` is a plain select-or-insert: better-sqlite3 is synchronous and there is one process, so two first locks cannot both see "no open shift"; `shifts_one_open_uq` stays as belt and braces with a raw-SQL refusal test, and there is no retry helper (it would be untestable dead code). Every service that writes money or stock under a shift calls `joinShift`; `shift_members.role` is a snapshot, so a promoted bartender's old shifts keep their line.

`closeShift`, one transaction: 409 `OPEN_TABS { tabs: [...] }` while any tab is `open`; 409 `NO_OPEN_COUNT` unless `hasSubmittedCount(tx, venueId, shiftId, 'open')` or the actor is `admin` with `override_no_open_count` (then `log('override', { what: 'no_open_count' })`) — PLAN F10 step 4 asks for the **opening** count, not the closing one; the closer's PIN through `verifyPinMetered`; `expected = drawerExpected + Σ waiterExpected(u)` over users **who have a settlement** (`self_sealed` counts), with everyone else's expected reported as `outstanding_fen` — comparing the drawer against people whose cash is still in their pockets made every close a ritual note; `|counted − expected| > max(cash_tolerance_fen, expected × cash_tolerance_pct / 100)` → 422 `NOTE_REQUIRED` when `closing_note` is empty; update the shift to `closed`; `UPDATE shift_members SET left_at = at, left_at_source='auto' WHERE left_at IS NULL`; `writeSummaryVersion(tx, …, 'close')`; `log('shift_closed')` with an `early_close` flag when `at` is more than `early_close_min` before `closing_time`. `forceClose` is admin-only, `closed_kind='forced'`, `cash_counted_fen NULL`, skips the tab and count blocks, requires a note ≥ 3 chars, `log('shift_forced', { missing_user_ids })`. `reviewShift` is `closed → reviewed`; a `card_total_fen` differing from Σ card payments requires a note.

```ts
// cash.ts
export function openingFloat(q, venueId, shift): { fen: number | null, source: 'override'|'derived'|'unknown' }
export function setOpeningFloat(db, venueId, actor, shiftId, body): ShiftRow
export function moveFloat(db, venueId, actor, shiftId, body): CashMovement
export function acknowledgeFloat(db, venueId, actor, movementId): CashMovement
export function requestPayout(db, venueId, actor, shiftId, body): CashMovement & { needs_owner: boolean }
export function decideCashMovement(db, venueId, actor, movementId, body): CashMovement
export function pickup(db, venueId, actor, shiftId, body): CashMovement
export function insertRefund(tx: Tx, venueId, actor, shiftId, args): string
export function expectedCash(q, venueId, shiftId, userId?, now?): ExpectedCash
export function withinTolerance(diffFen, prometFen, settings): boolean
```

`openingFloat` = the override if set, else the previous closed shift's `cash_counted_fen − Σ approved owner_pickup` on it, else `null` (the venue expectation then uses 0 and reports `opening_float_known: false` with the attention line "Unesi početni polog").

**`float_out` is born `pending`** and only counts once the receiver acknowledges it (`POST /api/cash-movements/:id/ack`, or the receiver's PIN on the giver's device at hand-over). It is a **non-quiet** log kind, and `/api/me/shift` always returns the actor's own `float_out_fen` and his `cash_movements` rows **even before settlement** — the blindness strip is about promet and expected, not about what a person was handed. Without those three changes a bartender could push his own shortfall onto a colleague who was structurally prevented from noticing it.

`decideCashMovement` decides **the two types that are born `pending`, and only those**: `payout` and `float_out`. `float_in`, `owner_pickup` and `refund` are born `approved` (§3.2) and can therefore never reach a decide route — a 409 `NOT_PENDING` is all `decideCashMovement` has to say about them, and there is no "role ∈ `approver_roles` for a refund" rule, because there is no pending refund to approve.

- `payout` — `role ∈ settings.payout_approver_roles` (default `['admin']`), and above `payout_owner_fen` always `admin` (403 `OWNER_REQUIRED`).
- `float_out` — `role ∈ settings.approver_roles`, i.e. an admin or a bartender may hand cash to a waiter. The **receiver's** own acknowledgement is the other route, `POST /api/cash-movements/:id/ack` (403 `NOT_RECEIVER`); both end at the same `approved` state and the same `cash_movements_update_guard`. Two doors because there are two situations: the receiver taps *Primio sam* on his own phone, or he types his PIN on the giver's phone at hand-over and the giver's session posts the decide.
- Both — **`movement.user_id !== actor.userId` unless the actor is `admin`** (403 `SELF_APPROVAL`), keyed on whose money it is, not who wrote the row. Without it a bartender requests a 49,99 KM payout, approves it himself, the drawer expectation drops by exactly that, and the close reconciles perfectly.

One transition (409 `ALREADY_DECIDED`); on a closed shift the decision writes a new summary version.

`pendingFor(q, venueId, now): AttentionItem[]` from `cash.ts` returns the pending `payout` and `float_out` rows, each with `actions: ['approve','reject']`.

**`expectedCash`, the one function** (all terms filtered by `venue_id` and `shift_id`, cash movements only when `status='approved'`). Every waiter term answers one question — *how much cash should be in this person's pocket right now* — so every term is either cash that moved or a balance he is holding, and **no term is a charge**:

`waiterExpected(u)` =

| # | term | key | why |
|---|---|---|---|
| 1 | + Σ `cash_movements.amount_fen WHERE type='float_out' AND user_id = u` | `float_out_fen` | cash the drawer handed him |
| 2 | + Σ `payments.amount_fen WHERE method='cash' AND paid_by = u` | `cash_fen` | cash he took, **negative reversals included** |
| 3 | + Σ `remaining(tab)` for tabs `status='unpaid' AND pending_review = 1 AND unpaid_by = u` | `unpaid_fen` | money he is answerable for until the owner writes it off |
| 4 | + Σ `line_adjustments.amount_fen WHERE kind='void' AND was_paid = 0 AND requested_by = u AND (status='pending' OR (status='rejected' AND tab.status='paid'))` | `void_held_fen` | a void that has not been granted is still owed |
| 5 | + Σ `remaining(tab)` for tabs `open|unpaid` carrying a `post_settle = 1` order locked by `u` | `post_settle_lock_fen` | rounds he served after signing off |
| 6 | + Σ `payments.amount_fen WHERE method='cash' AND paid_by = u AND post_settle = 1` — **already inside term 2**, reported separately, never added twice | `post_settle_cash_fen` | so the strip can explain the movement (§6.3) |

Two corrections against the earlier draft, both of which made `venueExpected` wrong in a way the `venue === drawer + Σ waiters` test could not see, because both sides moved together:

- **Term 5 counts what is owed on the tab, not what was charged.** The old term summed `orders.charged_fen` of `post_settle` orders. `charged_fen` is the guest's debt, not the settler's cash: the moment anybody pays that tab in cash the same money is counted again by term 2 — in this waiter's row if he took it, in a colleague's row if the colleague did — and `venueExpected` overstates by the amount. Shaped like term 3 it behaves: locking after settlement raises his expected by the round; a colleague paying the tab in cash leaves `venueExpected` unchanged and moves the money into the payer's term 2, where the cash actually is.
- **A post-settlement `from_waiter` void is subtracted once, not twice.** The old sixth term subtracted `amount_fen` for `kind='void' AND was_paid=1 AND refund_kind='from_waiter' AND decided_at > settlement.created_at`. But `insertReversal` (§6.3) has already written a **negative** `payments` row with `method='cash'` and `paid_by = adj.requested_by`, which term 2 sums. The term is **deleted**: the reversal row is the whole story, it carries a second name (`approved_by`), and it is the row the *Smjena* strip shows. The mirror case is deliberate and stays: a `refund_kind='none'` void moves nobody's cash, because nobody handed any back — that is the change §6.4 makes to PLAN F6 step 5, recorded in open decision 3.

`drawerExpected` = `openingFloat ?? 0` + Σ `float_in` − Σ approved `payout` − Σ approved `float_out` − Σ `refund`.

`venueExpected` = `drawerExpected + Σ waiterExpected` over every user with any term. `tip_fen` and `received_fen` never enter; `owner_pickup` never enters (it only drives the next shift's float).

```ts
export interface ExpectedCash {
  venue_expected_fen: number
  drawer_expected_fen: number
  opening_float_known: boolean
  waiters: { user_id: string, name: string, expected_fen: number,
             float_out_fen: number, cash_fen: number, unpaid_fen: number,
             void_held_fen: number, post_settle_lock_fen: number,
             post_settle_cash_fen: number, settled: boolean }[]
}
```

Consequences `cash.test.ts` and `settlements.test.ts` pin, one case each: a pending anything moves nothing for the venue; approving a `was_paid=0` void after settlement lowers the requester's expected by exactly `amount_fen`; rejecting moves nothing; a post-settlement `from_waiter` void lowers his expected by `amount_fen` **once** (assert the exact number, not just the direction — the double subtraction was invisible to a sign test); a post-settlement lock raises his expected by the tab's remaining, and a colleague then paying that tab in cash leaves `venueExpected` unchanged while moving the amount into the colleague's row; and `venueExpected === drawerExpected + Σ waiterExpected` after every one of them.

### 6.6 `server/services/settlements.ts`

```ts
export function settle(db, venueId, actor, shiftId, body: SettleBody): SettleResult
export function acceptSettlement(db, venueId, actor, shiftId, settlementId): Settlement
export function pendingFor(q, venueId, now): AttentionItem[]  // settlements awaiting acceptance
```

**One outbox check, one name, one owner.** The earlier draft had `unsentDevices(tx, venueId, shiftId, userId, now, settings)` in `settlements.ts` and `assertNoPendingOutbox(tx, venueId, shiftId, override, actor)` in `counts.ts` — two names and two signatures for one rule, neither exported by the file that owns `devices`. There is exactly one, it lives with the column it reads (`devices.pending_count`, written by the heartbeat), and both callers import it from `contracts.ts`:

```ts
// server/services/devices.ts — WP1
export interface StaleDevice { device_id: string, label: string, pending_count: number, last_seen_at: string | null }
export function assertNoPendingOutbox(tx: Tx, venueId: string, shiftId: string, opts: {
  actor: Actor, override?: boolean,
  /** Settle looks at one person's devices; a count looks at every device in the shift. */
  userId?: string,
}): StaleDevice[]
```

It reads the devices that locked a round in the shift (`orders.device_id`, narrowed to `orders.locked_by = userId` when given): a **fresh** device (`last_seen_at ≥ now − heartbeat_fresh_s`) with `pending_count > 0` → 409 `PENDING_OUTBOX { devices: [{ label, pending_count }] }`, unless the actor is `admin` with `override` (writes `override_by` where the caller has such a column and `log('override', { what: 'unsent' })`); stale devices are returned rather than thrown and the caller reports them.

One `settle`, no second late route: it accepts a shift in any status. On `open|closing` it is the normal path; on `closed|reviewed` it sets `late = 1`, writes `log('settlement_late')` and a new summary version (PLAN F10 step 7 *Naknadna predaja*). One transaction: 409 `SETTLED` on a second settlement (the unique index is the hard guarantee); `body.outbox_len !== 0` → 409 `PENDING_OUTBOX`; `assertNoPendingOutbox(tx, venueId, shiftId, { actor, override: body.override, userId: actor.userId })`, whose stale devices land in the response; `joinShift`; `expected = expectedCash(tx, …, actor.userId, now).waiters[0]`; `summary = summarizeUser(...)`; the receiver's PIN, if given, goes through `verifyPinMetered` **before** this transaction opens, and the receiver must be in `approver_roles` and not the settler → `accepted_by/at` at insert; no receiver → `self_sealed = 1`; insert `waiter_settlements` with `unsent_reported_json`; `log('waiter_finished')`; `bump('shift')`.

Returns the reveal, `SettleResult = { settlement_id, summary: UserSummary, expected_fen, declared_fen, diff_fen, within_tolerance, tolerance_fen, breakdown: ExpectedCash['waiters'][0], self_sealed, late, stale_devices: StaleDevice[] }`. `Settlement` is the stored row with `user_name` and `accepted_by_name` joined.

**Blindness is a nudge, not a control.** `declared_fen` is recorded before any `*_fen` for that user leaves the server, and `/api/me/shift` strips `*_fen` until a settlement exists — but `/api/me/shift/lines` returns per-line prices, so anyone who can add knows his number. The evidence is the recorded pair `declared_fen` / `expected_at_declare_fen`, not the strip. Say so in the service comment and in *Pravila*; do not let a future feature lean on the strip as if it were a control.

### 6.7 `server/services/summaries.ts`

```ts
export function summarizeUser(tx: Tx, venueId, shiftId, userId, now, settle?): UserSummary
export function summarizeShift(tx: Tx, venueId, shiftId, now): ShiftSummary
export function writeSummaryVersion(tx: Tx, venueId, shiftId, reason, now): number
export function latestSummary(q, venueId, shiftId): ShiftSummaryRow | null
export function shiftLines(q, venueId, shiftId, opts: {
  userId?: string, kat: string, cursor?: string, limit?: number,   // default 100, max 300
}): { rows: LineRow[], totals: LineTotals, next_cursor?: string }
export function getMyShift(db, venueId, userId): MyShift
export function listMyShifts(q, venueId, userId, limit): MyShiftRow[]
export function getOwnerShift(db, venueId, shiftId): OwnerShift
```

`shiftLines` pages the same way `listLog` does — a keyset cursor on `(at, shift_seq, line_id)`, base64 of those three, `next_cursor` present only when a full page came back. **`totals` are computed over the whole filtered set, not the page**, so the footer of page 1 and the footer of page 3 agree; that is the one thing paging a money screen must not get wrong, and `summaries.test.ts` asserts it by summing three pages and comparing to a one-page read with `limit: 300`.

```ts
export interface MyShift {                 // GET /api/me/shift
  shift: ShiftBrief | null, joined_at: string | null, hours: number,
  settled: boolean, settlement: Settlement | null,
  float_out_fen: number,                   // always present, even before settlement (§6.5)
  cash_movements: CashMovement[],          // his own rows, always
  summary: UserSummary | null,             // null until he settles — the blindness strip
}
export interface MyShiftRow { shift_id, business_date, joined_at, left_at, hours,
                              declared_fen: number | null, diff_fen: number | null }
export interface OwnerShift {
  shift: ShiftRow, summary: ShiftSummary, by_user: UserSummary[],
  cash_movements: CashMovement[], settlements: Settlement[],
  counts: CountView[], late_after_close: { count: number, fen: number, user_names: string[] },
}
```

`ShiftSummary` is the `shift_summaries` row with `by_category_json` / `by_user_json` parsed and names joined; `UserSummary` is `summarizeUser`'s return, below.

`summarizeUser` returns `{ user_id, joined_at, settled_at, hours, promet_fen, unpaid_fen, cash_fen, card_fen, float_out_fen, tabs, rounds, bowls, by_category[], storno { count, fen, pending_count, pending_fen }, self_voids { count, fen }, gratis { count, fen }, waste { count, fen }, post_settle_locks { count, fen }, expected_fen?, declared_fen?, tolerance_fen?, within_tolerance? }`. Promet = Σ `charged_fen` of lines on orders with `locked_by = user` in this shift − Σ applied void `amount_fen` on them. `self_voids` (applied, `auto = 1`, `requested_by = approved_by`) and `waste` sit on the same row of the admin's screen as promet: the point of counting them is that they are visibly counted.

`summarizeShift` builds `by_category` over every order in the shift and `by_user` over every member, plus `expected_cash_fen`, `outstanding_fen`, `counted_cash_fen`, `diff_fen`, `bowls/tobacco_g/coals` from `stock_movements` with this `shift_id`, `waste_fen`, and `stock_variance_fen` from the shift's confirmed close count. Before returning it asserts `Σ by_user.promet_fen === Σ by_category.fen === promet_fen` and throws 500 `SUMMARY_MISMATCH` otherwise — the reconciliation is checked at write time, not only in tests.

`writeSummaryVersion` is called by `closeShift`, `forceClose`, and every post-close decision (cash decision, pickup, late settlement, adjustment or unpaid decision). There is no nightly recompute in Korak 2.

`shiftLines` is one query over `order_lines ⋈ orders ⋈ tabs ⋈ tables ⋈ products` with left joins on the latest `line_adjustments` per line and a payments existence flag; `kat ∈ <category_id> | 'storno' | 'gratis' | 'nijeplaceno' | 'sve'`; rows carry `{ line_id, at, arrived_at, sync_lag_s, shift_seq, table_name, name_snapshot, note, flavour_names[], qty, charged_fen, unit_price_fen, status, late_sync, locked_by, locked_by_name }` where `status ∈ otvoreno|naplaceno|nije_placeno|storno|storno_na_cekanju|gratis`, sorted by `at, shift_seq`. Header and footer sums come from the same function, so they cannot disagree — that is `LineRow`, and the footer is

```ts
export interface LineTotals { rows: number, qty: number, charged_fen: number,
                              storno_fen: number, gratis_fen: number }
```

computed over the whole filtered set, never the page.

`shared/bowls.ts`, one export used by `summarizeUser`, `summarizeShift` and the nargila report:

```ts
export function countBowls(lines: {
  product_kind: ProductKind, shisha_grams: number | null, qty: number,
  flavour_ids: string[], parent_line_id: string | null,
}[]): { bowls: number, gramsByFlavour: Map<string, number> }
```

A line is a bowl iff `product_kind === 'shisha' && (shisha_grams ?? 0) > 0 && parent_line_id === null`; grams split evenly across `flavour_ids`. *Dodatni žar* is never a bowl.

### 6.8 `server/services/stock.ts`, `counts.ts`, `reports.ts`

**The one write helper.**

```ts
export function insertMovement(tx: Tx, venueId, m: {
  stockItemId, type, qtyDelta, unitCostMfen, refType?, refId?,
  userId?, shiftId?, note?, occurredAt, createdAt,
}): string
```

It inserts the row and — for every type except `late_sync` and `count_adjust` — checks `lastConfirmedCountAt(tx, venueId, stockItemId)`; when `occurredAt <= that`, it inserts a `late_sync` offset (`qty_delta = −qtyDelta`, same cost and `occurred_at`, `ref_type='stock_movement'`, `ref_id` = the row just written, note `kasno sinhronizovano · popis 07.09. 03:10`). PLAN §9 names this only for sales; it is generalised to deliveries, waste and corrections because a delivery dated before a confirmed count was already on the shelf when the shelf was counted, and would otherwise be counted twice by `SUM(qty_delta)`. One rule, one place; every caller passes a cost.

Reads: `onHandByItem`, `onHand` (unchanged, `SUM(qty_delta)`), `theoreticalAt(q, venueId, itemId, atIso)` = the same sum bounded by `occurred_at <= atIso`, `lastConfirmedCountAt`, `stockStatus(item, onHand)` → `u_minusu | bez_cijene | nisko | ok`, `getStock` (Korak 1, plus `status` and cost).

**The one cost reader — fall back, flag, never silently zero.**

```ts
export function unitCost(item: { avg_cost_mfen: number, last_cost_mfen: number }):
  { mfen: number, estimated: boolean }
// → { mfen: avg || last || 0, estimated: avg === 0 }
```

`submitCount`, `logWaste` and `correctStock` all price through it instead of reading `avg_cost_mfen` directly, and every row they write carries the `estimated` flag up to the screen (`stock_count_lines` has no column for it — it is derived at read from `unit_cost_mfen === last_cost_mfen && avg_cost_mfen === 0`, and `CountView`/`WasteView` expose it). An item with a `last_cost_mfen` and no moving average yet is priced at what it cost last time and labelled *procijenjeno*, which is a far better answer than 0,00 KM. Only an item with **neither** is genuinely unpriced, and that is the item `confirmCount`'s 422 `PRICE_MISSING` names.

**Opening stock — the *Početno stanje* screen's route.** `setOpeningStock(db, venueId, actor, body): StockItemAdmin[]`, admin, one transaction:

```
POST /api/stock/opening
{ note?: ≤200, lines[1..300]{ stock_item_id, qty: z.number().min(0), unit_cost_mfen: z.int().min(1) } }
```

Per line: one `insertMovement(type='opening', qty_delta = qty, unit_cost_mfen, ref_type='venue_setup', ref_id = venue_id, occurred_at = at)`, then `UPDATE stock_items SET avg_cost_mfen = unit_cost_mfen, last_cost_mfen = unit_cost_mfen`. It is **once per item, ever**: a line whose item already has a movement of any type other than `opening` is 409 `OPENING_LOCKED { stock_item_id }` — once a bowl has been sold against an item, its history is real and the way to fix a cost is `PATCH /api/admin/stock-items/:id` plus a `correction`, not a rewritten opening balance. Re-running it on an item that only has `opening` rows is allowed and replaces them with a `correction` to the new qty, because the first read-out is exactly where a typo happens. Writes `log('opening_set')` `{ n_items, total_value_fen }` and `bump('stock')`.

This is the route open decision 8 has been waiting on: without it the owner's 19 live rows keep `avg_cost_mfen = 0` forever and every variance, waste cost and *utrošak* prices at zero.

**Deliveries.** `createDelivery(db, venueId, actor, body): DeliveryView` — one transaction, always posted (a `draft` header is reserved for the Korak 3 scan flow): **replay by `(venue_id, client_id)` first**, like every other phone-born row; role admin, or bartender when `bartender_can_receive_goods`; `delivered_at = clampEventAt(body.delivered_at ?? at, at, max_sync_lag_h)`; per line `qty = packs × (pack_qty_used ?? item.pack_qty) + loose` (400 `INVALID_QTY` when ≤ 0, or `packs > 0` with no pack size), **`line_cost_fen` is `z.int().min(1)`** — a delivery you were not charged for is not a delivery, it is a `correction`, and a zero-cost line fed into the moving average drags every future variance toward 0,00 KM one paragraph after §3.1 closes that hole. `unit_cost_mfen = round(line_cost_fen × 1000 / qty)`, header `total_fen = Σ line_cost_fen`; one `insertMovement(type='delivery', occurred_at = delivered_at)` per line; then the moving average on the on-hand **before** the row: `avg = onHand <= 0 ? cost : round((onHand × avg + qty × cost) / (onHand + qty))`, `UPDATE stock_items SET avg_cost_mfen, last_cost_mfen`; `log('delivery_posted')`; `bump('stock')`. `reverseDelivery(db, venueId, actor, deliveryId, note)` — admin: 409 `DELIVERY_ALREADY_REVERSED` when `reversed_at` is set, one `correction` per line with `qty_delta = −line.qty` and the line's own cost, stamp `reversed_at/by/note`, `log('delivery_reversed')`. The average is not recomputed by a reversal — a reversal is not a purchase price. `recomputeAvgCost(db, venueId)` replays deliveries in order and a test proves the cached average matches it.

**Waste.** `logWaste(db, venueId, actor, body)` — replay by `client_id`; `occurred_at = clampEventAt(body.client_created_at, now, max_sync_lag_h, device.clock_skew_s)`; `cost_fen = round(qty × unitCost(item).mfen / 1000)`; the `waste` movement is written **immediately and always** (the bottle is broken whether or not anyone approves; approval is acknowledgement, not gating); `needs_approval = 1` when any of: `cost_fen ≥ waste_pin_threshold_fen`; the actor is not in `approver_roles` and the item is `kind='pice'` with `base_unit='kom'`; the actor is over `waste_events_per_shift_per_user`. Crossing the count cap also writes a non-quiet `log('waste_capped')`; a `needs_approval` event is a non-quiet `log('waste_logged')`. Waiter reasons are limited to `razbijeno|prosuto` (403 `REASON_FORBIDDEN`). `approveWaste` sets `approved_by/at` once (409 `WASTE_ALREADY_APPROVED`).

**Corrections.** `correctStock(db, venueId, actor, body)` — admin only; `qty_delta ≠ 0`; note required; `type ∈ correction|return_supplier` (the latter must be negative); `unit_cost_mfen` from `unitCost(item)`; `occurred_at = clampEventAt(body.occurred_at, now, max_sync_lag_h)` — the same clamp as every other body-supplied timestamp (§2), so a mistyped year cannot back-date a correction past a confirmed count and rewrite its theoretical stock; a legitimately back-dated one gets its offset from `insertMovement`. `log('stock_corrected')`.

**Counts** (`counts.ts`) — two states, no server-side draft and no witness route in Korak 2; the phone keeps the in-progress count in IndexedDB exactly like the cart:

```ts
export function submitCount(db, venueId, actor, body: SubmitCountBody): CountView
export function confirmCount(db, venueId, actor, countId, body): ConfirmResult
export function hasSubmittedCount(q, venueId, shiftId, phase): boolean
export function pendingFor(q, venueId, now): AttentionItem[]   // submitted counts awaiting confirm
```

`submitCount` creates and submits in one transaction, and **resolves the shift itself** — F1 step 3 wants the opening count to be possible before the first round is locked ("a šanker who submits the opening count before any lock gets his row from that count"), so requiring the custodian to call `POST /api/shifts/open` first would make the very first tap of the night an error:

| `phase` | shift |
|---|---|
| `open` | `ensureOpenShift(tx, venueId, actor, at)` — creates one if none, writing `log('shift_opened')` exactly as a first lock does — then `joinShift` and `setCustodian` |
| `close` | the open shift, else 409 `NO_OPEN_SHIFT` (there is nothing to close against) |
| `adhoc` | the open shift if there is one, else `shift_id = NULL` — a spot count on a quiet afternoon is still a count |

Then: `assertNoPendingOutbox(tx, venueId, shift.id, { actor, override: body.override })`; the `stock_counts_shift_phase_uq` index makes a second `open`/`close` count on the shift a 409 `COUNT_EXISTS { count_id }` caught from the constraint, not a hand-rolled pre-check that races; per line `counted_qty = weighed_g − tare_g` (weigh) or `packs × pack_qty + loose` (count), clamped at ≥ 0; `theoretical_qty = theoreticalAt(tx, item, submittedAt)`; `variance_qty`, `unit_cost_mfen` and `estimated` from `unitCost(item)`, `variance_fen = round(variance_qty × unit_cost_mfen / 1000)`; a line beyond `tolerance_qty` without a note → 422 `NOTE_REQUIRED { item_ids }`; a `spot` count must carry every active `is_spot` item → 422 `LINES_MISSING`; `log('count_submitted')`; `bump('count')`, `bump('stock')`.

`confirmCount` — admin. **`assertNoPendingOutbox(tx, venueId, count.shift_id, { actor, override: body.override })` runs first**, because F9 step 2 says submit *and confirm* refuse with 409 `PENDING_OUTBOX`, and confirm is the one that writes the adjustment: a round still sitting in a phone's outbox would land after the count and be counted as shrinkage. Then 422 `PRICE_MISSING { item_ids }` when any line with `|variance_qty| > tolerance_qty` has `unit_cost_mfen = 0` — which after the `unitCost` fallback means an item with neither an average nor a last cost, i.e. one the *Početno stanje* screen never got (confirming a variance you cannot price is exactly the moment to stop); per line `adjust = counted_qty − theoreticalAt(tx, item, submitted_at)` (late rounds that synced between submit and confirm are inside), non-zero → `insertMovement(type='count_adjust', occurred_at = submitted_at, ref_type='stock_count_line', ref_id = line.id)` and `UPDATE stock_count_lines SET applied_adjust`; header → `confirmed`; `log('count_confirmed', resolves = count_submitted)`; alert when `Σ |variance_fen| > variance_alert_fen`. Returns each line with `submitted_variance`, `applied_adjust`, `late_delta = adjust − variance_qty`.

`assertNoPendingOutbox` is `devices.ts`'s, imported through `contracts.ts` — one rule, one implementation, spelled out in §6.6. On a count the `override` writes `stock_counts.override_by`; stale devices come back as `stale_devices` and never block.

Shapes (`shared/types/stock.ts`):

```ts
export interface CountView { id, kind, phase, shift_id: string | null, status,
  counted_by, counted_by_name, submitted_at, confirmed_by: string | null, confirmed_at: string | null,
  override_by: string | null, note: string | null,
  lines: { stock_item_id, item_name, base_unit, counted_qty, theoretical_qty, variance_qty,
           unit_cost_mfen, variance_fen, estimated: boolean, applied_adjust: number | null,
           note: string | null }[],
  totals: { lines: number, out_of_tolerance: number, variance_fen: number },
  stale_devices: StaleDevice[] }
export interface ConfirmResult { count: CountView,
  lines: { stock_item_id, submitted_variance: number, applied_adjust: number, late_delta: number }[] }
export interface DeliveryView { id, client_id, supplier_name, invoice_no: string | null,
  delivered_at, total_fen, status, reversed_at: string | null, entered_by, entered_by_name,
  note: string | null,
  lines: { stock_item_id, item_name, packs, loose, qty, line_cost_fen, unit_cost_mfen }[],
  already_applied: boolean }
export interface WasteView { id, stock_item_id, item_name, qty, reason, cost_fen,
  estimated: boolean, needs_approval: boolean, approved_by: string | null,
  on_hand: number, already_applied: boolean }
export interface StockItemAdmin { /* the row, plus */ on_hand: number, status: StockStatus,
  estimated: boolean }
```

**Reports** (`reports.ts`, read-only): `ownerStock`, `itemMovements`, `categoriesReport(db, venueId, fromIso, toIso)`, `nargilaReport(db, venueId, fromIso, toIso)`. Period bounds come from `shared/dates.ts` (`[06:00 of the first business day, 06:00 after the last)`). *Nabavka* = Σ `delivery_lines.line_cost_fen` of posted deliveries + reversal corrections − `return_supplier`, grouped by `stock_items.category_id`. *Prodaja* = Σ `charged_fen` − applied void `amount_fen`, grouped by `products.category_id`. *Utrošak* = Σ `−qty_delta × unit_cost_mfen / 1000` over `sale|sale_storno`. *Otpis* = the same over `waste|count_adjust|late_sync`. The nargila report reads `početno_g` from the last confirmed count before `from` (else `theoreticalAt(from)`), `primljeno_g` from deliveries in the period, `završno_g` from the last confirmed count inside it (else `theoreticalAt(to)` flagged `estimated`), `prodano_lula` from `countBowls`, and prices the difference at the cheapest active shisha product.

### 6.9 `server/services/log.ts`

```ts
export function log(tx: Tx, venueId: string, e: {
  kind: LogKind, body: unknown, actorId?: string | null, deviceId?: string,
  ref?: { type: string, id: string }, shiftId?: string, resolvesId?: string,
}): string
export function listLog(db, venueId, q: LogQuery): { entries, next_cursor?, max_at }
export function getLogEntry(db, venueId, id): LogEntry & { request?, resolver? }
export function markLogSeen(db, venueId, userId, at): { log_seen_at: string }
```

`log` parses `body` with `LOG[kind].body` (Zod), renders `title_bs = LOG[kind].title(body, names)` with lazy name lookups (`user`, `product`, `table`, `category`, `stockItem`, `device`, `formatKm`, `localTime`), computes `business_date` once, inserts, `bump('log')`, and when `LOG[kind].alert` matches, queues the attention item as:

```ts
queueAlert(tx, venueId, {
  ruleKey: LOG[kind].alert.rule,
  ref: e.ref ?? { type: 'log', id: logId },   // ← the object, not the entry
  payload: { title_bs, log_id: logId },
})
```

**The `ref` must be the object the alert is about, not the entry that described it.** `alert_events`' dedupe key is `(venue_id, rule_key, ref_type, ref_id)` with `INSERT OR IGNORE`, and a fresh log-entry uuid per event makes it a key that never collides and therefore never dedupes — the mechanism would be decoration. Passing the caller's own `ref` gives it teeth: a void decided twice on the same adjustment queues one `void_after_payment`; a shift closed and then re-summarised queues one `shift_closed` for `('shift', shift_id)`; `count_confirmed` dedupes on the count. `LOG[kind].alert.rule` therefore also fixes the *shape* of the ref a caller must pass, and `log.test.ts` asserts every alert-bearing kind is called with a `ref` in the fixture. The fallback to the entry id exists only for a kind with no natural object, and the heartbeat's `clock_skew` keeps its own composed key (`deviceId + ':' + businessDate` — once per device per business date). A `resolvesId` marks the request entry resolved. An unknown kind throws 500 `LOG_TEMPLATE_MISSING`, which is why `LOG_KINDS` is frozen in `shared/logTemplates.ts` and `kind` is typed `LogKind` — a call to a missing kind is a typecheck error, not a shift close that fails at 03:10.

`shared/types/sync.ts` again, since `log_entries` is WP5's:

```ts
export interface LogEntry {
  id: string, kind: LogKind, title_bs: string, body: Record<string, unknown>,
  ref_type: string | null, ref_id: string | null,
  actor_id: string | null, actor_name: string | null,    // null actor renders as "Sistem"
  device_label: string | null, shift_id: string | null,
  business_date: string, at: string,
  resolves_id: string | null, redacted: boolean, quiet: boolean,
}
```

`listLog` is a keyset cursor on `(created_at, id)`; `important=1` hides the quiet kinds unless the entry resolves one, and attaches the resolved request inline. Bodies carry ids and integers plus `before`/`after` through a per-entity whitelist; never a hash, token, email or chat id.

### 6.10 `server/services/alerts.ts`, `admin.ts`, `owner.ts`

```ts
export function queueAlert(tx: Tx, venueId, a: { ruleKey, ref: { type, id }, payload }): string | null
export function sendAfter(rule: AlertRuleKey, at: string, tz: string): string
```

`queueAlert` is `INSERT OR IGNORE` on the unique key (a second call for the same object is a no-op), with `send_after = now`, or the next 10:00 local when the local time is 03:00–10:00 and the rule is not `shift_closed`, `cash_variance` or `health`. It is synchronous and writes inside the caller's transaction, like `log` and `bump`. **There is no drainer and no sender** — nothing in Šank sends anything outward (§9); `alert_events` is the in-app attention list's own table and `/admin` reads it directly, filtering on `send_after <= now`.

`admin.ts` — one exported function per route, every write one transaction with `log()` + `bump()`: `listProducts/createProduct/updateProduct` (a `price_fen` change closes the open `price_history` row and inserts a new one, `log('price_changed')`, `bump('menu')`), `setRecipe` (delete + insert, atomic), category / table / stock-item CRUD (`base_unit` immutable once a movement exists → 409 `UNIT_FROZEN`; creating a stock item requires `last_cost_mfen > 0`), `createUser`/`updateUser` (an admin cannot deactivate himself → 400 `SELF_DEACTIVATE`; PIN length 4 or 6 checked against nothing but the body — both are legal for every role, 6 is recommended for admins), `getSettings`/`updateSettings` (one `settings_changed` entry per changed key). Admin never deletes: `active = 0`, `available = 0`, `revoked_at`. Devices and PIN reset live in the auth package's `devices.ts`, not here.

`owner.ts` — `getLive(db, venueId, actor, now): OwnerLive`, plus `getOwnerShift`/`listOwnerShifts`/`shiftLines` re-exported from `summaries.ts` and `shifts.ts` so the route files import from one place.

```ts
export interface OwnerLive {
  seq: number
  shift: ShiftBrief | null
  promet_danas_fen: number
  open: { tables: number, total_fen: number }
  expected_cash_fen: number            // === expectedCash(...).venue_expected_fen, asserted in tests
  storna: { count: number, fen: number }
  gratis: { count: number, fen: number }
  self_voids: { count: number, fen: number }
  waste: { count: number, fen: number }
  who: { user_id, name, initials, joined_at, promet_fen, open_tabs, settled }[]
  unsent: StaleDevice[]
  pending: { adjustments: number, unpaid: number, payouts: number, settlements: number }
  attention: AttentionItem[]            // decidable — every row has a route behind its buttons
  flags: Flag[]                         // derived and self-clearing — see §1
  last_lines: LineRow[]                 // 20
  tables: TableState[]
  log_max_at: string
}
```

**`attention[]` is assembled, never queried.** `owner.ts` writes no cross-package SQL; it concatenates one function per package, all with the identical signature, all declared in the export block of their own §6 subsection and all in `contracts.ts`:

```ts
export function pendingFor(q: Queryable, venueId: string, now: string): AttentionItem[]
```

exported by `adjustments.ts` (pending voids and comps), `tabs.ts` (unpaid tabs with `pending_review`), `cash.ts` (pending `payout` and `float_out`), `shifts.ts` (a `closing` shift's unsettled waiters), `settlements.ts` (settlements awaiting acceptance) and `counts.ts` (submitted counts awaiting confirm).

```ts
export interface AttentionItem {
  kind: 'void' | 'comp' | 'unpaid_tab' | 'payout' | 'float_out'
      | 'settlement' | 'count' | 'waste'
  ref_type: 'line_adjustment' | 'tab' | 'cash_movement' | 'waiter_settlement'
          | 'stock_count' | 'waste_event'
  ref_id: string
  title_bs: string                      // "Traži storno · Amar · Sto 7 · 2 × Kafa 4,00 KM"
  amount_fen?: number
  at: string                            // oldest first on the screen
  actions: ('approve' | 'reject' | 'note')[]
}
export interface Flag {                 // derived every read, cleared by the condition going away
  kind: 'clock_skew' | 'early_close' | 'stale_device' | 'uncovered_payment'
      | 'no_opening_count' | 'cross_waiter_lock' | 'late_after_close' | 'opening_float_unknown'
  title_bs: string
  ref_type: string, ref_id: string, at: string
}
```

Every `AttentionItem.actions` entry maps to a route that exists in §7 — that is the invariant `owner-live.test.ts` checks, walking the F11 kind list and asserting each `(kind, action)` pair resolves to a `ROUTE_ROLES` key. Anything that is only *information* is a `Flag`, and a `Flag` disappears on its own; nothing in Korak 2 can pile up unacknowledged (§1).

---

## 7. API — the complete route table

Every route: `readValidatedJson(event, schema)` → `guard(() => service(useDb(), event.context.venueId, event.context.actor, body))`. Role comes from `ROUTE_ROLES` (deny by default). `A` = admin, `W` = waiter, `B` = bartender. Bodies live in `shared/schemas.ts` (Zod 4: `z.uuid()`, `z.int()`, `z.iso.datetime()`); money fields are `z.int().min(0).max(10_000_000)`. Common errors omitted from each row: 400 `INVALID_BODY`/`INVALID_PARAM`, 401 `NO_SESSION`/`SESSION_REVOKED`/`DEVICE_REVOKED`/`DEVICE_MISMATCH`, 403 `FORBIDDEN`, 429 `RATE_LIMITED`.

### Auth and devices

| Route | Role | Body | Response | Errors |
|---|---|---|---|---|
| `POST /api/auth/admin/login` | public | `{ email: z.email().max(120), password: z.string().min(1).max(200) }` | `{ user: MeUser, venue, expires_at }` + `sank_s` | 401 `INVALID_CREDENTIALS` |
| `POST /api/devices/enrol` | public | `{ code: z.string().length(6), label?: ≤40, app_version?: ≤20 }` | `{ device, venue }` + `sank_d` | 400 `ENROL_CODE_INVALID` |
| `POST /api/auth/pin` | public (needs `sank_d`) | `{ user_id, pin: /^\d{4}$\|^\d{6}$/, borrow?: boolean }` | `{ user: MeUser, session, device }` + `sank_s` | 401 `NO_DEVICE`, `INVALID_PIN {fails_left}`; 423 `LOCKED {retry_after_s}`; 403 `ADMIN_DEVICE_ONLY`, `NOT_YOUR_DEVICE` |
| `GET /api/auth/pin-len` | public (needs `sank_d`) | — | `{ pin_len: 4 \| 6 }` — how many digits the pad waits for; a venue's PINs are one length | 401 `NO_DEVICE` |
| `GET /api/auth/users` | any | — | `MeUser[]` (active staff of the session's venue) | 401 `NO_SESSION` |
| `POST /api/auth/logout` | any | `{}` | `{ ok: true }`; clears `sank_s` only | — |
| `GET /api/me` | any | — | `MeContext { user: MeUser, session: { id, kind, expires_at, borrowed }, device: DeviceBrief \| null, venue: { id, name, slug, settings }, seq }` — `getMe(q, venueId, actor)` in `services/auth.ts` | — |
| `POST /api/devices/heartbeat` | any | `{ pending: z.int().min(0), oldest_pending_at?: iso, client_now: iso, app_version: ≤40, standalone: boolean }` | `{ server_now, clock_skew_s, seq, shift_closing }` | — |
| `POST /api/dev/enrol` | public, `SANK_DEV_ENROL=1` | `{}` | `{ device, venue }` + `sank_d` | 404 `NOT_FOUND` in every other environment |

### Orders, tabs, payments, adjustments

| Route | Role | Body | Response | Errors |
|---|---|---|---|---|
| `POST /api/orders` | A W B | `createOrderBody { client_id, table_id, tab_client_id?, note?, client_created_at?, lines[1..50]{ id, product_id, qty 1..99, flavour_ids?[1..3], note?, comp_reason?, parent_line_id? } }` | `CreateOrderResult` | 404 `TABLE_NOT_FOUND`/`PRODUCT_NOT_FOUND`/`FLAVOUR_NOT_FOUND`; 400 `FLAVOURS_REQUIRED`/`FLAVOURS_NOT_ALLOWED`; 409 `TAB_TABLE_MISMATCH` |
| `GET /api/tables/state` | A W B | — | `TablesStateResponse { seq, shift: ShiftBrief \| null, tables: TableState[] }` — every field shaped in §6.2 (ETag, role+user tag) | — |
| `GET /api/tabs/:id` | A W B | — | `TabDetail` (§6.2) | 404 `TAB_NOT_FOUND` |
| `POST /api/payments` | A W B | `createPaymentBody { client_id, tab_id?, tab_client_id?, method, amount_fen, received_fen?, tip_fen, covers_order_client_ids[], client_created_at? }` | `PaymentResult` | 404 `TAB_NOT_FOUND`; 409 `TAB_ALREADY_PAID {paid_by,at}`, `TAB_VOIDED`; 422 `OVERPAY {remaining_fen}`; 400 `METHOD_NOT_ALLOWED`, `INVALID_COVERS` |
| `POST /api/tabs/unpaid` | A W B | `markUnpaidBody { client_id, tab_client_id, reason: walked_out\|dispute\|other, note?, client_created_at? }` | `UnpaidResult` | 403 `NOT_ASSIGNED`; 409 `TAB_ALREADY_PAID`, `NOTHING_TO_MARK` |
| `POST /api/tabs/:id/unpaid/decide` | A | `{ outcome: otpis\|naplatiti, note? }` | `Tab` | 409 `NOT_PENDING` |
| `POST /api/tabs/:id/move` | A W B | `{ table_id }` | `Tab` | 404 `TABLE_NOT_FOUND`; 409 `TAB_CLOSED`, `TABLE_OCCUPIED` |
| `POST /api/tabs/:id/assign` | A W B | `{ user_id }` — offer the tab to a colleague (§6.2), online-only | `Tab` | 403 `NOT_ASSIGNED`; 400 `INVALID_TARGET`; 409 `TAB_CLOSED` |
| `POST /api/tabs/:id/accept` | A W B | `{}` — take an offered tab | `Tab` | 403 `NOT_OFFERED`; 409 `TAB_CLOSED` |
| `POST /api/adjustments` | A W B | `createAdjustmentBody { client_id, order_line_id, kind, reason (discriminated by kind), note?, approver_user_id?, pin? }` `.strict()` | `AdjustmentResult` | 404 `LINE_NOT_FOUND`; 409 `LINE_ALREADY_ADJUSTED`, `TAB_VOIDED`; 400 `NOTE_REQUIRED`; 401 `INVALID_PIN`; 403 `SELF_APPROVAL`, `ADMIN_PIN_FOREIGN_DEVICE` |
| `POST /api/adjustments/:id/decide` | A B | `{ outcome: applied\|rejected, restock?, refund?: none\|from_waiter\|from_drawer, note?, pin? }` — PIN-bearing whenever `pin` is present (§5.2) | `AdjustmentResult` | 409 `ALREADY_DECIDED`; 403 `SELF_APPROVAL`, `ADMIN_FOREIGN_DEVICE`, `WINDOW_EXPIRED`; 401 `INVALID_PIN` |
| `GET /api/adjustments/pending` | A W B | — | `PendingAdjustment[]` (scoped by role) | — |
| `POST /api/drafts/discard` | A W B | `{ table_id, lines: z.int().min(1), total_fen }` | `{ ok: true }` | 404 `TABLE_NOT_FOUND` |
| `GET /api/prep` | A W B | — | `{ seq, open, done }` (ETag) | — |
| `POST /api/prep/:orderId/done` | A W B | `{}` | `PrepOrder` | 409 `ORDER_ALREADY_PREPARED` |

### Shifts, cash, settlement

| Route | Role | Body | Response | Errors |
|---|---|---|---|---|
| `POST /api/shifts/open` | A W B | `{}` | `Shift` | 409 `SHIFT_ALREADY_OPEN` |
| `POST /api/shifts/:id/closing` | A B | `{}` | `Shift` | 409 `SHIFT_CLOSED` |
| `POST /api/shifts/:id/close` | A B | `{ cash_counted_fen, closing_note?≤500, pin, override_no_open_count?: boolean }` | `CloseResult { shift, summary_version, missing_settlements[], outstanding_fen }` | 409 `OPEN_TABS {tabs}`, `NO_OPEN_COUNT`, `SHIFT_CLOSED`; 422 `NOTE_REQUIRED`; 401 `INVALID_PIN` |
| `POST /api/shifts/:id/force-close` | A | `{ note: min 3 }` | `CloseResult` | 409 `SHIFT_CLOSED` |
| `POST /api/shifts/:id/review` | A | `{ card_total_fen?, closing_note? }` | `Shift` | 409 `SHIFT_NOT_CLOSED`; 422 `NOTE_REQUIRED` |
| `POST /api/shifts/:id/settle` | A W B (self) | `{ declared_fen, outbox_len: z.int().min(0), receiver_user_id?, receiver_pin?, override?: boolean }` | `SettleResult` | 409 `SETTLED`, `PENDING_OUTBOX {devices}`; 401 `INVALID_PIN`; 403 `NOT_APPROVER` |
| `POST /api/shifts/:id/settlements/:sid/accept` | A B | `{}` | `Settlement` | 409 `ALREADY_ACCEPTED`; 403 `OWN_SETTLEMENT` |
| `POST /api/shifts/:id/leave` | A W B (self) | `{}` | `{ left_at }` | 409 `ALREADY_LEFT` |
| `POST /api/shifts/:id/float` | A B | `{ type: float_in\|float_out, user_id, amount_fen, note? }` | `CashMovement` | 409 `SHIFT_CLOSED`; 404 `USER_NOT_FOUND` |
| `POST /api/shifts/:id/payout` | A W B | `{ amount_fen: positive, reason: dobavljac\|sitno\|ostalo, note? }` | `CashMovement & { needs_owner }` | 409 `SHIFT_CLOSED` |
| `POST /api/shifts/:id/pickup` | A | `{ amount_fen: positive, note? }` | `CashMovement` | — |
| `POST /api/shifts/:id/opening-float` | A | `{ fen }` | `Shift` | 409 `SHIFT_CLOSED` |
| `POST /api/cash-movements/:id/decide` | A B | `{ outcome: approved\|rejected, note?, pin? }` — decides `payout` and `float_out` only (§6.5) | `CashMovement` | 409 `ALREADY_DECIDED`, `NOT_PENDING`; 403 `SELF_APPROVAL`, `OWNER_REQUIRED`; 401 `INVALID_PIN` |
| `POST /api/cash-movements/:id/ack` | A W B (receiver) | `{}` | `CashMovement` | 403 `NOT_RECEIVER`; 409 `ALREADY_DECIDED` |
| `GET /api/me/shift` | A W B | — | `MyShift` (§6.7) | — |
| `GET /api/me/shift/lines?kat=&cursor=` | A W B | — | `{ rows, totals, next_cursor? }` (`totals: null` before own settlement) | — |
| `GET /api/me/shifts?limit=30` | A W B | — | `MyShiftRow[]` — `listMyShifts` (§6.7) | — |

### Stock

| Route | Role | Body | Response | Errors |
|---|---|---|---|---|
| `GET /api/stock` | A W B | — | `{ seq, items }` (ETag) | — |
| `POST /api/stock/opening` | A | `{ note?≤200, lines[1..300]{ stock_item_id, qty ≥0, unit_cost_mfen: z.int().min(1) } }` — the *Početno stanje* screen (§6.8) | `StockItemAdmin[]` | 409 `OPENING_LOCKED {stock_item_id}`; 404 `STOCK_ITEM_NOT_FOUND` |
| `POST /api/stock/deliveries` | A (+B if `bartender_can_receive_goods`) | `{ client_id, supplier_name 1..80, invoice_no?≤40, delivered_at?: iso, note?, lines[1..200]{ stock_item_id, packs ≥0, loose ≥0, pack_qty_used?, line_cost_fen: z.int().min(1), note? } }` | `DeliveryView` | 400 `INVALID_QTY`; 404 `STOCK_ITEM_NOT_FOUND` |
| `GET /api/stock/deliveries?from&to` | A (+B) | — | `DeliveryView[]` | — |
| `POST /api/stock/deliveries/:id/reverse` | A | `{ note: 3..200 }` | `DeliveryView` | 409 `DELIVERY_ALREADY_REVERSED` |
| `POST /api/stock/waste` | A W B | `{ client_id, stock_item_id, qty >0, reason, note?, approver_user_id?, pin?, client_created_at? }` | `WasteView { id, needs_approval, cost_fen, on_hand, already_applied }` | 403 `REASON_FORBIDDEN`; 404 `STOCK_ITEM_NOT_FOUND` |
| `POST /api/stock/waste/:id/approve` | A B | `{}` | `WasteView` | 409 `WASTE_ALREADY_APPROVED` |
| `POST /api/stock/corrections` | A | `{ stock_item_id, type: correction\|return_supplier, qty_delta ≠0, note 3..200, occurred_at?: iso }` | `StockItem` | 400 `INVALID_QTY` |
| `POST /api/stock/counts` | A W B | `{ kind: spot\|full, phase: open\|close\|adhoc, note?, override?: boolean, lines[1..300]{ stock_item_id, packs?, loose?, weighed_g?, note? } }` | `CountView` + lines with `variance_*`, `stale_devices[]` | 409 `PENDING_OUTBOX {devices}`, `NO_OPEN_SHIFT`, `COUNT_EXISTS`; 422 `NOTE_REQUIRED {item_ids}`, `LINES_MISSING` |
| `POST /api/stock/counts/:id/confirm` | A | `{ override?: boolean, note? }` | `ConfirmResult` | 409 `COUNT_ALREADY_CONFIRMED`, `PENDING_OUTBOX`; 422 `PRICE_MISSING {item_ids}` |
| `GET /api/stock/counts?shift_id&status`, `GET /api/stock/counts/:id` | A W B | — | `CountView[]` / `CountView` | 404 `COUNT_NOT_FOUND` |

### Sync, owner reads, admin

| Route | Role | Body | Response |
|---|---|---|---|
| `GET /api/changes?since=<int≥0>` | any | — | `ChangesResult` (ETag, 304) |
| `GET /api/bootstrap` | any | — | `{ seq, venue, me, device, shift, menu_version, users, tables, categories, products, flavours }` (ETag) |
| `GET /api/health` | public | — | `{ ok, tables, products }` |
| `GET /api/owner/live` | A | — | `OwnerLive` (ETag) |
| `GET /api/owner/shifts?from&to` | A | — | `OwnerShiftRow[]` — `listOwnerShifts` in `shifts.ts` (§6.5) |
| `GET /api/owner/shift/:id` | A | — | `OwnerShift` (ETag, role+user tag) |
| `GET /api/owner/shift/:id/summary` | A | — | latest `shift_summaries` row with names joined |
| `GET /api/owner/shift/:id/lines?user=&kat=&cursor=` | A | — | `{ rows, totals, next_cursor? }` |
| `GET /api/owner/stock`, `/api/owner/stock/:itemId/movements?before&limit` | A | — | stock lists / ledger page |
| `GET /api/owner/categories?from&to`, `GET /api/owner/nargila?month=YYYY-MM` | A | — | the two §9 reports |
| `GET /api/owner/log?before&after&kind&group&actor&from&to&important&limit≤100`, `GET /api/owner/log/:id`, `POST /api/owner/log/seen` | A | — / `{}` | Dnevnik |
| `GET/POST /api/admin/products`, `PATCH /api/admin/products/:id`, `PUT /api/admin/products/:id/recipe` | A | see §6.10 | `Product` / `RecipeLine[]` |
| `GET/POST /api/admin/categories`, `PATCH /:id` | A | `{ name ≤40, kind, note_chips[], sort, active }` | `Category` |
| `GET/POST /api/admin/tables`, `PATCH /:id` | A | `{ name ≤20, zone, col 1..12, row 1..12, grp?, sort, active }` | `VenueTable` (409 `TABLE_HAS_OPEN_TAB` on deactivate) |
| `GET/POST /api/admin/stock-items`, `PATCH /:id` | A | `{ name, kind, base_unit, category_id?, brand?, pack_name?, pack_qty?, count_method, tare_g?, tolerance_qty, par_qty?, last_cost_mfen > 0, is_spot, available, active }` | `StockItemAdmin` (409 `UNIT_FROZEN`) |
| `GET/POST /api/admin/users`, `PATCH /:id`, `POST /:id/pin` | A | `{ name, initials ≤3, role: admin\|waiter\|bartender, pin }` / patch / `{ pin }` | `User` (400 `SELF_DEACTIVATE`, `PIN_LENGTH`) |
| `GET /api/admin/devices`, `PATCH /:id`, `POST /:id/revoke`, `POST /:id/unlock` | A | `{ label ≤40 }` / `{}` / `{}` | `DeviceAdmin { id, label, mode, bound_user_id, bound_user_name, enrolled_at, last_seen_at, app_version, standalone, pending_count, clock_skew_s, locked_at, revoked_at }` (409 `DEVICE_ALREADY_REVOKED`) — `unlock` clears `locked_at` **and** the device's `auth_attempts` counter, unconditionally. It does not check `locked_at` first: only the 15-fail step writes that column, while the 60-second and 15-minute steps are counted and never flagged, and the pad's failures are filed against the device with `user_id NULL` so no PIN reset reaches them. A guard on the flag made the owner's one key answer "not locked" to a tablet nobody could type on (§5.2) |
| `POST /api/admin/enrol-codes` | A | `{ mode: personal\|shared, bound_user_id?, label 1..40 }` | `{ code, expires_at, uses_left }` (400 `BOUND_USER_REQUIRED`) |
| `GET /api/admin/settings`, `PATCH /api/admin/settings` | A | `settingsSchema.partial()` | `Settings` (merged) |

---

## 8. Log kinds

`shared/logTemplates.ts` — `LOG[kind] = { body: ZodType, title(body, names): string, quiet?: true, alert?: { rule, when?(body) }, group }`. `LOG_KINDS` is frozen for Korak 2; `kind` is typed, so a call to an undefined kind fails typecheck. ✔ = raised onto the in-app attention list (§9). Locks and payments are **not** entries.

| kind | Bosnian title template | body fields | written when | quiet | ✔ |
|---|---|---|---|---|---|
| `shift_opened` | Smjena otvorena · {user} · {time} · automatski (prva tura) | shift_id, auto | `ensureOpenShift` creates a shift, from a first lock or an opening count (§6.8) | | |
| `shift_closed` | Smjena zatvorena · {user} · pazar {promet} · gotovina {cash} · razlika {diff} | summary numbers, early_close, per-waiter lines | `closeShift` | | ✔ |
| `shift_forced` | Smjena prisilno zatvorena · {user} · {note} | missing_user_ids | `forceClose` | | ✔ |
| `shift_reviewed` | Smjena pregledana · {user} · kartica {card_total} | card_diff_fen | `reviewShift` | | |
| `waiter_finished` | Završena smjena · {user} · {from}–{to} · promet {promet} · predao {declared} · {tolerance word} | summary_json | `settle` | | ✔ if outside tolerance |
| `settlement_late` | Naknadna predaja · {user} · {declared} | settlement_id | `settle` on a closed shift | | ✔ |
| `settlement_accepted` | Predaja primljena · {receiver} · od {user} · {declared} | settlement_id | `acceptSettlement`, or a receiver PIN at settle | | |
| `void_requested` | Traži storno · {user} · {table} · {line} {amount} | adjustment fields | `requestAdjustment` → pending | ✔quiet | |
| `void_decided` | Storno {odobren\|odbijen} · {approver} · {user} · {table} · {line} {amount}{· nakon naplate}{· na tuđem telefonu} | was_paid, foreign_device, restock, refund_kind | `decideAdjustment`, or an auto/PIN apply | | ✔ if `was_paid` or `foreign_device` |
| `self_void_capped` | Storno ide šankeru · {user} · prekoračen limit ({n}/{max}) | count, fen | rule 1 falls through on a cap | | |
| `comp_requested` / `comp_decided` | Traži gratis / Gratis {odobren\|odbijen} · {approver} · {user} · {line} {amount} | reason | `requestAdjustment` / `decideAdjustment` | requested only | ✔ over `comp_large_fen` |
| `unpaid_marked` | Nije plaćeno · {user} · {table} · {remaining} · {reason} | tab_id, reason | `markUnpaid` | ✔quiet | |
| `unpaid_decided` | Nenaplaćeno {otpisano\|na naplatu} · {admin} · {table} · {amount} | outcome | `decideUnpaid` | | |
| `payment_reversed` | Vraćeno gostu · {approver} · {table} · {amount} · {method} | adjustment_id, refund_kind | `insertReversal` or `insertRefund` | | ✔ |
| `pay_duplicate_attempt` | Pokušaj druge naplate · {user} · {table} · već naplatio {paid_by} | tab_id, paid_by | `createPayment` on a paid tab (own transaction) | ✔quiet | |
| `pay_uncovered` | Naplata bez pokrića · {user} · {table} | tab_id | payment leaving another waiter's round uncovered | ✔quiet | |
| `tab_moved` | Račun prebačen · {user} · {from} → {to} | tab_id | `moveTab` | ✔quiet | |
| `tab_offered` | Sto ponuđen · {user} → {target} · {table} | tab_id, to | `assignTab` (§6.2) | ✔quiet | |
| `tab_handed` | Sto preuzet · {to} · od {from} · {table} | tab_id, from, to | `acceptTab` (§6.2) | | |
| `cross_waiter_lock` | Tura na tuđem stolu · {user} · {table} · vodi {assigned_to} | tab_id, order_id, assigned_to, locked_by | `createOrder` step 7b, when `allow_cross_waiter_rounds` lets it through | ✔quiet | |
| `draft_discarded` | Odbačena nezaključana narudžba · {user} · {table} · {n} stavki · {total} | table_id, lines, total_fen | `POST /api/drafts/discard` at close (F10 step 1) | ✔quiet | |
| `late_after_settle` | Tura nakon predaje · {user} · {table} · {amount} | order_id, shift_seq | `createOrder` with `post_settle`, and `createPayment` with `post_settle` (§6.3) | | ✔ |
| `late_after_close` | Nakon zatvaranja · {user} · {table} · {amount} · {count}. tura | tab_id, order_id, shift_id, amount_fen, count | `resolveTab`'s late branch (§6.1 step 7) | | ✔ |
| `float_moved` | Pazar iz kase · {creator} → {user} · {amount} | movement_id, type | `moveFloat` | | |
| `float_override` | Početni polog ispravljen · {admin} · {before} → {after} | before, after | `setOpeningFloat` | | |
| `payout_requested` / `payout_decided` | Isplata iz kase · {user} · {amount} · {reason} · čeka odobrenje / Isplata {odobrena\|odbijena} · {approver} | movement_id | `requestPayout` / `decideCashMovement` | | ✔ on `requested` over `payout_owner_fen` (rule `payout_pending`); `decided` is never mirrored — the owner is the decider |
| `pickup` | Uzeto iz kase · {admin} · {amount} | movement_id | `pickup` | | |
| `override` | Preskočeno pravilo · {admin} · {what} | what | any admin override | | |
| `delivery_posted` / `delivery_reversed` | Prijem robe proknjižen · {user} · {supplier} · {total} · {n} stavki / Prijem storniran · {admin} · {note} | delivery_id | `createDelivery` / `reverseDelivery` | | |
| `count_submitted` / `count_confirmed` | Popis predan · {user} · {n} stavki · {k} van tolerancije / Popis potvrđen · {admin} · manjak {fen} · {k} stavki korigovano | count_id, variance | `submitCount` / `confirmCount` | | ✔ over `variance_alert_fen` |
| `waste_logged` / `waste_capped` | Otpis · {user} · {item} {qty} · {cost} · {reason} / Otpis iznad limita · {user} · {n}. put u smjeni | waste_id | `logWaste` | quiet unless `needs_approval` | |
| `stock_corrected` | Zaliha ispravljena · {admin} · {item} {qty_delta} · {note} | movement_id | `correctStock` | | |
| `opening_set` | Početno stanje uneseno · {admin} · {n_items} stavki · {total_value} | n_items, total_value_fen | `setOpeningStock` (§6.8) | | |
| `price_changed` | Cijena promijenjena · {admin} · {product} {before} → {after} | before, after | `updateProduct` | | |
| `product_changed` / `category_changed` / `table_changed` / `stock_item_changed` / `recipe_changed` | {Entity} promijenjen · {admin} · {name} · {what} | before/after whitelist | admin CRUD | | |
| `settings_changed` | Postavke promijenjene · {admin} · {label} {before} → {after} | key, before, after | one per changed key | | |
| `user_changed` | {Konobar dodan\|PIN resetovan\|deaktiviran} · {admin} · {name} | what | `createUser`/`updateUser`/`resetPin` | | |
| `device_enrolled` / `device_revoked` | Uređaj prijavljen / odjavljen · {admin} · {label} | device_id | enrol / revoke | | |
| `device_unlocked` | Uređaj otključan · {admin} · {label} | device_id, via (`reset_pin\|unlock`) | `resetPin` clearing a lock, or `POST /api/admin/devices/:id/unlock` (§5.2) | | |
| `lockout` | PIN zaključan · {device} · {n} pogrešnih | device_id, user_id, fails | 10th consecutive failure | | ✔ |
| `clock_skew` | {device}: sat kasni {n} min | device_id, skew_s | heartbeat over the threshold | | |

---

## 9. Alerts v1

**Nothing is sent anywhere. There is no Telegram, no e-mail, no push, no web hook and no bot.** The *Dnevnik* and the in-app attention list on *Puls* are the only two channels the owner has, and both live behind his own login. This is a product decision, not a missing feature: the owner reads the app, the app does not chase him.

What survives is `alert_events` + `queueAlert` — the **in-app *obavijesti* record**. It is the subset of Dnevnik entries worth surfacing at the top of *Puls* rather than leaving in the stream: already deduped on the object, already time-gated, already carrying the `log_id` that `/admin/dnevnik/:id` opens. `/admin` (Phase 2) reads the table directly with `sent_at` ignored and `send_after <= now`.

Removed with the sending: `AlertSender` and both implementations, `drainAlerts`, `server/tasks/alerts.ts`, `server/plugins/alerts.ts`, `TELEGRAM_BOT_TOKEN`, and `users.telegram_chat_id` (dropped by migration `0002_no_telegram.sql` — a plain SQLite `DROP COLUMN`, safe because no index, trigger or view named the column). `alert_events.sent_at`, `attempts` and `last_error` stay in the schema as unwritten leftovers rather than costing a table rebuild; a reader must not treat `sent_at IS NULL` as "not yet delivered", because nothing delivers.

Rule keys (v1), frozen in `shared/constants.ts` as `ALERT_RULE_KEYS`: `shift_closed`, `shift_forced`, `cash_variance` (a `waiter_finished` outside tolerance — the tolerance word and `declared_fen`, never the diff), `settlement_late`, `void_after_payment` (`void_decided` with `was_paid` or `foreign_device`), `payment_reversed`, `comp_large`, `late_after_settle`, `late_after_close`, `stock_variance` (`count_confirmed` over `variance_alert_fen`), `payout_pending`, `device_lockout`, `health` (a backup or nightly task failure). Dedupe on `(venue_id, rule_key, ref_type, ref_id)` with `INSERT OR IGNORE`; quiet hours 03:00–10:00 local via `send_after`, with `shift_closed`, `cash_variance` and `health` exempt — an item queued at 04:00 is written and kept, it simply does not head the list before 10:00. Every payload carries `title_bs` and `log_id`, so a row on *Puls* links to `/admin/dnevnik/<log_id>`. The hourly cap, the digest and in-app acknowledgement are Korak 3.

**§8's ✔ column and this list are one set, checked by a test.** `queueAlert` needs a `rule_key`, so a kind marked ✔ with no key here is a kind that would throw at 03:10 on a shift close. `alerts.test.ts` asserts both directions: every `LOG[kind].alert.rule` is in `ALERT_RULE_KEYS`, and every key in `ALERT_RULE_KEYS` is either produced by some `LOG[kind].alert` or by a named non-log caller (`health` from `server/tasks/*`, `clock_skew` from the heartbeat's own composed key, §4.3). That is why `shift_opened` and `payout_decided` lost their ✔ — an item for every shift opening is noise, and telling the owner about the decision he just made is noise — and why `settlement_late`, `payment_reversed` and `late_after_close` gained keys.

---

## 10. Deploy and ops

Five of the seven files are copied from `~/Projects/snajper/deploy` and renamed (`setup-server.sh`, `deploy.sh`, `snajper.service` → `sank.service`, `backup-db.sh`, `deploy.env.example`, `README-DEPLOY.md`). **`deploy/nginx.conf` is not among them — snajper has no such file**, and three applied security fixes depend on one (`X-Forwarded-For $remote_addr` as an *overwrite*, `X-Real-IP`, and `proxy_no_cache` under `location /api/`). WP8 writes it from scratch; the `TRUST_PROXY=1` in §5.4 is only safe once it exists, so the two land in the same PR. Files WP8 must produce:

| File | What it does |
|---|---|
| `deploy/setup-server.sh` | user `sank`, `/opt/sank/{releases,data,backups,native,bin}`, Node 22, `sqlite3`, `ufw`, `timedatectl set-timezone Europe/Sarajevo`, sudoers line for `systemctl restart sank`, better-sqlite3 native build, cron install |
| `deploy/deploy.sh` | build → rsync a release dir → flip the `current` symlink → `systemctl restart sank` → health gate on `http://127.0.0.1:3100/api/health` → rollback on failure. Migrations run at boot inside `openDatabase()`, so "migrate" *is* the restart and the gate proves it |
| `deploy/sank.service` | `Restart=always`, `RestartSec=5`, `Environment=NODE_ENV=production`, `Environment=TZ=UTC`, `NITRO_PORT=3100`, `NITRO_HOST=127.0.0.1`, `EnvironmentFile=/opt/sank/.env`, `ReadWritePaths=/opt/sank/data /opt/sank/backups` |
| `deploy/nginx.conf` | TLS, `proxy_set_header X-Real-IP $remote_addr`, `X-Forwarded-For $remote_addr` (**overwrite**), `location /api/ { proxy_no_cache 1; proxy_cache_bypass 1; }` |
| `deploy/backup-db.sh` | `sqlite3 <db> ".backup <dest>"` — that command **is** SQLite's online backup API, which is what the brief asks for: it reads through WAL and takes a consistent copy of a database the server is writing to, which `cp sank.db` cannot. Plus `PRAGMA quick_check` + retention, parameterised by `DEST` and `KEEP`; `chmod 600` the directory |
| `server/tasks/backup.ts` | the same backup for a machine with no cron and no `sqlite3` binary — ten lines calling better-sqlite3's own `sqlite.backup(dest)`, run hourly by the task scheduler and **skipped entirely unless `BACKUP_DIR` is set**, so the VPS keeps using cron (which survives a wedged Node process, and the in-process task does not) and Vedran's laptop gets hourly copies without installing anything. A throw → `queueAlert('health')` and a `task_runs` row with `ok = 0` |
| `/etc/cron.d/sank-backup` | `0 12-23,0-4 * * *` → `backups/hourly/` keep 48; `0 5 * * *` → `backups/daily/` keep 30; one log file `backups/backup.log` |
| `deploy/deploy.env.example`, `deploy/README-DEPLOY.md` | Bosnian glosses, health check, restore steps, "aplikacija ne radi → papirni blok", and the sentence that a backup file is a key to the till |

Env in `/opt/sank/.env`: `DB_PATH=/opt/sank/data/sank.db`, `PIN_PEPPER` (32 random bytes), `TRUST_PROXY=1`, `PUBLIC_URL`, `NITRO_PORT`, `NITRO_HOST`. There is no `TELEGRAM_BOT_TOKEN` and no notification secret of any kind (§9). `BACKUP_DIR` is deliberately **not** set on the VPS (cron owns backups there) and is set in the dev `.env`. Exposed through `runtimeConfig` as `{ pinPepper, publicUrl, trustProxy }` — nothing reaches the client. `SESSION_SECRET` is gone: sessions are random tokens stored as sha256 and there is nothing to sign; the one secret is the PIN pepper. PLAN §5's `/var/lib/sank/sank.db` is updated to `/opt/sank/data/sank.db` in the same PR — one tree to back up and hand over.

`server/tasks/nightly.ts` (Nitro `experimental.tasks`, `scheduledTasks: { '15 * * * *': ['nightly'], '35 * * * *': ['backup'] }` — two tasks, because the alert drainer is gone with the sender (§9); cron in UTC because the unit sets `TZ=UTC`): every hour it computes the local hour, and at local 05:xx claims `task_runs(task='nightly', business_date=yesterday)` with `INSERT OR IGNORE` (no row inserted → already done) and runs: the `shift_not_closed` alert when a shift is still open past `closing_time + 3 h`, `DELETE FROM changes WHERE created_at < now − 7 d`, `DELETE FROM sessions WHERE expires_at < now − 30 d`. Failure → `queueAlert('health')`. Off-box backups (rsync to the owner's machine) are a README step, not code.

---

## 11. Tests

`tests/helpers/db.ts` grows: `enrol(mode, boundUserName?) → { deviceId, deviceToken }`; `login(name, pin?, opts) → Actor` (through `verifyPinMetered` + `authorizeRequest`, so the round trip is proven once); `actor(name, { device?, bound? }) → Actor` (built directly — every other test uses this); `adminActor()`; `openShift()`; `lock(name, table, lines, clientAt?)`; `pay(name, tabId, fen, method)`; `voidLine(...)`; `settingsWith({...})`; `setDeviceHeartbeat(id, {...})`; `expectRefused(sql, message)`; `clock` (an injectable `now`).

**The row-writing helpers write rows, not calls.** `lock`, `pay`, `voidLine`, `markUnpaidRow`, `floatOut` and `cashMovement` insert their ledger rows with plain SQL through the schema, never by calling `createOrder`/`createPayment`/`requestAdjustment`. That is what lets WP2 build `cash.test.ts`'s reconciliation fixture — "Amar cash 200 and a −20 reversal, Lejla cash 150 + card 40, a pending void 5, a pending unpaid tab 24" — on its own branch, months before WP3 exists: `expectedCash` reads *columns* (`payments.method/paid_by/post_settle`, `tabs.status/unpaid_by`, `line_adjustments.kind/was_paid/status`, `cash_movements.type/status`), so a fixture that produces the right columns is a complete fixture. WP3 then adds `orders.test.ts` cases that go through the real service and assert the same columns come out. Two helpers, one shape, no package waiting on another's stub.

| File | Must prove |
|---|---|
| `schema.test.ts` | every table has `venue_id` (allowlist: `venues`, `changes`, `task_runs`, `sqlite_sequence`, `__drizzle_migrations`); every **declared** unique index — `PRAGMA index_list` filtered to `unique === 1 && origin === 'c'`, never the `sqlite_autoindex_*` rows a primary key creates (§3.3) — whose first column is not `venue_id` is in `GLOBAL_UNIQUE_INDEXES`; every name in `TRIGGER_NAMES` exists in `sqlite_master`; the migration contains no `__new_`; the seed leaves no `stock_items` row with `avg_cost_mfen = 0 AND last_cost_mfen = 0`; `PRAGMA foreign_key_check` is empty after migrating a Korak-1-shaped database |
| `api-shapes.test.ts` | **rewritten from Korak 1, owned by WP0.** Korak 1's version asserts `getTablesState()` as a bare array, `createDelivery` returning `StockItem[]`, `createOrder(db, venueId, body)` with a `user_id`, and `boot.users.length === 6` — every one of those changes in Korak 2, so left alone it fails on whichever package merges first. It becomes: every read route's envelope by name (`TablesStateResponse`, `ChangesResult`, `MeContext`, `MyShift`, `OwnerLive`, `TabDetail`, `CountView`, `DeliveryView`), every field of `TableState` and `ShiftBrief` on a fixture with two waiters and one offered tab, and — across every route's response — **no key matching `/_hash$\|token\|password\|pepper/`** |
| `errors.test.ts` | every `SankError(`/`conflict(`/`forbidden(`/`unauthorized(`/`unprocessable(`/`locked(` code literal under `server/**` has a non-empty Bosnian sentence in `ERROR_MESSAGES`, and no message is orphaned (§2) |
| `pin-routes.test.ts` | every exported Zod object in `shared/schemas/*.ts` with a key matching `/(^\|_)pin$/` belongs to a route in `PIN_BEARING_ROUTES`, and every route in that list is a key in `ROUTE_ROLES` (§5.2) |
| `rate-limit.test.ts` | `take(key, 1, nowSeconds)` returns 0 at the limit and 1 again one window later, with `vi.useFakeTimers()` and an explicit whole-second `now` — the signature is snajper's, and passing `Date.now()` silently disables the limiter (§5.4); the dev multiplier widens the limit and never removes the code path; `maxKeys` eviction |
| `triggers.test.ts` | the Korak 1 cases unchanged, plus one raw-SQL refusal per new rule: `payments` update/delete; a negative payment with no `approved_by`; `line_adjustments` `applied → pending`, `applied → rejected`, amount changed with the status; `tabs` `paid → open`, `unpaid → open`, `table_id` changed while paid; `orders` insert without `shift_id`; a second `open` shift; `shifts` `closed → open`; `shift_summaries` delete; `cash_movements` `approved → pending`; `waiter_settlements` accepted twice; `stock_counts` `confirmed → submitted`; `stock_count_lines` update of a non-`applied_adjust` column; a posted delivery header edit; `delivery_lines` update; `waste_events` qty edit; `log_entries` title edit without `redacted_at`; `auth_attempts` update/delete |
| `auth.test.ts` | hash round trip and pepper (the same PIN for two users hashes differently; a hash verified under a different `PIN_PEPPER` fails); admin login and the constant-time unknown-email path; enrol code uses 2 → 1 → 0 → `ENROL_CODE_INVALID`, expiry; PIN on shared/personal/borrowed devices, `ADMIN_DEVICE_ONLY`; **one committed `auth_attempts` row with `ok = 0` after a wrong PIN, after a wrong password, and after a bad enrol code** — all three doors, because all three go through `verifyMetered` and a path with no attempt row has no lockout (§5.1); 5 wrong PINs → 423 with `retry_after_s`, a correct PIN inside the window still refused, +61 s ok, 10 → 900 s + `lockout` entry, 15 → `devices.locked_at` unwindowed; 5 wrong passwords for the same `(ip, email)` → 423 while a different email is unaffected; lockout is per `(device, user)`; `resetPin` clears `locked_at` on the device the user locked and writes `device_unlocked`, and `POST /api/admin/devices/:id/unlock` does the same for one device while leaving `auth_attempts` intact; session resolve, expiry, revoke cascade on device revoke, `DEVICE_MISMATCH`; admin session sliding, staff never; a wrong approver PIN inside `requestAdjustment` leaves no adjustment **and** one committed attempt row |
| `tenant.test.ts` | pure `authorizeRequest`: `/api/health` without cookies passes; `/api/tables/state` without cookies → 401; a waiter on `/api/admin/devices` → 403; a route missing from `ROUTE_ROLES` → 403; `clientIp` with `TRUST_PROXY` unset ignores `X-Forwarded-For`, with it set takes the last hop; `cookieSecure()` is true with no env at all; `POST /api/dev/enrol` is 404 without `SANK_DEV_ENROL=1`; **a PIN-bearing route consumes `pinLimiter` for `(deviceId, approverUserId)`** and the 11th call in a window returns 429 `RATE_LIMITED` with `Retry-After` — the limiter runs in dev and in vitest, only wider (§5.4) |
| `route-roles.test.ts` | `server/api/**` and `ROUTE_ROLES` are the same set, both ways |
| `orders.test.ts` | the Korak 1 cases with `f.actor(...)`, plus: a shift is auto-opened and joined; `shift_seq` 1, 2, 3; `client_created_at` two days back attaches to the open shift with `late_sync = 1`; a future timestamp is clamped to now; a body naming table A with table B's `tab_client_id` → 409 `TAB_TABLE_MISMATCH` and zero rows; a `tab_client_id` on a paid tab opens a new late unpaid tab **and writes one `late_after_close` entry**, and when its shift is already `closed` a new `shift_summaries` version with `reason='late'`; a round on a colleague's assigned tab is accepted under `allow_cross_waiter_rounds` with one quiet `cross_waiter_lock` entry, and refused 403 `NOT_ASSIGNED` with the setting off; a lock after the actor's settlement succeeds with `post_settle = 1`, raises his expected and writes `late_after_settle` |
| `tabs.test.ts` | `tabMoney` on a tab with a comp, a pending void and a partial payment; `markUnpaid` on a colleague's tab → 403 `NOT_ASSIGNED`, replay by `unpaid_client_id` → one row; `moveTab` onto an occupied table → 409; **handover**: `assign` by a non-holder → 403, to the holder himself clears the offer, `accept` by anyone but `offered_to` → 403 `NOT_OFFERED`, a successful accept moves `assigned_to` and `my_open_tabs` between the two waiters while both waiters' `promet_fen` stay exactly where they were (money follows `orders.locked_by`, not the tab) |
| `drafts.test.ts` | `POST /api/drafts/discard` writes one quiet `draft_discarded` entry, no `orders`/`order_lines`/`stock_movements` row, and its `total_fen` appears in no summary |
| `payments.test.ts` | exact cash closes the tab; partial then rest; `OVERPAY` writes nothing; paying a paid tab → 409 **and** one surviving `pay_duplicate_attempt` entry; replay → one row; `received_fen`/`tip_fen` do not move `remaining_fen`; `METHOD_NOT_ALLOWED`, `INVALID_COVERS`; uncovered round → `pending_review`; `unpaid → paid` clears review |
| `adjustments.test.ts` | own unprepared line inside 300 s → applied, storno rows mirror the sale rows with the same `unit_cost_mfen`, on hand returns to the pre-order value; a **prepared** order → pending, zero storno rows; the 6th self-void in a shift → pending + `self_void_capped`; another waiter's line → pending; bartender PIN inside/outside the window; `SELF_APPROVAL`; `ADMIN_PIN_FOREIGN_DEVICE`; a `was_paid` void with `refund: 'none'` leaves `waiterExpected` unchanged, with `from_waiter` it drops and the reversal carries a distinct `approved_by`, with `from_drawer` the drawer drops instead; second adjustment on the same line → `LINE_ALREADY_ADJUSTED`; atomicity (a throwing reversal leaves the row `pending` and no storno); replay |
| `shifts.test.ts` | auto-open with a 02:30 local `client_created_at` lands on the previous business date; one open shift (raw insert refused); close blocked by an open tab and by a missing **opening** count; the tolerance note; members auto-left; summary v1; `outstanding_fen` for an unsettled waiter with the close still inside tolerance; force close lists missing settlements; review with a card diff needs a note; atomicity of close |
| `cash.test.ts` | the reconciliation fixture (float in 100, float out 50 → Amar and 30 → Lejla, Amar cash 200 and a −20 reversal, Lejla cash 150 + card 40, refund 10, a pending void 5, a pending unpaid tab 24, a pending payout 60, an approved payout 15) with the exact expected numbers, and `venue === drawer + Σ waiters` after every decision; a **pending** `float_out` moves nothing until acknowledged; a bartender approving his own payout → 403 `SELF_APPROVAL`; a payout over `payout_owner_fen` decided by a bartender → 403 `OWNER_REQUIRED`; opening float derived from the previous close minus pickups |
| `settlements.test.ts` | blind: `/api/me/shift` before settlement serialises with no `_fen` key **except** `float_out_fen`; after, it has them; a second settle → 409 `SETTLED`; `outbox_len = 1` → 409; a fresh device with pending → 409 with labels, stale → allowed and reported; settle on a closed shift sets `late = 1` and writes summary v2; a post-settlement `was_paid` void with `from_waiter` moves `diff_now` and leaves `summary_json` byte-identical |
| `summaries.test.ts` | `Σ by_user.promet_fen === Σ by_category.fen === promet_fen` with two waiters, a comp, an applied and a pending void and a coal top-up (the top-up is not a bowl); `shiftLines(kat='storno')` totals equal the summary's storno; the `user=` filter is ignored on `/me` |
| `stock-ops.test.ts` | on hand after a mixed bowl and its restock; delivery posting, `qty = 53` for 2 × 24 + 5, `unit_cost_mfen`, the moving average across two prices, `recomputeAvgCost` agreement; a late sale before a confirmed count writes its `late_sync` offset and leaves on hand unchanged; a confirm writes exactly the non-zero adjust rows at `occurred_at = submitted_at`; `PENDING_OUTBOX` fresh/stale/override; waste replay, `REASON_FORBIDDEN`, the `kom`-drink and per-shift caps, `needs_approval`; `PRICE_MISSING` on confirming an unpriced variance, and **not** on an item priced only by the `last_cost_mfen` fallback, which comes back `estimated: true`; a `line_cost_fen` of 0 is rejected by the schema before it can touch the moving average; delivery reversal twice → 409; `COUNT_EXISTS` on a second `open` count for the shift and no error on a second `adhoc`; a `phase='open'` count with no shift open **creates** one and writes `shift_opened`, a `phase='close'` one → 409 `NO_OPEN_SHIFT`; `confirmCount` refuses with `PENDING_OUTBOX` on a fresh device with an outbox; `POST /api/stock/opening` prices 19 zero-cost items and then refuses `OPENING_LOCKED` on an item that has since been sold |
| `reports.test.ts` | the owner's nargila example (15 000 g delivered, 4 000 g left, 500 bowls sold → `potroseno 11 000`, `ocekivano 550`, `razlika 50`) and next month's opening; the categories report's Σ prodaja equals the shift summaries' promet for the same period |
| `changes.test.ts` | `maxSeq` is 0 after seed; a lock bumps `table`, `prep`, `stock`; `getChanges(since)` returns exactly those entities and attaches the right snapshots; `since = latest` → empty and no snapshots; `since = 0` → `full`; a failed transaction leaves `maxSeq` unchanged; a second venue never appears |
| `changes-coverage.test.ts` | one call per mutating route grew `maxSeq` |
| `etag.test.ts` | a matching `If-None-Match` returns 304 with no body; a mutation changes the tag; **an admin and a waiter get different tags for the same `maxSeq`**, and a waiter presenting the admin's tag gets a 200 with a staff-shaped body |
| `heartbeat.test.ts` | skew stored and clamped; one `clock_skew` entry per device per business date; no `changes` bump |
| `log.test.ts` | a `log()` in a transaction that throws leaves zero entries and zero alerts; every `LOG_KINDS` member has a template that parses its fixture and renders a non-empty Bosnian title; no rendered body matches `/hash\|token\|email\|chat_id/`; `resolvesId` links; `important=1` hides `void_requested` but shows `void_decided` with the request inline |
| `alerts.test.ts` | the dedupe key inserts once; quiet hours defer `stock_variance` to 10:00 but not `shift_closed`; the drainer sends to admins with a chat id and to nobody else; a throwing sender increments `attempts` and backs off |
| `admin.test.ts` | a price change closes the old `price_history` row and the open row equals `products.price_fen`; `setRecipe` is atomic; `createUser` stores only a hash and the response has none; `SELF_DEACTIVATE`; `UNIT_FROZEN`; a settings patch writes one entry per key |
| `owner-live.test.ts` | the live numbers match the ledgers; `expected_cash_fen === venueExpected()`; `attention[]` is exactly the concatenation of the six `pendingFor()`s and every `(kind, action)` pair in it resolves to a `ROUTE_ROLES` key (the F11 list is the fixture); a `Flag` raised by a condition **disappears** once the condition ends — a stale device that heartbeats, an unpriced item that gets its opening cost — so nothing accumulates (§1); staff on any `/api/owner/*` or `/api/admin/*` → 403 |
| `invariants.test.ts` (WP8) | the three cross-package identities on one seeded night, each a named test: `Σ by_category.fen === Σ by_user.promet_fen === promet_fen` on the written summary; `venueExpected === drawerExpected + Σ waiterExpected`; `owner/live.expected_cash_fen === expectedCash().venue_expected_fen`; and the categories report's Σ *prodaja* over the period equals Σ `promet_fen` of the shift summaries inside it |
| `ui-contract.test.ts` (WP9) | no request body built anywhere under `app/` contains a `user_id` key (a grep over the source, so it cannot regress silently); `useApi` sends `credentials: 'include'`; `sank:session` in `localStorage` holds no `role` and no `*_fen`; every `fetch` of an `/api/` path goes through `useApi` |
| `dates.test.ts`, `bowls.test.ts`, `money.test.ts` | 05:59 vs 06:00, both DST nights; the bowl rule; the Korak 1 formatter cases |

---

## 12. Work packages

**WP0 must land and merge before any other package starts.** Five packages each generating `0001_*.sql` from the same snapshot cannot be merged: drizzle-kit numbers from `meta/_journal.json` and keeps a cumulative snapshot, so two branches at index 1 conflict in a way `git merge` cannot resolve. WP0 owns the schema; a package that needs a column files a one-line change against WP0's migration **before WP0 merges**, never a `0002`.

### WP0 — schema, migration, triggers, seed, shared split (sequential, first)

- **Owns:** `server/database/schema.ts`, `server/database/migrations/0001_korak2.sql` (+ meta), `server/database/triggers.sql`, `server/database/seed.ts`, `server/services/types.ts` (`Actor`), `server/services/contracts.ts` (typed cross-package stubs), `shared/{types,schemas,settings,dates,bowls,constants,errors,routeRoles,logTemplates}.ts` **and the `shared/types/*.ts` + `shared/errors/*.ts` fragment files each later package fills in**, `tests/helpers/db.ts`, `tests/unit/{schema,triggers,dates,bowls,api-shapes}.test.ts`, `vitest.config.ts`, `CLAUDE.md` conventions section.
- **Contents:** every table and column of §3 in one migration (including `UPDATE users SET role='admin' WHERE role='owner'` and the `tabs.assigned_to` backfill); the complete `triggers.sql`; `DEFAULT_SETTINGS`; `Role`, `Actor`, `LogKind`, `ChangeEntity`, `GLOBAL_UNIQUE_INDEXES`, `TRIGGER_NAMES`, `PIN_BEARING_ROUTES`, `ALERT_RULE_KEYS`, `ROUTE_ROLES` (every key from §7, values only); the complete frozen `LOG_KINDS` of §8, template bodies included, so no later package edits that file either; `shared/dates.ts` and `shared/bowls.ts` complete with tests; the seed with hashed dev PINs, placeholder item costs, `settings_json`, one open `price_history` row per product; fixture helpers; the rewritten `api-shapes.test.ts` (§11).
- **The three hot-path helpers are real, not stubs.** `contracts.ts` throwing `NOT_IMPLEMENTED` everywhere would make WP0's own done-when unreachable — `orders_shift_required` and `tabs_assigned_required` demand an `ensureOpenShift` on the first `POST /api/orders` test — and would leave WP3 unable to run a single test on its branch, since every lock calls into WP2 and WP4. So WP0 lands **working minimal versions** of exactly three, which WP2/WP3/WP4 then replace or extend in place:
  - `ensureOpenShift(tx, venueId, actor, at, clientAt?)` — plain select-or-insert plus `joinShift`, no summaries, no logging beyond `shift_opened`;
  - `nextShiftSeq(tx, venueId, shiftId)` — `MAX(shift_seq) + 1`;
  - `insertMovement(tx, venueId, m)` — the plain insert **with** the `late_sync` offset rule of §6.8, because on-hand arithmetic is wrong without it from the first test.

  Plus the four-line change to the existing Korak 1 `createOrder`/`resolveTab` that satisfies the new triggers (`shift_id`, `shift_seq`, `assigned_to = actor.userId` on the tab insert, `unit_cost_mfen` on the sale movement) — §3.4 promised this list and this is it. Everything else in `contracts.ts` stays a typed stub that throws `NOT_IMPLEMENTED` and is never on a path WP0's tests walk: `log`, `bump`, `queueAlert`, `expectedCash`, `hasLiveSettlement`, `assertNoPendingOutbox` (the one outbox check of §6.6 — the old `unsentDevices` name is gone), `getSettings`, `verifyPinMetered`, `resolvePaymentShift`, `insertRefund`, `setCustodian`, `hasSubmittedCount`, `unitCost`, `writeSummaryVersion`.
- **Done when:** `npm run typecheck`, `npm run test` (the 30 Korak 1 tests, `api-shapes` rewritten, plus schema/trigger/dates/bowls) and `nuxt build` are green; a database seeded on Korak 1 migrates cleanly with an empty `PRAGMA foreign_key_check`.

Every WP below owns its own service files, its own `server/api/**` subtree, its own `shared/schemas/<x>.ts`, `shared/types/<x>.ts` and `shared/errors/<x>.ts` fragments (all three re-exported by WP0's barrels, so the packages never edit the same lines) and its own test files. No package edits another's files; a needed function is imported from `contracts.ts`.

**Four subtrees would otherwise be claimed twice, so they are named here and nowhere else.** A glob like `api/devices/**` on one row and a single file under it on another is a merge conflict waiting for the day both branches land:

| Path | Owner | Why not the other one |
|---|---|---|
| `server/api/devices/heartbeat.post.ts` | **WP5** | The heartbeat is a sync mechanism (it feeds `pending_count` and `clock_skew_s`, and deliberately does *not* bump `changes`). WP1's `api/devices/**` is therefore `api/devices/enrol.post.ts` only. The `heartbeat()` **service** stays in `services/devices.ts`, which WP1 owns — WP5 imports it through `contracts.ts` like every other cross-package call |
| `server/api/admin/users/**` | **WP6** | Including `[id]/pin.post.ts`. `resetPin` is auth logic and lives in WP1's `services/auth.ts`; the route file that calls it is admin CRUD like every other file in that folder, and WP6 depends on WP1 anyway |
| `server/api/me/**` and `GET /api/me` | **WP2**, except `api/me/index.get.ts` → **WP1** | `/api/me/shift*` are shift reads; `GET /api/me` is the session envelope `getMe` builds in `services/auth.ts` and the one route that must exist before any screen boots |
| `server/api/owner/log*` | **WP5** | The Dnevnik reads `log_entries`, which WP5 owns; WP7's `api/owner/**` is `live`, `shifts` and `shift/**` only |

| WP | Owns | Depends on | Done when |
|---|---|---|---|
| **WP1 auth** | `services/{auth,devices}.ts`, `utils/{password,auth,rate-limit}.ts`, `middleware/tenant.ts`, `api/auth/**`, `api/devices/enrol.post.ts`, `api/me/index.get.ts`, `api/dev/enrol.post.ts`, `api/admin/{enrol-codes,devices}`, `shared/{schemas,types,errors}/auth.ts`, `tests/unit/{auth,tenant,route-roles,pin-routes,rate-limit,errors}.test.ts` | WP0 | login/enrol/PIN/lockout/reset/revoke/unlock work; all three doors leave an `auth_attempts` row; `authorizeRequest` is pure and tested; deny-by-default proven; every §11 auth assertion green |
| **WP2 shifts & cash** | `services/{shifts,cash,settlements,summaries}.ts`, `api/shifts/**`, `api/cash-movements/**`, `api/me/shift*`, `shared/{schemas,types,errors}/shifts.ts`, `tests/unit/{shifts,cash,settlements,summaries}.test.ts` | WP0; `verifyPinMetered` stubbed | `expectedCash` reconciliation exact, including the two corrected terms of §6.5; close/force/review; blind settle; summaries assert their own reconciliation |
| **WP3 money core** | `services/{orders,tabs,payments,adjustments}.ts`, `api/orders.post.ts`, `api/tabs/**`, `api/payments.post.ts`, `api/adjustments/**`, `api/drafts/discard.post.ts`, **deletion of `api/tabs/[id]/pay.post.ts`**, `shared/{schemas,types,errors}/money.ts`, `tests/unit/{orders,payments,adjustments,tabs,drafts}.test.ts` | **WP2** (real `ensureOpenShift`, `hasLiveSettlement`, `expectedCash`) | the whole §6.1–§6.4 rewrite; every Korak 1 orders/trigger test still green |
| **WP4 stock** | `services/{stock,counts,reports}.ts`, `api/stock/**`, `api/owner/{stock,categories,nargila}`, `shared/{schemas,types,errors}/stock.ts`, `tests/unit/{stock-ops,reports}.test.ts` | **WP3** (its count and report fixtures lock and pay real rounds) | `insertMovement` + late_sync; deliveries with costs; opening stock; waste gates; counts submit/confirm; both reports reproduce the owner's numbers |
| **WP5 sync & log** | `services/{changes,log,alerts}.ts`, `utils/{etag,bus}.ts`, `api/changes.get.ts`, `api/devices/heartbeat.post.ts`, `api/owner/log*`, `plugins/alerts.ts`, `shared/types/sync.ts`, `tests/unit/{changes,changes-coverage,etag,heartbeat,log,alerts}.test.ts` | WP0 | the feed, ETag with role **and user** in the tag, heartbeat, `log()` with a template per kind, `ref`-keyed dedupe and quiet hours |
| **WP6 admin CRUD** | `services/admin.ts`, `api/admin/{products,categories,tables,stock-items,users,settings}` (`users/[id]/pin.post.ts` included), `shared/{schemas,types,errors}/admin.ts`, `tests/unit/admin.test.ts` | WP0, WP5 (`log`, `bump`) | every catalogue write logged and bumped; `price_history` invariant; no hash in any response |
| **WP7 owner reads** | `services/owner.ts`, `api/owner/{live,shifts,shift/**}`, `shared/types/owner.ts`, `tests/unit/owner-live.test.ts` | **WP2, WP3, WP4, WP5** — it consumes their `pendingFor()` and read functions and cannot be tested against stubs | Puls, shift list, shift detail and drill-down match the ledgers; every `AttentionItem.actions` pair resolves to a `ROUTE_ROLES` key; staff get 403 |
| **WP8 integration & ops** | `server/plugins/database.ts` wiring, `server/tasks/{nightly,alerts,backup}.ts`, `nuxt.config.ts` (`runtimeConfig`, tasks), `deploy/**`, `README.md`, PLAN §5 path corrections, `tests/unit/invariants.test.ts` | WP1–WP7 | one `npm run test` green across packages, **and `invariants.test.ts` (§11) green** — that is the machine-checkable half. The VPS half is a runbook, not a done-when: `deploy/README-DEPLOY.md` carries the steps (deploy → health gate → break the health check → watch the rollback → restore yesterday's backup into a scratch path and `PRAGMA quick_check` it), Vedran runs it once with the owner and ticks it off there |
| **WP9 UI rewire** | `app/**` only: start screen (enrol code / dev button → names grid → PIN pad auto-submitting at `pin_len`), `stores/session.ts` filled from `/api/me`, `useApi` with `credentials: 'include'` and the 401 handling, removal of `user_id` from every body, one `/api/changes` poll replacing the per-screen timers, the new envelope shapes (`{ seq, shift, tables }` etc.), the *Odbaci* tap posting to `/api/drafts/discard`, heartbeat timer; `tests/unit/ui-contract.test.ts` | WP8 | `ui-contract.test.ts` (§11) green — no `user_id` in any body, `credentials: 'include'`, no role in `sank:session`; and the waiter, bartender and owner screens run against the real backend on a phone-sized viewport |

**Order.** WP0 first and alone. Then two lanes that never touch each other: **WP1 → WP6** and **WP5**, both of which need nothing from the money code; and **WP2 → WP3 → WP4**, in that order, because each one's fixtures are built out of the previous one's services (WP2's `cash.test.ts` reconciliation needs real payments, voids and unpaid tabs; WP3's every lock calls `ensureOpenShift` and `insertMovement`; WP4's counts need rounds to count against). WP7 joins both lanes, then WP8, then WP9. Serialising those three costs less wall clock than merging three branches that each stubbed the other two.

---

## 13. Open decisions for Vedran and the owner

1. **Cash count scope at close.** This document compares `cash_counted_fen` against the drawer **plus the waiters who have settled**, and reports everyone else as `outstanding_fen`. If the owner counts only the drawer and keeps the envelopes sealed, add `cash_count_scope: 'venue'|'drawer'` to the settings and switch the comparison — one line, but it changes what the pazar figure on *Puls* means.
2. **`float_out` acknowledgement.** Born `pending` until the receiver taps *Primio sam* or types his PIN. That is one extra tap at hand-over. Confirm the owner wants it (the alternative lets a bartender move a shortfall onto a colleague).
3. **Refunds without a void.** The design allows `cash_movements(type='refund')` with no linked adjustment (an admin hands money back for a complaint on a paid tab). Confirm.
4. **Locks and payments after a settlement** are accepted and flagged, not refused (PLAN F10 says `409 SETTLED`). Refusing loses the sale entirely — the guest paid and no line exists — so the server records it, adds it to the settler's expected, and alerts. Confirm the change to PLAN F10.
5. **Whole-line voids only in v1.** A 3 × Kafa line is voided whole; partial quantities arrive in Korak 3 with no migration. Confirm the pilot can live with the extra tap.
6. **Payout approvers.** Default `payout_approver_roles: ['admin']` — a bartender can request but not approve any payout. If the owner is often unreachable, the alternative is bartender approval below `payout_owner_fen` **with** the self-approval block, which is strictly weaker.
7. **Two dev browsers.** `/api/dev/enrol` keeps one `dev` device per venue, last browser wins. If Vedran tests waiter and bartender side by side, key it on a `?name=` query (`dev-konobar`, `dev-sank`).
8. **Item costs at go-live.** No longer a decision about *code* — `POST /api/stock/opening` and the `unitCost` fallback both ship in WP4 (§6.8), so the *Početno stanje* screen has a route waiting for it. What is left is a **calendar** decision: the owner has to sit down once and read out 19 purchase prices, before the first closing count, or every variance on that first count prices at 0,00 KM and the `count_confirmed` alert never fires. Pick the evening.
9. **DB path.** `/opt/sank/data/sank.db` (snajper's layout, one tree to back up); PLAN §5's `/var/lib/sank` is corrected in the WP8 PR. Say if the VPS already has the other path.
10. **`changes.seq` is a global AUTOINCREMENT**, monotonic per venue because every read filters by `venue_id`. Changing it to a per-venue counter later re-cursors every phone, so it is decided now.

---

## 14. Rejected critique

Everything critical and major in the three reviews is applied above, except the following, which are rejected or deliberately deferred, with the reason.

1. **Per-device `orders.client_seq` gap detection at settlement** (security, major #8 part 2) — rejected. It adds a client-minted counter the server cannot verify, and the accept-and-flag rule for post-settlement locks already removes the incentive to lie about the outbox. What we keep is the evidence: `waiter_settlements.unsent_reported_json`.
2. **`order_events` as a second who-did-what ledger** (all five designs referenced it) — rejected for Korak 2. CLAUDE.md says there is one activity record; every Korak 2 use (`pay_duplicate_attempt`, `pay_uncovered`, `tab_moved`, `unpaid_marked`, `late_after_settle`) is a quiet `log_entries` kind instead, which costs one table, two triggers and one insert on the hottest path less. `device_offline` moves with it to Korak 3.
3. **`changes` as an append-only ledger with a 500-row window, `stock_partial` and a trigger dropped by the nightly prune** — rejected. A cursor is not history; guarding it with a no-delete trigger and then routinely disabling that trigger weakens the mechanism everything else depends on. `changes` has no triggers and is pruned with a plain `DELETE`, and it is listed in `schema.test.ts` as deliberately unguarded.
4. **Telegram, and every other outward channel** — not deferred, *dropped*. The brief asked for a console sender in dev and a Telegram sender in production; the owner decided the app is the channel, so the sender, the drainer, the token and the chat-id column are gone and `alert_events` is the in-app attention record instead (§9). In-app acknowledgement and outcomes, the hourly cap and the digest stay Korak 3.
5. **Server-side count drafts (`draft_json`, `PUT /counts/:id/lines`) and the witness step** — deferred. The phone already holds drafts in IndexedDB exactly like the cart; `witnessed_by`/`witnessed_at` stay as columns so Korak 3 adds a route and no migration. This removes four routes and a four-branch trigger a junior would not be able to debug.
6. **Delivery drafts, `PATCH /deliveries/:id` and `/post`** — deferred. `POST /api/stock/deliveries` always posts; the `status` column stays with default `'posted'` so the Korak 3 scan flow can insert a draft. `delivery_lines` gets plain append-only triggers instead of a cross-table sub-select trigger.
7. **Settlement chains (`supersedes_id`), a separate `/settle_late` route, `self_accepted`, and the nightly summary recompute with `drift` entries** — rejected/deferred. One settlement per person per shift with a plain unique index; one `settle` route that behaves differently on a closed shift; `self_accepted` is derived at read; the drift detector's only job was catching a bug in `summarizeShift`, which the `SUMMARY_MISMATCH` assertion at write time now does synchronously.
8. **Partial-quantity voids with the residual rounding rule** (payments design) — deferred, see open decision 5. The columns stay.
9. **`unit_cost_fen` as integer feninga per base unit, compensated by summing `line_cost_fen`** (stock design) — rejected in favour of `unit_cost_mfen` (milli-feninga). It keeps money integral, keeps COGS honest to 0,001 fen per ml, and needs one cost column per row instead of two.
10. **An approver PIN required at the moment of logging every `kom` drink waste** (security, major #11) — partially rejected. Blocking the ledger write is wrong: the bottle is broken whether or not anyone approves, and a refusal teaches staff not to log breakage. Such an event is written immediately with `needs_approval = 1` and a non-quiet log entry, plus the per-shift cap, which is the same accountability without a hole in the ledger.
11. **Refusing back-dated deliveries instead of generalising the `late_sync` offset** (stock, open question 1) — rejected. `insertMovement` handles every type with one rule so `on hand = SUM(qty_delta)` stays true; refusing a late delivery would make an honest bartender lie about `delivered_at`.
12. **`SESSION_SECRET`** (sync/deploy design) — rejected as specified: nothing was signed with it. The variable is repurposed as `PIN_PEPPER`, which is the control the security review actually needed.
13. **`sessions_update_guard`, `enrol_codes_update_guard`, `users_pin_len_check`, `changes_no_*`, `alert_events` delete guard on cursor tables** — rejected as ceremony. Triggers guard ledgers and one-transition tables; Zod guards `pin_len`; the monolithic A/B/C boolean guards are split into `<t>_frozen_cols` + `<t>_status_guard` so adding a mutable column never means editing a boolean expression.
14. **The `ensureOpenShift` "catch SQLITE_CONSTRAINT, re-select, retry" helper** — rejected as untestable dead code: better-sqlite3 is synchronous and there is one process, so two first locks cannot both see "no open shift". The partial unique index stays as belt and braces with a raw-SQL test.
15. **`/api/owner/shift/:id/stavke`, `/api/owner/reports/kategorije`, `/api/tabs/:id/unpaid`, `cash_movements`/`settle_late`/`opening_float` underscores** — rejected in favour of PLAN §5's names (`/lines`, `/api/owner/categories`, `POST /api/tabs/unpaid` queueable with a `client_id`) and of **hyphens in every multi-word path segment, with no exceptions**: `force-close`, `cash-movements`, `enrol-codes`, `opening-float`, `stock-items`. PLAN §5's `force_close` is the one legacy underscore and it changes with the rest — there is no surviving exception, which is what the earlier wording accidentally claimed.
16. **`text/plain → 415` middleware check** — rejected. h3's `readBody` yields a string that fails Zod and returns 400 `INVALID_BODY`; CSRF is covered by `sameSite=lax` cookies plus JSON-only bodies with no form posts and no GET side effects.
17. **`locations` / `location_id`, `order_line_flavours`, `tabs.table_id` nullable, `order_lines.product_id` nullable, `tables.group`** — all four Korak 1 deviations stand, for the reasons in the code map: one location in v1; a JSON array of flavour ids is simpler than a fourth ledger and the read path already joins names; every tab sits on a table; free-text products are Korak 3; `group` is an SQL keyword.
18. **`POST /api/auth/owner/login` → `POST /api/auth/admin/login`** — renamed, and recorded here because §14.15 enumerates every other path decision and skipped this one. The reason is the preamble's: `owner` is a *screen*, `admin` is the *role*, and `'owner'` is not an accepted role value anywhere after the migration. The paths that name the dashboard keep the word (`/api/owner/live`, `/api/owner/log`); the path that names the credential does not. PLAN §5 is corrected in the WP8 PR alongside the DB path.
