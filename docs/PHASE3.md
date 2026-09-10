# Šank — Phase 3 build spec: the waiter and bartender app

**Status:** the build order for Phase 3 as defined in `docs/PHASES.md` §1 ("Waiter and bartender completion") and `PLAN.md` §13, re-cut for the way the project actually runs today — one team, five work packages, the folder conventions of `docs/PHASES.md` §2 kept because they are what makes four packages mergeable in parallel. Where this file disagrees with `PLAN.md` about *what a feature does*, `PLAN.md` wins. Where it disagrees with `docs/BACKEND.md` §7 about *what a route is called*, **the code on disk wins**, and this document was written against the code on disk on 2026-09-09.

Phase 1 (the backend contract) and Phase 2 (the admin dashboard `/a`) are complete on `main`: 805 vitest tests, every route of BACKEND §7 present and declared in `ROUTE_ROLES`, `/a` light, `/k` · `/s` · `/stanje` dark and running on the real API through one `useChanges()` poll and `useMe()`.

What is missing is everything that makes the phone survive a café: **there is no outbox, no draft in IndexedDB, no service worker, no manifest, no void, no comp, no count screen, no otpis, no *Moja smjena*, no re-lock, and no *Potvrdi* sheet on the lock.** The draft lives in `localStorage`, the heartbeat reports `pending: 0` because there is nothing to count, and `POST /api/orders` is fired straight from the button. That is this phase.

Two standing decisions that override older text anywhere in the repo:

- **No notifications of any kind.** Nothing in Šank sends anything outward — no Telegram, no e-mail, no push. The *Dnevnik* and the *Zahtijeva pažnju* list are the owner's only channels; chat is Phase 4. Do not register a push subscription, not even for "storno approved".
- **`/k` and `/s` are dark, `/a` is light.** The two themes never share a rule. Phase 3 touches no file under `app/pages/a/**` and no `app/components/ui/Ui*.vue` (those are Phase 4's; a change there is a request, one file, one sentence in the PR body).

---

## 0. Read these first, in this order

1. `CLAUDE.md` — the house rules: Bosnian on screen, English in identifiers, money as integer feninga, one poll, sessions never `user_id` in a body, ledger tables append-only, invariant tests never weakened.
2. `PLAN.md` §10 **in full** (screens S0–S18, the tap budget table, the ten invariants), §5 *Offline* / *Heartbeat* / *PWA*, §7 flows **F2–F10**, §12 (the glossary — reuse its labels **verbatim**), §13 Phase 1–3 bullets.
3. `docs/BACKEND.md` §4 (the change feed, ETag, heartbeat, what each client polls) and §7 (the route table).
4. `shared/types/*.ts` and `shared/schemas/*.ts` — the contract. Nothing is retyped by hand on the client.
5. `shared/routeRoles.ts` — **a route not in that file does not exist.** If a screen needs one, it is a backend addition and it belongs to the work package that is allowed to make it (§3), with a `ROUTE_ROLES` entry and a test, or it does not get built.
6. `docs/PHASE2.md` §4 and §5 — the shared conventions and the shape of a walkthrough script; this phase copies both.

---

## 1. The backend gaps Phase 3 must close

Verified against `server/api/**`, `shared/schemas/**` and `shared/types/**` today. Each item is a real gap and each has exactly one owner in §3. Everything else the waiter and bartender screens need already exists.

**1.1 A replay answers 200, not 409 — the outbox must be written for the code, not for PLAN §5.** PLAN says "on 2xx or `409 ALREADY_APPLIED` remove". The server never answers 409 on a replay (CLAUDE.md: "a replay returns 200 with the stored result, never 409"); `CreateOrderResult`, `PaymentResult`, `UnpaidResult` and `WasteView` each carry `already_applied: boolean`. **No backend change.** The store removes an entry on any 2xx, records `already_applied` for the toast ("Već poslano"), and keeps a 409 branch only as belt and braces.

**1.2 `POST /api/adjustments` has no `client_created_at`, so an offline self-void loses its 300 s window.** `createAdjustmentBody` (`shared/schemas/money.ts`) has no timestamp, and `server/services/adjustments.ts` computes `secondsSinceLock` from *server now* minus the order's `created_at` (line 115). A waiter who strikes a mistaken line 20 s after locking it, with the phone offline, would have the request arrive ten minutes later and become `pending` — the wrong outcome for the one case the 300 s window exists for. **Fix:** add `client_created_at` to the body (it becomes the fourth of the timestamps a body may carry — update the comment in `shared/schemas/money.ts` that says "exactly three"), adjust it by the device's `clock_skew_s` exactly as `orders.ts` does, and measure `secondsSinceLock` from the adjusted value while still storing the raw claim. Owner: **WP1**, with a test that a request carrying a 20 s-old `client_created_at` and arriving 10 min late is `applied, auto=1`.

**1.3 `GET /api/stock` cannot drive a count screen.** `StockItem` (`shared/types/stock.ts`) carries `pack_qty` and `is_spot` but not `count_method`, `tare_g` or `tolerance_qty`; those three live only on `StockItemAdmin`, behind admin-only routes a bartender may not call. Without them the count screen cannot know which items are weighed on the scale, what tare to subtract, or which line needs a note. **Fix:** widen `StockItem` with `count_method: 'count' | 'weigh'`, `tare_g: number | null`, `tolerance_qty: number`. Owner: **WP2**.

**1.4 There is no witness route.** `stock_counts.witnessed_by` / `witnessed_at` exist in the schema and are described as "reserved"; F9 step 4 (*Potvrđujem stanje*) has nothing to call. **Fix:** `POST /api/stock/counts/:id/witness` (`A W B`, empty body) → sets the pair, bumps `count`, refuses the counter himself with `403 SELF_WITNESS` and a confirmed count with `409 COUNT_ALREADY_CONFIRMED`; one new log kind `count_witnessed` (quiet, group `stock`) with its Bosnian template. `ROUTE_ROLES`, `tests/unit/route-roles.test.ts`, `changes-coverage` and the `logCoverage` test follow in the same PR. Owner: **WP2**.

**1.5 `GET /api/me/shift` has nothing to show before settlement.** `getMyShift` returns `summary: settlement ? summarizeUser(...) : null` — correct blindness, but it leaves S11 with an empty screen for the first five hours of every shift, and PLAN §13's Phase 2 done-when explicitly requires "no `*_fen` field but category counts". **Fix:** add `counts: MyShiftCounts` — always present, and containing **no key ending in `_fen`**: `rounds`, `tabs`, `bowls`, `by_category: { name, count }[]`, `storno: { pending, applied }`, `gratis: { used, cap, max_fen }` (the cap and the max come from settings and are not his money — they are the published rule), `waste`, `hours`. A test asserts `JSON.stringify(counts)` matches no `/_fen"/` other than `max_fen`. Owner: **WP4**; WP1 reads `counts.gratis` for the "Osoblje: 1/2 (do 3 KM)" line and renders only the cap until WP4 lands it.

**1.6 There is no `staff_notes` anywhere, and `MyShiftRow` has no note.** *Napomena* on an own row (S11, and the per-waiter strip on `/a`) has no storage. **Fix:** one table `staff_notes(id, venue_id, shift_id, user_id, body, created_at, updated_at)` with `UNIQUE(venue_id, shift_id, user_id)`, plus `PUT /api/me/shifts/:id/note` (`A W B`, own row only, `{ body: ≤500 }`, empty body deletes) and `note: string | null` on `MyShiftRow`. It is deliberately **not** a ledger table and gets no trigger and no entry in `LEDGER_TABLES`: it is one person's editable note about his own night, not an accounting row, and a note nobody can correct is a note nobody writes. Schema in **WP0**'s migration, route and type in **WP4**.

**1.7 *Moji podaci* has no sessions read.** PLAN §5 wants a waiter to see a login on a device that is not his. **Fix:** `GET /api/me/sessions` → `{ id, device_label, kind, borrowed, created_at, last_seen_at, current }[]`, own rows only, newest first, capped at 20. Owner: **WP4**.

**1.8 The lock screen cannot show "the last 3".** `GET /api/auth/users` → `listLoginUsers(db, venueId)` returns every active user of the venue with no recency at all. **Fix:** widen the row to `LoginUser = MeUser & { last_login_at: string | null }`, computed from `sessions` **for the requesting device only**. Nothing else may be added to that body: it is the one response a stranger holding an enrolled phone can read without a session (BACKEND §5.5). Owner: **WP4**.

**1.9 Bootstrap's catalogue is too thin for S3.** `Category` is `{ id, name, sort }` — no `note_chips`, which F2 step 4 requires; `Product` has no `short_name`, no `search_aliases` (the diacritic-insensitive prefix search of S3) and no `staff_drink_allowed` (the comp sheet's self-authorisation rule, F7). All three live on the admin shapes only. **Fix:** widen the two bootstrap shapes; `menu_version` already invalidates them, so no new poll. Owner: **WP3**.

