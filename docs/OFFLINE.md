# Šank — working without internet

*Build spec, drafted 24.09.2026. Status: **proposal**. §10 lists what Vedran and the owner decide before WP-C and WP-F start; Fable reviews WP-C before it merges.*

The waiter's screen must keep working when the café loses its internet. That means taking rounds, taking money, marking *Rashod* or *Policija*, moving guests and giving tables back. Rounds reach the bar and the ledger once the line returns.

Most of the plumbing already exists: the outbox from Phase 3 WP0. Three things are missing around it:

- After a restart the phone forgets the room.
- A few everyday taps still need the server there and then.
- A table that turns over during an outage is filed wrongly when the phones reconnect.

---

## 0. Read these first

1. `docs/PHASE3.md` §2 — the offline model as it was built — and `app/stores/outbox.ts`.
2. `CLAUDE.md` — the ledger, *one poll*, idempotency, and the end of the shift.
3. `server/services/orders.ts` `resolveTab` (from line 330) — the function §4.2 changes.

## 1. What "no internet" means in this café

Three facts shape everything below.

1. **The server is not in the café.** It is a VPS in a data centre. When the café's line dies, every screen loses the server at the same moment — the bar tablet as well as the phones. So "orders reach the bartender later" is literally true: the tablet sees nothing new until the line is back. Until then, the waiter's phone is the only record of what was ordered, and the only way to tell the bar.
2. **iOS kills a home-screen app it is not showing.** During a long outage the app will often be *cold-started with no network*. The waiter pockets the phone, takes it out ten minutes later, and the app starts from nothing. Anything the floor needs must be on the phone's own disk (IndexedDB), not only in memory.
3. **A phone knows only its own actions until it syncs.** During an outage two phones cannot see each other's rounds. The design does not try to fix that; it makes the merge safe instead. Phones only append. The server decides where each entry lands, judging by **when it happened**, not **when it arrived**.

## 2. Where we are today

### Already works offline

