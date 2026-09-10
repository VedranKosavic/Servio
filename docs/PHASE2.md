# Šank — Phase 2 build spec: the admin dashboard `/admin`

**Status:** the build order for Phase 2 as defined in `docs/PHASES.md` §1, re-cut for the way the project actually runs today. Where this file and `docs/PHASES.md` disagree about *who builds what*, this file wins (the two-developer split is suspended — one team builds everything — but its folder conventions are kept, because they are what makes six work packages mergeable in parallel). Where it disagrees with `PLAN.md` about *what a feature does*, `PLAN.md` wins. Where it disagrees with `docs/BACKEND.md` §7 about *what a route is called*, the code on disk wins, and this document has been written against the code on disk.

Phase 1 is complete on `main`: 724 vitest tests, every route in BACKEND §7 present and declared in `ROUTE_ROLES`, the waiter (`/konobar`), bartender (`/sanker`) and stock (`/stanje`) screens running against it. **`/admin` does not exist.** That is this phase.

Two decisions from 2026-09-09 that override older text anywhere in the repo:

- **No notifications and no Telegram.** Nothing in Šank sends anything outward. The *Dnevnik* and the *Zahtijeva pažnju* list inside the app are the owner's only two channels; chat lives in the app and is Phase 4. PLAN §11's "Alerts (Telegram)" paragraph is void. Do not build a sender, a digest, a mute, or a web-push registration.
- **The admin dashboard is light.** `/konobar` and `/sanker` stay dark. `/admin` is its own theme, scoped, and the two never share a stylesheet rule.

---

## 0. Read these first, in this order

1. `CLAUDE.md` — the house rules. Bosnian on screen, English in identifiers, money as integer feninga, one poll, sessions not `user_id` in a body.
2. `PLAN.md` §11 (the eight owner pages), §12 (the Bosnian glossary — reuse its labels **verbatim**), §10 S9/S11/S18 for the waiter-side flows the admin drills into.
3. `docs/BACKEND.md` §6.10 (`OwnerLive`, `AttentionItem`, `Flag`, `ATTENTION_ROUTES`) and §7 (the route table).
4. `shared/types/*.ts` — `owner.ts`, `shifts.ts`, `stock.ts`, `admin.ts`, `auth.ts`, `sync.ts`, `money.ts`. These are the contract; every `/admin` screen is typed off them and nothing is retyped by hand.
5. `shared/routeRoles.ts` — the complete list of routes that exist. **A route not in that file does not exist.** If a page needs one, it is a backend addition and it belongs in the WP that is allowed to make it (below), with a `ROUTE_ROLES` entry, or it does not get built.
6. The mockups: `design/{Puls,Smjena,Dnevnik,Roba,Izvjestaji,RasporedVlasnik}.dc.html` and `design/KIT.md`. The desktop CSS block in `KIT.md` is the source of the class names and the exact pixel values used below.

---

## 1. The backend gaps Phase 2 must close

Phase 1's WP9 notes list what the UI rewire left behind. Verified against the code on disk today; each of these is a real gap and each has an owner in §3.

**1.1 Three ETagged reads are not ETagged.** BACKEND §7 marks `GET /api/tables/state`, `GET /api/prep` and `GET /api/bootstrap` "(ETag)". All three handlers return the service value directly:

```ts
// server/api/tables/state.get.ts — today
export default defineEventHandler(event => guard(() =>
  getTablesState(useDb(), event.context.venueId, event.context.actor)))
```

`GET /api/changes` is the only route wrapped in `withEtag`. On `/admin` this matters more than on a phone: the dashboard opens four or five reads per page and the laptop keeps them open all evening. Fix: wrap each of the three in `withEtag(event, <tag>, () => …)`, with the tag built the way `changeTag` builds its — `MAX(seq)` for the venue, plus the role, plus the first eight characters of the user id, because `TablesStateResponse` carries `my_settled` / `my_open_tabs` and `Bootstrap` carries `me`. `server/utils/etag.ts` already exports `withEtag`; only the three route files and a tag helper per service change.

**1.2 `GET /api/changes` attaches a placeholder shift and never attaches `me`.** `shared/types/sync.ts` still carries WP2's and WP1's forward references as local aliases:

```ts
export interface ShiftSnapshot { id; business_date; status; opened_at }   // ≠ ShiftBrief
export type MeSnapshot = Record<string, unknown>                           // ≠ MeContext
```

`ShiftBrief` (`shared/types/shifts.ts`) landed with `closing`, `closer_name`, `my_settled` and `my_open_tabs` on it — the four fields the shift strip actually needs — and `getChanges` still builds the four-field snapshot. `me` is typed on `ChangesResult` and never sent; `useChanges` compensates by watching for a `user`/`device` row in `changes[]` and re-reading `/api/me`. Fix: point `ShiftSnapshot` at `ShiftBrief` and `MeSnapshot` at `MeContext`, widen `shiftSnapshot()` in `server/services/changes.ts` to return the brief, and attach `me: getMe(...)` when the `user` or `device` entity moved and the answer is not `full`. Then delete the compensating comment and the `changes[]` sniff in `useChanges` — `handlers.me` fires off `result.me` instead.

**1.3 `POST /api/auth/admin/login` returns the wrong envelope.** It answers `AdminLoginResult { user, venue, expires_at }`; every other door answers something the screen can hand straight to `useMe`. `/admin/login.vue` would otherwise have to assemble a `MeContext` by hand — exactly what `useMe.refreshAfterLogin()` exists to prevent. Fix: `adminLogin()` returns `MeContext` (it already has the session row and the venue; `device` is `null` for a laptop), `AdminLoginResult` is deleted from `shared/types/auth.ts`, `tests/unit/auth.test.ts` and `tests/unit/api-shapes.test.ts` follow.