**1.10 A phone cannot identify the *Žar* product or the "Ostalo" product.** `ProductKind` is `'simple' | 'shisha'`; the seed's *Dodatni žar* (0 KM, recipe 2 × coal) is recognisable only by its name, and matching UI behaviour on a name is how a rename becomes a Saturday-night bug. **Fix:** `products.system_key text` (`'zar' | 'ostalo'`, partial `UNIQUE(venue_id, system_key)`), surfaced on the bootstrap `Product`, set by the seed for *Dodatni žar* and settable from *Meni* for the fixed-price "Ostalo" product. Schema in **WP0**'s migration; type, service and seed in **WP3**.

**1.11 `+ Bez stola` cannot be built.** `createOrderBody.table_id` is a required uuid and `tabs.table_id` is `NOT NULL`, while PLAN §5's API table says `table_id|null`. **Fix:** make the column and the body field nullable. The partial index `tabs_one_open_per_table_uq` on `(venue_id, table_id) WHERE status = 'open'` keeps working unchanged and gives exactly the behaviour we want — SQLite treats two NULLs as *different* values in a unique index, so many table-less tabs may be open at once while one table still holds one tab. `TablesStateResponse` gains `loose_tabs: TableState[]` (`table_id: null`, name *Bez stola*), rendered as cards above the floor plan. Schema in **WP0**; body, service and type in **WP3**.

