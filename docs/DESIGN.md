# DESIGN.md — the Servio design system

The product is used at midnight by a waiter holding a phone in one hand while
carrying a tray in the other, and the next morning by the owner at a laptop
reading four-digit numbers in a table. It has to feel like a considered
hospitality product, not a bootstrap admin panel.

Everything below is implemented. The tokens live in **`app/assets/css/main.css`**
(the dark theme, and the whole `@theme` block), the light theme's value swap in
**`app/assets/css/admin.css`**. No page and no component writes a hex value; a
card that is nearly the right grey is how an app stops looking like one thing.

**Two themes, one system.** The dark theme owns `:root`. The light theme
redefines the *same names* under `[data-theme='light']`. Every shared component
class is written against the names, so a `.card` is structurally the same object
in `/konobar` and in `/admin` and differs only in material. The waiter's dark
screens and the owner's light dashboard both stay — this is a refinement of
both, never a re-theme of one into the other.

---

## 1. Typography

**Bricolage Grotesque + IBM Plex Sans.** Bricolage carries the voice — a
contemporary grotesque with a real optical-size axis, so a 40 px wordmark is
*drawn* for 40 px instead of being a blown-up UI face — while IBM Plex Sans
carries every sentence and, crucially, every digit: it has true tabular figures,
which is the one thing a product made almost entirely of money and quantities
cannot do without.

Both are loaded once, app-wide, in `nuxt.config.ts`. `--font-sans` and
`--font-display` name real system fallbacks, so a phone that cannot reach Google
Fonts renders the same layout at the same sizes rather than a broken one.

- `--font-display` — the wordmark, page titles, big numbers, avatar initials.
- `--font-sans` — everything else, and **every digit without exception**.

### The scale

Six steps plus one numeric readout. Line height and tracking are part of the
step: a 40 px heading at line-height 1.5 is not a heading. Each step is a
Tailwind utility (`text-display`, `text-title`, …) that carries all three
values, so a page never writes `text-[15px]` again.

| Token | Size | Line height | Tracking | Used for |
| --- | --- | --- | --- | --- |
| `--text-display` | 40 px | 1.02 | −0.035em | the wordmark, a hero number |
| `--text-title` | 24 px | 1.16 | −0.02em | a page title, a person's name |
| `--text-section` | 19 px | 1.30 | −0.01em | a card heading, a group label |
| `--text-body` | 17 px | 1.50 | 0 | sentences, list rows, buttons |
| `--text-label` | 14 px | 1.35 | 0.005em | a field label, a secondary line |
| `--text-caption` | 12 px | 1.30 | 0.08em | the eyebrow, a role, a timestamp |
| `--text-metric` | 30 px | 1.05 | −0.02em | **a money or quantity readout** |

The ratio is roughly 1.22 at the top and 1.14 at the bottom, because the small
end of a UI scale needs more steps than a geometric ratio gives it.

Weight is deliberately **not** in the token — pick it with `font-semibold` /
`font-bold`, or use one of the semantic classes that bundle family, step and
weight: `.wordmark`, `.page-title`, `.section-title`, `.eyebrow`, `.metric`.

The dark theme's body is 17 px (read at arm's length, in a dark room, in a
hurry); `/admin`'s is 15 px (read at a desk, in daylight, in quantity). That is
the only density difference between the two themes.

### Numbers

`.num` on every amount, every quantity, every clock time, no exceptions —
tabular figures give each digit the same width, so a column of prices lines up
on the decimal comma and `12,00` does not jump when it becomes `13,00`. `.metric`
already includes it. Money is always formatted through `shared/money.ts`
(`formatKm` / `signedKm`), never with a template string, and negatives use the
real minus sign U+2212 so a tabular column keeps its alignment.

---

## 2. Colour

### Dark — waiter, bartender, the lock screen

The old palette was a flat near-black with a mixed hue and one copper on top of
it; the result read as mud. The new ground is a **cool near-black with a real
hue around 220°**, laid out as a four-step ladder where each step is a visible
level of elevation, and the ink on it is **warm** off-white. That opposition is
what keeps the copper from looking like an accident.