**1.4 CSV export routes do not exist.** `ROUTE_ROLES` has no `/api/owner/export/*` key and `server/api/owner/` has no `export/` folder. PLAN §11 page 5 names eight files; Phase 2 ships four (§3, WP5) and the rest wait for Phase 3b.

**1.5 A shift review route exists; a Pravila route does not.** `POST /api/shifts/:id/review` is on disk and takes `{ card_total_fen?, closing_note? }` — that one route is **both** the card-total input and the *Pregledano* button on the Smjena page, and no second route is needed for either. There is no rules/Pravila table, type or route anywhere in the repo. **Phase 2 does not build the Pravila editor** that PLAN §11 page 4 mentions; it is a Phase 4 item alongside acknowledgements, and `/admin/postavke` links to nothing for it.

**1.6 There is no count-lines route.** PLAN's *Popisi* flow reads as create → add lines → submit → confirm. The backend has two routes: `POST /api/stock/counts` takes the whole count **with its lines in the body** and submits it in one call, and `POST /api/stock/counts/:id/confirm` confirms it. The draft lives on the client until *Pošalji popis*, exactly as on the phone (BACKEND §14.5). Build the form that way; do not invent `PUT /counts/:id/lines`.

**Nothing else in `server/**` may be touched by Phase 2.** WP0 makes the fixes in 1.1–1.3; WP5 adds the routes in 1.4 and nothing more. Every other work package is `app/**` only. A page that seems to need a new read is a design bug or a missing filter on an existing read — say so and stop.

---

## 2. The admin shell

Everything in this section is WP0. Nothing else can start until it merges.

### 2.1 `app/layouts/admin.vue`

The layout root carries `data-theme="light"` and every `/admin` token is defined **under that attribute selector**, never on `:root`:

```vue
<template>
  <div class="admin" data-theme="light"> … </div>
</template>

<style>
[data-theme='light'] {
  --bg: #f2f0eb;  --surface: #fbfaf7;  --surface-2: #e9e6df;  --line: #d9d4ca;
  --ink: #1f2a2e; --ink-2: #4a585d;    --muted: #6f7c80;
  --accent: #b5623a; --accent-soft: #f1dccf; --accent-ink: #8f4a28;
  --nav: #1f2a2e; --nav-ink: #e8e4dc; --nav-muted: #8d9599;
  --good: #3d8f7a; --good-soft: #dcefe8;
  --warn: #b07d1e; --warn-soft: #f6e9c9;
  --danger: #c8433f; --danger-soft: #f4dcda;
}
</style>
```

`app/assets/css/main.css` keeps the dark `@theme` block untouched — `/konobar` must not shift by one pixel. The admin tokens live in the layout's own `<style>` (not scoped, so the kit components inside can read them) and nowhere else in the app. Nothing under `/admin` writes a hex value; nothing outside `/admin` reads these names.

**Two navigations, one breakpoint at 1024 px.**

- **≥ 1024 px** — the left nav from the mockup: 220 px, `background: var(--nav)`, the Bricolage wordmark "Šank" over the eyebrow "Kontrolna ploča", then six items — **Puls · Smjena · Roba · Meni i postavke · Dnevnik · Izvoz** — each 44 px, radius 10, the active one on copper with `--accent-ink` text. Badge on the right of an item (`.n` in the kit: 22 px pill, `--danger`, white). The foot carries the venue chip ("Lounge") and "Haris · vlasnik" with *Odjavi se*.
- **< 1024 px** — bottom tabs **Puls · Smjena · Roba · Više**, 56 px tall, safe-area padding below, targets ≥ 44 px. *Više* is `/admin/vise`, a card list linking to Meni i postavke, Dnevnik and Izvoz, and its tab shows the **maximum** of its children's badges as a single red dot.

Both navs read their badge numbers from one place: `useAdminChanges()`. The Dnevnik badge is `log_max_at > users.log_seen_at`; the Puls badge is `attention.length`.

Icons are inline SVG, copied from `KIT.md` §"Icon set" (`pulse`, `money`, `box`, `list`, `users`, `calendar`). No icon font, no icon package, no emoji.

### 2.2 `app/pages/admin/login.vue`

Email + password, `layout: false` (the login screen has no nav), the light tokens applied to its own root. One form, two fields, one button *Prijavi se*; on submit it calls `POST /api/auth/admin/login`, then `useMe().refreshAfterLogin()`, then `navigateTo('/admin')`. A 401 renders the Bosnian sentence from `shared/errors.ts` through `apiErrorText()` — "Pogrešan email ili lozinka" — and never says which half was wrong. A 429 renders the rate-limit sentence with its seconds filled in. `autocomplete="email"` and `autocomplete="current-password"` so a password manager works; no "remember me" checkbox (the session cookie already lasts).

### 2.3 `app/middleware/admin.ts`

Route middleware, applied by every `/admin` page except `login` via `definePageMeta({ middleware: 'admin', layout: 'admin' })`:

```ts
export default defineNuxtRouteMiddleware(async () => {
  const me = useMe()
  const state = me.me.value ? me.status.value : await me.load()
  if (state !== 'ready') return navigateTo('/admin/login')
  if (me.user.value?.role !== 'admin') return navigateTo(me.home.value)
})
```

Client-side only in practice — the session is a httpOnly cookie the *server* reads, and `useMe` already documents why a server-render guard would bounce everybody. A waiter who somehow lands on `/admin` goes to `/konobar`, not to the login screen: he is logged in, just not welcome here. `homeFor()` in `app/composables/useMe.ts` returns `/konobar` for admins today and must return `/admin` after WP0 — that one line is the only edit WP0 makes to a waiter-owned composable besides §2.5.

### 2.4 `app/composables/useAdminApi.ts`