**1.12 Everything else already exists — do not invent it.** `GET /api/me/shifts?limit=30` (the last 30 nights, S11) is on disk and needs only `note` from 1.6; there is no need for `/api/me/history`. `POST /api/stock/waste` already takes `approver_user_id` + `pin` and answers `needs_approval`; `POST /api/stock/counts` takes the whole count with its lines in **one** body and answers `409 PENDING_OUTBOX { devices }` — there is no per-line route and none is to be added (BACKEND §14.5). `GET /api/adjustments/pending` is already scoped by role (a waiter sees only his own) and already answers `can_decide` per row, so the bartender's queue needs no new read. `POST /api/tabs/:id/{move,assign,accept}`, `POST /api/tabs/unpaid`, `POST /api/shifts/:id/float`, `POST /api/shifts/:id/settle` and `GET /api/tabs/:id` all exist as the screens need them. **The Pravila (S12), Razgovor (S15/S16) and Raspored (S17) routes do not exist and Phase 3 does not add them:** S12 renders the thresholds it already has from `me.venue.settings` and stores no acknowledgement, and the avatar sheet's *Razgovor* / *Raspored* entries ship disabled with "stiže uskoro" until Phase 4.

**One migration, one owner.** WP0 is the only package that runs `drizzle-kit generate`, once, producing `0003_phase3.sql` with exactly three things: `staff_notes` (1.6), `products.system_key` (1.10), `tabs.table_id` nullable (1.11). Nobody else generates a migration this phase; a package that needs a column asks WP0 before it starts.

---

## 2. The offline model

This is WP0's specification; every other package is built on top of it and none of them may write to IndexedDB directly.

### 2.1 Drafts

The Pinia `cart` store moves from `localStorage` to `idb-keyval`, key **`draft:{user_id}:{table_id}`** (`'draft:{user_id}:bez-stola:{tab_client_id}'` for a table-less tab). Three changes beyond the storage swap:

- **`tab_client_id` is minted on first open** of a table with no known open tab, and stored in the draft — so a payment, an unpaid mark or a void can name a tab the server has never seen.
- **Every line gets its client uuid when it is tapped**, not when it is sent (today `app/pages/k/sto/[id].vue` mints them inside `send()`). A queued `POST /api/adjustments` has to be able to name a line the server has not seen either.
- **Keyed by user.** A shared bar phone that re-locks must not hand Amar's draft to Lejla.

A draft older than 15 minutes pulses on S1: "Sto 7: nacrt čeka — Zaključi?" (F2 step 5). *Odbaci* posts `POST /api/drafts/discard` so the closing check has something to check.

### 2.2 The outbox — `app/stores/outbox.ts`

Money and stock only. Entries:

```ts
interface OutboxEntry {
  client_id: string                                  // the row's idempotency key
  kind: 'order' | 'pay' | 'unpaid' | 'adjust' | 'waste'
  tab_client_id?: string                             // what a failure blocks
  payload: unknown                                   // the exact body, already valid
  client_created_at: string                          // when it happened in the world
  attempts: number
  last_error: string | null
  status: 'queued' | 'failed'
}
```

Persisted with `idb-keyval` under `sank:outbox` (IndexedDB, not `localStorage`: it survives the iOS memory-pressure reload that follows the camera, and it holds more than 5 MB).

**Flush.** Sequentially, oldest first, one request at a time — never `Promise.all`, because a payment must not overtake the round it pays for. Triggered on `online`, on `visibilitychange` → visible, after every enqueue, and every 10 s while the document is visible. `AbortSignal.timeout(8000)` per POST (4000 for the poll); a timeout counts as a network error, not as a failure. Back-off 10 s → 60 s, reset on `online`, on `visibilitychange` and on any success. **The flush runs before the poll**, always: reading the room before sending what changed it is how a phone shows a table it already emptied.

**Outcomes.** Any 2xx removes the entry (and `already_applied: true` only changes the toast). A 5xx, a timeout or a network error leaves it queued and increments `attempts`. **A 4xx marks it `failed`** and blocks every later entry with the same `tab_client_id` until the waiter answers *Popravi ili odbaci* — other tabs keep flushing. The failed card names the table, the amount and `apiErrorText(err)`; *Odbaci* removes the entry and writes nothing.

**Enqueue, never fetch directly.** S2, S3, the pay sheet, the storno sheet and the otpis sheet call `outbox.enqueue(kind, body)` and get back the local truth immediately. Only `move`, `assign` and `accept` (online-only by PLAN F5/§5) and every GET go straight through `useApi`.

### 2.3 Heartbeat, the chip and the gates

`POST /api/devices/heartbeat` every 60 s while visible **and after every successful flush**, now carrying the truth: `{ pending, oldest_pending_at, client_now, app_version, standalone }`, where `pending` counts money and stock entries and nothing else. `useChanges`'s `beat()` stops hard-coding `pending: 0`.

The sync chip is in every `/k` and `/s` header, always visible, colour **and** word:

| state | chip |
|---|---|
| queue empty, last poll succeeded | green · **Sinhronizovano** |
| queue non-empty, network fine | amber · **Čeka slanje (2)** |
| last attempt failed | red · **Nema veze — narudžbe se čuvaju** |

