# Šank — phases, ownership and the two-developer workflow

**Status:** the working agreement between Vedran and Harun, who now share this repo and work at the same time, each with an AI coding agent. It sits above `PLAN.md` (the product) and `docs/BACKEND.md` (the Korak 2 backend contract). Where this file and a phase document disagree about *who touches which folder*, this file wins; where they disagree about *what a feature does*, `PLAN.md` wins.

The rule the whole document exists to protect: **two people never edit the same file in the same week.** Everything else — the phase cut, the fixture layer, the branch names — is machinery for that one rule. Merge conflicts in a Nuxt app are cheap; merge conflicts in a Drizzle migration snapshot or in `shared/types.ts` cost an evening each.

---

## 1. The phases

Five phases. Phases are **slices of the product**, not calendar weeks; each one ends with something a person can use on a phone. The cut below follows PLAN §13 but re-orders one thing: PLAN's Phase 2 bundles the owner dashboard with the waiter's shift work, and those two are exactly what two developers can build in parallel, so they are split here into Phase 2 (owner/admin UI) and Phase 3 (waiter/bartender completion).

### Phase 1 — Backend contract (Vedran)

Everything in `docs/BACKEND.md`: work packages **WP0 → WP8**. Auth (admin email+password, staff PIN on enrolled devices, sessions, tenant middleware, lockout, rate limits), shifts and cash with the blind per-waiter settlement, payments, voids and comps, stock operations and counts, the `changes` sync feed with ETag and heartbeat, `log_entries`, alerts, admin CRUD, owner reads, deploy and ops.

**Done when:** `npm run typecheck`, `npm run test` and `npm run build` are green on `main`; `tests/unit/invariants.test.ts` passes; every route in `docs/BACKEND.md` §7 exists, is declared in `ROUTE_ROLES` and returns the response type named in its row; a night simulated in tests (3 waiters, 40 rounds, 3 voids, 2 comps, 1 unpaid tab, 1 pending payout, 2 floats) closes with expected cash matching a hand calculation to the fen; the deploy runbook has been walked once against the VPS.

**WP9 (the UI rewire) is deliberately not in Phase 1** — it edits `app/**`, which belongs to the other developer while Phase 1 runs. It becomes the first work package of Phase 3.

### Phase 2 — Admin dashboard `/admin` and the shared UI kit (Harun)

The owner dashboard of PLAN §11, built against the Phase 1 types **before the endpoints exist**, using a typed fixture layer (§3). In scope: page 1 *Uživo / Puls*, page 2 *Smjena / Pregled dana* with the per-waiter strip and the `/admin/smjena/:id/stavke` drill-down, page 4 *Meni & Postavke* (products with inline price, recipes, categories, tables and zones, staff, devices, enrol codes, venue settings), page 6 *Dnevnik* as a read-only list over `GET /api/owner/log`, the admin login screen, the phone bottom tabs (`Puls · Smjena · Roba · Više`) and the laptop left nav with badges. Page 3 *Roba* ships as a read-only stock list plus the count-confirm and delivery forms; pages 5, 7 and 8 (*Izvoz*, *Razgovor*, *Raspored*) are stubs with the Bosnian empty state.

Plus the **shared UI kit** in `app/components/ui/**`: button, card, sheet, numpad, money and time formatters as components, table, tab bar, badge, empty state, chip, stepper — dark theme, ≥ 48 px targets, Bosnian labels, every one usable from both `/admin` and `/konobar`. The kit is new code; Phase 2 does **not** refactor the existing `/konobar` components into it (Phase 3 does that, and only if it is worth the diff).

**Done when:** with `NUXT_PUBLIC_MOCK=1` every `/admin` page renders from fixtures on a 390 px viewport and on a laptop, with no English word on any screen; with the flag off and Phase 1 merged, the same pages render from the real API with no component change other than deleting the fixture branch in the composable; `npm run typecheck` proves every fixture satisfies the type from `shared/types.ts`.

