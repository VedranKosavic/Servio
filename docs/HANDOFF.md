# Handoff

Read this first in a new session, then `CLAUDE.md`. It says what Servio is, where
everything lives, how to run it, and the rules that keep parallel work from
breaking the owner's running app.

## What this is

Servio is an internal order, shift and bar-stock system for one shisha lounge
café in Bosnia. Waiters take orders on their own phones, the bartender gets the
ticket the moment a round is locked, every order deducts stock inside the same
database transaction, and the owner sees cash counted against cash expected per
shift. **It is not a fiscal cash register**: it prints nothing and issues no
receipts.

The screen language is Bosnian (ijekavian), with no translation layer — strings
are written in Bosnian directly in the code. Code, comments and docs are English.

## Where things are

| Document | What it holds |
|---|---|
| `PLAN.md` | The master product plan: flows F1–F14, screens, rules, glossary (§12), roadmap |
| `docs/PLAN.bs.md` | The same plan in Bosnian, written for the café owner |
| `docs/BACKEND.md` | The backend contract: schema, services, every route, invariants |
| `docs/DESIGN.md` | The design system: type scale, colour tokens, component classes, motion |
| `docs/PHASES.md` | How the work was split into phases and who owned which folders |
| `docs/PHASE2.md` `PHASE3.md` `PHASE4.md` | Build specs for the dashboard, the waiter/bartender completion, and Ekipa |
| `deploy/` | Server setup, deploy script, systemd unit, backups, and a Bosnian runbook for the owner |
| `docs/reviews.md` | The original planning critiques, kept as a record |

## Running it

```bash
cd ~/Projects/sank && cp -n .env.example .env && npm ci && npm run dev -- --port 3002
```

The database is `data/sank.db`. It migrates, applies its triggers and seeds
itself on first boot. To start clean, delete the file and restart.

| Command | What it does |
|---|---|
| `npm run typecheck` | Nuxt prepare plus both TypeScript projects |
| `npm test` | The vitest suite against an in-memory database with real migrations |
| `npm run build` | The production build |
| `npm run db:seed` | Seeds an empty database |

The browser suite runs against a production build on its own database and port;
`tests/e2e/helpers.ts` documents how, and every spec file resets the rate limiter
through the dev-only route before it starts.

## Signing in

The first screen is a PIN pad. The PIN identifies the person, so PINs are unique
per venue and the backend refuses a duplicate.

| Account | Role | PIN |
|---|---|---|
| Haris | admin | 1111 |
| Amar | radnik | 2222 |
| Emir | radnik | 3333 |

An admin lands on the dashboard. A worker picks the screen they are working on,
Konobar or Šanker, and can switch later from the profile menu. The admin also has
an email entrance at `/admin/login` with `haris@lounge.ba` and password 1111.
The test suites need a larger cast, so the seed can also create Lejla, Dino and
Tarik (PINs 4444, 5555, 6666) behind an explicit option; the app's own seed makes
only the three above.

These are testing-phase numbers: before a real install, set real PINs in
`/admin/postavke/osoblje` and remove `SANK_DEV_ENROL` from the server's `.env`.

## The routes

- `/` — the PIN pad, then the screen chooser for a worker
- `/konobar` — floor plan, table, order, payment, storno, end of shift, count, waste, chat, schedule, rules
- `/sanker` — tickets, approval queue, count, chat, schedule; `/stanje` — stock and deliveries
- `/admin` — Puls, shifts, stock and reports, menu, settings, schedule, chat, log, exports

## What holds the system together

Break any of these and the numbers stop being trustworthy:

- **The ledger is append-only.** Orders, order lines, payments and stock movements
  cannot be edited or deleted; SQLite triggers enforce it and are re-applied at
  every boot, because a Drizzle migration can silently drop them.
- **Stock is never a stored balance.** On hand is the sum of movement deltas.
- **The server owns money.** No price or amount is accepted from a phone.
- **Every mutation from a phone carries a client id** and is unique per venue, so
  a retry can never double-count.
- **One expected-cash function** feeds every screen that shows expected cash.
- **Every mutation bumps the change feed**, which is how all screens stay in sync
  through one poll.
- **Every admin action writes a log entry** in the same transaction, which is what
  the Dnevnik reads.

Tests exist for each of these. If one fails, fix the code, not the test.

## Rules for any session working here

The owner keeps a dev server running on port 3002 against `data/sank.db` and
watches it while you work.

- Never delete, reseed or write to `data/sank.db` except through the app.
- Never bind port 3002. Use your own port and `DB_PATH=data/verify.db`.
- Never run `pkill` or kill a process you did not start. This has killed the
  owner's server before. Stop only your own, by PID.
- Keep typecheck, unit tests and build green in every commit.
- No new hex values or ad hoc font sizes: use the tokens in `docs/DESIGN.md`.
- Bosnian on screen, no English, no emoji, icons as inline SVG.
- Don't cost the waiter a tap. Two coffees is five taps, cash payment three, coal
  two, and those budgets are asserted in the browser suite.

## Splitting work across sessions

One session per folder area, and push before another session touches the same
files.

| Area | Owns |
|---|---|
| Design and UI polish | `app/**`, one of waiter / bartender / admin at a time |
| Backend and data | `server/**`, `shared/**`, migrations, `tests/unit/**` |
| Deploy and ops | `deploy/**`, the VPS, `.env` on the server |
| Café data | No code. Menu, prices, costs, tables, flavours entered in `/admin` |

Cross-cutting files — `app/assets/css/main.css`, `shared/types.ts`, the schema —
belong to whichever session is leading that day. Say so before touching them.

When several agents build in parallel, give each its own git worktree
(`git worktree add ../servio-<topic> -b <branch> main`), merge them one at a time
with a green gate between merges, and delete the worktrees afterwards. Expect
conflicts in the shared test registries, where the answer is always to keep both
sides.

## What is done

Phases 1 to 4 are complete and pushed: the backend contract, the admin dashboard,
the waiter and bartender screens with an offline queue and installable app, and
Ekipa — chat with photos, the schedule with swaps, receipt scanning for
deliveries, and house rules with acknowledgements. After that came a design system
pass across all three areas, and the sign-in rework described above.

## What is left

**Phase 5 is the pilot**, and most of it needs the owner rather than code:

- A small server and a domain, ideally in the owner's name. Everything needed is
  in `deploy/`, including a rehearsed restore.
- The real catalogue: products, prices, purchase costs, flavours, coal, and ten
  weighed bowls per shisha product so the grams are measured rather than guessed.
- Opening stock counted with costs, staff accounts with real PINs, phones enrolled
  with codes from `/admin/postavke/uredaji`, and a kitchen scale.
- Two weeks of paper baseline, then a week with the app and the paper blok in
  parallel, the owner's five-minute daily review, and a go or no-go after four
  weeks.

**Open decisions**: the final product name (the repo folder is still `sank`, the
GitHub repo is `Servio`, and the name on screen comes from one constant in
`shared/brand.ts`); cash in each waiter's pocket or one shared drawer; whether a
bartender works every shift; the closing hour; whether there is a card terminal;
and the real category list for the spend-against-sales report.

**Deliberately not built**: notifications of any kind. No Telegram, no push. The
Dnevnik and the attention list inside the app are the only channels.