| Token | Value | It is |
| --- | --- | --- |
| `--bg` | `#0b0d11` | the page |
| `--bg-2` | `#0f1116` | an inset well: a scroller, a pad recess |
| `--surface` | `#14171d` | a card, a sheet, a header |
| `--surface-2` | `#1b1f26` | a row, an input, a key inside a card |
| `--surface-3` | `#232830` | the top step: pressed, hovered, selected |
| `--line` | `#2c323c` | a border you are meant to see |
| `--line-soft` | `#21262e` | a rule between two rows of the same thing |
| `--ink` / `--text` | `#f3f0ea` | headings, values, anything read first |
| `--ink-2` / `--text-2` | `#a9a8a3` | labels, secondary lines |
| `--muted` | `#7a7d84` | captions, the eyebrow, disabled |

**Two borders, not one.** `--line` draws an edge; `--line-soft` separates two
rows and should barely register. Boxing every row in `--line` is exactly what
makes a dark UI look like a spreadsheet.

**Copper is reserved.** It marks the primary action and *the person's own
state* — his avatar, his row, his table — and nothing else.

| Token | Value | It is |
| --- | --- | --- |
| `--accent` | `#d68a5f` | a **fill**; `--on-accent` ink goes on it |
| `--accent-text` | `#eda877` | the same copper as **text or icon** on a dark surface (4.5:1 on `--surface`) |
| `--accent-soft` | `#2a1a10` | a tinted ground behind accent meaning |
| `--accent-line` | `#4d3220` | the border of a selected element |
| `--on-accent` | `#180d05` | what goes on an accent fill |

Never set copper as text with `--accent`; that is what `--accent-text` is for.

**Meaning is separate from the accent**, so "this is mine" and "this is fine"
are never the same colour: `--good #63b89f`, `--warn #e6b44f`,
`--danger #e5736e`, each with a `-soft` background companion. Colour never
carries the meaning alone — a pill always contains the word too, because a
colour-blind owner and a printed screenshot have to read the same thing.

**A chart's colours are not meanings either.** `--cat-1` … `--cat-5` are five
hues that are none of the meaning colours and none of the copper, and every
chart draws its categories from them in order. A stacked bar that reached for
`--accent` and then `--good` said "this one is mine" and "this one is fine"
about two categories whose only difference was where they landed in a sorted
list. The five are re-valued for paper in `admin.css` like every other token.

### Light — `/admin`

Warm paper kept, contrast tightened for dense tables: `--bg #f2f0eb`,
`--surface #fffdf9`, `--ink #1a2327` (≈14:1 on the card, which is what a column
of four-digit amounts at 13 px needs), `--line #d7d1c6` with `--line-soft
#e6e1d8` for table rows. The copper is deepened to `#ad5730` so white on it
clears 4.5:1, and `--accent-text #8a4525` is the copper that works as ink on
paper. The dark nav rail keeps its own small ladder (`--nav`, `--nav-well`,
`--nav-ink`, `--nav-muted`) because it is the one piece of dark material in the
light theme.

---

## 3. Space and shape

**One rhythm, 4 px.** `--spacing: 4px` is Tailwind's base, so the whole scale
derives from it: `p-2` is 8, `gap-3` is 12, `py-6` is 24. Stay on
**4 / 8 / 12 / 16 / 24 / 32 / 48**. Inside a component, 8–12; between components
in a column, 16; between groups, 24.

**A radius per kind of thing**, not a t-shirt scale, so the reason survives
being copied into a new component:

| Token | Value | Because |
| --- | --- | --- |
| `--radius-field` | 10 px | an input must still read as a slot |
| `--radius-control` | 14 px | a button and a keypad key are pressed, so they are softer |
| `--radius-card` | 16 px | a card holds content, so it is softer again |
| `--radius-panel` | 20 px | a panel holds cards, and must not read as one |
| `--radius-sheet` | 22 px | the top corners of something arriving from below |
| `--radius-chip` | 999 px | a chip, a pill, an avatar |