The single place `/admin` knows a URL, built exactly like `useApi.ts`: one `request<T>()` helper with `credentials: 'include'`, `cache: 'default'` on ETagged GETs, errors unwrapped into `ApiSideError` (reuse the class exported from `useApi.ts` — do not define a second one). One method per route, each typed off `shared/types`, each with a one-line comment naming the Bosnian thing it powers. No fixture branch and no `NUXT_PUBLIC_MOCK` flag: the endpoints exist now, so `docs/PHASES.md` §3's fixture layer is obsolete and is not built.

Query-bearing reads take a typed argument, never a raw string: `getOwnerLog(q: LogQuery)`, `getShiftLines(id, { user, kat, cursor })`, `getCategories({ from, to })`, `getNargila(month)`, `getItemMovements(id, { before, limit })`.

### 2.5 `app/composables/useAdminChanges.ts`

**One poll on `/admin` too.** It wraps the existing `useChanges()` rather than opening a second timer. `useChanges` today exposes handlers for `tables`, `prep`, `stock`, `pending`, `menu` and `me` — none of which is what an owner page needs, and it does not surface `log_max_at`. WP0 appends **one** optional handler to `ChangeHandlers`:

```ts
/** The whole answer, for screens that key their refetches off entities. */
raw?: (result: ChangesResult) => void
```

three lines in `apply()` and nothing else in that file. `useAdminChanges(handlers)` then:

- polls at 15 s (`intervalMs: 15_000`), heartbeat off (`heartbeat: false` — a laptop is not a device and has no outbox);
- exposes `attentionCount`, `logUnread`, `pending` and `ok` as refs the nav and every page read;
- calls the caller's `onEntity(entity)` when a relevant entity's seq moved, so a page refetches **only** the read that went stale — Puls on `table`/`adjustment`/`shift`, Smjena on `shift`/`adjustment`/`count`, Roba on `stock`/`count`, Meni on `menu`/`settings`, Dnevnik on `log`.

A page never sets its own `setInterval`. If a page needs a clock (table ages, "Ažurirano 22:41"), it uses `useNow({ interval: 30_000 })` from VueUse for *rendering* and still refetches only on the poll.

### 2.6 The UI kit — `app/components/ui/*`

Eleven components, light-theme only, all reading the layout's CSS variables, all with `defineProps<…>()` typed off `shared/types` where a domain type exists. Nuxt auto-imports them; no import lines in pages.

| Component | What it is | Notes |
|---|---|---|
| `UiTile` | the 92 px stat tile from the mockup | `label`, `value` (30 px/600, tabular), `sub`, optional `tone` |
| `UiCard` | `--surface` + 1 px `--line`, radius 12, no shadow | `title` slot with an optional count in `--muted` |
| `UiTable` | dense table, sticky header, `overflow-x: auto` wrapper | `th` 12 px uppercase `.06em`; `td` tabular; right-align via `align="r"` per column |
| `UiPill` | 24 px status pill | `tone: good \| warn \| bad \| neutral \| accent` |
| `UiButton` | 36 px on laptop, **44 px on phone** | `variant: primary \| ghost \| soft \| danger`; `pending` disables and shows the spinner |
| `UiSheet` | bottom sheet on phone, centred dialog ≥ 1024 px | traps focus, closes on Esc, one primary action |
| `UiField` | label + input/select/textarea + error line | numeric inputs get `inputmode="decimal"` and parse through `parseDecimalInput` |
| `UiSeg` | the segmented control (`Važno / Sve`, `Unutra / Bašta`) | `v-model`, options typed |
| `UiPeriod` | the period picker | presets **Danas · Jučer · Ova sedmica · Prošla sedmica · Ovaj mjesec · Prilagođeno**; two date inputs appear only on *Prilagođeno* |
| `UiAttentionRow` | one row of *Zahtijeva pažnju* | takes an `AttentionItem`; renders `title_bs`, the time, `amount_fen` and one `UiButton` per entry in `actions` |
| `UiMoney` | an amount | `formatKm(fen)`, tabular, `--danger` when negative, `--muted` when zero |

`UiPeriod` writes the period into the route query and reads it back, so a laptop tab is shareable and a reload keeps the range. `useAdminPeriod()` (WP0) owns the mapping: `?period=danas|jucer|ova-sedmica|prosla-sedmica|ovaj-mjesec` or `?from=YYYY-MM-DD&to=YYYY-MM-DD`, resolved to a `{ from, to }` pair of **business dates** through `shared/dates.ts` — never through `new Date().getHours()`.

`UiAttentionRow` is the one component with behaviour worth spelling out. It does not know any routes. It takes the item and asks the shared table:

```ts
const route = ATTENTION_ROUTES[item.ref_type]?.[action]   // '#shared/types/owner'
```

and posts to the filled-in path. The id-filling logic already exists server-side as `attentionTarget()` in `server/services/owner.ts`; WP0 lifts the ten lines of it into `shared/attention.ts` so both sides call one function, and `tests/unit/owner-live.test.ts` keeps passing because it imports the same function through the server file's re-export. That is the one shared-file addition Phase 2 makes, and it is append-only.

---

## 3. Six work packages

**File ownership is strict.** A path has exactly one owner. Creating a new file inside your own prefix is always fine; touching a file under another package's prefix — one line, a typo, a formatting fix — is not. WP0 is sequential and first; WP1–WP5 then run in parallel and never share a file.

Every package: branch `phase-2/<wp>`, one PR, `npm run typecheck && npm run test && npm run build` green before it is called done, and the done-when checked in a browser at both 390 px and 1440 px.

---

### WP0 — shell, kit, login, backend gaps *(sequential, first)*

**Files owned**