### Phase 3 — Waiter and bartender completion (Vedran)

WP9 first: the start screen becomes real PIN login, `user_id` disappears from every body, `useApi` sends `credentials: 'include'`, one `/api/changes` poll replaces the per-screen timers, the heartbeat starts. Then S8 *Naplata* (cash/card, covers, unpaid), S9 *Završi smjenu* with the blind declaration and the verdict, S11 *Moja smjena*, the void/comp flow with the 300 s self-void window and the bartender's *Na čekanju* queue, S13 *Otpis* and the count screens, `Premjesti sto` / `Predaj sto kolegi`, and the PWA: manifest, service worker, the offline outbox with client UUIDs and the sync chip.

**Done when:** two rounds and a payment queued on a real Android with Wi-Fi off appear exactly once after reconnecting; a whole shift is opened by a first lock and closed in the app; the tap budgets of PLAN §10 hold on a mid-range phone.

### Phase 4 — Ekipa (Harun)

The Korak 3 team features, backend and UI together, because by then Phase 1 is finished and `server/**` is free: chat (`chat_*` tables, `canSee`, channels *Svi* / *Konobari* / *Admini*, images and uploads), the roster (`shift_templates`, weeks, publish, swap requests), the *Dnevnik* filters and laptop table, receipt scanning (`POST /api/uploads` → Claude vision → draft delivery), and the *obavijesti* list on *Puls* beyond the v1 rule set (acknowledgement, outcomes, the digest). **Chat lives in the app; there is no Telegram and no outward notification of any kind** — the Dnevnik and that attention list are the only channels (BACKEND §9).

**Done when:** PLAN §13 Phase 3b's done-when list passes.

### Phase 5 — Pilot, deploy, polish (both)

Onboarding evening with the owner, one week with the paper blok in parallel, the KPI chips, the restore drill, and the bug queue that a real night produces. **No web push, and no notification channel of any kind** — what PLAN once deferred to this phase is dropped, not postponed (BACKEND §9). Whoever wrote the code fixes the bug; no ownership rules apply during the pilot beyond "say what you are touching".

### What runs concurrently

| Together | Vedran | Harun | Why they do not collide |
|---|---|---|---|
| Block A (now) | Phase 1 | Phase 2 | Server vs `/admin` UI — disjoint folders; Harun compiles against types, not endpoints |
| Block B | Phase 3 | Phase 4 | Waiter `/konobar` + `/sanker` vs chat/roster backend + `/admin` pages 6–8 |
| Block C | Phase 5 | Phase 5 | Pilot, shared queue |

**Phase 2 does not wait for Phase 1 to finish, but it does wait one day for WP0.** WP0 lands the schema and the `shared/types.ts` barrel; the day after it merges, Phase 1 ships a **types-only PR** (`phase-1/contract-types`) that fills `shared/types/{owner,admin,shifts,stock,sync}.ts` with the response shapes named in BACKEND §7 — no implementation, just interfaces. That PR is the starting gun for Phase 2.

---

## 2. Ownership by folder

**Strict, while a block is running.** A path has exactly one owner. Creating a *new* file inside your own prefix is always allowed; touching anything under someone else's prefix — one line, a typo, a formatting fix — is not. Ownership is renegotiated at each block boundary (see §5).

### Block A: Phase 1 (Vedran) ∥ Phase 2 (Harun)

