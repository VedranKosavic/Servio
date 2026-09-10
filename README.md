# Šank

Internal order, shift and bar-stock system for a shisha lounge café in Bosnia and Herzegovina.
Waiters lock rounds on their phones; the owner sees cash counted vs expected and stock counted
vs expected per shift, plus what sells, which shisha flavours move, and where merchandise disappears.

**This is not a fiscal cash register.** It issues no receipts and records nothing for tax purposes;
it is an internal accountability and stock tool. *Ovo nije fiskalni uređaj.*

**Status: the backend is done; the screens are next.** Phase 1 (WP0–WP8) has landed on `main`:
the Korak 2 schema and its append-only triggers, PIN sessions on enrolled devices with
deny-by-default authorization, the money core (rounds, tabs, payments, voids and comps), shifts
with blind cash settlement, bar stock with counts and the two owner reports, the change feed, the
*Dnevnik*, admin CRUD, the owner dashboard's reads, and the deploy kit in [deploy/](deploy/).
715 tests, `npm run typecheck && npm test && npm run build` green.

**Šank notifies nobody.** There is no Telegram bot, no e-mail, no push and no outward channel of
any kind: the owner reads the *Dnevnik* and the attention list inside the app, and the team chat
will live in the app too. Nothing to install, nothing to configure, and no café data leaving the
box it runs on.

What is left is **WP9**, the waiter and bartender screens under `app/`: they are still Korak 1's
and still send a `user_id` in the body instead of using the session, so they need the start screen
(enrol code → names → PIN pad), one `/api/changes` poll in place of the per-screen timers, and the
new envelope shapes. The API is finished and documented, so that work is re-wiring, not design.

Run it locally with `cp .env.example .env && npm run dev`; the first boot migrates and seeds
itself. Deploying it to a small Ubuntu box is [deploy/README-DEPLOY.md](deploy/README-DEPLOY.md),
written for someone who has never used a server; the one page the café owner needs is
[deploy/OWNER_RUNBOOK.md](deploy/OWNER_RUNBOOK.md).

The technical plan is in [PLAN.md](PLAN.md) (English, for the developers); the backend
implementation contract — schema, routes, services, invariants — is in
[docs/BACKEND.md](docs/BACKEND.md); the two-developer workflow in
[docs/PHASES.md](docs/PHASES.md); the owner-facing plan in Bosnian is
[docs/PLAN.bs.md](docs/PLAN.bs.md); research appendices in [docs/research/](docs/research/); the
review log in [docs/reviews.md](docs/reviews.md). The app itself is Bosnian-only (no i18n layer).

**The first screen is a PIN pad and nothing else** — no names, no role buttons. The PIN
identifies the person, which is why every PIN in a venue has to be different and why the
app refuses to set one that is already taken. A fresh `npm run db:seed` creates three
accounts: **Haris 1111** (vlasnik — lands on `/admin`, and `haris@lounge.ba` / `1111` is
the same door on a laptop), **Amar 2222** and **Emir 3333** (radnici). A radnik picks
*Konobar* or *Šanker* after the PIN and can switch later without signing out; both screens
are open to both of them.

The `SANK_DEV_PIN` override that gave everybody the same PIN is gone: a shared PIN can no
longer identify anybody, so it must not be possible to seed one. `npm run db:dev-pins`
survives, repointed — it brings an **existing** database onto those three accounts and
those three PINs in place, and deactivates everybody else rather than deleting them, so
the rounds they served stay readable. That is the script to run on any dev database seeded
before this change: one seeded with `SANK_DEV_PIN=1111` has six people behind the same
four digits, and the pad answers *Taj PIN koristi više osoba* rather than guessing which
of them is standing at the till.

`SANK_SEED_CAST=full` (on `db:seed`) and `SANK_DEV_CAST=full` (on `db:dev-pins`) add Lejla,
Dino and Tarik on 4444 / 5555 / 6666, which is what the unit fixtures and the Playwright
suite need. Both are explicit flags and not `NODE_ENV` guesses, for the same reason the
dev PINs are: a test cast that can reach a real café is a stranger's name on the pad.
