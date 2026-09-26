# UI refresh — *Grafit i bakar*

**Status: decided 24.09.2026 (Vedran). S1 (tokens and font) landed 26.09.2026;
S2–S6 are not built yet.** The mockups are on the
design canvas <https://claude.ai/artifact/9fMgWT4J1aAmnkSBncnGMd> (private — ask
Vedran for access). `docs/DESIGN.md` still describes what is shipped; every slice
below updates it for the part it lands, so the two never disagree about the
running app.

The app was judged "good, but the details need work": the pain points were the
**cards** (a card inside a card, a bordered input box and a bordered button inside
that) and the **type** (every line at the same heavy 17 px, 24 px bold display
titles), plus a ground that reads **blue** like every other POS. This is a
refinement of the system in `DESIGN.md`, not a new one — the flows, routes, API
and copy do not move.

---

## 0. Read first

1. `docs/DESIGN.md` — the system this refines. Its rules still hold unless a line
   below replaces one.
2. `CLAUDE.md` — especially *Moja smjena is two things* and the end-of-shift rules;
   the screens below keep every one of them.
3. The canvas. Top row: now → proposal for *Zaključi smjenu*, *Moja smjena* and
   *Dodaj*. Second row: *Stolovi*, the *Sto* sheet, *Šank — narudžbe*. Third row:
   the palette/type board and a now-vs-proposal details board. Each proposal board
   has a `paleta` switch (grafit / sada) under Tweaks.

## 1. What changes, and what does not

**Does not change** (each one was decided, do not reopen it):

- **The waiter's menu tile.** `app/components/ProductTile.vue` keeps its layout: the
  square, the photo behind at 30 %, name and price on top, the copper count and the
  44 px "−" on the corners. Only the palette and the font reach it. A PR that
  changes its template or its scoped CSS is out of scope.
- ***Druga smjena* stays blue** on the floor plan: `--shift-b` `#5c8fd0` and its
  three companions keep their values.
- **Copper stays the one accent** and the colour of the main button.
- Dark staff screens, light `/admin`; the floor-plan geometry; every Bosnian label
  except the one new word in §4.3.

**Changes:** the ground (graphite, not blue-black), one UI font (Geist), a calmer
type scale, the grouped-list card, the header and its status pill, copper used on
fewer things, and five staff screens redrawn with those rules (§5).

## 2. Tokens — exact values

Value swaps: no token is renamed or removed and one is added (`--font-wordmark`,
§3), so `tests/unit/admin-ui.test.ts` keeps passing and every component moves with
the palette untouched.

### 2.1 Dark — `app/assets/css/main.css` (`@theme`)

| Token | Now | New |
| --- | --- | --- |
| `--color-bg` | `#0b0d11` | `#0f0f0f` |
| `--color-bg-2` | `#0f1116` | `#131313` |
| `--color-surface` | `#14171d` | `#191919` |
| `--color-surface-2` | `#1b1f26` | `#222222` |
| `--color-surface-3` | `#232830` | `#2c2c2c` |
| `--color-line` | `#2c323c` | `#2e2e2e` |
| `--color-line-soft` | `#21262e` | `#252525` |
| `--color-text` | `#f3f0ea` | `#f4f3f1` |
| `--color-text-2` | `#a9a8a3` | `#b3b1ae` |
| `--color-muted` | `#7a7d84` | `#8b8986` (4.9:1 on `surface`) |
| `--color-good` / `-soft` | `#63b89f` / `#12312a` | `#7cc493` / `#16271c` |
| `--color-warn` / `-soft` | `#e6b44f` / `#35290f` | `#ecc653` / `#2f2911` |
| `--color-scrim` | `rgb(6 8 11 / 0.72)` | `rgb(0 0 0 / 0.7)` |

Unchanged: the five copper tokens, `danger`, the four `shift-b` tokens and
`cat-1…5`. The mockups draw `line` as white at 9 %; the tokens stay **solid hex**
because several rules use `--line` as a fill (a divider, a pressed "−"), and a
translucent fill would change with whatever sits under it.

`warn` moves a little towards yellow so a late ticket or a waiting table never
reads as copper, and `good` loses its teal. `shared/brand.ts`:
`THEME_COLOR_DARK` → `'#0f0f0f'` (it must equal `--color-bg`).

### 2.2 Light — `app/assets/css/admin.css` (`[data-theme='light']`)