- `app/layouts/admin.vue`, `app/pages/admin/login.vue`, `app/pages/admin/vise.vue`
- `app/middleware/admin.ts`
- `app/composables/{useAdminApi,useAdminChanges,useAdminPeriod}.ts`
- `app/components/ui/Ui*.vue` (the eleven above)
- `app/utils/adminFormat.ts` — re-exports `formatKm` / `formatAmount` from `#shared/money` plus `dateBs()`, `dateTimeBs()`, `durationBs()`, so pages get them auto-imported
- `shared/attention.ts` (new), `tests/unit/admin-ui.test.ts`
- **Backend gaps only:** `server/api/{tables/state,prep/index,bootstrap}.get.ts` and one tag helper per service (§1.1); `shared/types/sync.ts` + `server/services/changes.ts` (§1.2); `server/api/auth/admin/login.post.ts`, `server/services/auth.ts` `adminLogin`, `shared/types/auth.ts` (§1.3)
- Three surgical edits outside the prefix, named in the PR body: `homeFor()` in `app/composables/useMe.ts` returns `/admin` for admins; the `raw` handler in `app/composables/useChanges.ts`; the deletion of the `changes[]` `me` sniff there.
- Tests to follow the backend changes: `tests/unit/{auth,api-shapes,etag,changes}.test.ts`

**Routes used:** `POST /api/auth/admin/login`, `POST /api/auth/logout`, `GET /api/me`, `GET /api/changes?since=`.

**Backend additions allowed:** exactly §1.1, §1.2 and §1.3. No new route, no new table, no migration.

**Done when:** logging in at `/admin/login` as `haris@lounge.ba / lounge` lands on an empty `/admin` with the copper "Puls" item active in the left nav at 1440 px and the four bottom tabs at 390 px; a hard reload keeps the session; visiting `/admin` as a waiter lands on `/konobar`; and `curl -I` on `/api/tables/state` shows an `ETag` header where it showed none.

---

### WP1 — Puls (`/admin`)

The live page, polled every 15 s. Everything on it comes from **one** read.

**Files owned:** `app/pages/admin/index.vue`; `app/components/puls/Puls*.vue` — `PulsTiles`, `PulsAttention`, `PulsFeed`, `PulsTableGrid`, `PulsFlags`, `PulsWhoStrip`.

**Routes used**

| Purpose | Route |
|---|---|
| everything on the page | `GET /api/owner/live` |
| the poll | `GET /api/changes?since=` (through `useAdminChanges`) |
| one-tap actions | `POST /api/adjustments/:id/decide` · `POST /api/tabs/:id/unpaid/decide` · `POST /api/cash-movements/:id/decide` · `POST /api/shifts/:id/settlements/:sid/accept` · `POST /api/shifts/:id/force-close` · `POST /api/stock/counts/:id/confirm` · `POST /api/stock/waste/:id/approve` — **never written literally in a component**, always resolved through `ATTENTION_ROUTES` |
| a table's detail | `GET /api/tabs/:id` |

**What it renders.** Six `UiTile`s across the top, in the mockup's order: *Promet danas* (`promet_danas_fen`), *Otvoreno* (`open.tables` stolova · `open.total_fen`), *Gotovina očekivano* (`expected_cash_fen`), *Storna / gratis* (`storna` / `gratis` as counts over amounts), *Ko radi* (`who[]` names, with "predao" on `settled` and an offline badge from `unsent`), *Neposlano* (`unsent.length` with the device label). Then **Zahtijeva pažnju** — `attention[]`, oldest first, one `UiAttentionRow` each, buttons *Odobri · Odbij · Bilješka* built from `item.actions`; a row disappears from the next poll once decided, and the count in the nav follows. Then `flags[]` in the same card but visually quieter, with **no buttons** — a flag is information and clears itself; never render a dismiss control. Then **Zadnje stavke**: `last_lines` (20), time · waiter · table · item · amount, voids in `--danger`, comps in `--warn`, free-text marked. Then **Stolovi**: `tables[]` in the `grid4` from the mockup, grouped *Unutra* / *Bašta* by `zone`, coloured by age — free (outline), < 1 h `--good-soft`, 1–3 h `--warn-soft`, > 3 h `--danger-soft` — with the legend row underneath. Tapping a table opens `GET /api/tabs/:id` in a `UiSheet`.

Empty state, verbatim: **"Još nema narudžbi večeras — prvi sto se pojavi ovdje čim ga konobar zaključi."**

**Backend additions allowed:** none.

**Done when:** with a shift open and one pending void, the void appears in *Zahtijeva pažnju* within 15 s of being requested on the phone, *Odobri* clears it from the list and the nav badge without a reload, and the *Storna* tile's count goes up by one.

---

### WP2 — Smjena and Smjene (`/admin/smjene`, `/admin/smjena/:id`)

**Files owned:** `app/pages/admin/smjene.vue`, `app/pages/admin/smjena/[id]/index.vue`, `app/pages/admin/smjena/[id]/stavke.vue`; `app/components/smjena/Smjena*.vue` — `SmjenaHeader`, `SmjenaWaiterStrip`, `SmjenaCashBox`, `SmjenaCounts`, `SmjenaAfterClose`, `SmjenaLines`, `SmjenaCategoryBar`.

**Routes used**

| Purpose | Route |
|---|---|
| the list | `GET /api/owner/shifts?from&to` → `OwnerShiftRow[]` |
| the page | `GET /api/owner/shift/:id` → `OwnerShift { shift, summary, by_user, cash_movements, settlements, counts, late_after_close }` |
| the written summary | `GET /api/owner/shift/:id/summary` |
| the drill-down | `GET /api/owner/shift/:id/lines?user=&kat=&cursor=` → `LinesPage` |
| card total **and** *Pregledano* | `POST /api/shifts/:id/review` `{ card_total_fen?, closing_note? }` |
| the drawer | `POST /api/shifts/:id/pickup` · `POST /api/shifts/:id/float` · `POST /api/shifts/:id/opening-float` · `POST /api/cash-movements/:id/decide` |
| settlements | `POST /api/shifts/:id/settlements/:sid/accept` · `POST /api/shifts/:id/force-close` |
| counts | `POST /api/stock/counts/:id/confirm` (the *Primijeni* button) |
| attention | the same `ATTENTION_ROUTES` set as WP1 |

