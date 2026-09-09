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
