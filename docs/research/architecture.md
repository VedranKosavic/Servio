# Research: Architecture & stack recommendation

_Produced 2026-09-08 by the planning workflow; input to PLAN.md. Facts marked as assumptions were not verified._

# Architecture & stack recommendation — Šank

## 1. Options compared

| | **A. Nuxt 4 + Nitro + Drizzle/SQLite on VPS (snajper pattern), SSE** | **B. Nuxt 4 + Supabase** | **C. Nuxt 4 + PocketBase** | **D. Nuxt + Firebase/Firestore** | **E. Cloudflare Pages + Workers + D1 (+ Durable Objects)** |
|---|---|---|---|---|---|
| Pros | Zero new concepts; all business logic is synchronous TS inside one `db.transaction()`; owner owns the data; no vendor | Managed Postgres, Auth, Realtime, RLS; Vedran used it in iqra | One binary, built-in admin UI, SSE realtime, S3 backups | Best built-in offline cache; realtime listeners | Free tier, global edge, no server to patch |
| Cons | You run it (already doing so); single process, single box | Ledger/stock logic must live in Postgres functions (plpgsql) or Edge Functions (Deno) — two new languages; free tier pauses after 7 idle days; 500 MB cap | Pre-1.0 (v0.39.x, Jul 2026, docs say "not recommended for production critical apps"); rules DSL + Go/JS hooks; two processes to babysit | NoSQL is hostile to ledgers/reconciliation; server-assigned numbers and price snapshots need Cloud Functions (Blaze plan); rules language; lock-in | Whole new mental model (Workers runtime, D1 limits, DO for realtime); no better-sqlite3; debugging offline is hard |
| Cost / month | 0 (share snajper VPS) – 5 EUR | 0 (free, pausable) / 25 USD Pro | 0–5 EUR | 0–5 USD | 0 |
| Ops burden | Low, known (systemd, rsync, cron) | None, but vendor | Low-medium | None, but vendor | Low, but foreign |
| Learning curve | None | Medium (RLS, plpgsql, realtime channels) | Medium | High | High |
| Offline | Hand-rolled outbox (needed anyway) | Hand-rolled outbox | Hand-rolled outbox | Built-in, but transactions/aggregates don't work offline | Hand-rolled |
| Realtime | SSE via `createEventStream`, in-process bus — 40 lines | Postgres Changes channels — good | SSE per collection — good | Firestore listeners — best | Durable Objects — good but new |
| Multi-tenant | `venue_id` everywhere; later one SQLite file per venue | RLS by `venue_id` — strongest | Rules by venue | Rules by venue | D1 per venue |
| Backups | `.backup` + rclone offsite; proven | Free plan: only your own `pg_dump`; PITR is paid | Built-in to S3 | Export needs Blaze + GCS bucket | D1 time-travel (30 days) |

**Recommendation: A.** The hard parts of Šank are (1) a transactional ledger (order → price snapshot → stock deduction → order number, atomically), (2) an offline outbox on the waiter phone, (3) a live owner view. (2) is identical in every option. (1) is easiest by a mile in A: better-sqlite3 transactions are synchronous, so a junior can write `insert order, insert lines, insert stock_movements, bump seq` in plain TypeScript with no async interleaving bugs — in B that code moves into plpgsql/RPC or Deno functions. (3) is 40 lines of Nitro. B is the only serious rival and becomes right only if a second venue appears fast *and* the owner will pay 25 USD/month; the `venue_id` discipline below keeps that door open (Drizzle → Postgres is a driver swap if you avoid SQLite-only SQL).

## 2. Deployment topology