**`/admin/smjene`** is a `UiTable` under a `UiPeriod`: datum · status · promet · razlika · a chevron. Status through `UiPill` — *otvorena* accent, *zatvorena* neutral, *pregledano* good.

**`/admin/smjena/:id`** follows the mockup top to bottom. Header: date, opened/closed times and the closer's name, a *pregledano · Haris 09:14* pill when `shift.status === 'reviewed'`, and *Izvoz* linking to `/admin/izvoz` pre-filtered to this shift. Then five `UiTile`s — *Pazar*, *Gotovina / kartica*, *Gratis · storna*, *Razlika gotovine* with the tolerance word (`u toleranciji` / `van tolerancije`, from `settings.cash_tolerance_fen` and `cash_tolerance_pct`), *Manjak robe*, *Lule* with g/lulu and žar/lulu.

**Per-waiter strip** — a `UiTable` over `by_user: UserSummary[]`: konobar, promet, stolovi, storna (count and amount), sati, predao, očekivano, ocjena (the tolerance word — **"označeno za razgovor", never an accusation**), napomena. Every category chip and every number in a row links to `/admin/smjena/:id/stavke?user=<id>&kat=<slug>`, which renders `LinesPage.rows` with times and statuses and pages on `next_cursor`.

**Kasa** — the cash box card: ostalo u kasi sinoć → početni polog → float in/out → payouts by status → refunds → expected → counted → diff, each row from `cash_movements[]`, pending ones carrying *Odobri / Odbij*. Settlements per waiter show the "u trenutku predaje −12,00 · sada −2,00" pair and *Prihvati* on self-sealed ones.

**Popisi** — `counts[]` as opening and closing cards with custodian, witness, variance and, when `status === 'submitted'`, a **Primijeni** button that posts the confirm.

**Nakon zatvaranja** — `late_after_close` when its count is non-zero: "3 stavke poslane nakon zatvaranja · 18,50 KM · Dino".

**Backend additions allowed:** none.

**Done when:** opening yesterday's closed shift shows a pazar that equals cash + card + unpaid from the same page's own rows, typing a card total and pressing *Pregledano* flips the header pill to *pregledano* and the row on `/admin/smjene` with it, and clicking a waiter's *Nargila 34* chip lands on `/admin/smjena/:id/stavke?user=…&kat=nargila` with 34 rows.

---

### WP3 — Roba (`/admin/roba/*`)

**Files owned:** `app/pages/admin/roba/index.vue`, `prijem.vue`, `popisi/index.vue`, `popisi/[id].vue`, `otpis.vue`, `artikal/[id].vue`, `nargila.vue`, `kategorije.vue`, `pocetno-stanje.vue`; `app/components/roba/Roba*.vue` — `RobaTabs`, `RobaStanjeTable`, `RobaPrijemForm`, `RobaPopisForm`, `RobaMovements`, `RobaReport`.

**Routes used**

| Tab | Route |
|---|---|
| Stanje šanka | `GET /api/owner/stock` → `OwnerStockReport` (and `GET /api/stock` for the live seq) |
| Prijem robe | `POST /api/stock/deliveries` · `GET /api/stock/deliveries?from&to` · `POST /api/stock/deliveries/:id/reverse` |
| Popisi | `GET /api/stock/counts?shift_id&status` · `GET /api/stock/counts/:id` · `POST /api/stock/counts` · `POST /api/stock/counts/:id/confirm` |
| Otpis | `POST /api/stock/waste` · `POST /api/stock/waste/:id/approve` |
| korekcije | `POST /api/stock/corrections` |
| artikal → kretanje | `GET /api/owner/stock/:id/movements?before&limit` → `ItemMovementsPage` |
| Nargila | `GET /api/owner/nargila?month=YYYY-MM` |
| Kategorije | `GET /api/owner/categories?from&to` |
| Početno stanje | `POST /api/stock/opening` |
| the catalogue behind every form | `GET /api/admin/stock-items` |

Six tabs across the top, per the mockup: **Stanje šanka · Prijem robe · Popisi · Otpis · Nargila · Kategorije**. *Stanje* is a `UiTable` — artikal, na stanju (through `formatStockQty`), paketi + komadi, status as a `UiPill` (*ok* / *nisko · minimum N* / *u minusu* / *bez cijene*) — with the four filter chips underneath: **U minusu · Bez cijene · Bez normativa · Kasno sinhronizovano**, each a client-side filter over the same rows plus its count.

*Prijem robe* is a **typed form only** — supplier, invoice number, date, then one line per item with packs / loose / `line_cost_fen`, a running total, and *Proknjiži*. The photo-scan flow in the mockup (`Prijem sa slike`, "Poveži / Novi artikal / Preskoči") is **Phase 4**: no upload control, no draft state, no `POST /api/uploads`.

*Popisi* lists counts and opens one; the create form builds the whole count client-side and posts it in one `POST /api/stock/counts` (§1.6), showing `variance_*` per line coloured `line-ok` / `line-warn` / `line-bad` and *Primijeni* on the submitted ones. A `422 NOTE_REQUIRED {item_ids}` highlights exactly those rows; a `409 PENDING_OUTBOX {devices}` names the phones.

*Početno stanje* sits under Roba, not under Postavke, and warns that it is one-time per item (`409 OPENING_LOCKED`).

**Backend additions allowed:** none.

**Done when:** posting a delivery of 24 Red Bull moves that item's *Na stanju* by +24 without a reload, its movement ledger at `/admin/roba/artikal/:id` shows the new `delivery` row at the top, and confirming a submitted count applies its variance and flips its pill to *potvrđeno*.

---

### WP4 — Meni & Postavke (`/admin/meni`, `/admin/postavke/*`)

