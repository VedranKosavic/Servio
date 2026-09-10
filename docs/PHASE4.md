# Šank — Phase 4 build spec: Ekipa

**Status:** the build order for Phase 4 as defined in `docs/PHASES.md` §1 ("Ekipa") and `PLAN.md` §13 (Phase 2's Razgovor/Raspored bullets plus the whole of Phase 3b), re-cut for the way the project actually runs today — one team, five work packages, the strict folder ownership of `docs/PHASES.md` §2 kept because it is what makes four packages mergeable in parallel. Where this file disagrees with `PLAN.md` about *what a feature does*, `PLAN.md` wins. Where it disagrees with `docs/BACKEND.md` §7 about *what a route is called*, **the code on disk wins**, and this document was written against the code on disk on 2026-09-10.

Phases 1–3 are complete on `main`: 887 vitest tests and 27 Playwright checks, the backend contract of `docs/BACKEND.md`, the admin dashboard `/a`, and the waiter and bartender app with its outbox, PWA, storno, popis and *Moja smjena*. What is missing is everything that makes the app a place where the *team* lives rather than only the till:

- **there is no chat** — no `chat_*` tables, no `canSee`, no channels, no uploads route, no image pipeline at all;
- **there is no roster** — no `shift_templates`, no weeks, no assignments, no swaps, no hours;
- **there are no published *Pravila*** — `/k/pravila` renders thresholds out of `me.venue.settings` and stores nothing, so nobody has ever acknowledged anything;
- **there is no receipt scan** — `deliveries.source` and `deliveries.scan_id` exist and have never been written, `delivery_scans` and `supplier_aliases` do not exist, and no Anthropic SDK is installed.

`app/utils/waiterMenu.ts` already lists *Razgovor* and *Raspored* as `ready: false` with *stiže uskoro*. This phase is what turns those two lines to `true`.

---

## 0. Read these first, in this order

1. `CLAUDE.md` — Bosnian on screen and English in identifiers, money as integer feninga, one poll, sessions never `user_id` in a body, ledger tables append-only, invariant tests never weakened, **nothing notifies outward**.
2. `PLAN.md` **§6** (the chat / uploads / roster / rules table definitions), **F12** in full (channels, the access matrix, messages, images, offline, badges, moderation, the pinned note), **F13** (already built — read it so you do not rebuild it), **F14** in full (the roster model, the owner's week, the waiter's swap, absence and past dates, constraints, hours, screens), **§8** (the fairness contract, which is the reason half of F12 is shaped the way it is), **§9 F8** (*Prijem sa slike*), **§10** S12 and S15–S18, **§11** pages 6–8, and **§12** — the glossary, whose labels are reused *verbatim*.
3. `docs/BACKEND.md` **§2** (ids, money, time, the three body timestamps, errors, roles, the actor, signatures, transactions, triggers, migrations, tests) and **§4** (the change feed, ETag, heartbeat, what each client polls).
4. `docs/PHASE3.md` §3 (how five packages share a repo without touching each other's files) and §5 (the shape of a verification run) — this phase copies both.
5. `shared/routeRoles.ts` — **a route not in that file does not exist.** `server/middleware/tenant.ts` 403s an undeclared key and `tests/unit/route-roles.test.ts` asserts the two sets match, both directions.

---

## 1. What Phase 4 is, and four standing decisions

Four features — **Razgovor** (F12, §8: three channels, images, the pinned *Za naručiti* note, moderation; S15, S16, `/a` page 7), **Raspored** (F14: templates, weeks, publish, swaps, absence, *Sati*; S17, `/a` page 8), **Prijem sa slike** (F8, §9: a photo of an otpremnica becomes a draft delivery; `/a/roba/prijem`) and **Pravila** (§8: versioned rules with acknowledgements; S12, `/a/postavke/pravila`) — in one backend package and four UI packages.

Four decisions that override older text anywhere in the repo:

- **Nothing notifies outward, still.** Every sentence in `PLAN.md` about Telegram — `chat_digest`, `roster_sick`, `swap_unfilled` as a *message*, the deep links — is superseded (BACKEND §9). Those rules survive **only** as rows on the in-app *Zahtijeva pažnju* list on *Puls*. Do not add a sender, a bot token, a web-push subscription or a service-worker `push` handler.
- **Chat is a route, never an overlay** (PLAN §10 invariant 10). No toast, no sound, no vibration, anywhere in S1–S9. An incoming message changes a badge number and nothing else. Nothing in this phase adds a tap to F2–F5.
- **Chat never enters the money outbox.** Unsent messages and photos live in the chat store's own pending list and are never counted in `outbox_len`, the heartbeat's `pending`, the sync chip, the logout gate, or the settlement and count gates. A stuck "nema leda" must not stop a cash handover.
- **`/k` and `/s` are dark, `/a` is light.** The two themes never share a rule; the `/a` chat screen is a re-implementation in the light kit, not a re-skin of the dark one.

---

## 2. WP0 — the backend *(sequential, first)*

WP0 lands alone and merges before WP1–WP4 branch. It owns the migration, the triggers, the five services, every route, every new shared file, and the client API methods the four UI packages will call. Nothing in `app/pages/**` or `app/components/**` is WP0's except the four *settled up front* files of §2.12.

### 2.1 Migration `0004_phase4.sql`

**One migration, one owner, generated once** with `drizzle-kit generate` (never `push`). Two hard rules from BACKEND §2 apply: a new column carrying `REFERENCES` must be nullable with no default, and nothing may change an existing column's type or nullability — a test greps the new migration for `__new_` and fails on a hit. Every table below carries `venue_id TEXT NOT NULL REFERENCES venues(id)` and every unique index starts with `venue_id`; `tests/unit/schema.test.ts` proves both for free.

**Chat.**

- `chat_channels(id, venue_id, kind 'svi'|'konobari'|'admini', name, pinned_text?, pinned_by?, pinned_at?, created_at)`, `UNIQUE(venue_id, kind)` → `chat_channels_kind_uq`. Three rows seeded with the venue; never created, renamed or deleted by a user. Deliberately **mutable**: a pinned note is a note, not a ledger.
- `chat_messages(id, venue_id, channel_id, client_id, seq INTEGER NOT NULL, kind 'text'|'image'|'system', body?, upload_id?, reply_to_id?, forwarded_from_id?, author_id?, device_id?, system_key?, system_payload_json?, client_created_at?, client_created_at_adj?, created_at, deleted_at?, deleted_by?, redacted_at?)`; `UNIQUE(venue_id, client_id)`; indexes `(venue_id, seq)` and `(venue_id, channel_id, seq)`. `seq` is **venue-wide**, assigned as `MAX(seq)+1` inside the insert transaction exactly like `orders.shift_seq`, so one integer is the cursor for every channel. `author_id` is NULL only for `kind='system'`. `body` ≤ 2000 chars; an image message may carry a caption in `body`.
- `chat_reads(venue_id, channel_id, user_id, last_read_seq, updated_at)`, PK `(venue_id, channel_id, user_id)`. A plain upsert. It exists so badges work, it is shown to nobody, and *Pravila* says both.
- `uploads(id, venue_id, kind 'chat'|'delivery', path, bytes, width, height, mime, created_by, device_id?, created_at, deleted_at?)`; indexes `(venue_id, kind, created_at)` and `(venue_id, created_by, created_at)`.

**Roster.**

- `shift_templates(id, venue_id, name, start_time 'HH:MM', end_time 'HH:MM', sort, active, created_at)`, `UNIQUE(venue_id, name)`. Seed *Dnevna* 08:00–16:00 and *Večernja* 16:00–01:00. `end_time <= start_time` means the shift ends next day.
- `roster_weeks(id, venue_id, week_start, published_at?, published_by?, created_by, created_at)`, `UNIQUE(venue_id, week_start)`; `week_start` is a Monday ISO date from `weekStart()`.
- `roster_assignments(id, venue_id, work_date, template_id, user_id, start_time, end_time, status 'planned'|'swapped'|'sick'|'absent'|'removed', origin 'owner'|'copy'|'swap', swap_request_id?, note?, created_by, created_at, updated_by?, updated_at?)`; partial unique `(venue_id, work_date, template_id, user_id) WHERE status NOT IN ('swapped','removed')`; indexes `(venue_id, work_date)` and `(venue_id, user_id, work_date)`. `start_time`/`end_time` are **copied from the template at insert**, like a price at lock, so editing a template tomorrow never rewrites anyone's past hours.
- `swap_requests(id, venue_id, assignment_id, from_user_id, to_user_id?, reason 'zamjena'|'bolest', note?, status 'pending'|'accepted'|'declined'|'cancelled', decided_by?, decided_at?, created_at)`; partial unique `(venue_id, assignment_id) WHERE status='pending'` — one live request per shift.

**Pravila.**

- `rules(id, venue_id, version INTEGER, body_md, published_at, published_by)`, `UNIQUE(venue_id, version)`. Append-only: a correction is a new version.
- `users` gains three nullable columns: `rules_ack_at`, `rules_version INTEGER`, `chat_muted_until`.

**Scan.**

- `delivery_scans(id, venue_id, upload_id, model, raw_json?, status 'uploaded'|'parsed'|'applied'|'discarded', error?, created_by, created_at, parsed_at?)`.
- `supplier_aliases(id, venue_id, stock_item_id, alias, supplier_name?, created_by, created_at)`, `UNIQUE(venue_id, alias)` — the alias is stored lowercased and diacritic-folded by the service, so "Coca Cola 0,25" and "coca-cola 0.25" collide on purpose.

`deliveries.source` and `deliveries.scan_id` **already exist** (Korak 2 left them for exactly this) and are written for the first time here. No column is added to `deliveries`.

### 2.2 Triggers (`server/database/triggers.sql`, names in `shared/constants.ts`)

Same two shapes as everywhere else — `<t>_frozen_cols` for columns that may never change and `<t>_status_guard` for the allowed transitions — and every frozen check uses `OLD.x IS NEW.x`.

- **`chat_messages_frozen_cols`** — `venue_id, channel_id, client_id, seq, kind, upload_id, reply_to_id, forwarded_from_id, author_id, device_id, system_key, created_at` may never change. **`chat_messages_status_guard`** allows exactly two independent one-way transitions: `deleted_at`/`deleted_by` NULL → set, once; and, separately, `redacted_at` NULL → set once together with `body` rewritten to the fixed string `Uklonjeno · retencija` (the Phase 5 retention task; nothing in Phase 4 writes it). Any other UPDATE, and every DELETE, aborts. A soft-deleted text **keeps its body** — moderation evidence; the placeholder on screen shows who and when, never the text.
- **`rules_no_update` / `rules_no_delete`** — versions are append-only.
- **`roster_assignments_status_guard`** — the mutable roster is the documented exception to append-only (§6), but the transitions are not free: `planned → swapped|sick|absent|removed`, `sick → planned|swapped`, `absent → planned`, `removed → planned` (an owner un-removing before publish). `swapped → *` aborts — a taken shift is history. `venue_id, work_date, template_id, user_id, start_time, end_time, created_by, created_at` are frozen: a cell change is a new row and a `removed` row, never an overwrite. A hard `DELETE` is allowed **only** while the week is unpublished, enforced in the service, not the trigger.
- **`swap_requests_status_guard`** — `pending → accepted|declined|cancelled` and nothing else; `status, to_user_id, decided_by, decided_at` are the only mutable columns. `accepted → pending` and `declined → accepted` abort.
- **`uploads_update_guard`** — `deleted_at` NULL → set once, nothing else; no DELETE (the row outlives the file, which is how the reference count and the GC stay honest).
- **`delivery_scans_status_guard`** — `uploaded → parsed|discarded`, `parsed → applied|discarded`; `raw_json`, `error`, `parsed_at` writable on the `uploaded → parsed` move only.

`chat_channels`, `chat_reads`, `shift_templates`, `roster_weeks` and `supplier_aliases` get **no triggers** and the "Tables with NO triggers, deliberately" comment block at the top of `triggers.sql` gains a line saying so and why: a pinned note, a read cursor, a template and a learned alias are plans and bookmarks, not ledgers. Every roster write still goes through `services/roster.ts`, which writes a `log_entries` row with before/after in the same transaction — that is where the history lives.

### 2.3 `settings_json` additions (`shared/settings.ts`)

Append to `DEFAULT_SETTINGS`, all of them published on *Pravila*:

```ts
chat_delete_own_s: 900,
chat_image_month_bytes: 209715200,     // 200 MB of chat photos per venue per month
upload_user_day_bytes: 31457280,       // 30 MB
upload_user_day_files: 25,
chat_retention_days: 90,
roster_late_grace_min: 30,
swap_needs_owner: false,               // Phase 5; read by nothing in Phase 4
```

`bartender_can_receive_goods` already exists and is what gates `kind='delivery'` uploads for a šanker.

### 2.4 `shared/chat.ts` — the access matrix and the money guard

Two pure functions, imported by every route, every screen and every test:

```ts
export type ChannelKind = 'svi' | 'konobari' | 'admini'
export const CHANNEL_KINDS: ChannelKind[] = ['svi', 'konobari', 'admini']

/** PLAN F12 (a). Four rows × three columns, and nothing else decides access. */
export function canSee(role: Role, kind: ChannelKind): boolean

/** The composer's confirm sheet and the server's quiet log entry ask the same question. */
export function looksLikeMoney(text: string): boolean
```

| `users.role` | Svi | Konobari | Admini |
|---|---|---|---|
| `admin` | yes | **no** | yes |
| `bartender` | yes | yes | no |
| `waiter` | yes | yes | no |

The šanker is staff. The owner never sees *Konobari* in the app — enforced on **every** read, write, quote and image URL, not only on the channel list. `looksLikeMoney` matches `/\d+[,.]\d{2}\s*KM/i` or `/(očekivano|manjak|razlika|predao|pazar)/i`.

### 2.5 `server/services/chat.ts`

```ts
export function chatSince(db: Queryable, venueId: string, actor: Actor,
                          cursor: number | null): ChatSince
export function chatHistory(db: Queryable, venueId: string, actor: Actor,
                            kind: ChannelKind, beforeSeq: number | null, limit: number): ChatPage
export function postMessage(db: Db, venueId: string, actor: Actor,
                            kind: ChannelKind, body: PostMessageBody): PostMessageResult
export function deleteMessage(db: Db, venueId: string, actor: Actor, id: string): void
export function forwardMessage(db: Db, venueId: string, actor: Actor,
                               id: string, to: ChannelKind): PostMessageResult
export function markRead(db: Db, venueId: string, actor: Actor, kind: ChannelKind, seq: number): void
export function setPin(db: Db, venueId: string, actor: Actor,
                       kind: ChannelKind, body: { text: string } | { append: string } | { cleared: true }): void
export function muteUser(db: Db, venueId: string, actor: Actor, userId: string, until: string | null): void
/** The one way the system speaks. Takes `Tx`, so it runs inside its caller's transaction. */
export function postSystem(tx: Tx, venueId: string, kind: ChannelKind,
                           systemKey: string, text: string, payload?: SystemPayload): void
```

**`chatSince`.** With no cursor (first open, wiped IndexedDB) it returns `channels[]` — only the ones `canSee` admits — with the last 30 messages each, plus `cursor = MAX(seq)`. With a cursor it returns `{ cursor, channels: [{ id, kind, name, unread, last_seq, preview, pinned_text, pinned_at, members }], messages, has_more }` for `seq > cursor`, capped at 200, oldest first; when `MAX(seq) − cursor > 1000` it answers `{ reset: true }` and the client re-bootstraps. **Messages from a forbidden channel are never selected** — the `WHERE channel_id IN (…)` is built from `canSee`, not filtered afterwards. `unread` counts only `kind IN ('text','image')`: a system line is shown in the thread and never bumps a badge, so the badge means "a person wrote something". `members` is every active user the matrix admits, by name, so the room is visible to the people in it.

**`postMessage`** takes `{ client_id, kind, body?, upload_id?, reply_to_id?, money_ack?, client_created_at }`. The replay lookup on `(venue_id, client_id)` is the first statement inside the transaction and a replay returns **200** with the stored result and `already_applied: true` — never 409 (CLAUDE.md). Errors: `403 CHANNEL_FORBIDDEN` (matrix), `403 MUTED` (`users.chat_muted_until` in the future, message "Vlasnik te utišao do 10:00"), `422 BODY_EMPTY | BODY_TOO_LONG | UPLOAD_NOT_YOURS | REPLY_CROSS_CHANNEL`. `REPLY_CROSS_CHANNEL` is the rule that stops a quoted first line carrying *Konobari* text into *Svi*. Rate limit 10/min per device, through the existing `server/utils/rate-limit.ts`.

**The money guard.** `postMessage` never blocks anything. When `kind !== 'admini'` and `looksLikeMoney(body)`, it writes a quiet `chat_money_warned` entry naming the author and the channel, and posts the message. The confirm sheet lives on the phone (WP1); `money_ack` is recorded in the entry body so the Dnevnik can tell "the sheet was shown and he sent anyway" from "the sheet never appeared". **`postSystem` throws** when any `*_fen` key appears in `payload` outside *Admini* — a waiter's settlement is a Dnevnik entry for admins, never a chat line.

**`deleteMessage`.** Soft delete, `deleted_at`/`deleted_by` set once. The rules, in order: the author of a `text` message within `chat_delete_own_s` (`409 DELETE_WINDOW` after); an `admin` on anything in *Svi* or *Admini* at any age (`403 CHANNEL_FORBIDDEN` in *Konobari*, even with a forged channel id); **any member of *Konobari* on an `image` at any age** — *Ukloni sliku*, placeholder "Sliku uklonio Emir · 22:41", quiet `chat_image_removed` entry naming author and remover. Text in *Konobari* is deletable by its author only. The file on disk is unlinked **only** when no non-deleted `chat_messages` row references the `upload_id`; the count runs inside the delete transaction, so a forwarded copy keeps the evidence alive after the author deletes the original.

**`forwardMessage`** creates a new message in the target channel with `forwarded_from_id`, the same `upload_id`, and a body prefixed `↪ Amar (Konobari, 22:41): `. Staff forward *Konobari* → *Svi* and *Konobari*/*Svi* → *Admini* (*Prijavi vlasniku*, the one staff → *Admini* path); admins forward *Svi* → *Admini*.

**`setPin`.** `chat_channels.pinned_text` ≤ 500 chars, on every channel; the one that matters is *Svi*'s **Za naručiti**. Two shapes: `{ text }` replaces (the owner's tidy-up), `{ append }` adds the message's first line ≤ 80 chars as a new line — no lost update, no keyboard, two taps. `{ cleared: true }` is *Naručeno ✓*, admin only. Every one of the three writes the column **and** one `chat_pin_changed` system message, so history keeps every version.

**System keys** (`postSystem`, always inside the caller's transaction): `pin_changed`, `pin_cleared`, `roster_published`, `roster_changed`, `swap_requested` (*Konobari*), `swap_accepted` (*Svi*), `user_changed` (*Konobari*), `rules_published` (*Svi*). A system message may carry `system_payload_json.link { label, route }`, rendered as one 48 px secondary button ("Raspored →") — never an action of its own; **chat never calls a roster or shift route**.

The `swap_accepted` line is **identical whether the request's reason was `zamjena` or `bolest`**. There is no separate key for a sickness cover, because a distinct key would itself be the reason, and *Pravila* says "Bolovanje vidi samo vlasnik".

### 2.6 `server/services/uploads.ts`

```ts
export function createUpload(db: Db, venueId: string, actor: Actor,
                             file: { bytes: Buffer, filename: string }, kind: UploadKind): UploadResult
export function readUpload(db: Queryable, venueId: string, actor: Actor,
                           id: string): { path: string, bytes: number } | null
export function gcOrphans(db: Db, venueId: string, olderThanMin: number): number
export function expireChatImages(db: Db, venueId: string, days: number): number
```

`POST /api/uploads` is multipart (`readMultipartFormData`) with fields `image` and `kind`. Checks, in order, each with its Bosnian sentence in `shared/errors/chat.ts`:

1. **JPEG magic bytes** `FF D8 FF` — `415 NOT_JPEG`, "Ovaj format ne radi — slikaj iz aplikacije." A PNG renamed `.jpg` is refused here and nowhere else.
2. **Size** ≤ 1.5 MB for `kind='chat'`, ≤ 2.5 MB for `kind='delivery'` — `413 IMAGE_TOO_BIG`. The phone has already downscaled (§3, WP1); this is the belt.
3. **Kind** — `delivery` only for an `admin` session, or a `bartender` when `bartender_can_receive_goods` — `422 KIND_FORBIDDEN`.
4. **Per-user daily caps** `upload_user_day_files` 25 and `upload_user_day_bytes` 30 MB — `413 USER_CAP`, "Dnevni limit slika — sutra opet."
5. **Venue monthly cap** on `kind='chat'`, `chat_image_month_bytes` 200 MB — `413 STORAGE_CAP`, "Mjesečni limit slika je pun — javi vlasniku."

Any cap that trips writes a quiet `chat_cap_hit` entry naming the user. Orphans — an upload no message references yet — do not count toward the caps.

Files go to `${UPLOAD_DIR}/{kind}/YYYY/MM/{uuid}.jpg` with mode `0600`, where `UPLOAD_DIR` is a new env var: `data/uploads` locally (add it to `.gitignore` and to `.env.example`), `/var/lib/sank/uploads` on the VPS (`deploy/deploy.env.example`, and `client_max_body_size 4m` is already in `deploy/nginx.conf`). Dimensions come from parsing the JPEG SOF marker in ~20 lines — **no `sharp`, no native module**; a header we cannot parse stores `width`/`height` as `0` rather than failing the upload.

`GET /api/uploads/:id` streams from disk only after: a valid session, the same venue, and either (`actor.role === 'admin'` and `kind='delivery'`) or the upload is referenced by a non-deleted `chat_messages` row in a channel `canSee` admits. Anything else is **404**, not 403 — a 403 would confirm the file exists. Headers: `Content-Type: image/jpeg`, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline; filename="slika.jpg"`, `Cache-Control: private, max-age=3600`, `Content-Security-Policy: default-src 'none'`. That last one is not decoration: a polyglot JPEG/HTML must never execute on the app origin.

Two jobs join `server/tasks/nightly.ts` (no-ops under vitest, as the existing ones are): **`gcOrphans`** hourly unlinks the file of every upload older than 60 minutes that no non-deleted message references and no `parsed|applied` scan references, setting `uploads.deleted_at` — it never DELETEs the row. **`expireChatImages`** at 05:40 unlinks `kind='chat'` files older than `chat_retention_days`; the message stays and renders "Slika istekla". Delivery photos are evidence beside a posted delivery and follow the ledger — a 400-day-old one is untouched. `deploy/` backups already copy the database; the rclone file list gains `uploads/delivery/` only — **`uploads/chat/` never leaves the VPS**, and *Pravila* says so.

### 2.7 `server/services/roster.ts`

```ts
export function getRoster(db: Queryable, venueId: string, actor: Actor,
                          from: string, to: string): RosterWeekView[]
export function getMyRoster(db: Queryable, venueId: string, actor: Actor): MyRoster
export function copyWeek(db: Db, venueId: string, actor: Actor, weekStart: string): RosterWeekView
export function publishWeek(db: Db, venueId: string, actor: Actor, weekStart: string): RosterWeekView
export function addAssignment(db: Db, venueId: string, actor: Actor, body: AssignmentBody): Assignment
export function patchAssignment(db: Db, venueId: string, actor: Actor, id: string, body: AssignmentPatch): Assignment
export function removeAssignment(db: Db, venueId: string, actor: Actor, id: string): void
export function requestSwap(db: Db, venueId: string, actor: Actor, body: SwapBody): SwapRequest
export function decideSwap(db: Db, venueId: string, actor: Actor, id: string,
                           what: 'accept' | 'decline' | 'cancel' | 'assign',
                           body?: { to_user_id?: string, force_double?: boolean }): SwapRequest
export function rosterHours(db: Queryable, venueId: string, month: string, userId?: string): HoursRow[]
```

**The staff projection is a different query, not a filter.** `getRoster` for a non-admin returns published weeks only, strips `note`, `updated_by` and `swap_request_id`, and maps a **colleague's** `sick | absent | removed` row to a hole; own rows keep their full status. There is no code path in which a waiter's response object ever held a colleague's `sick` and then dropped it.

**Copy and publish.** `copyWeek` copies the previous week's rows with `origin != 'swap' AND status != 'removed'` — the regular people, not one-off covers — skipping deactivated users; `409 WEEK_NOT_EMPTY` if the target already has rows. `publishWeek` sets `published_at`, writes `roster_published`, and posts one *Svi* system line "Raspored za 14.09.–20.09. je objavljen — Raspored →"; a second publish is `409 ALREADY_PUBLISHED`.

**Constraints**, all enforced in one helper shared by `addAssignment` and the swap taker: the partial unique index (the same person twice in one cell); `409 OVERLAP` for two overlapping templates on one date, **with no override**; `409 DOUBLE_SHIFT` for a second non-overlapping template on one day, overridden by `force_double: true` on the retry (the sheet *Dupla smjena — svejedno dodaj*, asked once); `409 ROSTER_LOCKED` for any create or delete when `work_date < today`.

**Past dates and absence.** After the day, an admin marks *Nije došao* (`planned → absent`, `roster_absent`, important) or clears it back. A past-date `PATCH` allows only `planned ↔ absent` and `planned → sick`, **never `removed`** (`422 PAST_LOCKED`) — an admin cannot retroactively remove a person from the night stock went missing. **Staff never `PATCH` a status** (`403`): a waiter's sickness enters through one door only, *Traži zamjenu* with reason `bolest`.

**Swaps, no owner confirmation in v1.** `requestSwap` takes `{ assignment_id, to_user_id?, reason, note? }` on the requester's **own** row only. `reason='bolest'` sets the assignment `status='sick'` **in the same transaction** — that is the one way sickness enters the roster — and writes `roster_sick` (an attention row for the owner; the reason is on `/a` *Zamjene* and in *Dnevnik*, never in chat). Both reasons post the identical *Konobari* line "Amar traži zamjenu · pet 18.09. Večernja 16–01 — Raspored →" for an open request, or land as a card on the named colleague's S17.

`decideSwap('accept')` is **one transaction**: the giver's row → `swapped` (a `sick` giver row **stays `sick`**, so *Sati* counts the sick day and the grid keeps the struck-through chip), a new taker row `planned / origin='swap' / swap_request_id`, the request → `accepted` with `decided_by = taker`, `log(swap_accepted)` resolving `swap_requested`, and one *Svi* line "Zamjena · pet 18.09. Večernja — Dino umjesto Amara". A forced error mid-way leaves zero changes and zero entries. The taker passes the same overlap and double-shift rules. A named offer accepted by anyone else is `403`; a second accept on one request is `409 ALREADY_DECIDED`; a staff accept on `work_date < today` is `409 ROSTER_LOCKED`, while a same-day accept is always allowed, also after `start_time`, and the row carries the note "potvrđeno nakon početka". `decideSwap('assign')` is the owner's *Dodijeli* — the avatar picker names a taker and accepts in the same transaction, allowed up to 7 days after `work_date` and marked "dodijeljeno naknadno". An owner editing a cell with a live request cancels it with the note "vlasnik promijenio ćeliju", and the requester's card says so. Deactivating a user turns his future `planned` rows into `removed` (note "deaktiviran") and cancels his live requests — a hook in `services/admin.ts`'s user patch.

**System-line coalescing.** Edits before publish post nothing. After publish, every edit writes a quiet `roster_changed` entry, but *Svi* receives **at most one line per owner per business day** — a Friday of six fixes is one line, and the waiters' badge stays honest (system lines never bump it anyway).

**`rosterHours`** aggregates `shift_members` first — `SELECT user_id, business_date, MIN(joined_at), MAX(left_at), MAX(left_at_source='auto') … GROUP BY user_id, business_date`, because a date can carry two `shifts` rows after an early close — then joins both ways. Each assignment gets `planned_h` (nominal `(end − start) mod 24` from the snapshotted `HH:MM`, no timezone math and no DST-exact rostering), `first_action`, `left_at`, `worked_h`, `late_min` above `roster_late_grace_min`, `early_leave_min`, and `no_shift_row` when a `planned` row has no member row. Every member row without a matching assignment becomes an **`unplanned`** row — the person who *was* there and is not on the plan. Printed on the page, not optional: **the first action is not the arrival**, so "prva tura 16:40 (+40 min)" is evidence for a conversation, never a flag (§8).

### 2.8 `server/services/rules.ts`

```ts
export function latestRules(db: Queryable, venueId: string, actor: Actor): RulesView
export function publishRules(db: Db, venueId: string, actor: Actor, body: { body_md: string }): RulesView
export function ackRules(db: Db, venueId: string, actor: Actor, version: number): void
export function listRuleVersions(db: Queryable, venueId: string): RuleVersion[]
```

`publishRules` inserts `version = MAX(version)+1`, writes `rules_published` (important), and posts one *Svi* system line "Objavljena su nova Pravila (v3) — Pravila →". `latestRules` returns `{ version, body_md, published_at, published_by_name, my_ack_version, must_ack }`, where `must_ack` is `my_ack_version < version`. `ackRules` sets `users.rules_ack_at` and `users.rules_version` and writes a quiet `rules_acked` entry; acknowledging an old version is `409 RULES_STALE`.

**The ack gate is a client rule, not a server refusal.** Nothing on the server 403s an order because a waiter has not read v3 — refusing to record a round the guest is already drinking would put money outside the ledger, which is the one thing this app exists to prevent. The gate is the S12 screen standing in front of S1 on the first login after a new version (WP4), and the evidence is the `rules_acked` entry with its timestamp.

### 2.9 `server/services/scan.ts` and the injectable model client

```ts
// server/services/scan.ts
export interface ScanModel {
  read(input: { imageBase64: string, catalogue: ScanCatalogueLine[],
                aliases: ScanAliasLine[] }): Promise<ScanParse>
}
/** Tests inject a stub; `null` restores the real one (or none, with no key). */
export function setScanModel(model: ScanModel | null): void
export function scanDelivery(db: Db, venueId: string, actor: Actor,
                             body: { upload_id: string }): Promise<ScanDraft>
export function linkAlias(db: Db, venueId: string, actor: Actor,
                          body: { alias: string, stock_item_id: string, supplier_name?: string }): void
export function discardScan(db: Db, venueId: string, actor: Actor, id: string, reason: string): void
```

`scanDelivery` is the only `async` service in the codebase, and it is async **around** its transactions, never inside one: read the upload and the catalogue → `await model.read(...)` → open a transaction and write `delivery_scans` with `raw_json`, `status='parsed'`, `parsed_at`. better-sqlite3 is synchronous and a `db.transaction()` body still contains no `await` (BACKEND §2).

**The real client lives in `server/services/scanModel.ts`** and is constructed lazily, once, only when `ANTHROPIC_API_KEY` is set. When it is not, `scanDelivery` throws `503 SCAN_NOT_CONFIGURED`, "Prepoznavanje sa slike nije podešeno — unesi prijem ručno." — and the typed form is right there. That is a supported state, not a broken one: the key is optional in `.env.example`, and CI never has it.

```ts
// server/services/scanModel.ts — the only file that imports the SDK.
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { scanParseSchema } from '#shared/schemas/scan'

const res = await client.beta.messages.parse({
  model: 'claude-opus-5',
  max_tokens: 16000,
  // Opus 5's classifiers can decline a request; `default` re-runs it server-side
  // on Anthropic's recommended substitute, routed by refusal category, so we
  // never maintain a model list of our own.
  betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default',
  output_config: { format: zodOutputFormat(scanParseSchema) },
  messages: [{ role: 'user', content: [
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
    { type: 'text', text: prompt },
  ] }],
})
```

Four rules, each of which is a bug if broken: **no assistant prefill** (a 400 on this model); **no `budget_tokens`** (a 400 — adaptive thinking is the default and is what we want); the model id is exactly `claude-opus-5` with **no date suffix**; and `res.parsed_output` may be `null`, which is a `parsed` scan with `error` set and an empty draft, not an exception thrown at the owner. Check `stop_reason === 'refusal'` before reading content. Package: `@anthropic-ai/sdk` as a **dependency**, `zod` is already there.

**The prompt** carries the venue's stock items (`id, name, brand, pack_name, pack_qty, base_unit`) and every `supplier_aliases` row, and asks for `{ supplier, invoice_no, date, lines: [{ text, qty, pack, unit_price_fen, stock_item_id, confidence }] }`.

**The server never trusts the model's id.** After parsing: every `stock_item_id` is looked up in the real catalogue and dropped if it does not exist (a hallucinated id becomes an unknown line); an exact `supplier_aliases` hit on the folded `text` **overrides** the model at confidence `1.0`. Then `confidence >= 0.8` is green, `0.4–0.8` amber, everything else unknown. Prices from the model are a **suggestion the owner edits**, exactly like the typed form's `line_cost_fen` — this is not a price the catalogue already knows (BACKEND §2), it is what the supplier charged, and it reaches a movement only through the owner's *Proknjiži*.

**Nothing is posted by the scan.** The draft goes back to the phone, the owner edits every line, and *Proknjiži* calls the **existing** `POST /api/stock/deliveries` with `source: 'scan'` and `scan_id`; that route then flips the scan to `applied` in the same transaction as the delivery. `linkAlias` is what the owner's *Poveži* calls, so the second photo from the same supplier matches for free.

### 2.10 Routes

Every row is declared in `shared/routeRoles.ts`; `AWB` = all three roles, `AB` = admin + bartender, `A` = admin.

| Route | Roles | Notes |
|---|---|---|
| `GET /api/chat/since?cursor=` | AWB | bootstrap / catch-up / `reset`, ETagged |
| `GET /api/chat/:channel/messages?before_seq=&limit=` | AWB | *Učitaj starije*, backwards, cap 50 |
| `POST /api/chat/:channel/messages` | AWB | `{client_id, kind, body?, upload_id?, reply_to_id?, money_ack?, client_created_at}` |
| `POST /api/chat/:channel/pin` | AWB | `{text}` / `{append}` / `{cleared}`; `cleared` admin-only |
| `POST /api/chat/messages/:id/delete` | AWB | own, admin, or any member on a *Konobari* image |
| `POST /api/chat/messages/:id/forward` | AWB | `{to}` |
| `POST /api/chat/read` | AWB | `{channel, seq}`, debounced 1 s on the client |
| `POST /api/chat/users/:id/mute` | A | `{until \| null}` |
| `POST /api/uploads` | AWB | multipart; `kind='delivery'` gated inside |
| `GET /api/uploads/:id` | AWB | access-checked stream; 404, never 403 |
| `GET /api/roster?from=&to=` | AWB | staff projection for non-admins |
| `GET /api/me/roster` | AWB | my week + offers and requests awaiting me |
| `GET /api/me/roster/hours?month=` | AWB | *Moji sati*, own rows only |
| `POST /api/roster/weeks/copy` | A | `{week_start}` |
| `POST /api/roster/weeks/publish` | A | `{week_start}` |
| `POST /api/roster/assignments` | A | `{work_date, template_id, user_id, force_double?}` |
| `PATCH /api/roster/assignments/:id` | A | status and note only |
| `DELETE /api/roster/assignments/:id` | A | unpublished weeks and future dates only |
| `GET /api/roster/swaps?status=` | A | the *Zamjene* panel |
| `POST /api/roster/swaps` | AWB | own row only |
| `POST /api/roster/swaps/:id/accept` | AWB | `{force_double?}` |
| `POST /api/roster/swaps/:id/decline` | AWB | the named colleague |
| `POST /api/roster/swaps/:id/cancel` | AWB | the requester's *Povuci* |
| `POST /api/roster/swaps/:id/assign` | A | *Dodijeli*, `{to_user_id, force_double?}` |
| `GET /api/roster/hours?month=` | A | *Sati* |
| `GET /api/admin/shift-templates` · `POST` · `PATCH /:id` | A | *Šabloni smjena* |
| `GET /api/rules` | AWB | latest + `must_ack` |
| `POST /api/me/rules/ack` | AWB | `{version}` |
| `GET /api/admin/rules` · `POST /api/admin/rules` | A | versions with acknowledgements; publish |
| `POST /api/stock/deliveries/scan` | AB | `{upload_id}` → draft |
| `POST /api/stock/scans/:id/discard` | A | `{reason}` |
| `POST /api/stock/supplier-aliases` | A | *Poveži* |

**Two things `routeKey()` cannot do today, and both are WP0's.** First, `svi` is not a uuid, so `POST /api/chat/svi/messages` would not normalise to the `:channel` key and would 403. `routeKey()` gains one rule — a segment in `CHANNEL_KINDS` immediately after `/api/chat` becomes `:channel` — and `tests/unit/route-roles.test.ts`'s `segment()` gains the matching `[channel] → :channel`. Second, `/api/chat/messages/:id/delete` and `/api/chat/:channel/messages` overlap in Nitro's router; the static branch wins, but that is exactly the kind of thing that is true until it isn't, so WP0 ships a test asserting `POST /api/chat/<uuid>/delete`-shaped traffic reaches the delete handler and not the send handler.

### 2.11 Log kinds, bumps and the change feed

**`ChangeEntity` gains `'chat' | 'roster' | 'rules'`** and `ChangesResult` gains three optional snapshots:

```ts
chat?: { max_seq: number, total_unread: number,
         channels: { kind: ChannelKind, unread: number, last_seq: number }[] }
roster?: { max_at: string }        // the client refetches its own roster read
rules_version?: number             // moved → the ack gate re-evaluates
```

That is the whole of "one poll": the 15 s `GET /api/changes` carries the **unread counts**, and S16 calls `GET /api/chat/since` on mount, after every own send, and on `visibilitychange` — never on a timer of its own. A chat write bumps the **`chat` entity only**; it never bumps `table`, `shift` or anything a waiter's floor plan reads.

**`POST /api/chat/read` does not bump** and joins the `changes-coverage` exemption list beside `/api/auth/*` and the heartbeat, for the same reason the heartbeat is there: a read cursor that invalidated every phone's ETag every few seconds would cost the venue its 304s. **`POST /api/uploads` does not bump either** — an orphan upload nobody can see is not an event; the message that references it is. Both exemptions are written into the test with their one-line reason.

**The ETag must move when a badge moves.** `/api/changes` and `/api/chat/since` append the requester's own `MAX(last_read_seq)` to the existing `${maxSeq}-${role}-${userId}` tag — one indexed lookup, and without it a phone that just marked a channel read would 304 its way to a stale badge.

**New log kinds** (`shared/logTemplates.ts`, with a Bosnian title template each, and a new `group: 'ekipa'` whose icon row joins `app/components/dnevnik/dnevnikKinds.ts`): `chat_money_warned` (quiet), `chat_muted`, `chat_image_removed` (quiet), `chat_cap_hit` (quiet), `chat_pin_changed` (quiet), `chat_deleted_by_admin` (quiet), `roster_published`, `roster_changed` (quiet), `roster_absent` (important), `roster_sick`, `swap_requested` (quiet), `swap_accepted` (resolves `swap_requested`), `swap_declined` (quiet), `swap_cancelled` (quiet), `swap_assigned`, `template_changed` (quiet), `rules_published`, `rules_acked` (quiet), `delivery_scanned` (quiet), `delivery_discarded`, `alias_linked` (quiet). `ALERT_RULE_KEYS` gains `swap_unfilled` and `roster_sick`, both raised onto the in-app *Zahtijeva pažnju* list and **sent nowhere**. Every body is ids and integers; the existing `log.test.ts` grep for `/hash|token|chat_id|email/` covers the new bodies for free.

### 2.12 What WP0 settles up front, so no two UI packages fight

Four files are written by WP0 on day one with **every** Phase 4 row already in them, pointing at routes that do not exist yet and rendering disabled until they do. No later package edits them except to flip one boolean:

1. **`app/utils/waiterMenu.ts`** — the `chat` and `roster` rows keep `ready: false` and gain `to: '/k/razgovor'` / `to: '/k/raspored'` with `toBartender: '/s/razgovor'` / `'/s/raspored'`. WP1 flips the first, WP2 the second. One line each.
2. **`app/utils/adminNav.ts`** (new, the `/a` twin of `waiterMenu.ts`) — the row list that `app/layouts/admin.vue` and `app/pages/a/vise.vue` both read, with *Razgovor* and *Raspored* present and `ready: false`. Those two existing files each lose their inline array in the same PR and gain nothing else.
3. **`app/composables/useApi.ts` and `useAdminApi.ts`** — one typed method per route in §2.10, added by WP0 before the UI packages branch. This is the Phase 3 pattern and it exists because these two files are the only place in the app that knows a URL; four packages appending to them in parallel is four conflicts.
4. **`shared/types/{chat,roster,rules,scan}.ts`** and their `shared/types.ts` re-exports — the contract every screen is typed against.

WP0 also adds `bez emoji`-safe icons to `app/components/ui/UiIcon.vue`'s set if the four screens need any that do not exist; that file is otherwise untouched this phase.

### 2.13 WP0 done-when

`npm run typecheck && npm run test && npm run build` green, `0004_phase4.sql` the only migration, and vitest proving at least:

**Access.** The full matrix for every role × channel × {`since`, post, history, read, pin, forward, delete, mute}; `since` never returns a *Konobari* row to an admin, **including with a forged channel id in the body**; a `GET /api/uploads/:id` for a *Konobari* photo is 404 for an admin, 200 for him after a staff member forwards it into *Admini*, and **stays 200 after the author deletes the original**; a reply quoting a *Konobari* message into *Svi* is `422 REPLY_CROSS_CHANNEL`.

**Idempotence and order.** A send replayed twice is one row with `already_applied: true`; `seq` is monotonic over 200 inserts across three channels; one queued chat entry and zero money entries → `settle` returns 200 and the heartbeat reports `pending: 0`.

**Triggers.** `UPDATE chat_messages SET body=…` aborts; `DELETE` aborts; `deleted_at` set twice aborts; `swap_requests` `accepted → pending` aborts; `roster_assignments` `swapped → planned` aborts; `rules` UPDATE aborts.

**Uploads.** PNG bytes with a `.jpg` name → 415; 1.6 MB `chat` → 413; 2.4 MB `delivery` → 201; a waiter posting `kind='delivery'` → 422; the 26th file of a day → 413 `USER_CAP`; 201 MB in a month → 413 `STORAGE_CAP`; an orphan at 61 minutes → file gone, `deleted_at` set, **row kept**; a `discarded` scan at 61 minutes → file gone, both rows kept; a `parsed` scan at 61 minutes → file kept; mode `0600`; a chat image at 91 days unlinked while a 400-day delivery photo is untouched.

**Roster.** The same person twice in a cell → unique error; overlapping templates → `409 OVERLAP`; a non-overlapping second → `409 DOUBLE_SHIFT` without `force_double` and a row with it; request → accept writes exactly giver `swapped`, taker `planned/origin='swap'`, request `accepted`, **atomically** (a forced error mid-way leaves zero rows and zero entries); two accepts → the second is `409 ALREADY_DECIDED`; a `bolest` request sets the row `sick` in the same transaction, an accepted one leaves the giver `sick`, a withdrawn one returns it to `planned`, **and the resulting *Svi* row's `body` and `system_payload_json` contain neither "bolest" nor "bolovanje"**; six post-publish edits by one owner in one day → six `roster_changed` entries and **one** *Svi* line; planned hours `16:00–01:00` = 9 h and `22:00–06:00` = 8 h on any date; a member row at 16:40 against start 16:00 with grace 30 → `late_min = 40`; a member row with no assignment → `unplanned`; the šanker (count submit, no lock) has a member row and no flag; a staff `PATCH` → 403; `removed` on yesterday → 422.

**Scan.** With the stub injected, a photo returns a draft whose green lines carry real `stock_item_id`s, whose amber line carries the OCR text, and whose unknown line has none; a model answer naming a `stock_item_id` that does not exist comes back **unknown**, not green; an exact `supplier_aliases` hit overrides a low model confidence; nothing is written to `stock_movements` until `POST /api/stock/deliveries` runs; with no `ANTHROPIC_API_KEY` and no stub, the route is `503 SCAN_NOT_CONFIGURED` and the typed form still posts.

**The registries.** `route-roles`, `changes-coverage` (with its two new exemptions and their reasons), `errors` (every new code has a Bosnian sentence and no message is orphaned), `log` (every new kind has a template whose Zod body parses its fixture), `schema` (`venue_id` everywhere, no new global unique, every new trigger name in `sqlite_master`) and `api-shapes` (every new envelope by name) all extended in this PR.

---

## 3. The four UI work packages

**File ownership is strict.** A path has exactly one owner. Creating a new file inside your own prefix is always fine; touching a file under another package's prefix — one line, a typo, a formatting fix — is not. WP1–WP4 branch only after WP0 is on `main`, and they never share a file.

Every package: branch `phase-4/<wp>`, one PR, `npm run typecheck && npm run test && npm run build` green before it is called done, and the done-when walked on a 390 px viewport with the network thrown offline at least once.

### WP1 — Razgovor

**S15 *Kanali*** at `/k/razgovor` (and `/s/razgovor`, a thin wrapper whose back arrow returns to the ticket queue — the `/s/popis` precedent): rows *Svi* · *Konobari* with name, last-line preview, time and an unread badge capped at "99+"; under *Svi*, the pinned **Za naručiti** first line. The screen opens straight on the last-used channel when unread exists only there (remembered in `idb-keyval`), so S15 is usually skipped.

**S16 *Kanal*** at `/k/razgovor/:kind`: header with the channel name, the member list ("Članovi 5 · Amar, Lejla, Dino, Emir (šanker), Haris") and the pin bar; messages newest at the bottom, own on the right, name and time on others, system lines centred and grey with their optional 48 px link button, images at 320 px with a `width`/`height` placeholder so the list never jumps. Long-press a bubble → *Odgovori · Dodaj u "Za naručiti" · Proslijedi u… · Prijavi vlasniku · Obriši* (or *Ukloni sliku*), with a ⋯ twin because every gesture has a button alternative. *Učitaj starije* at the top. **Auto-scroll only if the view was already at the bottom**, else a *Nova poruka ↓* pill; the composer never loses focus on a poll. Composer pinned to the bottom: text field, *Slikaj*, *Galerija*, *Pošalji* (56 px, disabled when empty); the draft survives a reload (`chat_draft:{channel}` in IndexedDB).

**Images.** `app/utils/image.ts` is one decode path and this package writes it: `URL.createObjectURL(file)` → `<img>` (browsers honour EXIF orientation on decode) → canvas with the longest edge ≤ `maxEdge` → `toBlob('image/jpeg', quality)`. `downscale(file, { maxEdge: 1280, quality: 0.75 })` for chat (100–180 KB typical) and `{ maxEdge: 1600, quality: 0.85 }` for a delivery note (WP3 imports it — small print on an A4 otpremnica has to stay legible). Re-encoding drops EXIF including GPS, which is a privacy gain stated in *Pravila*. *Slikaj* is `<input type="file" accept="image/*" capture="environment">`, *Galerija* the same input without `capture`; the native camera needs no permission dialog of ours. A file the canvas cannot decode gets "Ovaj format ne radi — slikaj iz aplikacije." Tapping a photo opens a full-screen viewer (`touch-action: pinch-zoom`, native `<img>`, re-requested on open) with *Proslijedi* / *Obriši* / close.

**Offline.** `app/stores/chat.ts` keeps its own pending list at `chat:pending` in `idb-keyval` (`{client_id, channel, kind, body?, blob?, client_created_at}`), flushed oldest-first on `online`, on `visibilitychange`, after every send and after each money-outbox flush, with `AbortSignal.timeout(8000)`. A 4xx **drops** the entry with the toast "Poruka nije poslana" — not the *Popravi ili odbaci* gate; chat is not money. An entry older than 24 h is dropped the same way. Photos are downscaled **before** queueing (a ≤ 300 KB Blob; `idb-keyval` stores Blobs), at most 5 pending images, beyond which "Sačuvaj sliku u galeriju, pošalji kad bude veze" — because the file input's capture is a temporary file iOS never writes to Photos, and a photo of the mess taken at 15:55 on dead Wi-Fi must not be lost. The bubble shows a clock and "čeka slanje" until polling returns the server row matched by `client_id`. **This list is counted nowhere** (§1).

**The money sheet.** In *Svi* and *Konobari*, when `looksLikeMoney(draft)` is true, *Pošalji* opens a confirm sheet: "Iznosi kolega ne idu u Svi — pošalji u Admini?" with *Ipak pošalji*, which sends with `money_ack: true`. Admin sessions get *Slikaj* only in *Svi* — no *Galerija*, because screenshots of `/a` live in the gallery and a camera photo of a screen is deliberate.

**`/a/razgovor`** — *Svi* and *Admini*, never *Konobari*, and no nav item for it either. Two-pane at ≥ 1024 px (channel list left, thread right), single-column below, phone identical to S15/S16 in the light kit. *Naručeno ✓* on the *Za naručiti* bar clears the note and posts the system line "Haris: naručeno". *Obriši* on anything, *Utišaj* with a until-time picker, *Proslijedi u Admini*.

**Files owned:** `app/pages/k/razgovor/**` · `app/pages/s/razgovor/**` · `app/pages/a/razgovor/**` · `app/components/chat/**` · `app/stores/chat.ts` · `app/utils/image.ts` · `app/composables/useChat.ts` · `app/components/SankerNav.vue` and `app/pages/stanje/index.vue` (the avatar sheet is missing from the third bartender tab; adding it is how he reaches Razgovor from all three) · `app/utils/waiterMenu.ts` **(the `chat` row's `ready` only)** · `app/utils/adminNav.ts` **(the `razgovor` row's `ready` only)** · `tests/e2e/phase4-razgovor.spec.ts`.

**Done when:** a text and a photo sent by Amar in *Svi* appear on Emir's phone within 15 s and on Haris's `/a` too; Haris has no *Konobari* row anywhere and a hand-crafted request for it is 403; a photo taken with Wi-Fi off is queued, survives a reload, and appears **once** after reconnecting in ≤ 7 taps; a message with "12,50 KM" in it opens the sheet; *Dodaj u "Za naručiti"* is two taps; leaving S3 mid-draft for S16 and coming back restores the exact table and draft.

### WP2 — Raspored

**`/a/raspored`.** Week header with a *Nacrt* / *Objavljeno* pill and *← →* arrows. Laptop: templates × days grid with sticky headers, the avatar picker as a popover, **2 clicks** per person. Phone: day cards with one row per template showing chips — sick struck through, removed hidden behind "1 uklonjen", a pending request amber — and a `+` that opens the avatar sheet, **2 taps**. *Kopiraj prošlu sedmicu* and *Objavi raspored* sit in the header: a typical week is **3 taps**, four fixes ≈ 8–12. The avatar picker stays open for a second person and tags people already working that day ("Dnevna"); a `409 DOUBLE_SHIFT` opens the sheet *Dupla smjena — svejedno dodaj* which retries with `force_double`, asked once; a `409 OVERLAP` is refused with no override. After the day, *Nije došao* and *Bolestan* on a cell.

**Zamjene tab** — requests by status with the reason (this is the only screen besides *Dnevnik* where "bolest" is a word), *Dodijeli* (avatar picker → assign and accept in one transaction, 3 taps, "dodijeljeno naknadno" past the date) and *Odbij*. **Sati tab** — a month picker and the planned-vs-worked table per person: planned shifts and hours, worked hours, `late_min`, `early_leave_min`, sick days, absences, swaps given and taken, plus the *radio bez rasporeda* and *planirano, nema smjene* rows. The caveat sentence is printed on the page, not in a tooltip: **"Prva akcija nije dolazak."** Rows edited after their `work_date` carry an "izmijenjeno 10.09. · Haris" chip.

**`/k/raspored` (S17).** Segments *Ova sedmica* | *Sljedeća*. At the top, cards for offers to me and my own requests ("Traži se zamjena · pet 18.09." with *Povuci*). Then seven day rows, "pon 14.09.", listing templates with initials; **my** shifts in the accent colour with the time. An unpublished next week says "Raspored za sljedeću sedmicu još nije objavljen." Tap my shift → sheet: *Traži zamjenu* → optional colleague → reason chip *zamjena* / *bolest* → optional note → *Pošalji* (**5–6 taps**). Tap an open request → *Preuzimam* (**3 taps** from S1). The last response is cached in `idb-keyval` (`roster:last`, the staff projection only) so the screen opens offline; **every write is online-only** and disabled with "Nema veze", like *Premjesti sto* — a swap is not urgent and a queued one would need server-side conflict rules for nothing.

**Šabloni smjena** under `/a/postavke` — template CRUD, `template_changed`, deactivation hides a template from future weeks, and a template edited after publish leaves existing rows on their snapshot while the grid shows "16–01 (staro 15–00)" for that week.

**Files owned:** `app/pages/a/raspored/**` · `app/pages/a/postavke/sabloni.vue` · `app/pages/k/raspored/**` · `app/pages/s/raspored/**` · `app/components/raspored/**` · `app/composables/useRoster.ts` · `app/utils/waiterMenu.ts` **(the `roster` row's `ready` only)** · `app/utils/adminNav.ts` **(the `raspored` row's `ready` only)** · `tests/e2e/phase4-raspored.spec.ts`.

**Done when:** Haris copies last week and publishes next week in 3 taps and every phone's S17 shows it within 15 s; Dino requests a swap and Amar accepts it on his own phone, the giver's row is `swapped` and the taker's `origin='swap'`, one *Svi* line appears with no reason and no note, and all three grids update within 15 s; a sick request marks the row and Amar's S17 shows a colleague's `sick` as a hole while Haris sees the word; a swap on yesterday is refused in Bosnian; *Sati* for a real week shows one late arrival, one "radio bez rasporeda" and the šanker's shifts with no false flag.

### WP3 — Prijem sa slike

One new path on the existing `/a/roba/prijem` page, beside *Ručno*, which stays and remains the fallback.

**Sa slike.** *Slikaj otpremnicu* → `downscale(file, { maxEdge: 1600, quality: 0.85 })` (WP1's util; if WP1 has not merged, this package writes `app/utils/image.ts` and WP1 imports it — whichever lands first carries the file, and the PR body says which) → `POST /api/uploads` with `kind='delivery'` → `POST /api/stock/deliveries/scan { upload_id }`, with an honest waiting state ("Čitam sliku…", it takes seconds, not milliseconds).

**The draft** opens fully editable, one row per line, with the photo pinned at the top and tappable to full screen:

- **green** — matched, confidence ≥ 0.8: the item name, packs + loose, price per pack;
- **amber** — unsure: the same row with the OCR text beside it and the item field pre-filled but focused;
- **unknown** — no match: the OCR text and three buttons, ***Poveži*** (item search → `POST /api/stock/supplier-aliases`, so next time it is green), ***Novi artikal*** (the existing stock-item sheet, then link), ***Preskoči***.

The counts sit in the header — "6 prepoznato · 1 nesigurno · 1 nepoznato" — and **nothing is posted until the owner has looked at every line**. *Proknjiži* calls the existing `POST /api/stock/deliveries` with `source: 'scan'` and `scan_id`; the movements, the moving average and `delivery_posted` are the code that already works. Leaving without posting offers *Odbaci sken* with a reason (`delivery_discarded`), whose photo the hourly GC then unlinks.

**Not configured is a first-class state.** A `503 SCAN_NOT_CONFIGURED` renders as a calm card — "Prepoznavanje sa slike nije podešeno. Unesi prijem ručno." — with the *Ručno* form open beneath it. No stack trace, no retry loop, no English.

**Files owned:** `app/pages/a/roba/prijem.vue` · `app/components/roba/RobaScan*.vue` · `app/composables/useScan.ts` · `app/utils/image.ts` (only if it lands before WP1) · `tests/e2e/phase4-prijem.spec.ts`.

**Done when:** with the stubbed model, a photo produces a draft with green, amber and unknown lines; *Poveži* on the unknown line writes an alias and a second scan of the same text comes back green; *Proknjiži* writes one `delivery` movement per line with the right `unit_cost_mfen` and flips the scan to `applied`; a waiter session posting `kind='delivery'` gets 422; with the key unset the card appears and the typed form still books a delivery.

### WP4 — Pravila, and the two nav flips

**`/a/postavke/pravila`.** A plain textarea over `body_md` (markdown-ish: headings, lists, bold — rendered by a ~40-line renderer in `app/utils/markdownish.ts`, **no library**, no raw HTML, because this text is published to every phone), a preview, and *Objavi novu verziju* with a confirm sheet naming the version. Below it, the version list and, for the current version, **who has acknowledged it and when** — the one screen in the app where a per-person list is not surveillance but the record that the rules were read.

**`/k/pravila` (S12), rewritten.** It renders the **published** `body_md` of the latest version, with the thresholds interpolated from `me.venue.settings` so a settings edit never leaves *Pravila* lying — that is the point of publishing them. Below the text, the sections that carry the fairness contract, verbatim from PLAN §8 and F12:

- *Šta znači "označeno za razgovor"* — yellow means a conversation, red only after three flagged shifts in 30 days, and every flag gets an outcome;
- *Šta aplikacija bilježi* — the fields, who sees what, no location and no contacts, the camera only when you tap *Slikaj*, EXIF stripped, chat text 12 months and chat photos 90 days, and `chat_reads` existing for badges and shown to nobody;
- **the honesty note about the database file**, verbatim from F12 (a) — the owner does not see *Konobari* in the app and cannot open it there, the messages are nonetheless in the database like everything else, the file can be opened by the owner and by Vedran, the channel is not secret, only not on the owner's screen. The owner's promise not to open it is a *Pravila* line, not code, and the page says that too;
- *Slike samo šanka, robe i prostora — gosti nikad*, and *Šta napišeš u Konobarima kolega može proslijediti*;
- *Ničiji pazar, manjak ili razlika ne ide u Svi ni u Konobare — ni kao slika.*

**The ack gate.** On the first login after a new version, S12 stands in front of S1 — the full text, scrolled to the bottom, then *Pročitao sam Pravila v3* (56 px, disabled until the scroll reaches the end). It is dismissable only by acknowledging; there is no *Kasnije*. It blocks navigation on the client only (§2.8) and it never appears mid-shift: the check runs at login and on the `rules_version` bump, and if a version is published at 22:00 the gate waits for the next login rather than standing between a waiter and a table.

**The two nav flips** are WP1's and WP2's one-line changes; WP4 owns nothing in `waiterMenu.ts` or `adminNav.ts`. What WP4 does own is the *Pravila* row's presence in both, which WP0 already wrote.

**Files owned:** `app/pages/k/pravila.vue` · `app/pages/a/postavke/pravila.vue` · `app/components/pravila/**` · `app/utils/markdownish.ts` · `app/composables/useRules.ts` · `tests/e2e/phase4-pravila.spec.ts`.

**Done when:** Haris publishes v2 and Amar's next login shows the gate, which he cannot pass without tapping *Potvrđujem*; the acknowledgement appears on `/a/postavke/pravila` with his name and the time and as a `rules_acked` entry in *Dnevnik*; a threshold changed in *Postavke* changes the number on every phone's *Pravila* without a new version; the honesty note is on every phone, word for word.

---

## 4. Shared conventions

**`docs/PHASE3.md` §4 applies unchanged** — Bosnian on screen with no i18n layer, ≥ 48 px targets with 8 px gaps and the primary button 56 px at the bottom, state as colour **and** icon **and** text, inline 24 px SVG icons and no icon library, **no emoji anywhere**, integer feninga through `formatKm` / `parseKm`, `08.09.2026.` and 24 h through `shared/dates.ts` with nothing calling `getHours()`, two-line comments wherever a non-Vue concept first appears, and errors that blame nobody. Four additions specific to this phase:

**The new vocabulary**, from `PLAN.md` §12, **verbatim**: *razgovor, kanal, poruka, pošalji, odgovori, proslijedi, prijavi vlasniku, obriši, ukloni sliku, utišaj, slika, slikaj, galerija, učitaj starije, nova poruka ↓, za naručiti, naručeno, članovi, Svi / Konobari / Admini, raspored, šablon smjene, sedmica, ova / sljedeća, objavi raspored, objavljeno, nacrt, kopiraj prošlu sedmicu, zamjena, traži zamjenu, preuzimam, povuci, dodijeli, bolestan / bolovanje, nije došao, dupla smjena, sati · planirano / odrađeno, radio bez rasporeda, pravila, potvrđujem, prijem sa slike, otpremnica.* A new word goes into §12 before it goes into a template. The `↪` in a forward prefix and the `↓` in *Nova poruka ↓* are typographic characters from that glossary, not emoji.

**`weekStart(date)`** (Monday) joins `shared/dates.ts`: the roster needs it and nothing else has.

**The one new money field** is a scan line's `line_cost_fen` — what the supplier charged, typed or corrected by the owner before *Proknjiži*, and validated the way every other declared amount is (BACKEND §2).

**No read receipts, ever, in any form.** A per-person reading log is what §8 forbids in spirit; `chat_reads` exists to count badges and is shown to nobody, and *Pravila* says so.

---

## 5. Verification

Two things, in this order: the unit suite stays green and grows, and one scripted evening is walked on three sessions.

### 5.1 The rules of the run

- A **fresh database**: `rm -f data/verify.db*` then seed it.
- A **dedicated port**: **3113**.
- **Never** `data/sank.db` and **never** port 3002 — that is the owner's dev server and it holds real evenings. Never `pkill`; stop only the server you started, by its PID.
- Against a **production build**, not `npm run dev`.

```
rm -f data/verify.db*
DB_PATH=data/verify.db PIN_PEPPER=dev npm run db:seed
npm run build
DB_PATH=data/verify.db PIN_PEPPER=dev COOKIE_SECURE=0 SANK_DEV_ENROL=1 \
  UPLOAD_DIR=data/verify-uploads SANK_SCAN_STUB=1 \
  PORT=3113 node .output/server/index.mjs          # terminal 1
SANK_E2E_URL=http://localhost:3113 npx playwright test   # terminal 2
```

`SANK_SCAN_STUB=1` installs the deterministic `ScanModel` (`setScanModel`) that returns a fixed eight-line otpremnica — six green, one amber, one unknown. It is read **once at boot**, is never true in production, and is the only reason check 6 costs nothing and never calls the API.

**Three sessions, and how each logs in.** *Amar* (waiter, PIN 1111) and *Emir* (bartender, PIN 123456) each enrol their **own** device through `POST /api/admin/enrol-codes` + `POST /api/devices/enrol` — not `POST /api/dev/enrol`, which reuses one device row and rotates its token, so the second enrolment would invalidate the first's cookie. *Haris* is an admin session: `haris@lounge.ba / lounge` at `/a/login`, no device. **A device is enrolled once per file, in `test.beforeAll`**; `authLimiter` allows ten auth calls a minute keyed by the device cookie or, before enrolment, by the IP, and `DEV_MULTIPLIER` is 1 in a built server. What is reset between tests is IndexedDB and localStorage — never the cookies.

### 5.2 The seven checks

1. **A message and a photo cross the room.** Amar opens *Razgovor → Svi*, sends "nema leda", then *Slikaj* with a fixture JPEG. Both appear on Emir's phone within **15 s** (his next `/api/changes` carries the unread count and S16 fetches `since`), and on Haris's `/a/razgovor`. The photo renders at 320 px on all three and opens full screen; `GET /api/uploads/:id` answers 200 for each of them.
2. **Konobari is private.** Emir sends a line in *Konobari* and Amar sees it. Haris's `/a` has **no *Konobari* row anywhere in the nav or the channel list**, and a direct `GET /api/chat/konobari/messages` from his session is **403**, as is a `GET /api/uploads/:id` for a photo posted only there — **404**, before and 200 after Emir forwards it with *Prijavi vlasniku*.
3. **Money-looking text prompts.** Amar types "predao 612,50 KM" in *Svi*; the sheet "Iznosi kolega ne idu u Svi — pošalji u Admini?" appears; *Ipak pošalji* sends it and *Dnevnik* carries one quiet `chat_money_warned` naming him. The same text in *Admini* from Haris opens no sheet.
4. **A published week and a swap that everyone sees.** Haris opens `/a/raspored`, taps *Kopiraj prošlu sedmicu* and *Objavi raspored* — **3 taps** — and both phones' S17 show the week within 15 s. Dino's row: *Traži zamjenu* → *zamjena* → *Pošalji*; *Konobari* gets one line; Amar taps *Preuzimam*; within 15 s **all three grids** show Amar in the cell, Dino's row is `swapped`, *Svi* has one line reading "Zamjena · … — Amar umjesto Dine" with no reason and no note, and `/a` *Zamjene* shows the request `accepted`.
5. **Pravila v2 gates the next login.** Haris publishes a new version from `/a/postavke/pravila`. Amar's next login shows S12 in front of S1; *Potvrđujem* is disabled until the text is scrolled to the end; after tapping it he reaches S1 and can order. `/a/postavke/pravila` lists his acknowledgement with the time, and *Dnevnik* has `rules_published` and `rules_acked`.
6. **A scan, an unknown line, and a booked delivery.** Haris opens `/a/roba/prijem → Sa slike`, uploads the fixture photo, and gets a draft with six green lines, one amber and one unknown. He taps *Poveži* on the unknown one, picks the stock item, edits one price, and taps *Proknjiži*. The stock ledger gains one `delivery` movement per line, `deliveries.source` is `scan` with the `scan_id` set, the scan is `applied`, and re-running the same photo comes back with that line **green**.
7. **Across everything.** No English word on any screen; no emoji; every amount tabular; no horizontal scroll at 390 px; the console clean; chat never toasts, sounds or vibrates, and leaving a draft on S3 for S16 and coming back restores the table and the draft exactly; a settlement with one chat message still queued goes through; `npm run typecheck`, `npm run test` and `npm run build` green.

---

## 6. Phase 4 is done when

All five work packages are merged to `main`; `0004_phase4.sql` is the only migration added; the registries (`ROUTE_ROLES`, `changes-coverage`, `errors`, `logTemplates`, `TRIGGER_NAMES`, `api-shapes`) are extended rather than exempted; the seven checks of §5.2 pass on `data/verify.db` at port 3113; the *Razgovor* and *Raspored* rows in `app/utils/waiterMenu.ts` and `app/utils/adminNav.ts` read `ready: true`; and the two sentences `docs/PHASES.md` §1 sets for this phase hold — **a photo taken with Wi-Fi off appears exactly once in *Svi* after reconnecting**, and **a swap requested on one phone and accepted on another changes the owner's grid within 15 s**, with no notification of any kind having left the building.

Phase 5 — the pilot, and everything on PLAN §13's second-wave list — starts from there.