**Elevation is material, not shadow.** On a dark UI a light drop shadow is
invisible and a heavy one is mud, so depth is a step up the surface ladder plus
a border. Shadows exist for exactly two things that genuinely float:
`--shadow-pop` (a toast, the lock screen's panel) and `--shadow-sheet`.

**Targets.** 48 px minimum on `/konobar`, `/sanker` and `/stanje` — that is a
thumb, on a phone, standing up. 44 px on `/admin` at a laptop, and 44 px there
too for anything inline in a dense row; below 1024 px `/admin` goes to 44 as
well. `.btn` is 48 by default, `.btn-lg` 56 for the one action a screen is
about, and `.btn-sm` — the inline one — reads `--tap`, so it is 48 on the phone
screens and 44 on the dashboard, never less. **A text link with an underline is
not a control**: an action inside a row is `.btn-sm`, which has a box.

**The primary action bar on a phone** is `.action-bar`: sticky to the bottom,
with the list scrolling under a gradient in the page's own ground, and its
bottom padding is `12px + env(safe-area-inset-bottom)` so nothing sits under an
iPhone's home indicator. Full-height screens use `100dvh`, not `100vh`, and the
base layout already applies both safe-area insets.

---

## 4. Components

Every primitive below is a class in `main.css`, in `@layer components` — below
Tailwind's utilities, so a utility on the same element always wins
(`class="card border-accent"` really does draw a copper border).

| Class | Structure | Dark | Light |
| --- | --- | --- | --- |
| `.btn` + `.btn-primary` / `.btn-secondary` / `.btn-ghost` / `.btn-danger`; sizes `.btn-lg` `.btn-sm` | 48 px, `--radius-control`, 8 px gap, scales to 0.97 on press | primary = ink on copper; secondary = `--surface-2` + `--line`; ghost = outline only; danger = `--danger-soft` ground with danger ink | same shapes, white on copper, 44 px on a laptop via `UiButton` |
| `.card` / `.card-2` / `.card-3` / `.panel` / `.well` / `.surface` | the surface ladder as containers | `--surface` → `--surface-3` with a `--line` edge | paper → white card with a warm rule |
| `.chip` / `.chip-good` `-warn` `-danger` `-accent`; `.pill` / `.pill-on` | chip is a 12 px status marker; pill is the same shape as a 44 px **target** | soft grounds on the dark ladder | soft tints on paper |
| `.input`, `.input-num` | 48 px slot, `--radius-field`; the numeric variant is 60 px, centred and tabular | `--surface-2` with a `--line` edge | white field with a warm rule |
| `.sheet-scrim` + `.sheet-panel` | bottom sheet on a phone, centred dialog ≥1024 px (`UiSheet`) | `--surface` over a 0.72 scrim, `--shadow-sheet` | same, lighter scrim |
| `.row` | 56 px, `--line-soft` under it, **no box** | | |
| `.tile` | eyebrow / value / quiet second line; the value is `.metric` | | |
| `.avatar` (+ `-sm` `-lg` `-accent`) | initials in a circle in the display face | material by default, **copper only for the person himself** | same rule |
| `.empty` | a dashed card that says what is missing and what to do | never an empty box | |
| `.note` / `-good` `-warn` `-danger` | the inline sentence a screen says back | soft ground, semantic ink | |
| `.toast` | fixed, above the thumb, `--shadow-pop`, fades up | | |
| `.eyebrow`, `.wordmark`, `.page-title`, `.section-title`, `.metric` | the type steps with family and weight attached | | |

`/admin`'s Vue primitives (`UiButton`, `UiCard`, `UiPill`, `UiTile`, `UiField`,
`UiSheet`, `UiTable`, `UiMoney`, `UiSeg`) keep their own scoped CSS; they read
the same tokens, so they moved with the palette without being touched.

---

## 5. Motion

Small and tasteful. Three curves and four durations, all tokens:

- `--ease-out-soft` (`cubic-bezier(.22,1,.36,1)`) — the default: leaves fast,
  settles. This is what makes a sheet feel physical.
- `--ease-in-soft` for something leaving, `--ease-standard` for a state change.
- `--dur-tap` 90 ms (press feedback), `--dur-fast` 140 ms (colour and state),
  `--dur-base` 200 ms (a toast, a fade), `--dur-sheet` 260 ms (a sheet arriving).