An entry older than 5 minutes adds a banner under the header: *"Nešto čeka slanje duže od 5 minuta — uključi Wi-Fi ili mobilne podatke."* Red **never** blocks adding, locking or paying (invariant 5); a queued payment keeps the table yellow, *Naplata čeka slanje*. The lock toast reads the outbox: "Poslano · Sto 7 · Tura 1" against "Sačuvano · čeka slanje · Sto 7". *Odjavi se* is refused while the queue is non-empty: *"Imaš 2 neposlane narudžbe"*. S9 (*Završi smjenu*) is already blocked server-side by `409 PENDING_OUTBOX`; the screen now also blocks locally with the same sentence before the request leaves.

### 2.4 PWA

`@vite-pwa/nuxt` (new dependency), `registerType: 'prompt'`, `strategies: 'generateSW'`. Precache the built client assets (`globPatterns: ['**/*.{js,css,woff2,svg,png,webmanifest}']`) with `navigateFallback: '/k'` and a denylist for `/api/` and `/a`. Runtime caching is two rules and no more: **NetworkFirst with `networkTimeoutSeconds: 3` for `/api/bootstrap`**, **NetworkOnly for every other `/api/` path**. The second one is not a preference — BACKEND §4.2 sets `Cache-Control: private, no-cache` precisely so every read revalidates against the current person's cookie, and a service worker that served a cached read would show Emir's numbers to Amar on a shared tablet.

The manifest: `name` "Šank", `short_name` "Šank", `display: 'standalone'`, `background_color`/`theme_color` `#0e0e12`, `start_url: '/k'`, `lang: 'bs'`, 192 and 512 px maskable icons in `public/icons/`. A new service worker shows "Nova verzija — osvježi" **only between orders** — the prompt is suppressed while any draft has lines and while the outbox is non-empty, and it never appears on S3, S4 or S5.

`app/pages/k/instalacija.vue`: the three-picture iOS guide (Podijeli → *Dodaj na početni ekran* → otvori s ikone) plus the sentence that matters — the home-screen app has its own cookie jar, so an iPhone enrols **inside** the installed app, not in Safari. On iOS in the browser, S0 shows this page and nothing else.

`navigator.storage.persist()` is requested once, after the first successful PIN login; S11 reports the answer as *"Trajno spremanje: uključeno / isključeno"*. Wake Lock is acquired on S3 and S4 **only while a draft has lines**, released on leaving or on lock, skipped under 20 % battery where the Battery API exists, and toggleable from the avatar sheet (*Drži ekran upaljen*). `navigator.vibrate` is called only where `'vibrate' in navigator`; everywhere else the same event flashes the strip.

---

## 3. Five work packages

**File ownership is strict.** A path has exactly one owner. Creating a new file inside your own prefix is always fine; touching a file under another package's prefix — one line, a typo, a formatting fix — is not. **WP0 is sequential and first.** WP1–WP4 then run in parallel and never share a file.

Every package: branch `phase-3/<wp>`, one PR, `npm run typecheck && npm run test && npm run build` green before it is called done, and the done-when walked on a 390 px viewport with the network throttled to offline at least once.

Two files every package would otherwise want to edit are settled up front, by WP0, on day one:

- `app/components/waiter/WaiterAvatarSheet.vue` + `app/utils/waiterMenu.ts` — the avatar sheet with **all** of its items already listed (*Moja smjena · Završi smjenu · Brzi popis · Otpis · Pravila · Instalacija · Drži ekran upaljen · Odjavi se*, plus *Razgovor* and *Raspored* disabled with "stiže uskoro"). Each item points at the route the owning package will create and renders disabled until it exists. No later package edits this file.
- `app/components/SankerNav.vue` — the bartender's three tabs (*Narudžbe · Na čekanju · Stanje*), same rule.

### WP0 — offline, PWA, drafts, the shell *(sequential, first)*

**Files owned:** `app/stores/{outbox,cart}.ts` · `app/composables/{useOutbox,useSync,useWakeLock}.ts` · `app/components/waiter/{WaiterSyncChip,WaiterOutboxBanner,WaiterFailedCard,WaiterAvatarSheet}.vue` · `app/components/SankerNav.vue` · `app/utils/waiterMenu.ts` · `app/pages/k/instalacija.vue` · `public/icons/**` · `nuxt.config.ts` (the `@vite-pwa/nuxt` block only) · `package.json` (`@vite-pwa/nuxt`, `idb-keyval`) · `app/composables/useChanges.ts` (the heartbeat body and the flush-before-poll order) · `server/database/schema.ts` + `server/database/migrations/0003_phase3.sql` (the three schema changes of §1.6, §1.10 and §1.11, **generated once**) · `tests/unit/outbox.test.ts`.

**Routes used:** `POST /api/devices/heartbeat`, `GET /api/changes?since=`, and every mutating route through the store's flush.

**Backend additions allowed:** the migration and nothing else. No route, no service change.

**Done when:** with the network off, two rounds on two tables and one payment queue, the chip reads *Čeka slanje (3)*, a reload keeps all three, and reconnecting sends them in the order they were made and empties the queue; a forced `400` on one of them marks that tab failed, leaves the other tab flushing, and *Odbaci* clears it; `npm run build` emits `sw.js` and `manifest.webmanifest`; installing on Android shows the Šank icon and opens at `/k` with `standalone: true` in the next heartbeat.

### WP1 — storna, gratis and the approval queue