| What | How |
|---|---|
| Locking a round (also the bar's *Osoblje*/*Otpis* rounds) | `enqueue('order')`, idempotent by `client_id` (`app/stores/outbox.ts`) |
| *Naplati*, and the change to hand back | `enqueue('pay')`; the phone computes the change (`useTabPay.ts`) |
| *Rashod*, *Policija*, *Otpis*, *Osoblje* on a tab | `enqueue('unpaid')` |
| *Storno* | `enqueue('adjust')`. A request that carries a PIN falls back to the queue without the PIN (`useAdjustments.ts`) |
| Drafts | In IndexedDB, keyed by person and table (`stores/cart.ts`) |
| Shell, menu, product pictures | Service worker: precache, `NetworkFirst` for `/api/bootstrap`, `CacheFirst` for images (`nuxt.config.ts`) |
| Honest state | Sync chip, 5-minute banner; logout is blocked while the queue is not empty (`useSync.ts`) |
| Re-lock on a shared tablet | A PBKDF2 PIN cache that lives 14 h (`useLock.ts`) |

### Breaks today

| The waiter… | …and offline | Where |
|---|---|---|
| reopens the app | **The room is empty.** The floor lives only in memory and `/api/changes` is network-only; only rounds still in the queue are drawn. | `useChanges.ts:86`, `konobar/index.vue:54` |
| reopens the app | **Nobody is signed in, as far as the screen knows.** The session envelope is in memory only (`useMe.ts:63`), so the waiter's own tables draw as a colleague's and the re-lock pad cannot unlock. | `pages/index.vue:342` |
| opens a table | *"Nema veze — ture se ne mogu učitati"*. The rounds on a tab are a network-only read with no timeout. | `konobar/index.vue:651`, `useApi.ts:322` |
| taps *Očisti sto* / *Naplati i očisti* | The payment is queued, but the clear fails: *"Sto se nije očistio"*. A table paid offline never shows *Očisti sto* either, because the button waits for the server's `paid` flag. | `konobar/index.vue:809`, `WaiterTableSheet.vue:276` |
| looks at a table just paid offline | The tile still shows the full amount. Queued rounds are folded into the floor, queued payments are not. | `konobar/index.vue:143` |
| taps *Premjesti* | Disabled. | `OrderMoveSheet.vue` |
| adds *Žar* (long press, or on a bowl in the sheet) | Needs the bowl's line from the tab's rounds, which come from the server. | `konobar/index.vue:437` |
| has to tell the bar | Nothing on the phone is made for the bartender to read. | — |

### Found while planning: what goes wrong when the phones come back

All six were verified in the code.

1. **A table that turns over during an outage is filed as "late".**
   - The sequence, all on one offline phone: a round for the first guests → *Naplati* → a round for the next guests.
   - On sync, the payment closes the first tab with the **server's arrival clock** (`payments.ts:185`). The next guests' round is dated by the phone, so it looks earlier than that close, and is judged to have happened "before the table was settled" (`orders.ts:369`).
   - It becomes an `unpaid` late tab that is on no floor plan. Its payment then fails with `404 TAB_NOT_FOUND`. Every later round on that table is filed the same way.
2. **A table cleared while it still owes money captures the next guests' rounds.** This happens online too.
   - *Očisti sto* on an unpaid tab leaves it open and off the plan (a *stranded* tab).
   - The next round on that table joins it. The "open tab on this table" lookup ignores `cleared_at` (`orders.ts:413`), and the old `tabs_one_open_per_table_uq` index would refuse a second open tab anyway (`schema.ts:755`).
   - The new guests' table looks free while their round sits on the old party's bill.
3. **The shift can close while a phone still holds rounds.**
   - *Zaključi smjenu* checks open tabs, not phones (`closings.ts:459`). The pending-outbox check exists (`devices.ts:393`), but only settle and the stock count call it, and it only looks at devices whose rounds already reached the server.
   - The close signs that crew out (`shifts.ts:1075`). The phone's queue then answers 401 until somebody signs in on it — and it is sent **as whoever signed in**, onto whatever shift is open then.
4. **A queued payment can name a tab the server never heard of.** A phone's offline round may join a colleague's tab on the same table. The phone's own `tab_client_id` is then never stored, so its queued payment answers `404 TAB_NOT_FOUND` (`payments.ts:341`).
5. **One entry can stop a whole queue.**
   - The server allows 60 rounds a minute per phone (`tenant.ts:112`), and the outbox treats that `429` as a permanent refusal (`outbox.ts:324`). A long outage can put more than 60 rounds on one phone, so flushing them trips the limit.
   - Every `5xx` is retried for ever and stops the run (`outbox.ts:335`). One row that crashes the server therefore blocks every table behind it.
   - Two such crashes exist today: moving a tab onto a table that is paid but not cleared (`tabs.ts:691` checks only `open`), and paying an `unpaid` tab whose table has another live tab.
6. **Nothing tells the bar that a ticket is old.** A ticket is dated and sorted by its arrival (`prep.ts:114`). After an outage the tablet shows, as new, a stack of rounds that were already made from memory.

## 3. The model

Seven rules. Everything in §4–§6 follows from them.

1. **The phone keeps two things on disk: the last room the server described, and its own queue.** What the waiter sees is the room with the queue laid over it: rounds added, payments taken off, cleared tables emptied, moved tabs moved. The phone never edits the stored room; it recomputes the view every time. *(This is a **projection**: one pure function that takes "the last server answer plus my unsent actions" and returns "what the screen shows" — a `computed`, only bigger and kept in one file.)*
2. **Everything a waiter does at a table goes through the queue.** A round, *Naplati*, the four marks, *Storno*, *Očisti sto*, *Premjesti*, a discarded draft, the bar hand-off. Nothing at a table waits for the network.
3. **What needs somebody else's decision right now stays online-only.** Such a button says *Treba internet* rather than failing on tap: signing in, picking the shift, handing a table to a colleague, an approval with a PIN, *Zaključi smjenu*, adding or removing a table, anything in `/admin` (§6).
4. **The server dates everything by when it happened.** That is the phone's clock corrected by the device's measured skew (`clampEventAt`, `shared/dates.ts`). It keeps when it arrived as `created_at`, for the record. Every comparison that decides where a round belongs uses the first.
5. **The phone does not guess ids.** A phone only ever sends tab client ids it minted itself. The server remembers every one it has been sent, including those that ended up on somebody else's tab, so whatever was queued behind a round still finds that tab.
6. **"No ticket, no drink" survives the outage.** When the bar cannot receive, the round is still locked on the phone first, and the phone becomes the ticket (*Pokaži šankeru*). A round the bartender has already seen reaches the bar as done, not as a new ticket.
7. **No screen waits for a network that is not there.** Every read the floor depends on gets a 4-second limit and a stored copy to fall back on. The chip says the network is gone, not a spinner.

## 4. Server changes

### 4.1 When it happened, not when it arrived — fixes finding 1

Write world time (`clientAt`, which each service already computes) into the tab lifecycle stamps:

- `tabs.opened_at` of a new tab (`orders.ts:468`, today `at`);
- `tabs.closed_at` when a payment settles the tab (`payments.ts:185`, today `at`). The payment path must then clamp with the device skew, as orders do; today it clamps without it (`payments.ts:142`);
- `tabs.cleared_at` in *Očisti sto*, and in the automatic clear by the next round (`orders.ts:448`);
- the late tab's `closed_at` (`orders.ts:396`).

The `created_at` columns keep the server's clock. Apart from the late rule, these stamps are only displayed, on the floor row and in the tab detail (checked with a `grep` of `server/`), so no report or summary moves.

### 4.2 Which tab a round joins

Today `resolveTab` (`orders.ts:330`) goes: the phone's own tab → the late rule → the open tab on the table → clear a paid tab → a new tab.

The new rules, in order, for a round that happened at time *t* on table *X*:

1. **The phone names a tab the server knows** — by `tabs.client_id` or by the newest alias (§4.3).
   - Still open: join it, as today. `TAB_TABLE_MISMATCH` stays.
   - Settled, and the round happened before it settled: late, as today, and alias the phone's id to the late tab.
   - Settled, and the round happened after: the guests ordered again after paying. Carry on as if the id were new.
2. **X has a live open tab (open, `cleared_at IS NULL`) opened at or before *t*.** Join it and record the alias.
3. **A settled tab on X was open at *t*** (`opened_at ≤ t ≤ closed_at`). Late, as today: the round belongs to a bill that is already settled.
   - This replaces "*t* is before the table's last close". That test misfires as soon as two tabs on one table overlap in time, which rule 4 below can create.
4. **X has a live open tab opened after *t*.** The round belongs to guests who were there before the ones sitting now.
   - It gets **a tab of its own, born off the table** (cleared, *stranded*).
   - The payment or mark queued behind it on the same phone settles it.
   - The new guests are never charged for it.
5. **X has a paid, uncleared tab that closed before *t*.** Clear it at *t* and open a new tab — today's rule, now with world time.
6. **Otherwise:** a new tab.

**Rule 4 was chosen over today's behaviour**, which joins the round to whatever is open on the table:

- Joining can put a departed party's unpaid round on the new guests' bill.
- It also lets the departed party's queued *Očisti sto* or *Rashod* land on the new guests' tab.
- Rule 4 costs less. If two phones served the *same* party during an outage, that party can end up with two bills, one per phone. Each bill is exactly what that phone showed, so the money still reconciles.
- Which of the two outcomes happens depends on which phone reconnects first. Both are correct money.

**Two schema consequences, in one migration:**

- **Drop `tabs_one_open_per_table_uq`.** Rule 4's own tab needs a second open tab on the table, and so does the fix for finding 2.
  - `tabs_one_live_per_table_uq` stays: one uncleared, open-or-paid tab per table. That is the rule the floor plan depends on.
  - This moves an invariant, so the PR carries the sentence that says so.
- **Every "the open tab on this table" lookup adds `cleared_at IS NULL`.** That means orders (`orders.ts:413`) and move (`tabs.ts:691`). A stranded tab is settled from its own card and is never joined by the next guests.

**Clock slack.** Two phones' clocks, even after skew correction, disagree by seconds. Every "before/after" comparison above takes the same small slack. WP-C picks the constant (start at 60 s) and a test pins it.

**Review.** This is the most delicate change in the plan, because `resolveTab` decides whose bill a round lands on. WP-C is reviewed by Fable before merge, and its tests are the timelines in §9.

### 4.3 Tab aliases — fixes finding 4

- **New table** `tab_aliases(id, venue_id, client_id, tab_id, created_at)`: append-only (the usual triggers), with a unique index on `(venue_id, client_id, tab_id)`.
- **Written by `resolveTab`** whenever a phone's `tab_client_id` ends up on a tab with a different `client_id`.
- **Read through one helper**, `findTabByClientId(tx, venueId, clientId)`: the newest alias first, else `tabs.client_id`. It replaces the separate lookups in payments (`payments.ts:341`), the unpaid mark (`tabs.ts:529`), clear, move and adjustments.

### 4.4 *Očisti sto* and *Premjesti*, by the phone's ids

**`POST /api/tabs/clear`** — body `{ client_id, tab_id?, tab_client_id?, client_created_at }`.

- The tab is found through the helper, or by `tab_id`.
- It writes `cleared_at` (world time), `cleared_by`, and a new `cleared_client_id` column with a partial unique index, the way `unpaid_client_id` works.
- A replay answers 200 `already_applied`.
- If somebody else already cleared the tab, it answers 200 `already_cleared` instead of `409 TAB_ALREADY_CLEARED`: the table is where the phone wanted it.

**`POST /api/tabs/move`** — body `{ client_id, tab_id?, tab_client_id?, table_id, client_created_at }`.

- Every move is a row in a new append-only `tab_moves` table, unique by `(venue_id, client_id)`, so a replay answers 200 with that row.
- A target with a live tab answers `409 TABLE_OCCUPIED`. Today a paid, uncleared target gives a 500 instead.

**The old routes.** `/api/tabs/:id/clear` and `/api/tabs/:id/move` stay for one release, for phones still on the old bundle, then go. `shared/routeRoles.ts`, `changes-coverage.test.ts` and a replay-twice test cover all four routes.

### 4.5 The bar hand-off

- **`POST /api/prep/pokazano`** — body `{ client_id, order_client_id, client_created_at }`.
  - It finds the order by the phone's client id.
  - It sets `prepared_at` (world time) and `prepared_by` (the waiter who showed it).
  - If the order is already prepared, it answers 200 and changes nothing.
  - It bumps `prep`.
- **`PrepOrder` gains `ordered_at`** (= `orders.client_created_at_adj`). The queue keeps its arrival order.

### 4.6 The close waits for the phones — fixes finding 3

**The heartbeat learns about gaps.**

- The first heartbeat after a phone has been cut off carries `offline_from`: when its first request failed.
- The server stores it on the device (`last_gap_from`, `last_gap_to = now`).
- For a gap longer than 5 minutes in an open shift, it writes one Dnevnik entry `veza_prekinuta`: *"Amarov telefon bez veze 21:10–22:40 · 14 stavki stiglo naknadno"*. PLAN §5 already specifies this as `device_offline`; `docs/BACKEND.md` deferred it, and this builds it.

**`closeByBar` asks every phone of the crew.**

- The devices it checks: every device holding a live session on the shift, plus every device that locked a round in it.
- **A fresh device with `pending > 0`** → `409 PENDING_OUTBOX`, naming it. That is today's rule, over a wider set.
- **A device not heard from since the latest gap that any phone of this shift reported** → `409 PHONES_SILENT`, naming it with its last heartbeat.
  - Unless the body says `potvrdi_neposlano: true`. That writes the existing `override` entry (`{ what: 'unsent' }`).
- **On a night with no outage nothing changes** for the šanker.

**Why a gap and not simply "stale".** A phone in a pocket stops beating: its timers pause when the screen is hidden. So on an ordinary night most phones are "stale" by closing time, and refusing on staleness alone would ask for *Zaključi svejedno* every night, until nobody reads the question any more. After a café-wide outage there is almost always a reported gap: the bar tablet stands on the counter with its screen on, and it reports as soon as the line is back.

**What the gap rule cannot see:** a single phone in a dead spot that is pocketed before it reconnects, on a night when nobody else lost the line. That phone still holds its rounds, bound to their author (§5.3), and sends them the next time it is opened. D5 covers where they land.

**The preview.** `GET /api/shifts/:id/zakljucenje` returns the same device list, so the screen can show it before the tap.

### 4.7 What stays exactly as it is

- **A late round is never refused for stock or availability** (`stock.ts:186`, `orders.ts:748`). `PRODUCT_TIME_OVER` is already judged at the round's own time (`orders.ts:538`). Keep both.
- **Queued bodies are a contract with the past.** A phone can hold a body for up to 12 h (`max_sync_lag_h`), across a deploy.
  - The schemas of the queued routes only ever gain optional fields.
  - A field is removed only after a release that no longer sends it has shipped, and a day has passed.

## 5. Phone changes

### 5.1 What the phone keeps on disk

A new store, `app/stores/room.ts`. It uses IndexedDB via `idb-keyval`, with the same `plain()` rule as the outbox.

| Key | What | Written | Dropped |
|---|---|---|---|
| `sank:room` | the last `tables_state`, with `seq`, `saved_at` and the `unavailable` lists | every poll answer that carries them | on logout or revoke; also when older than 12 h or from an earlier business day |
| `sank:tabs` | the last `TabDetail` per tab id, with `saved_at` | on every `getTab`. In the background, for each of **my** tabs the poll says moved — one request at a time, online only | when the tab leaves the room; on logout or revoke |
| `sank:me` | the last `MeContext` | every successful `/api/me` | status `anon`/`nodevice`, logout |

- **`useChanges` hydrates the room before its first request**, so the plan paints at once from disk.
- **`useMe().load()` falls back to `sank:me` on a network failure** (status `offline`), and `requireSession()` accepts that for the screen.
  - That also makes the offline re-lock work after a restart.
  - The server still decides identity on every request, and the stored envelope holds no secret.
- **Reads get a 4 s `timeoutMs`:** `getTab`, `getMe` and `getStock`. Every caller falls back to the stored copy.
- **`wipeLocalState()` also clears the three IndexedDB keys.**

### 5.2 The projection — one pure function

`app/utils/projection.ts`:

```ts
project(room, tabs, entries, catalogue, me) → { tables, loose, stranded, tabDetail(tabId) }
```

Today this logic is spread over `queuedByTable`, `withQueue` and `useTabMoney`, and it knows only rounds and payments. It moves into one file with a unit test per entry kind:

| Queued entry | What it does to the view |
|---|---|
| `order` | Adds its lines to the tab as *čeka slanje*. They are priced from the menu for display only; the server prices the round. A table with no tab becomes mine. |
| `pay` | Takes the amount off. At 0, the tile gets its checkmark and the sheet offers *Očisti sto*. |
| `unpaid` | The tab leaves the tile; the guests are gone. |
| `adjust` (storno) | Strikes the line when the phone predicts it applies by itself; otherwise marks it *čeka odobrenje*. |
| `clear` | The tile is free. A tab that still owes money becomes a stranded card, which is what the server will make of it. |
| `move` | The tab is drawn on its new table. |
| `prep` | Nothing on the floor; the round leaves *Za šank*. |

The floor and the sheet read only from `project()`, so the two can no longer disagree. Nothing else on a screen does arithmetic with the queue.

### 5.3 The outbox

**New kinds:** `clear`, `move`, `discard` and `prep`.

- `discard` is the draft discard. Its body has no idempotency key, and the server already treats a repeat as two honest entries (`drafts.test.ts:93`).
- Every kind carries `tab_client_id` where it has one, so a refused entry holds back its own table and no other.

**`prep` never counts as pending.** It is not money. Like chat before it, it never:

- colours the chip,
- blocks the logout,
- shows in the heartbeat.

**Each entry remembers its author** (`user_id`, taken from `me` when it is queued).

- The flush sends only the signed-in person's entries.
- Anybody else's stay parked and visible, on the lock screen and above the plan: *"Neposlano od Amara (3) — šalje se kad se Amar prijavi na ovom telefonu"*.
- Nothing is ever sent under another person's name (finding 3).

**Error handling:**

| Answer | What the outbox does |
|---|---|
| `429` | Wait for `Retry-After` and carry on. The entry is not failed. |
| `502/503/504` | A network error, as today. |
| `500` three times on one entry | That entry fails, with *"Server ne prima ovu stavku — javi vlasniku"*, so the rest of the queue keeps moving. |

### 5.4 The waiter's screens

- **Header.** The chip as today. While the chip is red, *Stanje od 21:40* shows under the title. After 2 minutes offline, a banner: *"Nema interneta od 21:10 — sve se čuva na telefonu. Ture pokaži šankeru."*
- **Sheet.**
  - The rounds come from `project()`: stored ones carry *Stanje od 21:40*, queued ones carry *čeka slanje*.
  - *Očisti sto* appears when the projected tab is paid.
  - *Premjesti* works offline.
  - *Predaj kolegi* says *Treba internet*.
  - Clearing a table forgets its tab id on the phone, the way a full payment already does. Without this, the next guests' first round would name the old tab.
- **Locking a round offline** (every session not in šanker mode).
  - Instead of the toast, the round opens full screen exactly as the bar would see it: `TicketCard.vue`, built from the queued payload with names from the menu.
  - Two buttons: *Šanker je vidio* (queues `prep`) and *Kasnije*.
- ***Za šank (2)*.**
  - A strip over the plan lists my locked rounds that have neither reached the server nor been shown.
  - A tap opens the same card.
  - The strip empties as rounds are sent or shown.
- **Online-only buttons** carry *Treba internet* underneath (§6).

### 5.5 The bar

- **Offline banner:** *"Nema veze — nove ture ne stižu. Konobari ti ih pokazuju na telefonu."* The screen keeps the last queue it had. Optionally it is stored like the room, so a restarted tablet is not blank.
- **`TicketCard.vue`:** when `created_at − ordered_at > 2 min`, the card adds *naručeno 21:05 · stiglo 21:42* and a *bez veze* chip. A round that was shown never reaches the open queue at all.
- **`/sanker/zakljuci`:**
  - It shows the device list from §4.6: *"Čeka se: Amarov telefon — javio se u 21:05. Neka otvori aplikaciju."*
  - *Zaključi svejedno* sits behind a second question.

## 6. Online-only, on purpose

| Action | Why | Offline the screen says |
|---|---|---|
| Signing in with a PIN — except re-opening a session this phone already holds | A session can only be born on the server | *Nema veze — prijava traži internet* (as today) |
| *Koju smjenu radiš?*, switching *konobar/šanker* | The seat and the shift are server state other phones read | *Treba internet* |
| *Predaj kolegi* / *Prihvati* | Needs the colleague, now | *Treba internet* |
| An approval with a PIN, *Odobri/Odbij* | A PIN must never sit in IndexedDB, and the approval window is measured when the decision is made (`useAdjustments.ts`) | The request queues as *čeka odobrenje* (as today) |
| *Zaključi smjenu* | Only true against the server's numbers | *Treba internet* (as today) |
| *+ Sto*, removing a table | Changes every phone's room | *Treba internet* |
| *Moja smjena*, *Stanje šanka* | Reports | The last copy with its time, where there is one; else *Treba internet* |
| All of `/admin` | The owner is not on the café's wifi | — |

## 7. When two phones disagree

| Situation | Outcome |
|---|---|
| One phone; a table turns over offline (round, *Naplati i očisti*, the next guests' round, *Naplati*) | Two tabs, both paid, nothing late (§4.1). |
| I add a round to a colleague's table while offline | It joins the colleague's tab, which was opened before it. My queued payment finds the tab through the alias. If my payment does not cover the colleague's round, the tab is flagged *naplata čeka*, as today. |
| My round is from before the guests sitting there now (a colleague cleared and re-seated the table while I was offline) | A tab of its own, off the plan (§4.2 rule 4). My queued payment settles it; the new guests never see it. |
| My round is from before a tab on that table was paid | Late tab and a *kasno* card on my phone — today's rule, now with correct dates. If I queued a payment for it, the payment lands on it through the alias. |
| Two phones clear the same table | The second answers 200 and changes nothing. |
| I move guests to a table a colleague has since seated | `409 TABLE_OCCUPIED` → a failed card, *"Sto 9 je u međuvremenu zauzet"*. *Odbaci* leaves them on the old table in the books, and I move them again once I know where they sit. |
| I take cash on a tab a colleague already settled | `409 TAB_ALREADY_PAID` → a failed card naming the table, who settled it and when. If the guest paid twice, the money goes back to the guest. The copy is settled with the owner, in the *označeno za razgovor* tone and never as an accusation. |
| What is owed changed under my payment (a storno, a partial payment) | `422 OVERPAY` carries `remaining_fen`; *Popravi* re-queues the payment for that amount. |
| The šanker closes while my phone is offline | Refused until my phone reports, or confirmed with *Zaključi svejedno* (§4.6). My entries wait for me (§5.3). |
| A product was switched off in the meantime | `404 PRODUCT_NOT_FOUND` → a failed card. Rare, it comes from an admin action, and the owner decides. |

## 8. Work packages

One PR each. Each must pass `npm run typecheck && npm run test && npm run build`, and have its done-when walked on a 390 px viewport with the network off at least once (PHASE3 §3).

**Order:**

- A, B and C can run side by side.
- D needs A and C.
- E needs A and B.
- F stands alone.
- G is documentation.

Sizes are relative: S < M < L.

### WP-A — The phone remembers the room · client · M

- **Files:** `app/stores/room.ts` (new), `app/utils/projection.ts` (new), `app/composables/{useChanges,useMe,useApi,useTabPay}.ts`, `app/pages/konobar/index.vue`, `app/pages/konobar/dodaj/[id].vue`, `app/pages/index.vue`, `app/components/WaiterHeader.vue`, `tests/unit/projection.test.ts` (new).
- **Done when** — with the network off, the installed app is killed and reopened, and then:
  - it shows the room as last seen, with *Stanje od*;
  - my tables are in my shift's colour, and each of them opens with its rounds;
  - a table paid offline shows its checkmark;
  - a shared tablet, re-locked and restarted offline, unlocks with the last PIN;
  - after *Odjavi se*, nothing of the room is left on disk.

### WP-B — The outbox survives a long outage · client · S

- **Files:** `app/stores/outbox.ts`, `app/composables/{useOutbox,useSync,useChanges}.ts`, `app/pages/index.vue`, `app/components/waiter/WaiterFailedCard.vue`, `tests/unit/outbox.test.ts`.
- **Done when** vitest shows that:
  - 90 queued rounds, sent against the 60-a-minute limit, empty with no failed card;
  - a `500` three times fails that one entry and lets the next table's entries go;
  - a `502` never fails anything;
  - another person's entries are never sent and are listed on the lock screen;
  - `prep` moves neither the chip nor `pending`.

### WP-C — Where a late round belongs · server · L · Fable reviews

- **Files:** `server/services/{orders,payments,tabs,clearTable,adjustments}.ts`, a new `server/services/tabAliases.ts`, migration `0025_offline_tabs.sql` (drops `tabs_one_open_per_table_uq`, creates `tab_aliases`), `server/database/{schema.ts,triggers.sql}`, `tests/unit/offline-timelines.test.ts` (new).
- **Done when:**
  - the seven timelines of §9 replay, each twice, into exactly the tabs and payments written next to them;
  - `tests/unit/invariants.test.ts` is untouched;
  - the PR names the invariant that moved (the dropped index).

### WP-D — *Očisti sto* and *Premjesti* offline · server + client · M

- **Files:** `server/api/tabs/{clear,move}.post.ts` (new), `server/services/{clearTable,tabs}.ts`, migration `0026_tab_moves.sql` (`tab_moves`, `tabs.cleared_client_id`), `shared/{routeRoles,schemas/money}.ts`, `app/composables/useApi.ts` (`OUTBOX_URLS`), `app/stores/cart.ts`, `app/pages/konobar/index.vue`, `app/components/waiter/{WaiterTableSheet,WaiterFailedCard}.vue`, `app/components/order/OrderMoveSheet.vue`.
- **Done when:**
  - offline, *Naplati i očisti* on Sto 5 frees the tile at once;
  - after sync, every phone shows Sto 5 free;
  - each body posted twice writes one row;
  - a move onto a paid, uncleared table answers 409, not 500.

### WP-E — *Pokaži šankeru* · server + client · M

- **Files:** `server/api/prep/pokazano.post.ts` (new), `server/services/prep.ts`, `shared/types/money.ts` (`PrepOrder.ordered_at`), `shared/routeRoles.ts`, `app/components/TicketCard.vue`, `app/components/waiter/WaiterZaSank.vue` (new), `app/pages/konobar/{index,dodaj/[id]}.vue`, `app/pages/sanker/index.vue`, `app/components/pravila/PravilaDoc.vue` (one paragraph, *Kad nema interneta*).
- **Done when:**
  - a round locked offline, shown and marked *Šanker je vidio*, is in the bar's *Gotovo* list after sync and was never in the open queue;
  - a round locked offline and not shown arrives open, with *naručeno … · stiglo …*;
  - the šanker's own rounds never ask to be shown.

### WP-F — The close waits for the phones · server + šanker screen · M

- **Files:**
  - server: `server/services/{heartbeat,devices,closings}.ts`, `server/api/devices/heartbeat.post.ts`, a migration for `devices.last_gap_from/last_gap_to`;
  - shared: `shared/schemas/sync.ts`, `shared/logTemplates.ts` (`veza_prekinuta`), `shared/errors/shifts.ts` (`PHONES_SILENT`). `logTemplates.ts` is frozen for Korak 2, so the PR says why it changes;
  - client: `app/composables/useChanges.ts` (sends `offline_from`), `app/pages/sanker/zakljuci.vue`.
- **Done when** — e2e:
  - Amar's phone is online but holds a refused entry, and Emir's close is refused with `PENDING_OUTBOX`, naming Amar's phone;
  - both go offline; Amar queues a round; the line comes back; Emir's tablet reports its gap while Amar's app stays closed. The close is then refused with `PHONES_SILENT`, naming Amar's phone;
  - Amar opens the app, the round flushes, and the close goes through;
  - run the same again, but close with *Zaključi svejedno* while Amar's app is still closed. The close is accepted, and the Dnevnik shows the override and the gap.

### WP-G — Outside the app · docs · S

- **`deploy/OWNER_RUNBOOK.md`** gets a section, *Kad nestane interneta*:
  1. Phones switch to mobile data.
  2. The bar tablet joins the šanker's hotspot.
  3. Everybody opens the app until it says *Sinhronizovano* before *Zaključi smjenu*.
- **Once WP-C lands:** `CLAUDE.md` gets a paragraph on world time and the tab rules, PLAN §5 *Offline* points here, and PLAN §12 gets the new labels.

## 9. Verification

**Timelines for WP-C** — vitest, replayed through the services with the clock set:

1. **One phone, Sto 5.** R1 21:00 → P1 21:20 → clear 21:21 → R2 21:25 → P2 21:50, all arriving at 22:00. → Two tabs, both paid; no `late_sync`, no `late_after_close`. *(Today: R2 is late and P2 fails with 404.)*
2. **The guests pay, stay, and order again.** R1 → P1 (*Samo naplati*) → R2 → P2. → Two tabs, both paid. The first is cleared by R2 at R2's time.
3. **Two phones, the same guests.**
   - B, online, locks R2 at 21:10. A's R1 from 21:00 arrives at 21:40.
   - → R1 gets its own tab (rule 4), and A's P1 settles it.
   - In the reverse arrival order there is one tab and both rounds are on it. Both outcomes are correct money.
4. **The table is re-seated while A is offline.**
   - A: R1 21:00, P1 21:20, clear 21:21. B, online: R2 21:25.
   - A's three arrive at 21:40. → R1 gets its own tab, P1 settles it, and the clear answers `already_cleared`. B's tab holds only R2.
5. **A genuinely late round.** T1 is paid at 21:20, online. A's R from 21:10 arrives at 21:40. → A late tab with `pending_review`. A's queued payment for it pays it, through the alias.
6. **Stranded capture** (finding 2, online). R1, then *Očisti sto* with money still owed. → The next guests' R2 opens a new live tab, not the stranded one.
7. **Everything twice.** Every body in 1–6 posted twice. → One row each.

**Playwright** (`context.setOffline`), one spec per slice:

- a restart offline shows the room;
- the turnover of timeline 1, end to end on two tables;
- the bar hand-off;
- the close gate.

**Real phones** — one iPhone and one Android phone, both installed from the home screen:

1. During a mock evening, unplug the router's internet cable for 30 minutes.
2. Meanwhile: three tables turn over, one party is moved, one *Rashod*, and every round is handed to the bar from the phone.
3. Kill the app on both phones mid-outage.
4. Plug the cable back in and open both phones.
5. Check *Puls* against a paper tally of the same evening, and check that nothing is on the bar's open queue that was already made.

## 10. Decisions before WP-C and WP-F

- **D1 · A new crew during an outage.** Nobody can sign in without the server.
  - *Recommended:* accept that, and make it rare. Phones go on mobile data and the tablet on a hotspot (WP-G), and a crew that was signed in when the line dropped keeps working through any outage.
  - *Rejected for now:* signing in offline against PINs cached on the phone for everybody who used it recently.
    - A four-digit PIN's cached hash can be brute-forced off a stolen phone in minutes.
    - The phone cannot know about a worker who was deactivated.
    - The shift picker has nothing to offer offline.
- **D2 · The bar hand-off.**
  - *Recommended:* *Pokaži šankeru* plus *Šanker je vidio*.
  - *Alternative:* verbal only, with late tickets merely labelled.
- **D3 · A round from before the guests sitting there now.**
  - *Recommended:* its own tab (§4.2 rule 4).
  - *Alternative:* join the current guests' bill, as today. §4.2 says why not.
- **D4 · Closing while a phone is silent after an outage.**
  - *Recommended:* refuse, with *Zaključi svejedno*.
  - *Alternative:* only list the phones.
- **D5 · Rounds that reach the server after their shift closed.** This is only possible after *Zaključi svejedno*, or from a phone that died.
  - *v1:* they wait on the phone until their author signs in on it again, and land, marked late, on the shift that is open then.
  - *v2:* file them against the closed shift, through a narrow door for sessions that a close ended. This touches `tenant.ts` and the summaries.
  - Build v2 only if v1 turns out to happen in practice.
- **D6 · A 4G fallback router.** A one-time purchase, and the phones never notice the outage. It is the owner's call, not an app decision — but it removes most of what this document handles.

**Not in this plan, deliberately:**

- **Phones talking to each other without the server.** Browsers cannot open a local server, and WebRTC needs a server to introduce the phones.
- **A local copy of the server in the café.** Two databases would be two sources of truth to reconcile, and a second origin breaks the service worker and the cookies.
- **Background sync on iOS.** It does not exist there. A phone sends its queue when somebody opens the app, which is why the close waits for the phones.