The vocabulary is three things and no more: a **sheet** slides 12 % up and fades
in; a **tap** scales the surface to 0.97; a **state change** cross-fades colour.
Nothing on a list animates its position, because a row that moves under a thumb
mid-tap is a wrong order.

**Under `prefers-reduced-motion: reduce` every duration collapses to 1 ms and
every animation to one iteration.** Switched off, not merely shortened — but the
*end state* still applies, because a sheet that never opens is worse than a
sheet that opens instantly.

---

## 6. Copy voice (Bosnian, ijekavian)

- **Calm.** No exclamation marks anywhere. No slang, no jokes, no emoji — icons
  are inline SVG.
- **Buttons name the action**, in the imperative, and say what will happen:
  *Naplati*, *Završi smjenu*, *Prijavi uređaj*. Never *OK*, never *Pošalji* when
  it means *Naruči*.
- **Errors say what to do next**, not what went wrong internally: *"Nema veze —
  prijava traži internet"*, *"PIN je zaključan. Pokušaj ponovo za 45 s."* If
  there is nothing to do, say how long: a countdown, not a shrug.
- **Never accuse.** *"označeno za razgovor"*, never *"greška konobara"*.
- **Second person singular** (*ti*), because everyone in the café is on first
  names. The wordmark stays a nominative noun no sentence has to decline.
- **The wordmark lives in one file**, `shared/brand.ts` (`APP_NAME`,
  `APP_TAGLINE`, `APP_DESCRIPTION`), re-exported by `app/utils/brand.ts` for
  auto-import. Renaming the product is one string. The folder, the repo,
  `data/sank.db`, the `sank_*` cookies and the docs keep their identifiers —
  renaming a wordmark is a string, renaming an identifier is a migration.

---

## 7. The login screen, as the proof

`app/pages/index.vue`, `app/pages/ekran.vue` and
`app/components/WaiterPinPad.vue` are the system used end to end. Screenshots:
`docs/design-shots/` and `docs/design-shots/prijava/`.

**One composition, two widths.** A centred column, 420 px wide at most: the mark,
the wordmark at `--text-display`, an `.eyebrow` third line, one panel, and
nothing else. At 390 px the panel is the width of the screen; at 1440 px it is
the same card floating on a copper wash. Nothing stretches and there is no gap
in the middle for the eye to fall into.

**Hierarchy in three steps.** 40 px wordmark → 12 px letterspaced caps → 19 px
panel heading → 14 px muted sub. The third line is the venue's own name, in
copper — the one thing on the screen that belongs to the café rather than to the
product. Before the first sign-in this browser has no session, so the line says
what the app is instead of leaving a hole where the hierarchy should be.

**The panel is the pad, and there is nothing else in it.** No faces, no
*Ostali profili*, no role buttons: **the PIN identifies the person**, so a
screen that drew the staff list would hand a stranger holding an enrolled phone
the one thing the pad refuses to ask. What used to be a list of 132 px profile
tiles is gone, and with it *Nastavi kao …* — a live session is forwarded to its
own screen rather than asked whether it meant it.

**The pad.** 68 px keys (72 from 640 px up) in a 328 px block that sits inside a
thumb's arc, `--surface-2` on `--surface`, pressing to `--surface-3` at 0.95
scale. The two corner keys — *Obriši* and the backspace — have no material behind
them, so the nine digits read as one block. The dots fill copper and grow 15 %,
and there are four of them because every account in the café has four; a refused
four grows the row to six and adds a *Potvrdi*, which is the only way a pad that
cannot ask whose PIN it is may accept a six-digit one. The lockout is its own
warn-toned strip with the seconds counting down in tabular figures, because a
locked pad with no clock on it is indistinguishable from a broken one.

**The enrol path** is two labelled fields and one primary button — the code field
is `.input-num`, 60 px, centred and letterspaced. It is deliberately secondary:
one quiet foot row (*Ovaj telefon nije prijavljen?*) and the place a `NO_DEVICE`
from the pad lands, because it is the once-a-year case and the pad is the screen.