**Screens:** S2's long-press on a locked line → *"Zaključene stavke se ne mijenjaju"* → **Zatraži storno**; reason chips `wrong_entry · guest_changed_mind · not_served · complaint · other` (note ≥ 5 characters for *other*) with the line *"Vraća robu na stanje: da / ne"* derived from `RESTOCK_REASONS`; a self-void within `void_self_window_s` applies at once and the line goes struck grey; otherwise the sheet offers the bartender's PIN **on the requester's phone** (`approver_user_id` + `pin`, applied while `seconds_since_lock ≤ 900`), and without it the line goes struck amber: *"Storno čeka odobrenje — 5,00 KM ostaje u tvom pazaru dok se ne odobri."* Offline the copy is PLAN's: *"Nema veze — ide na čekanje, Emir potvrđuje sa svog telefona."*

*Na račun kuće* on a **draft** line (long-press in S2/S3): `staff_drink` self-authorises for `staff_drink_allowed` products under `staff_drink_max_fen`, the sheet showing *"Osoblje: 1/2 (do 3 KM)"*; every other reason locks at full price and waits.

**S14 *Na čekanju*** at `/s/cekanje`: the bartender's queue over `GET /api/adjustments/pending`, one-tap *Odobri* / *Odbij* while `can_decide` is true, and *"Ide vlasniku"* on a row past `bartender_approve_window_s`, with the requester, the table, the line and the amount on every card.

**Files owned:** `app/pages/s/cekanje.vue` · `app/components/adjust/Adj*.vue` (`AdjVoidSheet`, `AdjCompSheet`, `AdjPinSheet`, `AdjPendingCard`, `AdjLineState`) · `app/composables/useAdjustments.ts` · **backend:** `shared/schemas/money.ts` (`client_created_at` on `createAdjustmentBody`), `server/services/adjustments.ts` (the adjusted window of §1.2), `tests/unit/adjustments.test.ts`.

**Routes used:** `POST /api/adjustments` · `POST /api/adjustments/:id/decide` · `GET /api/adjustments/pending` · `GET /api/tabs/:id`.

**Done when:** a line voided 40 s after its lock disappears from the tab with no approval; the same request queued offline and flushed ten minutes later is still `applied, auto=1`; a 20-minute-old line requested on Amar's phone and approved with Emir's PIN on that same phone comes back `applied` with `foreign_device`, and the tab total drops by exactly the line; a request past 900 s shows *Ide vlasniku* on `/s` with no *Odobri* button; a `staff_drink` comp beyond the cap is refused in Bosnian and the counter reads 2/2.

### WP2 — popis and otpis

**F9 *Brzi popis*** at `/k/popis` and `/s/popis` (one component, two routes so both roles reach it from their own nav): the `is_spot` list in one screen, one big numeric field per item with a **packs / komadi** toggle where `pack_qty` exists, grams on the scale for `count_method: 'weigh'` items with `tare_g` subtracted and named on screen (*"minus tara 40 g"*), **theoretical hidden until submit** — the screen never shows what it expects before the number is typed. *Predaj* posts the whole count in one body; `409 PENDING_OUTBOX { devices }` renders as *"Amarov telefon se javio prije 3 min, 2 neposlane"* with a *Pokušaj ponovo*; `422 NOTE_REQUIRED { item_ids }` scrolls to the first item and opens its note. After submit: the variance per line, the total, and *Potvrđujem stanje* for the incoming custodian (§1.4) — the witness taps on the same phone, and an unwitnessed count is allowed, never blocked.

**Shift open — *Dopuni smjenu*** (F1 step 3), reachable from `/s` and from the avatar sheet: `float_out` per waiter (`POST /api/shifts/:id/float`, bartender or admin) and the opening count as `kind: 'spot', phase: 'open'`, with the sentence that a shift without one cannot close.

**S13 *Otpis***: item → qty → reason chip (`razbijeno · isteklo · prosuto · degustacija · ostalo`) → *Sačuvaj*, four taps; above `waste_pin_threshold_fen` the approver's PIN sheet appears inline; without it the entry saves with `needs_approval` and says so.

**Files owned:** `app/pages/{k,s}/popis.vue` · `app/pages/k/otpis.vue` · `app/components/popis/Popis*.vue` · `app/components/otpis/Otpis*.vue` · `app/composables/useCounts.ts` · **backend:** `shared/types/stock.ts` + `server/services/stock.ts` (§1.3), `server/api/stock/counts/[id]/witness.post.ts` + `shared/routeRoles.ts` + `shared/logTemplates.ts` (§1.4), `tests/unit/{stock-ops,log,route-roles}.test.ts`.

**Routes used:** `GET /api/stock` · `POST /api/stock/counts` · `GET /api/stock/counts?shift_id&status` · `GET /api/stock/counts/:id` · `POST /api/stock/counts/:id/witness` · `POST /api/stock/waste` · `POST /api/shifts/:id/float`.

**Done when:** an opening spot count of the 19 spot items takes under five minutes on a phone with the scale on the bar; one bottle counted one short shows −1 kom on the submitted count and the owner's *Primijeni* on `/a` writes the `count_adjust`; the count is refused while a fresh device reports two unsent entries and goes through the moment that phone flushes; an otpis of a 12 KM bottle asks for a PIN and one of 3 KM does not.

### WP3 — the order screens