**Files owned:** `app/pages/admin/meni/index.vue`, `app/pages/admin/postavke/index.vue`, `kategorije.vue`, `stolovi.vue`, `osoblje.vue`, `uredaji.vue`; `app/components/postavke/Postavke*.vue` — `PostavkeProductRow`, `PostavkeRecipeEditor`, `PostavkeTableGrid`, `PostavkeUserSheet`, `PostavkeDeviceRow`, `PostavkeSettingsForm`.

**Routes used**

| Screen | Route |
|---|---|
| Meni | `GET /api/admin/products` · `POST /api/admin/products` · `PATCH /api/admin/products/:id` · `PUT /api/admin/products/:id/recipe` |
| Kategorije | `GET/POST /api/admin/categories` · `PATCH /api/admin/categories/:id` |
| Stolovi i zone | `GET/POST /api/admin/tables` · `PATCH /api/admin/tables/:id` |
| Osoblje | `GET/POST /api/admin/users` · `PATCH /api/admin/users/:id` · `POST /api/admin/users/:id/pin` |
| Uređaji | `GET /api/admin/devices` · `PATCH /api/admin/devices/:id` · `POST /api/admin/devices/:id/revoke` · `POST /api/admin/devices/:id/unlock` · `POST /api/admin/enrol-codes` |
| Podešavanja | `GET /api/admin/settings` · `PATCH /api/admin/settings` |
| the stock items a recipe points at | `GET /api/admin/stock-items` |

**Meni** groups `ProductAdmin[]` by category. Each row: name, an **inline price field** that PATCHes on blur (with the standing warning "mijenjaj cijene prije otvaranja smjene"), an *Omiljeno* star capped at 12 across the whole menu, `active`, `staff_drink_allowed`, and a chevron into the recipe editor. The recipe editor is a `UiSheet` listing `RecipeLine[]` with stock item + qty per unit and one `PUT` that replaces the set atomically. Shisha products additionally carry **grams per bowl** with an *Izmjereno* marker.

**Stolovi** edits `col` / `row` (1..12), `zone` and `sort` as plain number fields beside a live preview of the grid — no drag-and-drop in Phase 2 — and surfaces `409 TABLE_HAS_OPEN_TAB` as "Sto ima otvoren račun" when a deactivate is refused.

**Osoblje** creates a person with name, initials (≤ 3), role and PIN; deactivates with `active: 0` (never deletes) and renders `400 SELF_DEACTIVATE` as "Ne možeš sebe deaktivirati"; resets a PIN through `POST /api/admin/users/:id/pin`. **No response ever contains a hash and no screen ever displays one.**

**Uređaji** lists `DeviceAdmin` rows with label, mode, bound user, last seen, app version, `pending_count`, `clock_skew_s`, and *Revoke* / *Otključaj*. *Novi uređaj* posts an enrol code and shows the six characters large enough to read across the bar, with its expiry.

**Podešavanja** is one form over `settingsSchema.partial()`, grouped: tolerancije (`cash_tolerance_fen`, `cash_tolerance_pct`, `variance_alert_fen`), storna (`void_self_window_s`, `self_void_max_per_shift`, `self_void_max_fen`), gratis (`comp_large_fen`, `comp_shift_fen`), otpis (`waste_pin_threshold_fen`, `waste_shift_fen`), isplate (`payout_owner_fen`, `payout_approver_roles`), nargila (`grams_per_bowl_default`, `gpb_band_pct`, `coals_per_bowl_alert`), uređaji (`heartbeat_fresh_s`, `clock_skew_alert_s`, `shared_device_idle_s`). Money fields are entered in KM and sent in feninga; a saved field shows a *sačuvano* pill for two seconds. **No Pravila editor** (§1.5) and no chat/roster settings (Phase 4).

**Backend additions allowed:** none.

**Done when:** changing a product's price to 4,50 KM and reloading `/konobar` shows the new price on the waiter's tile, and the change appears in `/admin/dnevnik` as a `price_changed` entry with the old and new amounts.

---

### WP5 — Dnevnik & Izvoz (`/admin/dnevnik`, `/admin/izvoz`)

**Files owned:** `app/pages/admin/dnevnik/index.vue`, `app/pages/admin/dnevnik/[id].vue`, `app/pages/admin/izvoz.vue`; `app/components/dnevnik/Dnevnik*.vue`, `app/components/izvoz/Izvoz*.vue`; **and the export backend** — `server/api/owner/export/{smjene,dnevni-pazar,stavke,popis}.get.ts`, `server/services/export.ts`, `shared/types/export.ts`, the four `ROUTE_ROLES` entries, `tests/unit/export.test.ts`.

**Routes used**

| Purpose | Route |
|---|---|
| the list | `GET /api/owner/log?before&after&kind&group&actor&from&to&important&limit` → `LogListResult` |
| one entry | `GET /api/owner/log/:id` → `LogEntryDetail` |
| the badge | `POST /api/owner/log/seen` |
| the filters' option lists | `GET /api/admin/users` (Osoba), `LOG_KINDS` from `#shared/logTemplates` (Vrsta) |
| the exports | the four new `GET /api/owner/export/*` |

**Dnevnik** is the who-did-what feed and is **owner-only** — nothing here ever appears in `/konobar`. Newest first, grouped by day and by shift, each row the `.entry` from the mockup: time, a 32 px icon tinted by kind (accent / good / bad), `title_bs` already rendered by the server, and the body's numbers as chips. A `UiSeg` toggles **Važno / Sve** (`important=1`); three filters — **Osoba · Vrsta · Period** — map to `actor`, `kind` and `from`/`to`. Paging is the keyset `before` cursor on scroll, never an offset. A *Završena smjena* card carries its category chips, and each one opens `/admin/smjena/:id/stavke?user=&kat=`. A decision entry renders the request it resolved inline ("✔ Riješio Haris · 09:41") and vice versa, straight off `LogEntryDetail.request` / `.resolver`. Opening the page posts `log/seen`, which clears the nav badge.