**The chooser, `/ekran`.** *Na čemu si večeras?* — the second step, and the only
one behind the PIN. The 56 px avatar, an `.eyebrow` greeting and a 24 px
question, then two `--radius-card` tiles, 112 px stacked on a phone and 148 px
side by side from 560 px, each carrying the screen's name at `--text-section` and
one muted line of what is on it. The greeting is the point of the name: the pad
asked nobody who he was, so this is the first place the session says whose it is,
and *Nisam ja — odjavi se* is the foot row for when the answer is wrong.

**The landing rule lives in one place**: `shared/landing.ts`, through `homeFor()`
in `useMe.ts`. An owner lands on `/admin`; a worker lands on the screen he chose,
and on the chooser when he has not chosen one.

---

## 8. The dashboard, as the second proof

`/admin` is the same system in the other material. Screenshots, before and
after: `docs/design-shots/admin/`.

**Density is a value, so it swaps with the palette.** `admin.css` now restates
the type steps as well as the colours — seven of them, 12 → 28, because a table
of four-digit amounts read at a desk needs more rungs at the bottom of the ladder
than a phone held at arm's length does:

| Step | Light | Dark | Used for |
| --- | --- | --- | --- |
| `--text-caption` | 12 | 12 | a column header, an eyebrow, a timestamp |
| `--text-micro` | 13 | — | a second line under a row, an inline meta |
| `--text-label` | 14 | 14 | a table cell, a field label, a small button |
| `--text-body` | 15 | 17 | a row, a sentence, a button, an input |
| `--text-section` | 16 | 19 | a card heading |
| `--text-title` | 24 | 24 | the page title |
| `--text-metric` | 28 | 30 | the number a tile is about |

`--text-micro` exists only under `[data-theme='light']`, so **it must not be
used outside `/admin`** — a dark screen reading it would get no size at all.
Ten and eleven pixels survive in exactly two places, both inside the dark rail
(a badge's digits, a tab's label), and both are furniture rather than text.

**Elevation on paper.** `main.css` sizes its shadows for a dark room, where a
shadow has to be nearly black to register; dropped onto warm paper the same
values read as soot. The light theme restates `--shadow-pop` and
`--shadow-sheet` in the ink colour at a low alpha and adds two of its own:
`--shadow-card`, one hairline of contact shadow so a card sits *on* the page
rather than being a rectangle drawn on it, and `--shadow-raise` for a tile under
the pointer. A rule alone is what makes a light dashboard look like a
spreadsheet; a real drop shadow is what makes it look like 2014.

**The rail is grouped and the current row is not a copper slab.** Eight flat
rows is a list of links; three labelled groups (*Lokal*, *Ljudi*,
*Podešavanje*) is a product with a shape. The current page used to be filled
solid copper, which put the loudest colour in the theme on screen permanently
and left nothing louder for the one button a page is about; it is now a raised
well (`--nav-on`) with a copper spine and copper ink (`--nav-on-ink`). The rail
carries the same mark the lock screen does, at a rail's size, and its foot is a
venue block, the crossing link to `/konobar`, and the owner's own name in a
circle.

**One page head, one tab strip.** `UiPageHead` replaced fifteen hand-written
copies of the same `font-size: 28px` title: an eyebrow (which part of the app),
the title (which screen) and a sub line (the state of it), with a slot for the
page's buttons and one for a drill-down's way back. *Roba* drew its tabs as a
segmented well and *Meni i postavke* drew its as copper pills — two ideas of the
same thing in one product; both are now an underlined bar whose only colour is
the copper rule under the current tab.

**Tiles lead with the number.** The unit sits beside the figure at label size
instead of on a line of its own ("86,00" with "KM" under it reads as two facts,
and it is one), the figure is the display face at `--text-metric`, and the
second line says something the number does not. The eyebrow has a floor height
so a row of tiles keeps one baseline whether or not a given tile wraps.

**The attention list reads as work to do**: a tone marker on the left saying
what *kind* of decision this is, the title at row weight, and the buttons on a
right-hand rail so the whole column of them lines up. The flags underneath moved
into a well — one step *down* the ladder from the decisions above them: same
card, visibly not the same job. An empty list is good news and looks like it.

**A `UiTable` is a list, not a spreadsheet**: `--line` under the sticky header,
`--line-soft` between rows, the first cell carrying the weight, and `flush` on
the card so the table reaches its edges instead of wasting the two columns it
needed.