- One Ubuntu VPS (reuse snajper's box; separate systemd unit `sank.service`, separate user, separate SQLite file `/var/lib/sank/sank.db`, WAL mode, `busy_timeout=5000`).
- One Node process. No Redis, no queue, no second service. The in-memory event bus is enough because there is exactly one process; document this so nobody adds PM2 cluster mode.
- Reverse proxy = whatever snajper uses (nginx + certbot or Caddy). If nginx: `location /api/events { proxy_buffering off; proxy_read_timeout 1h; }` or SSE silently dies.
- Domain `sank.<domain>`; waiters open `/k` (konobar), owner `/a` (admin). Same Nuxt app, two layouts, role-gated by middleware.
- Telegram bot (grammy, already known) for owner alerts (shift closed, storno over 20 KM, device enrolled). Skip web-push in v1 — it is unreliable on iOS and Telegram is what the owner already reads.
- Deploy = `rsync` + `systemctl restart`, plus `drizzle-kit migrate` run by a `deploy.sh` step (migrations, not `push`, once real data exists).

## 3. Auth model

Three principals, one `sessions` table, cookie sessions like snajper.

**Owner:** `/a/login` with email + password (scrypt from `node:crypto`, no native dep). Session cookie `sank_s`, 30 days sliding, httpOnly/secure/SameSite=Lax. Optional second owner/manager later via `users.role`.

**Waiters = per-waiter accounts + short PIN on venue-bound devices.** Per-waiter identity is non-negotiable (accountability); a PIN keeps it fast; device binding makes PIN brute force need physical presence.

- `devices(id, venue_id, name, token_hash, shared bool, enrolled_at, revoked_at, last_seen_at, app_version, pending_count)`.
- Enrolment: owner opens *Uređaji → Dodaj uređaj*, gets a 6-char single-use code (`enrol_codes`, 10 min TTL). Waiter opens `/k`, screen "Unesi kod uređaja", types it → server sets cookie `sank_d` (random 32 bytes, hash stored) for 365 days. Owner names the device ("Amarov telefon", "Šank tablet").
- Daily login: screen shows active waiters as big buttons → tap name → 4-digit PIN pad. **2 taps + 4 digits.** Creates a waiter session (14 h, or until the shift closes). On `devices.shared = true` (the bar tablet) the app re-locks after 60 s idle so every order on the shared device is still attributed to a person.
- PIN storage: scrypt hash in `waiters.pin_hash`. 4 digits is 10 000 possibilities, so the lockout is the real defence (see §14).
- Revocation: owner taps *Opozovi* → `devices.revoked_at` set. `server/middleware/device.ts` checks the device row on every `/api/*` request (indexed lookup); revoked → 401 `DEVICE_REVOKED` → client wipes IndexedDB and shows "Uređaj je opozvan".
- Lost phone: revoke device; unsent orders on it are gone (see §5, policy).

## 4. Realtime

- Dashboard subscribes to **one** SSE stream `GET /api/events` (Nitro `createEventStream`). Server keeps `Map<venueId, Set<stream>>` in `server/utils/bus.ts`; services call `bus.emit(venueId, {type, id})` after commit.
- Event types: `order.created`, `order.voided`, `tab.closed`, `shift.opened`, `shift.closed`, `stock.changed`, `device.heartbeat`. Payloads are tiny (`{type, orderId, tableId}`); the dashboard refetches `/api/dashboard/live` on any event (debounced 300 ms). No client-side state merging.
- Heartbeat comment every 25 s so proxies and mobile carriers don't drop the connection. `EventSource` reconnects on its own; on `error` the client also starts polling `/api/dashboard/live` every 10 s until `open` fires.
- Honest note: for one venue, polling every 5 s with ETag would also be perfectly fine; SSE is recommended only because it is equally simple in Nitro and gives the "live" feel the owner asked for. **Do not use WebSockets** — two-way is not needed and they complicate proxies and reconnection.
- Waiter app: no SSE. It fetches `/api/tables/state` on open, on `visibilitychange`, and every 15 s while visible, so a waiter sees table 5 already has an open bill.

## 5. Offline approach (waiter PWA)

**Outbox:** Pinia store `outbox` persisted to IndexedDB (`idb-keyval`; localStorage as last resort). Every mutation is `{client_id: uuid, kind, payload, client_created_at, attempts}`. Flush: on `online`, on `visibilitychange`, after each enqueue, every 10 s. Sequential, in order, one at a time; stop on network error; on 2xx or `409 ALREADY_APPLIED` remove; on 4xx validation error move to `failed` and show it.

**Idempotency:** `orders.client_id` with `UNIQUE(venue_id, client_id)`; the server returns the existing row for a replay. Same for voids and tab closes.

**No shared mutable document → no merge conflicts.** Clients never edit orders; they append. Clients never create tabs (računi); the server, in the order transaction, does "find open tab for this table in the current shift or open one". Two waiters on table 5 both append to the same tab. The only real conflict: waiter B closed table 5's tab at 22:00, waiter A's queued 21:50 order syncs at 22:05. Rule: if `client_created_at < tab.closed_at`, open a **new** tab for the table with `orders.late_sync = 1` and emit `order.late` — never mutate a settled bill; the owner sees "Kasno sinhronizovano" on the dashboard and reconciles.

**Prices:** the phone caches the menu with `menu_version`; the server always snapshots current prices, so a stale phone cannot change money.

**Service worker:** `@vite-pwa/nuxt` (Workbox), `registerType: 'prompt'` ("Nova verzija — osvježi", never auto-reload mid-order). Precache app shell; `NetworkFirst` (3 s timeout) for `/api/bootstrap` and `/api/menu`; `NetworkOnly` for everything else; never cache `/api/events`.

**Visible status:** persistent pill in the waiter header: green "Sinhronizovano", amber "Čeka: 2", grey "Offline". Order card shows a tick when server-acked. Unsent order older than 5 min → red banner. Logout blocked while outbox is non-empty ("Imaš 2 neposlane narudžbe"). Every 60 s the app posts `POST /api/devices/heartbeat {pending, app_version}`, so at shift close the owner sees "Amarov telefon: 2 neposlane".

**Phone dies with unsent orders:** they are gone from the system. Mitigations: (a) `navigator.storage.persist()` requested on first login; (b) house rule — enter before serving, wait for the tick on the shared Wi-Fi/mobile data; (c) owner can add a manual order with `source = 'manual'` and a note; (d) stock count vs sales at shift end reveals the gap anyway — that reconciliation, not the phone, is the accountability mechanism.

## 6. Data integrity

- **Append-only:** `orders`, `order_lines`, `order_voids` (storno = new row referencing a line, with `reason`, `actor_id`, `approved_by`), `stock_movements` (signed qty; types `receipt | sale | void | count_adjust | waste`), `shift_events`. Stock on hand = `SUM(qty)` per `stock_item_id`; never an `UPDATE stock SET qty`.
- **Money as integers in feninga** (`unit_price_fen INTEGER`); format to KM in `shared/money.ts`. No floats anywhere.
- **Server-side price snapshot:** `order_lines.unit_price_fen` and `name_snapshot` copied from `menu_items` at insert; `menu_items` changes never touch history.
- **Server-assigned numbers:** `orders.shift_seq` = `MAX(shift_seq)+1` within the same transaction (SQLite serialises writers, so this is safe); displayed as "#42".
- **Server clock:** `created_at` = server time; keep `client_created_at` only for lag analysis and the late-sync rule.
- **Recipes:** `menu_item_components(menu_item_id, stock_item_id, qty)` — Coca-Cola 0.25 l → 1 bottle; nargila → `grams_per_bowl` of the chosen aroma + 1 coal portion. The order transaction inserts one `stock_movements` row per component.
- **Void rules:** same waiter may void within 2 min without approval ("greška"); after that it lands in the owner's approval queue. Both paths are rows in the ledger.

## 7. API sketch (core operations)

| Route | Body → Result |
|---|---|
| `POST /api/auth/owner/login` | `{email, password}` → session cookie |
| `POST /api/devices/enrol` | `{code}` → device cookie, `{device}` |
| `POST /api/auth/pin` | `{waiter_id, pin}` → waiter session; 423 on lockout |
| `POST /api/auth/logout` | — |
| `GET /api/bootstrap` | → `{venue, me, tables, menu, menu_version, shift, aromas}` |
| `GET /api/tables/state` | → `[{table_id, tab_id, total_fen, opened_at, lines_count}]` |
| `POST /api/orders` | `{client_id, table_id, lines:[{menu_item_id, qty, aroma_ids?, note?}], client_created_at}` → `{order_id, shift_seq, tab_id, total_fen, late_sync}` |
| `POST /api/orders/:id/void` | `{client_id, line_id?, reason}` → `{void_id, status: 'applied'|'pending_approval'}` |
| `POST /api/tabs/:id/close` | `{client_id, payment_method: 'cash'|'card'}` → `{closed_at, total_fen}` |
| `POST /api/shifts/open` / `POST /api/shifts/:id/close` | `{opening_cash_fen}` / `{counted_cash_fen, counts?}` → reconciliation `{expected_cash_fen, difference_fen}` |
| `POST /api/stock/receipts` | `{supplier, lines:[{stock_item_id, qty, unit_cost_fen}]}` |
| `POST /api/stock/counts` | `{lines:[{stock_item_id, counted_qty}]}` → generated `count_adjust` movements |
| `GET /api/dashboard/live` | → open tabs, today's pazar, per-waiter totals, pending voids, devices |
| `GET /api/events` | SSE |
| `POST /api/devices/:id/revoke`, `POST /api/waiters`, `PUT /api/menu-items/:id` | admin CRUD |

All mutations validated with zod schemas in `shared/`; every handler reads `event.context.venueId` — never a `venue_id` from the body.

## 8. Folder structure (snajper shape)

```
app/
  layouts/waiter.vue, admin.vue
  middleware/auth.global.ts
  pages/
    k/index.vue (stolovi)  k/sto/[id].vue (narudžba)  k/enrol.vue  k/pin.vue
    a/login.vue  a/index.vue (uživo)  a/smjene/  a/roba/  a/meni/  a/konobari/  a/uredjaji/
  components/k/  (MenuGrid, AromaPicker, OrderSheet, SyncPill)
  components/a/  (LiveTables, ShiftCard, StockTable, VoidQueue)
  composables/useOutbox.ts, useSse.ts, useSession.ts
  stores/outbox.ts, cart.ts, menu.ts        (Pinia)
server/
  api/…  (one file per route above)
  middleware/device.ts, tenant.ts
  database/schema.ts, client.ts, migrations/
  services/orders.ts, shifts.ts, stock.ts   (pure functions taking `tx`)
  utils/auth.ts, bus.ts, lockout.ts
  plugins/db.ts (pragmas), telegram.ts
  tasks/backup.ts, hourly-backup.ts
shared/money.ts, schemas.ts (zod), types.ts, constants.ts
tests/unit/ (ledger, reconciliation, idempotency)  tests/e2e/ (playwright)
deploy/sank.service, deploy.sh, restore.sh, RESTORE.md
```

## 9. PWA install; when Capacitor

- **Android:** manifest + SW → Chrome offers install; catch `beforeinstallprompt` and show an "Instaliraj" button on the PIN screen. Full offline, persistent storage granted on install.
- **iOS:** Safari → Share → "Add to Home Screen" (show a one-time picture guide). Set `apple-mobile-web-app-capable`, 180 px icon. Limits (verified): push works only from the home-screen app (iOS 16.4+); **no Background Sync** — the outbox flushes only while the app is open, so the pill says "Otvori aplikaciju da pošalješ"; storage: the 7-day ITP cap applies to Safari tabs, home-screen apps are officially exempt (assumption: still true in 2026), but LRU eviction under storage pressure remains possible — call `navigator.storage.persist()` and treat the outbox as volatile.
- **Capacitor only if:** the owner wants a kiosk-locked bar tablet, a Bluetooth bill printer, background sync on iOS, or store distribution. Not v1. Because all data goes through `/api`, wrapping the SPA later costs days, not a rewrite.

## 10. Backups and restore drill

- Nitro task `backup` runs `db.backup('/var/backups/sank/hourly/sank-<ts>.db')` every hour 12:00–04:00 (keep 48), and daily at 05:00 (keep 60). `.backup` is WAL-safe. DB will stay under ~100 MB/year.
- Offsite: `rclone copy` daily to Cloudflare R2 (10 GB free) or Hetzner Storage Box (~3.5 EUR). Optional upgrade: Litestream for continuous replication.
- **Restore drill, first Monday monthly, 15 min:** pull latest offsite file to the laptop → `sqlite3 f.db 'PRAGMA integrity_check'` → run the app locally against it → compare last `shift_seq` and yesterday's pazar with the live dashboard → note the time taken in `deploy/RESTORE.md`. If it was never restored, it is not a backup.

## 11. Multi-tenant readiness (no tenant UI)

- `venues(id, name, slug, settings_json)` seeded with one row; `venue_id NOT NULL` on every business table; every unique index is `(venue_id, …)`.
- `server/middleware/tenant.ts` resolves `venueId` from the session/device row into `event.context`; services take `venueId` as first argument. A vitest test introspects the schema and fails if any table lacks `venue_id`.
- Per-venue settings in `settings_json` (currency, `grams_per_bowl`, `void_grace_minutes`, `pin_length`, shift auto-close hour). No cross-venue joins, ever → later the cheapest SaaS path is one SQLite file per venue, no code change to queries.

## 12. Testing

- **vitest unit** against `better-sqlite3(':memory:')` with real migrations (fast, real SQL): order totals; price snapshot survives a menu price change; `shift_seq` monotonic and unique; idempotent replay (same `client_id` twice → one row); late-sync rule opens a new tab; void math; stock ledger (receipt + sales − void ± count_adjust); shift reconciliation (`expected_cash = Σ cash tabs − cash voids; difference = counted − expected`); PIN lockout escalation.
- **Playwright e2e, three flows:** enrol + PIN + order appears on dashboard via SSE; `context.setOffline(true)` → two orders → online → both synced once; owner closes shift and sees the difference.

## 13. Security basics

HTTPS + HSTS; cookies httpOnly/secure/SameSite=Lax; owner session 30 d sliding, waiter 14 h, device token 365 d; `nuxt.config` `runtimeConfig` private keys only (session secret, bot token, R2 keys) — nothing in `public`. PIN lockout in `lockout.ts`: 5 failures → 60 s, 10 → 15 min, 15 → device locked until owner unlocks; keyed by `device_id + waiter_id`; alert owner via Telegram at 10. Rate limits (in-memory token bucket): `/api/auth/*` 10/min per IP, `/api/orders` 60/min per device. Enrol codes single-use, 10 min. Revoke checked per request. `audit_log` rows for price changes, void approvals, PIN resets, revocations. zod on every body; `venue_id` never taken from the client. DB file `chmod 600`, systemd `ProtectSystem=strict`, unattended-upgrades on.

## 14. Conclusion and top 5 risks

**Build A: Nuxt 4 + Nitro + Drizzle/SQLite on the existing VPS, SSE for the dashboard, per-waiter PIN on enrolled devices, append-only ledgers in feninga, an IndexedDB outbox with `client_id` idempotency, hourly `.backup` + offsite copy, `venue_id` on every table.**

| # | Risk | Mitigation |
|---|---|---|
| 1 | Orders lost or duplicated by the offline outbox (dead phone, iOS eviction, double-tap) | `UNIQUE(venue_id, client_id)`; persist storage; sync pill + pending banner; heartbeat shows pending per device at shift close; manual order with `source='manual'` |
| 2 | Waiters simply don't enter orders (the real theft path — software cannot see an unentered order) | Make entry faster than paper (≤ 4 taps for a drink); per-shift stock count vs sales reconciliation as the accountability mechanism; show waiters their own stats first (fairness), owner spot-checks second |
| 3 | Single VPS dies during Saturday night | Hourly backups (RPO 1 h), offsite copy, rehearsed 15-min restore; the bar runs on paper for an hour and back-fills as manual orders |
| 4 | SSE breaks behind proxies / mobile carriers, dashboard silently goes stale | 25 s heartbeat, proxy buffering off, EventSource auto-reconnect, polling fallback, "posljednje ažurirano" timestamp on the dashboard |
| 5 | Complexity creep by a junior + AI pair (Redis, WebSockets, microservices, clever merges) | One process, one DB file, append-only tables, server-owned tabs and numbers; vitest ledger tests are the guardrail; anything not in this document needs a written reason |

Verified while writing: Supabase free-tier pausing after 7 idle days ([docs](https://supabase.com/docs/guides/platform/free-project-pausing)); PocketBase v0.39.x still pre-1.0 ([docs](https://pocketbase.io/docs/), [npm](https://www.npmjs.com/package/pocketbase)); iOS home-screen push since 16.4, no Background Sync, Persistent Storage API since Safari 17 ([MagicBell](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide), [MobiLoud](https://www.mobiloud.com/blog/progressive-web-apps-ios/)). Assumption: home-screen web apps remain exempt from Safari's 7-day storage cap.