**Izvoz** is a card per file with a `UiPeriod` above them and a *Preuzmi* button each. Four files ship in Phase 2:

| File | Route | Rows |
|---|---|---|
| `smjene.csv` | `GET /api/owner/export/smjene?from&to` | one row per shift: datum, otvorena, zatvorena, promet, gotovina, kartica, gratis, storna, razlika, manjak robe |
| `dnevni_pazar.csv` | `GET /api/owner/export/dnevni-pazar?from&to` | one row per business day, with the footer line |
| `stavke.csv` | `GET /api/owner/export/stavke?from&to&full_names=0\|1` | one row per line item; **initials by default**, full names only with the explicit toggle |
| `popis.csv` | `GET /api/owner/export/popis?count_id` | one row per count line with variance and cost |

CSV rules, identical for all four and implemented once in `server/services/export.ts`: **UTF-8 with a BOM** (the byte-order mark `U+FEFF` as the first character, so Excel on a Bosnian Windows opens it without mangling č and ž), **`;` as the delimiter** (a comma is the decimal separator here), CRLF line endings, quotes doubled inside quoted fields, amounts written as `1250,50` with a comma and no thousands separator, dates as `08.09.2026.`, times 24 h. Every file ends with the footer line **`interni izvještaj — nije fiskalni`** in its own row — the disclaimer CLAUDE.md requires, in the file as well as on the page. `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="dnevni_pazar.csv"` (underscore in the filename, hyphen in the path — BACKEND §14.15 mandates hyphens in path segments and PLAN §11 names the files with underscores; both are honoured).

The four routes are **reads**: they take no body, mutate nothing, write no log entry and bump nothing, so `changes-coverage.test.ts` needs no exemption. They must be declared in `ROUTE_ROLES` as `A` or `route-roles.test.ts` fails in both directions.

**Backend additions allowed:** `server/api/owner/export/**` and `server/services/export.ts` only. WP5 may **read** through existing owner/summary services; it may not add a column, a table or a migration.

**Done when:** downloading `dnevni_pazar.csv` for *Ova sedmica* opens in a spreadsheet with correct diacritics and one row per day, its last row reads "interni izvještaj — nije fiskalni", and `/admin/dnevnik` filtered to *Važno · Dino · Danas* shows only Dino's non-quiet entries from today.

---

## 4. Shared conventions

Every package obeys all of these; a PR that breaks one is not merged.

**Language.** Bosnian (ijekavian) on screen, always, with no i18n layer and no English fallback. Labels come from `PLAN.md` §12 verbatim: *smjena, pazar, stanje šanka, prijem robe, popis, manjak / višak, otpis, sto, tura, storno, na račun kuće / gratis, na čekanju, odobri / odbij, zahtijeva pažnju, označeno za razgovor, u toleranciji / van tolerancije, riješio, napomena / bilješka, uzeo iz kase, isplata iz kase, početni polog, nargila / aroma / lula / žar, normativ, bez normativa / bez cijene / u minusu, kasno sinhronizovano, uređaji, dnevnik, važno / sve, period, sedmica.* An English word on a screen is a bug. The three verbs never mix: a waiter **zaključi** a round, **završi** his own shift, the bartender **zatvara** the venue's shift. Never *račun* for an order.

**Money.** Integer feninga end to end. Display through `formatKm(fen)` → `1.250,50 KM`, or `formatAmount(fen)` inside a table cell. A negative amount uses the real minus sign in prose and `--danger` in a cell. Never `toFixed`, never a float, never a currency `Intl` call.

**Dates and time.** `08.09.2026.` with the trailing dot; 24 h clock; `Europe/Sarajevo` for every rendered instant; the business day starts at 06:00. Nothing calls `getHours()` or `getDate()` — every conversion goes through `shared/dates.ts` or `app/utils/adminFormat.ts`. Months are *januar … decembar*, weekdays abbreviated *pon · uto · sri · čet · pet · sub · ned*.

**Numbers.** `font-variant-numeric: tabular-nums` on every column of figures, on every tile value, and on every input that holds one. Right-align amounts in tables.

**Touch.** Below 1024 px every interactive target is ≥ 44 px tall with ≥ 8 px between neighbours, primary actions sit in the lower part of the screen, and no action is gesture-only. On a laptop the kit's 36 px buttons and 24 px pills are correct.

**Icons.** Inline SVG from `KIT.md`, 24 px (20 px inside a chip), `stroke="currentColor"`, `stroke-width="1.8"`. **No emoji anywhere** — not in a label, not in a log title, not in a commit message.

**Accessibility and honesty.** Colour never carries meaning alone: a status is colour **and** a word. Loading states render a skeleton, not a spinner over stale numbers. An error renders `apiErrorText(err)`, which fills the placeholders from the error body. A screen that could not refresh says so rather than silently showing an old number.

**Privacy.** Per-person money appears only inside `/admin`, and only on the pages named here. Flags say "označeno za razgovor" and never accuse. There are no leaderboards and no rankings. `/admin` never renders the *Konobari* channel or anything from it.

**Comments.** Vedran is a junior Vue dev: two lines wherever a non-Vue concept first appears (ETag, keyset cursor, business day, tabular numerals, BOM). Comments and identifiers in English; strings in Bosnian.

---

## 5. The final walkthrough

One script creates a realistic night **through the API**, then a human walks the five pages against it. No fixtures, no seeded shortcuts: everything below goes in through the same routes a phone uses, so a green walkthrough proves the dashboard reads the real ledger.

### 5.1 `scripts/phase2-night.mjs`

Run against a dev server on a freshly seeded database:

```
rm -f data/sank.db*                # a fresh, seeded venue
npm run dev -- --port 3100         # terminal 1
node scripts/phase2-night.mjs      # terminal 2 (SANK_BASE overrides the port)
```