Targets: 44 px on a laptop (38 px buttons plus their row's padding), 44 px for
everything below 1024 px, and every input 16 px on a phone so iOS does not zoom
the page on focus.

---

## 9. Rules for the next screen

1. No hex values outside `main.css` and `admin.css`. If a colour is missing, add
   a token. The one exception is the pair in `shared/brand.ts` that paints the
   browser's own chrome — a `<meta>` tag cannot read a custom property — and
   each of those names the token it must equal.
2. No ad-hoc font sizes. Use a step, or add one here first — and add it to
   `main.css`, which declares every name. `admin.css` only re-values them, so a
   step invented there alone is a shared primitive with no size on the dark
   screens.
3. `.num` on every digit that is money, a quantity or a time.
4. Targets come from `var(--tap)`: 48 px on the phone screens, 44 px on
   `/admin`. Read the token rather than writing either number.
5. Copper for the primary action and for the person's own state. Nothing else.
6. Depth is a surface step plus a border. Reach for a shadow only when something
   really floats.
7. Every animation goes through a `--dur-*` token, so reduced motion switches it
   off for free.
8. Bosnian on screen, English in the code, no emoji, icons inline SVG.

---

## 10. One primitive per job

Screens are allowed to build a primitive the system lacks, inside their own
components folder, as long as it is written against the tokens and listed here.
Three redesign branches did exactly that in parallel, so three of them arrived
twice. They have been folded together; this is the record of where each landed,
because the useful part is the *rule*, not the history.

**The segmented control is `app/components/ui/UiSeg.vue`.** `/konobar` had built
`WaiterSeg` — one track, one thumb that slides — for the zone on the floor plan,
the phase on *Brzi popis* and the week on *Raspored*, all of which had been drawn
as two full-width copper buttons, and two primary-looking buttons are not a
control, they are two actions competing with whatever they sit above. `/admin`
had `UiSeg`, an inline pill. They are one component now: `UiSeg` with a `block`
prop for the full-width sliding form. The thumb is **material, never copper** —
choosing which half of the room to look at is neither a primary action nor the
person's own state — and the segments stay plain `<button aria-pressed>` rather
than `role="tab"`, because nothing here controls a tabpanel.

**The dark page header is `WaiterHeader`.** `SankerHeader` is that component with
the sync chip and the avatar passed to its `right` slot — a usage, not a second
implementation.

**Every bottom sheet is `.sheet-scrim` + `.sheet-panel`**, and behaviour comes
from `useSheetDismiss`. Seventeen dark sheets had each hand-written the same
chrome and drifted: `bg-black/55` beside `bg-black/60`, `rounded-t-[20px]` beside
`rounded-t-2xl`, three different max heights, and not one of them closed on
Escape or locked the page behind it the way `/admin`'s `UiSheet` always had.

**Hit targets come from `--tap`** — 48 px in `main.css`, 44 px in `admin.css`. A
shared primitive reads the token and is correct in the area it renders in,
instead of guessing from the viewport width. This is what makes `UiButton` and
`UiField` safe to use on `/konobar/raspored`.

**The floor plan is drawn twice, on purpose.** `/konobar`'s `FloorPlan` +
`FloorTable` and `/admin`'s `puls/PulsFloor` + `puls/PulsFloorTable` lay the room
out by the same rule — one stack per `col`, ordered by `row`, shorter stacks
centred, a `grp` in its own dashed box — and that rule lives in neither of them:
it is `floorZones()` in `app/utils/puls.ts` and the catalogue's own coordinates.
What differs is what a tile *says*, and it is a different question on each
screen: a waiter's asks *is this mine* (copper, or a colleague's initials), the
owner's asks *how much is on it and how long has it been there*. Sharing one
component would have meant a prop that switches the tile's whole content, and
the two also run in opposite materials — `/konobar` is dark, `/admin` is light,
and the two never share a CSS rule (§2). Two components against one geometry is
the smaller duplication.

**Left alone on purpose:** `FloorTable.vue` and `ProductTile.vue` keep their
scoped CSS. Each is used by exactly one screen, and a component with one caller
is where its own layout belongs — the system owns what is shared, not everything
that exists.
