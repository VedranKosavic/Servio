# CLAUDE.md — Šank

Internal order + shift + bar-stock + owner-dashboard app for one shisha lounge in Bosnia and Herzegovina. The master plan (data model, flows, rules, roadmap, open decisions) lives in **PLAN.md** — read it before any task. Research appendices are in `docs/research/`, the review history in `docs/reviews.md`.

## Owner context

- Vedran is a **junior web developer trained only on Vue 3 / Nuxt** — explain non-Vue concepts (transactions, triggers, WAL, service workers, ETag, scrypt, moving average) in a two-line comment or README paragraph where they first appear; never assume backend/devops experience beyond what `~/Projects/snajper` already ships.
- Model split: **Fable plans and reviews, Opus 5 implements** via subagents, one PR per roadmap bullet or coherent slice. After each phase: `nuxt build` + typecheck + vitest + a visual check on a phone-sized viewport (real phone for offline work), then commit.
- The café owner is Vedran's friend. One venue now; `venue_id` on every table so a second café is an insert, not a rewrite.

## Stack & conventions

- Nuxt 4 (Vue 3 + TypeScript, `<script setup>`), Tailwind CSS v4, Pinia + VueUse, Drizzle ORM + better-sqlite3 (WAL), Nitro server routes, Zod schemas in `shared/`, vitest. Same folder shape as snajper: `app/`, `server/`, `shared/`, `deploy/`, `tests/`.
- Two layouts: `/k` — waiter app (dark theme, mobile-first, installable PWA, offline outbox with client UUIDs); `/a` — owner dashboard (phone + laptop).
- UI language Bosnian (ijekavian). Money is integer feninga in `*_fen` columns, formatted `1.250,50 KM`; dates `08.09.2026.`; 24 h clock; the business day starts 06:00 `Europe/Sarajevo` — no business code calls `getHours()` without a zone (`shared/dates.ts`).
- Ledger tables are append-only, enforced by SQLite triggers in `server/db/triggers.sql` re-applied at boot. Phase 0 invariant tests are the guardrail: never weaken one to fit a feature; a test change needs a sentence in the PR naming the invariant that moved.
- The server never trusts a price or amount from a phone; prices are snapshotted at lock; stock is deducted inside the lock transaction; every phone-born row is idempotent (`UNIQUE(venue_id, client_id)`).
- Migrations only (`drizzle-kit generate` + `migrate`); never `drizzle-kit push` against real data.
- Secrets (Anthropic API key for receipt scanning, Telegram bot token, session secret) live in `.env` on the VPS only; nothing secret ships to the client.
- **Bosnian only, no i18n layer.** Every UI string, Telegram message and log title is written in Bosnian (ijekavian) directly in the code; no English on any screen, no translation library. English stays in identifiers, comments and docs. `PLAN.md` §12 is the glossary — reuse its labels verbatim.
- One activity record: `log_entries` (written by `log()` inside the same transaction as the event) feeds the owner-only *Dnevnik* page and the Telegram mirror; there is no separate `audit_log`. Chat (`chat_*`), uploads and the roster tables follow the same venue_id / client_id conventions; chat access is one `canSee(role, kind)` function enforced on every read, write and image URL.
- The waiter's end of shift is one flow: the cash settlement (*Završi smjenu*). Do not add a second end-of-shift; extend that one.

## Sensitivity notes

- **Not a fiscal device.** No receipts, no printing, no PDV lines, no receipt numbering; the word *račun* appears only in "Na račun kuće". Keep the disclaimer in README and the watermark on *Pokaži narudžbu*.
- **Konobari is private.** Owners never see the *Konobari* channel in the app (server-enforced); *Dnevnik* and drill-downs are owner-only; no per-person money ever appears in *Svi* or *Konobari*. The honesty note about the database file is published in *Pravila* — keep it truthful.
- **Accountability, not surveillance.** Staff see their own numbers first; flags say "označeno za razgovor", never accuse; no leaderboards; thresholds are published in *Pravila* inside the app. Read PLAN.md §8 before touching any per-person metric.