Plain `fetch` with a per-actor cookie jar, no test framework and no build step. It prints each step and ends with a summary of the ids it created and the `/api/owner/live` read they should produce. In order:

1. **Three waiters and a bartender, on four real devices.** Admin cookie first, via `POST /api/auth/admin/login` with `haris@lounge.ba / lounge`; then, per actor, `POST /api/admin/enrol-codes { mode: 'personal', bound_user_id, label }` as the admin, `POST /api/devices/enrol { code }` as the phone, and `POST /api/auth/pin` as the person — Amar, Lejla and Dino (waiters) and Emir (bartender), from the seed. **Not** `POST /api/dev/enrol`: that door reuses one shared dev device row and rotates its token on every call, so the second actor's enrol invalidates the first actor's cookie and the next request comes back `401 DEVICE_MISMATCH`. The script also sends `PATCH /api/admin/settings { payment_methods: ['cash', 'card'] }` here, because the seed venue takes cash only and step 4's card payment would otherwise be a `400 METHOD_NOT_ALLOWED`.
2. **The shift opens on the first lock** — no explicit open call, so the auto-open path is exercised.
3. **~12 orders.** `POST /api/orders`, each with a fresh `client_id`: four tables for Amar (including one shisha with two flavours), four for Lejla, three for Dino, one cross-waiter round; 30–60 s apart on `client_created_at` so the *Zadnje stavke* feed has a real order.
4. **Two payments.** `POST /api/payments` — one cash with change, one card — covering two of Amar's tables.
5. **One pending void.** Dino requests a storno on a **paid** line (`POST /api/adjustments`), left undecided so it lands in `attention[]` as `was_paid`.
6. **One unpaid tab.** `POST /api/tabs/unpaid` on one of Lejla's tables, reason `walked_out`, left `pending_review`.
7. **One payout above the owner threshold.** `POST /api/shifts/:id/payout` for 60,00 KM by Emir — a second `attention` row that needs the admin.
8. **A settlement.** Amar declares blind through `POST /api/shifts/:id/settle` with a `declared_fen` deliberately 4,00 KM short — inside tolerance, so the verdict word is *u toleranciji*.
9. **A submitted count.** `POST /api/stock/counts` with `kind: 'full'`, `phase: 'close'`, ~10 lines, three of them off tolerance, left **submitted** so *Primijeni* has something to do. Every line carries a `note`: a line outside tolerance without one makes the whole post the documented `422 NOTE_REQUIRED` naming the item ids.
10. **A delivery**, so Roba has a movement to show: `POST /api/stock/deliveries`, two lines with real `line_cost_fen`.
11. It does **not** close the shift. The walkthrough closes it by hand from the app, because closing is one of the things being verified.

### 5.2 The checks, page by page

**`/admin/login`** — wrong password shows a Bosnian sentence and no hint about which field; correct credentials land on `/admin`; a reload keeps the session; `/admin` in a private window redirects to `/admin/login`.

**`/admin` (Puls)** — six tiles; *Promet danas* equals the sum of the twelve orders minus the comp; *Otvoreno* matches the tables still open; *Zahtijeva pažnju* holds exactly three rows (void, unpaid tab, payout) oldest first; *Odobri* on the payout clears it within one poll and decrements the nav badge; *Zadnje stavke* shows the last twenty in reverse time order with the void in red; the table grid colours by age and its legend matches; a stale device shows in *Neposlano*; no flag has a button. At 390 px the tiles stack two-up and the bottom tabs are reachable with a thumb.

**`/admin/smjene` → `/admin/smjena/:id`** — the open shift is listed as *otvorena*; the header numbers reconcile (pazar = gotovina + kartica + nenaplaćeno); the per-waiter strip shows Amar as *u toleranciji* with a −4,00 diff and Dino with no settlement yet; a category chip opens `/stavke` with the matching row count; the cash box lists the 60,00 payout as approved after the Puls action; the submitted count shows *Primijeni*, and pressing it confirms and flips the pill; entering a card total and pressing *Pregledano* flips the header to *pregledano*.

**`/admin/roba`** — *Stanje šanka* shows the delivery's items with their new on-hand; the four filter chips count correctly and filter; opening an item shows the movement ledger newest first with the `delivery` row on top; *Popisi* lists the confirmed count with its variance; *Nargila* for the current month shows g/bowl inside the band; *Kategorije* for *Ova sedmica* shows nabavka vs prodaja per category.

**`/admin/meni` and `/admin/postavke/*`** — an inline price change persists across a reload and appears in the Dnevnik; the recipe editor saves and reloads identically; a new enrol code renders six characters and an expiry; deactivating yourself is refused in Bosnian; a settings change to `cash_tolerance_fen` changes the tolerance word on the Smjena page.

**`/admin/dnevnik` and `/admin/izvoz`** — the night's actions are all present, newest first, grouped by day; *Važno* hides the quiet kinds but keeps a decision that resolved one; the three filters compose; opening the page clears the badge and it stays cleared after a reload; the four CSVs download, open in a spreadsheet with correct diacritics and `;` columns, and each ends with the disclaimer row.

**Across all pages** — no English word anywhere; no emoji; every amount tabular and right-aligned; 390 px has no horizontal scroll except inside a table's own scroller; `npm run typecheck`, `npm run test` and `npm run build` green; the browser console clean.

---

## 6. Phase 2 is done when

All six work packages are merged to `main`, the walkthrough in §5 passes on a laptop and on a 390 px phone, the three backend gaps of §1.1–§1.3 are closed with their tests updated, the four export routes exist and are declared, and the owner has opened `/admin` on his own laptop once and found last night's shift without being told where to click.

Phase 3 (the waiter and bartender completion) and Phase 4 (chat, roster, receipt scanning, the Dnevnik's laptop table) start from there.