| Token | Now | New |
| --- | --- | --- |
| `--bg` / `--bg-2` | `#f2f0eb` / `#e7e4dd` | `#f4f4f2` / `#eaeae7` |
| `--surface` / `-2` / `-3` | `#fffdf9` / `#eae7e0` / `#f6f4ef` | `#ffffff` / `#efefec` / `#f7f7f5` |
| `--line` / `--line-soft` | `#d7d1c6` / `#e6e1d8` | `#deded9` / `#ebebe8` |
| `--ink` = `--text` | `#1a2327` | `#1b1b1a` |
| `--ink-2` = `--text-2` | `#46545a` | `#52524f` |
| `--muted` | `#6c797e` | `#737370` (4.8:1 on white) |
| `--good` / `-soft` | `#2f8a72` / `#dceee7` | `#2f7f55` / `#e0efe5` |
| `--warn` / `-soft` | `#a5720f` / `#f7ead0` | `#8a6e09` / `#f5edcf` (4.9:1 on white) |
| `--nav` | `#1b2427` | `#171717` |
| `--nav-well` / `--nav-line` / `--nav-on` | `#283134` / `#313b3e` / `#32393b` | `#232323` / `#2e2e2e` / `#2a2a2a` |
| `--nav-ink` / `--nav-muted` / `--nav-item` | `#ece8e0` / `#949c9f` / `#bfb9ae` | `#f1f0ee` / `#9a9895` / `#c4c2be` |
| shadows | `rgb(26 35 39 / …)` | `rgb(27 27 26 / …)`, same alphas |

Unchanged: copper, `danger`, `--nav-on-ink`, `--offline-ink`, `--field-bg`,
`cat-1…5`. `shared/brand.ts`: `THEME_COLOR_LIGHT` → `'#171717'` (it must equal `--nav`).

## 3. Type

- **Geist** replaces IBM Plex Sans for everything: in `nuxt.config.ts` the css2 URL
  loads `family=Geist:wght@400;500;600;700` in place of Plex, and Bricolage
  Grotesque stays at 700 for **the wordmark only** (`.wordmark`). Checked on
  24.09.: Geist has real tabular figures (with `tabular-nums`, `1111` and `0000`
  are the same width), ships `latin-ext` (č ć š ž đ), and its latin subset
  carries U+2212, the minus sign the money uses.
- `--font-sans`: `"Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`.
- **`--font-display` points at Geist too.** Twelve components read it directly:
  `UiPageHead`, `UiTile`, `UiSheet`, `FloorTable`, the Puls cards, the admin rail
  and a few more. Re-pointing the token moves all of them with no edit, so page
  titles, key numbers and avatar initials become Geist 600. A new
  **`--font-wordmark`** holds Bricolage Grotesque. `.wordmark` (the PIN screen),
  `.a-brand-name` (the rail) and the wordmark on `/admin/login` switch to it, and
  they are the only places it is used.
- **The dark scale gets calmer** — the one density change in the refresh:

  | Step | Now | New | Used for |
  | --- | --- | --- | --- |
  | `--text-title` | 24 | **20** / 1.2 / −0.01em | a screen title in the header |
  | `--text-section` | 19 | **17** / 1.3 | a sheet title, a ticket's lines |
  | `--text-body` | 17 | **16** / 1.45 | rows, buttons, inputs (≥ 16 keeps iOS from zooming) |
  | `--text-metric` | 30 | **28** / 1.1 / −0.02em | the one key number on a screen |
  | `label` 14, `micro` 13, `caption` 12, `display` 40 | — | unchanged | |

  `admin.css` keeps its own restatement (24 px page titles at a desk); only the
  family changes there.
- Weights: 400 for text, 500 for values and buttons, 600 for titles and the key
  number, 700 only inside count badges.
- Section labels are the existing `.eyebrow` shape: 12 px, 600, uppercase, 0.07em,
  `--muted` — one letter-spacing, not the nine hand-rolled ones the audit found.
- **Check on the real phone.** 17 px was chosen for arm's length in a dark room
  (`DESIGN.md` §1). If 16 fails that test in the café, rows go back to 17 and
  everything else stays.

## 4. The rules the screens are built from

### 4.1 Section → one card → rows

A section is a label **outside** the card, one card (`surface`, 1 px `line`, radius
`--radius-card`), and rows inside it: 48–56 px, a `line-soft` hairline between
rows, inset 16 px, no hairline above the first. **No card inside a card**, and no
bordered box inside a card except an input. In rows:

- values right-aligned and tabular; amounts **without** "KM" — the total carries
  the unit, set at 16 px `ink-2` beside the figure;
- a subtraction shows U+2212 before the amount (`−90,00`), never an en dash before
  the label;
- a row at 0,00 is `--muted`, label and value, so the eye skips it;
- an action row ("+ Dodaj plaćanje") is a full-width row button in `--ink` with the
  icon in `--ink-2` — not copper, not a separate bordered button.