**S5 *Zaključi* exists at last.** Today the button posts directly; PLAN §10 invariant 2 requires *Zaključi* → a sheet listing every line and the total → *Potvrdi*, with the table pill as the header, and the only exception is a 0 KM system product.

**S3 *Dodaj*:** long-press → note chips from `categories.note_chips_json` (*bez šećera · s mlijekom · dupla*) or free text, and *Na račun kuće* (WP1's sheet); the **Nedavno** tab beside *Omiljeno*; diacritic-insensitive prefix search over `name`, `short_name` and `search_aliases`; the fixed-price **"Ostalo"** product (`system_key: 'ostalo'`) whose long-press takes the free text that becomes the line's `note`.

**S2 *Sto N*:** locked rounds as collapsible *"Tura 1 · 21:05 · Amar"*, shisha lines with flavour chips and inline *Žar* / *Nova lula*, the draft block *"Nova tura — nije poslano"*, and ⋯ → *Nije plaćeno · Premjesti sto · Predaj sto kolegi · Pokaži narudžbu*. **Žar** is the two-tap path of F4: long-press a table with a live shisha on S1, or the inline chip on S2 → one confirm → an order of its own carrying the `system_key: 'zar'` product with `parent_line_id`. ***Pokaži narudžbu*** is the guest view: the lines and the total, large, with the diagonal watermark *"interni pregled — nije fiskalni račun"* and no button that changes anything.

**The two cards.** After a lock whose `order_total_fen` differs from the draft's arithmetic, an amber card *"Cijena promijenjena: Kafa 1,50 → 2,00 KM · Sto 7"* and a refetch of `/api/bootstrap`. When `late_sync` comes back true (F3 step 5), a red card *"Tura 21:50 za Sto 5 stigla nakon naplate. Jesi li naplatio?"* with *Naplaćeno gotovina* (which enqueues the payment) and *Nije naplaćeno*.

**+ Bez stola** (§1.11): the floating button on S1, a table-less tab rendered as a card above the plan.

**Files owned:** `app/pages/k/index.vue` · `app/pages/k/sto/[id].vue` · `app/pages/k/dodaj/[id].vue` · `app/components/{FloorPlan,FloorTable,ProductTile,ProductShishaSheet,WaiterPaySheet,WaiterHeader}.vue` · `app/components/order/Order*.vue` (`OrderConfirmSheet`, `OrderNoteSheet`, `OrderZarSheet`, `OrderGuestView`, `OrderPriceCard`, `OrderLateCard`, `OrderMoveSheet`) · **backend:** `shared/types/admin.ts` (§1.9, §1.10), `server/services/{bootstrap,orders,tabs}.ts`, `shared/schemas/money.ts` (`table_id` nullable), `server/database/seed.ts` (`system_key`), `tests/unit/{orders,tabs,api-shapes}.test.ts`.

**Routes used:** `GET /api/bootstrap` · `GET /api/changes` · `GET /api/tabs/:id` · `POST /api/orders` · `POST /api/payments` · `POST /api/tabs/unpaid` · `POST /api/tabs/:id/move` · `POST /api/tabs/:id/assign` · `POST /api/tabs/:id/accept` · `POST /api/drafts/discard`.

**Done when:** the tap budgets of §4 hold on a mid-range Android with a stopwatch; *Žar* on a live shisha is two taps; a nargila with two aromas plus a čaj with a chip is ten; *Pokaži narudžbu* carries the watermark and nothing tappable; a price changed in `/a` between draft and lock produces the amber card once and the correct total; a round locked against a paid tab produces the red card.

### WP4 — Moja smjena, historija, brava

**S11 `/k/moja-smjena`:** during the open shift, **counts only** from §1.5 (ture, stolovi, *"Nargila 34 · Kafa 52"*, storna with their status, *"Osoblje 1/2"*, sati, *"Trajno spremanje: uključeno"*); after his own settlement, the money — promet, per category, gotovina, kartica, and the verdict in words. Below it, the last 30 nights from `GET /api/me/shifts` with *Napomena* editable on any own row (§1.6), *Moji sati* (worked only; the planned column arrives with the roster in Phase 4 and is absent, not zero), and *Moji podaci* listing his own sessions (§1.7) with the sentence that a login he does not recognise is worth mentioning to the owner. Category chips open `/k/moja-smjena/stavke?kat=` over the existing `GET /api/me/shift/lines`.

**S10 *Promijeni korisnika*:** on a `shared` device the app re-locks after `shared_device_idle_s` of no touch, showing the last three users as avatars (§1.8) with the rest of the names one tap away, and the pad auto-submitting on the last digit. **Offline unlock, honestly scoped:** the re-lock is a client-side screen over a session that is still alive, so a PBKDF2-SHA-256 hash of the PIN (`crypto.subtle`, 150 000 iterations, a per-(user, device) random salt, cached in IndexedDB only for users who logged in on this device within `14 h`) lets the screen re-open without the network; the next request to the server revalidates the session anyway, and if the session itself has expired the screen says *"Nema veze — prijava traži internet"* rather than pretending. The cache is wiped on logout, on `DEVICE_REVOKED` and after 14 h.

***Drugi konobar*** on a personal device: name → PIN → `borrow: true`, and the header then reads *"Amar · Emirov telefon"* for the whole borrowed session.

**Files owned:** `app/pages/k/moja-smjena/{index,stavke}.vue` · `app/pages/k/pravila.vue` · `app/pages/index.vue` (S0 and the lock screen) · `app/components/WaiterPinPad.vue` · `app/components/mine/Mine*.vue` · `app/composables/{useMe,useLock}.ts` · **backend:** `server/services/summaries.ts` + `server/api/me/**` (§1.5, §1.6, §1.7), `server/services/auth.ts` + `server/api/auth/users.get.ts` (§1.8), `shared/types/{shifts,auth}.ts`, `shared/schemas/shifts.ts`, `shared/routeRoles.ts`, `tests/unit/{summaries,auth,api-shapes,route-roles}.test.ts`.

**Routes used:** `GET /api/me/shift` · `GET /api/me/shift/lines?kat=` · `GET /api/me/shifts?limit=30` · `PUT /api/me/shifts/:id/note` · `GET /api/me/sessions` · `GET /api/auth/users` · `POST /api/auth/pin` · `POST /api/auth/logout`.

**Done when:** before settlement the S11 screen shows counts and the response body contains no `*_fen` key but `max_fen`; after settlement it shows the same night in KM with the tolerance word; a note typed on a row from three nights ago survives a reload; a shared device left alone for five minutes re-locks and Amar's avatar is one of the three offered; the same device with the network off unlocks with the right PIN and refuses the wrong one; the owner's PIN is still refused on a waiter's phone.

---

## 4. Shared conventions

**Language.** Bosnian (ijekavian) on screen, always; no i18n layer, no English fallback. Labels from `PLAN.md` §12 verbatim: *sto, tura, narudžba* (never *račun*), *zaključi · završi smjenu · zatvori smjenu* (the three verbs never mix), *naplati, gotovina, kartica, kusur, tačno, napojnica, nije plaćeno, storno, zatraži storno, na račun kuće, kuća časti, osoblje, na čekanju, odobri / odbij, popis / brzi popis, manjak / višak, otpis, nacrt, neposlano / čeka slanje, premjesti sto / predaj sto kolegi, omiljeno / nedavno, sažetak, napomena, predaj gotovinu, u toleranciji / van tolerancije, označeno za razgovor.* A new word goes into §12 before it goes into a template. An English word on a screen is a bug — the grep test in CI is the guard.

**Tap budgets are acceptance numbers, not aspirations** (PLAN §10, counted from S1 with defaults applied, lock = 2 taps): 2× kafa **5** · nargila + 2× Coca-Cola **8** · mix nargila + čaj s čipom **10** · Žar **2** · gotovina tačno **3** (kartica 4) · šest gostiju odvojeno **≈ 20** · *Završi smjenu* **1** from the S1 bottom bar. A PR that adds a tap to F2–F5 is not merged; the number is checked by hand on a real phone and written in the PR body.

**Touch and layout.** Dark `#0e0e12`, body 18 px, amounts 24 px, targets **≥ 48 px** with 8 px gaps, the primary button 56 px pinned to the bottom, primary actions in the lower 40 % of the screen, every gesture with a button alternative (a long-press always has a ⋯ twin). State is colour **and** icon **and** text.

**Money.** Integer feninga end to end, rendered with `formatKm(fen)` → `1.250,50 KM`, parsed with `parseKm` (which takes `,` and `.`). No `toFixed`, no float, no `Intl` currency. The phone never sends a price or an amount it computed from a catalogue — except `amount_fen` on a payment, which is what the guest handed over.

**Dates and time.** `08.09.2026.` with the trailing dot, 24 h, `Europe/Sarajevo`, the business day from 06:00, every conversion through `shared/dates.ts`. Nothing calls `getHours()`.

**Icons.** Inline SVG, 24 px (20 px in a chip), `stroke="currentColor"`, `stroke-width="1.8"`, no icon library. **No emoji anywhere** — not on a screen, not in a log title, not in a commit message.

**Honesty.** Errors blame nobody: *"Nema veze — čuvamo narudžbu."* A screen that could not refresh says so instead of showing an old number as if it were current. A waiter sees everything about his own work, his money only after he has handed it over, and nothing about a colleague's money (invariant 9).

**Comments.** Two lines wherever a non-Vue concept first appears — IndexedDB, a service worker, back-off, Wake Lock, PBKDF2, a partial unique index, clock skew. Identifiers and comments in English, strings in Bosnian.

---

## 5. Verification

Two things, in this order: the unit suite stays green and grows, and one scripted night is walked on two phones.

### 5.1 The rules of the run

- A **fresh database**: `rm -f data/verify.db*` then `DB_PATH=data/verify.db npm run db:seed`.
- A **dedicated port**: 3112.
- **Never** `data/sank.db` and **never** port 3002 — that is the owner's live dev server and it holds real evenings.

The run is against a **production build**, not `npm run dev`: the service worker and the manifest do not exist under dev (see the `devOptions` note in `nuxt.config.ts`), so check 8 cannot be walked there at all.

```
rm -f data/verify.db*
DB_PATH=data/verify.db PIN_PEPPER=dev npm run db:seed
npm run build
DB_PATH=data/verify.db PIN_PEPPER=dev COOKIE_SECURE=0 SANK_DEV_ENROL=1 \
  PORT=3112 node .output/server/index.mjs                # terminal 1
npx playwright test                                      # terminal 2
```

The command takes **no path**: the suite is the five `tests/e2e/wp*.spec.ts` files between them, and `playwright.config.ts` runs them serially with one worker. There is no `phase3.spec.ts`.

`playwright.config.ts` pins `baseURL: 'http://localhost:3112'` and one Chromium project at 390 × 844 with `isMobile: true`. Two rules govern how a file logs in, and both are about the same limiter:

- **Two contexts where two people are involved**: *Amar* (waiter) and *Emir* (bartender). Each enrols its own device through `POST /api/admin/enrol-codes` + `POST /api/devices/enrol` — **not** `POST /api/dev/enrol`, which reuses one shared device row and rotates its token, so the second context's enrol would invalidate the first's cookie (learned in Phase 2).
- **A device is enrolled once per role per file**, in `test.beforeAll`, and every test then opens a fresh page on that same context. `authLimiter` (`server/middleware/tenant.ts`, `AUTH_DOORS`) allows ten calls a minute keyed by the device cookie **or, before enrolment, by the IP**, and `DEV_MULTIPLIER` is 1 in a built server because `import.meta.dev` compiles to `false` there regardless of `NODE_ENV`. A file that enrolled per test therefore 429'd partway through its own run. What is reset between tests is the phone's state — IndexedDB and localStorage — and never its cookies.

The admin cookie for the setup calls comes from `haris@lounge.ba / lounge`, which also sends `PATCH /api/admin/settings { payment_methods: ['cash', 'card'] }`.

### 5.2 The nine checks

1. **Offline, exactly once.** With `context.setOffline(true)` on Amar's phone: two rounds on Sto 5 (four lines, one of them a nargila with two aromas) and a cash payment on Sto 7. The chip reads *Čeka slanje (3)*; a reload keeps all three; `setOffline(false)` empties the queue within one flush. Then, through the API: exactly one `tabs` row per table, one `orders` row per round, one `payments` row, and re-running the same three bodies changes no count.
2. **A void by PIN.** Amar taps a locked line → *Zatraži storno* → `guest_changed_mind` → the sheet shows *"Vraća robu na stanje: da"* → Emir's PIN on Amar's phone → the line is struck, the tab total drops by the line, and `GET /api/adjustments/pending` is empty. Walked from Amar's **page**, not his `request`: the two sheets shipped disabled once and every storno in the file was a POST, so nothing noticed. A second void requested without a PIN shows the amber *"ostaje u tvom pazaru"* line and appears on `/s/cekanje` with *Odobri*.
3. **A comp inside the allowance.** A long-press on a draft coffee → *Na račun kuće* → *Osoblje* shows *"Osoblje: 0/2 (do 3 KM)"*, locks at 0 KM, and the second one shows 1/2. The third is refused in Bosnian.
4. **A spot count at close with one wrong bottle.** Emir opens *Brzi popis* from `/s`, counts the fourteen spot items (`is_spot` in `server/database/seed.ts` — the screen reads *Stavke za popis 0 / 14*) with one item one short, submits (theoretical never visible before *Predaj*), Amar taps *Potvrđujem stanje*, and `/a` shows the count with its manjak and a working *Primijeni*.
5. **The pending-outbox gate.** With Amar offline and one entry queued, Emir's count is refused with the sentence naming Amar's phone, and goes through after Amar reconnects.
6. **An otpis.** Emir writes off a broken bottle of syrup — *Sirup (Monin 0,7 l)*, the seed's dearest item at 12,00 KM a bottle and the only one that crosses `waste_pin_threshold_fen` on its own: the PIN sheet appears, the entry saves approved, and the item's on-hand drops by one.
7. **Moja smjena, before and after.** Before settling, Amar's S11 shows ture, stolovi and category counts and **no KM**, and the raw `GET /api/me/shift` body contains no `*_fen` key but `max_fen`. He settles blind through S9; the reveal names expected, declared, the difference and the tolerance word; S11 then shows the same night in KM, and the note he types on last night's row survives a reload.
8. **The PWA.** `GET /manifest.webmanifest` is served with the right `start_url` and both icons; `navigator.serviceWorker.controller` is non-null after one reload; `/api/tables/state` is never answered from the cache (the SW's rule is NetworkOnly) while `/api/bootstrap` answers within 3 s or falls back; deploying a new build shows *Nova verzija — osvježi* on S1 and **not** while a draft is open.
9. **Across everything.** No English word on any `/k` or `/s` screen; no emoji; every amount tabular; no horizontal scroll at 390 px; the console clean; `npm run typecheck`, `npm run test` and `npm run build` green.

---

## 6. Phase 3 is done when

All five work packages are merged to `main`; the backend gaps of §1.2–§1.11 are closed with their tests; `0003_phase3.sql` is the only migration added; the nine checks of §5.2 pass on the verify database; and — the two done-when sentences `docs/PHASES.md` §1 sets for this phase — **two rounds and a payment queued on a real Android with Wi-Fi off appear exactly once after reconnecting**, and **a whole shift is opened by a first lock and closed in the app**, with the tap budgets of §4 holding on a mid-range phone.

Phase 4 (chat, roster, receipt scanning, the Dnevnik's laptop table) starts from there.