| Path | Owner |
|---|---|
| `server/**` | Phase 1 |
| `shared/**` (including `shared/types/*.ts`) | Phase 1 |
| `tests/**` except `tests/unit/admin-ui*.test.ts` | Phase 1 |
| `deploy/**`, `server/database/migrations/**`, `drizzle.config.ts` | Phase 1 |
| `docs/BACKEND.md`, `PLAN.md`, `README.md`, `CLAUDE.md` | Phase 1 |
| `app/pages/admin/**` | Phase 2 |
| `app/components/Admin*/**` and `app/components/ui/**` | Phase 2 |
| `app/composables/useAdmin*.ts`, `app/composables/useFixtures.ts` | Phase 2 |
| `app/fixtures/**` | Phase 2 |
| `app/layouts/admin.vue`, `app/stores/admin*.ts` | Phase 2 |
| `tests/unit/admin-ui*.test.ts` | Phase 2 |
| `app/pages/{index,k,s,stanje}/**`, `app/components/*.vue` (the existing waiter set), `app/composables/use{Api,Polling,Prep*,Visible*,Bootstrap*}.ts`, `app/stores/{session,cart}.ts` | **frozen** — Phase 3 |

The last row matters: the existing waiter screens are nobody's this block. Phase 1 does not edit them (that is WP9, deferred), Phase 2 does not refactor them into the UI kit. They keep running against the Korak 1 routes until Phase 3 rewires them.

### Shared touch points — Phase 1 owns, Phase 2 requests

`package.json` · `package-lock.json` · `nuxt.config.ts` · `app/app.vue` · `app/assets/css/main.css` · `shared/types.ts` (the barrel itself) · `tsconfig.json` · `vitest.config.ts` · `.github/workflows/ci.yml`

Phase 2 will need all six of the first ones — a dependency, a `runtimeConfig.public.mock` flag, a laptop breakpoint token. The procedure is a **request PR**: a branch `phase-2/req-<thing>`, touching only the shared file, under ~20 lines, with a one-sentence body saying what needs it. Phase 1 reviews and merges it **the same day** — this is not a design review, it is a lock. Adding a token to the `@theme` block of `main.css` and adding a dependency are append-only and effectively auto-approved; changing an existing token or an existing type is a conversation.

If a request PR sits unmerged for more than a day, Harun is unblocked, not stuck: he adds the value locally in his own file (a CSS variable in the admin layout, a local type alias) with a `// TODO(req-<thing>): move to main.css` comment, and deletes it when the request lands.

### Block B: Phase 3 (Vedran) ∥ Phase 4 (Harun)