New: `app/components/ui/UiSection.vue` (label, optional right-hand note, slot) and
`.list` / `.list-row` in `main.css` for the inset hairline. The unused `.row`,
`.tile`, `.panel` and `.well` go (the audit found 0 uses of each).

### 4.2 The header

`WaiterHeader` keeps its slots and its 64 px. The title is `--text-title` in
`--font-sans` 600; the second line becomes a sentence at 13 px `ink-2` ("Druga
smjena · 8 otvorenih stolova"), not the uppercase eyebrow. Back target 44 px.
`SankerHeader` follows, being `WaiterHeader` with a right slot.

### 4.3 The status pill

`WaiterSyncChip` **always shows a word**. The lone ✓ it showed when synced read as a
save button.

| State | Full (`aria-label`, *Stolovi*) | Compact (other headers) |
| --- | --- | --- |
| ok | Sinhronizovano | **Na vezi** (new — add to `PLAN.md` §12) |
| waiting | Čeka slanje (n) | Čeka (n) |
| offline | Nema veze — narudžbe se čuvaju / — čeka slanje (n) | Nema veze / Nema veze (n) |

Shape: a 30 px pill on `surface-2` with a `line-soft` edge, a 7 px dot in
`good` / `warn` / `danger`, text 13 px 500 `ink-2`. Colour + dot + word, as
`DESIGN.md` §2 requires.

### 4.4 Copper, and the other buttons

Copper **fills** exactly three kinds of thing:

1. **The one main button on a screen** — *Zaključi*, *Zaključi smjenu*, *Naplati i
   očisti*, *Gotovo* on the first ticket only (the others are secondary).
2. **The person's own things** — the avatar, the count badge on a menu tile, the
   person's own unsent draft on the plan.
3. ***Prva smjena* tables** (by slot, as shipped).

Everything else that is copper today goes neutral: the VIP box, the šank counter's
edge and stools, the floor's copper tint, the `SankerNav` marker, *Na redu* on
`TicketCard`, and any copper text link. The active category chip on *Dodaj* is an
`ink` fill with `bg`-coloured text, not a copper tint.

Secondary = `surface-2` + 1 px `line`. Quiet = `surface-2`, no border, `ink-2`,
used for the tertiary row on the table sheet.

### 4.5 One dark sheet

`app/components/StaffSheet.vue` — the bottom-sheet chrome the staff screens have
copied by hand about eighteen times (four different max heights, five that lose the
home-indicator padding, three with no Escape):

- the grab handle;
- a header row: title + sub, optional actions, and a 40 px round × on the right;
- a scrolling body;
- a sticky footer with `env(safe-area-inset-bottom)`;
- `useSheetDismiss` for Escape and scroll lock.

`UiSheet` stays the light `/admin` sheet.

### 4.6 The summary bar

Sticky at the bottom, `surface` with a `line` top edge. On the left, the label
(14 px `ink-2`) with a muted line under it. On the right, the key number
(`--text-metric`, with KM at 16 px `ink-2`), then the primary button:

- ***Zaključi smjenu*:** *Za predati*, the formula "1.284,50 − 184,00", then the
  full-width button under them.
- ***Dodaj*:** "4 stavke", the running total, and *Zaključi* to the right.

### 4.7 Icons

One stroke icon set for the staff screens (24 grid, 1.75 stroke, `currentColor`),
extending `UiIcon` rather than starting a second component. The icons: back,
close, check, plus, minus, search, chevron up/down, clock, move, shield, trash,
receipt, bottles, cup, flame, cloud-off. The 61 inline SVGs (35 files) are
replaced as each screen is touched, not in one sweep.

## 5. The screens

| Screen | Files | What changes |
| --- | --- | --- |
| *Zaključi smjenu* | `app/pages/sanker/zakljuci.vue` | Section **Obračun smjene** (Sav prihod, then Dnevnica, Otpis, Rashod, Policija, Osoblje as minus rows, zeros muted) with one caption under it. Section **Plaćeno iz pazara**: Merkator as a row with a 40 px right-aligned input, each *Dodatna plaćanja* line as a row with a ×, then "+ Dodaj plaćanje" (opens the existing sheet). Summary bar with *Za predati*. A negative total stays `danger`, as it is today. Server-owned numbers and the request body do not change. |
| *Moja smjena* | `app/pages/konobar/moja-smjena/index.vue` | Section **Prodano večeras** with "n artikala". Rows: `12×` (tabular, `ink-2`), name, amount. Under it a card *Ukupan pazar* and one muted caption. Still exactly two things (CLAUDE.md), no second number. |
| *Dodaj* | `app/pages/konobar/dodaj/[id].vue` | Header title = the table ("Sto 7"), sub "Unutra · nova tura". The separate "Sto 7 · Unutra ›" row goes, because *Nazad* already does its job. Search field on `surface-2`, active chip `ink`. Summary bar. **`ProductTile.vue` untouched.** |
| *Stolovi* | `app/pages/konobar/index.vue`, `FloorRoom.vue`, `FloorTable.vue`, `FloorPlan.vue` | Header with the pill and the avatar. `UiSeg` + "+ Sto". Flat `bg-2` floor with a faint dot grid and a `line` edge for both zones: no floorboards, no copper tint, no green tint. *Bašta* keeps its dashed fence. VIP box dashed `muted`. Tiles 11 px radius, number 17/600, amount 10.5/600. Legend = the two shift colours (as shipped). |
| *Sto* sheet | `app/components/waiter/WaiterTableSheet.vue` | On `StaffSheet`. Header "Sto 7" with a sub line built from what the sheet already has: zone and whose tab, plus the time it opened if the tab state carries it. No new API field. Then "+ Dodaj" and ×. Then *Za naplatu* as the key number and section **Ture**: rounds as rows in one card, and an open round lists its lines inline with hairlines instead of a nested card. Footer: *Naplati i očisti* (primary), *Samo naplati — gosti ostaju* (secondary), then the reason buttons as quiet buttons with icons — three for a table (*Premjesti · Policija · Rashod*), 2×2 for *Bez stola* (*Premjesti · Rashod · Otpis · Osoblje*). |
| *Šank — narudžbe* | `app/pages/sanker/index.vue`, `TicketCard.vue`, `SankerNav.vue` | Every ticket the same card. The first one says *Na redu* in `ink` and is the only one with a copper *Gotovo*. The age turns `warn` when late. Lines 17 px with the quantity at 700. `SankerNav` marker and active icon in `ink`. |
| Everything else | — | Picks up §2–§4 through the tokens, the header, the pill and the sheet. No redesign. |
| `/admin` | `admin.css` | The tokens do nearly all of it. Page titles become Geist 600 through `--font-display` (§3). |

## 6. Work slices

One PR each, in this order. Opus implements, Fable reviews. Every PR carries
before/after screenshots at 390 px (and 1440 px for anything that touches `/admin`).

1. **S1 — Tokens and font.** The files:
   - `main.css` and `admin.css`
   - `nuxt.config.ts`
   - `shared/brand.ts`
   - the three wordmark rules in `layouts/admin.vue` and `pages/admin/login.vue`
   - `DESIGN.md` §1–§2

   It changes values only. After it, every screen is graphite and Geist with its
   layout unchanged. This is the PR that touches the most screens, and the easiest
   to review.
2. **S2 — Primitives.** `UiSection` + `.list-row`, `WaiterHeader`,
   `WaiterSyncChip`, `StaffSheet`, the summary bar, the icon set. `DESIGN.md` §3,
   §4, §10.
3. **S3 — Copper and the floor plan.** §4.4 across `FloorRoom`, `FloorTable`,
   `SankerNav`, `TicketCard` and the *Dodaj* chips; the flat floor. Fix the
   unsent-draft tile too if that task has not landed: `.mine.draft` in
   `FloorTable.vue` matches nothing since the tiles went by shift.
4. **S4 — The five staff screens** of §5, one or two PRs.
5. **S5 — The remaining sheets onto `StaffSheet`.** Order, adjust, waiter and
   stock sheets, plus the inline sheets in `sto/[id].vue` and `zakljuci.vue`.
6. **S6 (optional) — `/admin` duplicates** from the audit: the ~20 scoped
   `.p-error` / red-box copies, the dashed empties, and the three period pickers.

**Done when**, for every slice:

- `npm run build`, `npm run typecheck` and `npm test` are green.
- The phone-viewport check is done.
- For S1 and S4, the staff screens were looked at on a real phone in the dimmed
  café.
- `git diff --stat app/components/ProductTile.vue` is empty.

## 7. Review checklist

- [ ] One copper fill per screen for the action. Everything else copper is the
  person's own thing or a *Prva smjena* table.
- [ ] No card inside a card; section labels sit outside their card.
- [ ] Amounts are tabular, minus is U+2212, rows carry no "KM", zero rows are muted.
- [ ] No state is an icon alone. The pill always has its word.
- [ ] *Druga smjena* is still `#5c8fd0`. `ProductTile.vue` is unchanged.
- [ ] No hex outside `main.css`, `admin.css` and the two constants in `shared/brand.ts`.
- [ ] Copy unchanged except *Na vezi*, which is in `PLAN.md` §12.