| Path | Owner |
|---|---|
| `app/pages/{index,k,s}/**`, the waiter components, `app/stores/{session,cart,outbox}.ts`, `public/sw.js`, `public/manifest.webmanifest` | Phase 3 |
| `server/services/{orders,payments,tabs,adjustments,shifts,cash,stock,counts}.ts` and their routes | Phase 3 |
| `server/services/{chat,roster,uploads,scan}.ts`, `server/api/{chat,roster,uploads}/**` | Phase 4 |
| `app/pages/admin/**`, `app/pages/konobar/razgovor/**`, `app/pages/konobar/raspored/**` | Phase 4 |
| `app/components/ui/**` | Phase 4 (still Harun's; Phase 3 requests) |
| the schema and its one migration for the block | **Phase 4** — Korak 3 tables are all his |

Migrations are the one place where "one owner" is not a preference but a hard requirement: `drizzle-kit` numbers migrations from `meta/_journal.json` and keeps a cumulative snapshot, so two branches that each generate `0002_*.sql` produce a conflict `git merge` cannot resolve. **Exactly one person per block runs `drizzle-kit generate`.** In Block A that is Vedran; in Block B it is Harun. The other one asks for the column.

---

## 3. How Phase 2 codes against a contract that does not exist yet

Harun builds screens for endpoints that Vedran has not written. The trick is that he builds against the **types**, which exist from day two, and feeds them with fixtures until the endpoints land.

**One layer, two sources.** Every `/admin` page calls a composable in `app/composables/useAdminApi.ts`. That composable has one branch, at the top, and nowhere else:

```ts
// app/composables/useAdminApi.ts
import type { OwnerLive, OwnerShift, Product } from '#shared/types'
import { fixtures } from '~/fixtures'

const mock = () => useRuntimeConfig().public.mock === '1'

export function useAdminApi() {
  return {
    // The return type is the contract. When Vedran changes `OwnerLive`,
    // this file and the fixture both stop compiling — which is the point.
    getLive: (): Promise<OwnerLive> =>
      mock() ? Promise.resolve(fixtures.ownerLive()) : $fetch('/api/owner/live'),
    // …one line per route in BACKEND §7
  }
}
```

**The fixtures are typed, not shaped.** `app/fixtures/ownerLive.ts` exports `export function ownerLive(): OwnerLive { … }` with a real annotation, never `as any` and never a loose object literal. That single discipline turns `npm run typecheck` into the contract test: the day Phase 1 renames a field, CI fails on Harun's branch with the exact file and line, before a screen renders an empty panel.

**Rules for the mock layer.**

1. **Never a second API.** No `/api/mock/**` route, no MSW server, no separate express. A mock endpoint is a second implementation that drifts; a fixture function is a value that cannot.
2. **One flag.** `NUXT_PUBLIC_MOCK=1` in `.env` locally, declared once in `nuxt.config.ts` (a Phase-1 request PR) as `runtimeConfig.public.mock`. Unset in CI and in production; the fixture branch is dead code the bundler drops.
3. **Fixtures are one realistic night**, not lorem ipsum: the real floor plan from the seed, Bosnian names, money as integer feninga through `formatKm`, a shift with three waiters, one pending void, one unpaid tab, one settlement outside tolerance. Empty and error states get their own fixture (`ownerLiveEmpty()`, `ownerLiveNoShift()`) because those are the screens that ship broken otherwise.
4. **Fixtures die.** When an endpoint lands, its fixture stays only as long as it is used by a test or by an empty-state story; the rest is deleted in the PR that switches the page over.
5. **Latency and failure are simulated, once.** The mock branch resolves after 120 ms and one fixture per family throws a `SankError`-shaped `{ code, message }`, so loading and error states are built at the same time as the happy path rather than three weeks later.

**Switching over.** When Phase 1 merges the WP that implements a route, Harun opens a small PR that (a) deletes that route's mock branch, (b) deletes its fixture, (c) walks the page once against the real dev server. One route per PR; a broken switch-over never blocks another page.

---

## 4. Git workflow

**`main` is always green and always deployable.** Nobody pushes to `main`; everything arrives through a pull request that CI has passed.

- **Branches:** `phase-1/<topic>` and `phase-2/<topic>` — `phase-1/wp2-shifts`, `phase-2/puls-page`, `phase-2/req-mock-flag`. The prefix is what makes a stale branch readable a month later, and it tells the other person at a glance whether a branch will touch their folders.
- **Small PRs.** One work package or one page per PR, ideally under ~400 changed lines. A PR that touches more than one owner's folders is wrong by construction — split it or file a request PR.
- **Rebase on `main` daily**, first thing: `git fetch origin && git rebase origin/main`. Rebasing your own unmerged branch is normal and expected. A branch that has not seen `main` in three days is where the expensive conflicts live.
- **No force-push to `main`, ever.** Protect the branch on GitHub: require a passing CI check, require a PR, disallow force-push and deletion. Force-pushing your *own* feature branch after a rebase is fine — that is what `--force-with-lease` is for.
- **Squash merge**, with the PR title as the commit subject. History on `main` is one line per slice.
- **The CI gate** (`.github/workflows/ci.yml`) runs `npm ci`, `npm run typecheck`, `npm run test`, `npm run build` on Node 22 for every push and every PR. Red CI is never merged and never explained away; if a test on `main` is flaky it is fixed or deleted the same day, because a red `main` means the other developer cannot tell whether he broke something.
- **Never weaken an invariant test to make a feature fit.** If one genuinely must change, the PR body carries a sentence naming the invariant that moved and why (`CLAUDE.md`).
- **Review.** Each PR gets a look from the other person — for cross-folder PRs and request PRs that review is required; for a PR entirely inside your own prefix a self-merge after green CI is fine, because waiting for a friend's evening is how a two-person project stalls. Agent-written code counts as code: the human whose branch it is is the author and is responsible for it.

---

## 5. Daily sync and cross-phase changes

**The ritual, ten minutes, once a day** (a message, not a call — write it in the shared chat before you start coding):

1. What I merged since yesterday (one line per PR).
2. What I am on today, and **which folders it will touch**.
3. What I need from you: request PRs open, contract questions, anything blocked.
4. Anything I noticed in your area but did not touch.

Point 2 is the one that prevents the collision; point 4 is the one that prevents the silent fix. If you spot a bug in the other person's folder, you write it in the sync message or open an issue — you do not fix it, however small, because a one-line fix in a file the other person is mid-rewrite of costs him twenty minutes of conflict resolution to save you two.

**The rule for cross-phase changes**, in order:

1. **It is in my prefix** → do it.
2. **It is in the shared touch points** → request PR, ≤ 20 lines, one sentence of why, merged the same day.
3. **It is in the other person's prefix** → ask. He does it, or he hands the file over for one PR with an explicit "it's yours until you merge" in the chat. Handovers are per-file and per-PR, never standing.
4. **It changes the contract** (`shared/types/*.ts`, a route path, a response shape) → Phase 1 makes the change, Phase 2 fixes his fixtures in the same PR or immediately after. The contract lives in `docs/BACKEND.md` §7; a change lands there in the same PR that changes the type, or it did not happen.

**Block boundaries.** When Phase 1 merges its last WP, ownership is re-cut before the next branch is created: post the new table (§2 Block B) in the chat, both agree, then start. Fifteen minutes at the boundary is cheaper than a week of ambiguity in `server/services/`.

---

## 6. Briefing your AI agent

Each developer runs his own agent in his own clone. The agent gets three things at the start of a session, pasted into the first message (not left for it to discover):

1. **Its phase section from this file** — §1's paragraph for that phase, verbatim.
2. **Its ownership table** — §2's block table, verbatim, with this sentence under it: *"You may create and edit files only under the paths owned by this phase. If a change seems to require editing any other path, stop and tell me what you would change and why; do not edit it."* This is the single most important line in the brief. Agents are helpful; a helpful agent that fixes a type in `shared/types.ts` while implementing an admin page has just created a merge conflict and a contract change nobody agreed to.
3. **The task itself**, with the sources named by section: for Phase 1, "`docs/BACKEND.md` WP2, read §6.5, §6.6, §7 *Shifts, cash, settlement*"; for Phase 2, "PLAN §11 page 1, `docs/BACKEND.md` §6.10 `OwnerLive` for the shape, build against `useAdminApi` with a fixture".

Standing rules for both agents, worth repeating in every brief because they are the ones that get dropped: read `CLAUDE.md` first; Bosnian in every UI string, English in identifiers and comments; money is integer feninga through `shared/money.ts`, never a float; one branch per PR named `phase-N/<topic>`; run `npm run typecheck && npm run test && npm run build` before saying it is done; never weaken an existing test.

Two conventions that keep the agents out of each other's way in a shared repo: **rebase before you start, not before you push** (an agent that rebases at the end has already written code against a stale contract), and **never run `drizzle-kit generate` unless your phase owns migrations this block** — put it in the brief as a prohibition, because an agent asked for a new column will reach for it without asking.

---

## 7. The short version

Vedran builds the backend contract; Harun builds the admin dashboard against its types with fixtures behind `NUXT_PUBLIC_MOCK=1`. Server, shared and tests are Vedran's; `/admin`, the UI kit and the fixtures are Harun's; the waiter screens are frozen until Phase 3. Shared files change through 20-line request PRs merged the same day. `main` is protected, CI is the gate, branches are `phase-N/<topic>`, everyone rebases daily, and the agents are told in writing which folders they may not touch.
