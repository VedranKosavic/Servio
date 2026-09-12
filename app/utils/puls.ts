/**
 * The logic behind *Puls*, kept out of the templates.
 *
 * Everything here is a **pure function**: an argument in, a value out, no
 * `fetch`, no `ref`, no component. That is what makes it testable in
 * `tests/unit/puls.test.ts` without a browser, and it is where the rules that
 * are easy to get quietly wrong live — which shift the café is in now, which one
 * it just finished and which one comes next; what a shift actually sold; and
 * which body a decide route wants.
 *
 * Files in `app/utils/` are auto-imported by Nuxt exactly like composables, so
 * no component below writes an `import` line for any of this.
 */
import type {
  AttentionAction,
  AttentionRefType,
  LineRow,
  LiveRostered,
  LiveWho,
  ShiftTemplateView,
  TableState,
  VenueTable,
  Zone,
} from '#shared/types'
import { durationBs } from './adminFormat'

// ---------------------------------------------------------------------------
// The one-tap decisions
// ---------------------------------------------------------------------------

/**
 * **Nothing on `/admin` calls the three functions below tonight.**
 *
 * *Puls* used to end in one row — `PulsOdluke` — that opened the decisions
 * waiting to be made, and the owner asked for that row and its whole logic to
 * go. Two of its buttons were the only door in the app to their route
 * (`POST /api/tabs/:id/unpaid/decide` and `POST /api/shifts/:id/force-close`),
 * so those two decisions now have nowhere to be made from a screen.
 *
 * What is kept here is the *vocabulary*, because it is the part that cannot be
 * re-derived by reading a route: three decide routes that each mean something
 * different by *Odobri*, and one that refuses to run without a written sentence.
 * It is under test in `tests/unit/puls.test.ts`, so whichever screen is given
 * those doors deliberately later finds the contract intact rather than guessing
 * at it a second time. Nothing here posts anything, and nothing here is
 * rendered.
 */

/**
 * What the route behind *Odobri* / *Odbij* / *Bilješka* wants in its body.
 *
 * The **path** comes from `attentionTarget()` in `shared/attention.ts` and is
 * never written here; this is the other half — the one field each of those
 * routes validates. They do not share a vocabulary, and that is deliberate
 * rather than untidy: a storno is `applied | rejected` because it either
 * happened or it did not, a payout is `approved | rejected` because it is a
 * request, and an unpaid tab is `otpis | naplatiti` because the owner is not
 * approving anything — he is choosing whether the café eats the money or goes
 * after it. Approving *the waiter's request* to write a tab off is `otpis`;
 * refusing it means somebody has to collect, which is `naplatiti`.
 *
 * A `waiter_settlement` note is `POST /api/shifts/:id/force-close`, whose body
 * requires a written reason — see `decisionNeedsNote`.
 */
export function decisionBody(
  refType: AttentionRefType, action: AttentionAction, note?: string,
): Record<string, unknown> {
  const written = note?.trim() ? { note: note.trim() } : {}

  switch (refType) {
    case 'line_adjustment':
      return { outcome: action === 'approve' ? 'applied' : 'rejected', ...written }
    case 'tab':
      return { outcome: action === 'approve' ? 'otpis' : 'naplatiti', ...written }
    case 'cash_movement':
      return { outcome: action === 'approve' ? 'approved' : 'rejected', ...written }
    case 'waiter_settlement':
      // `approve` accepts an envelope (an empty body); `note` force-closes the
      // shift over a waiter who went home, and that one is not optional.
      return action === 'note' ? { note: note?.trim() ?? '' } : {}
    case 'stock_count':
    case 'waste_event':
      return written
  }
}

/**
 * True when the route refuses to run without a written reason, so the screen
 * has to ask for one before it posts anything.
 *
 * Exactly one pair qualifies: closing a shift over a waiter who has not handed
 * his envelope in. `forceCloseBody` requires three characters or more, and a
 * decision that heavy should carry a sentence anyway.
 */
export function decisionNeedsNote(
  refType: AttentionRefType, action: AttentionAction,
): boolean {
  return refType === 'waiter_settlement' && action === 'note'
}

/** The shortest note `POST /api/shifts/:id/force-close` will take. */
export const NOTE_MIN = 3

// ---------------------------------------------------------------------------
// Which shift it is
// ---------------------------------------------------------------------------

/**
 * One of the venue's shifts, as the screen names it.
 *
 * `name` is the template's own word — *Prva smjena*, *Večernja* — and
 * `ordinal_bs` is the owner's way of asking for it ("first or second shift").
 * Both come out of the roster's `shift_templates`, because a café that adds a
 * third shift must not have to have this file edited.
 */
export interface ShiftWindow {
  id: string
  /** The template's own name: "Prva smjena". */
  name: string
  /** Where it sits among the venue's active shifts, 1-based. */
  index: number
  /** "prva smjena", "druga smjena" — what the owner calls it. */
  ordinal_bs: string
  /** "07–15", with an en dash, from the template's own wall clock. */
  hours: string
  start_time: string
  end_time: string
}

/**
 * Which calendar day a shift that is not running belongs to, read against the
 * clock we asked about — not against the business date, which still calls 03:00
 * yesterday. *Sljedeća smjena je u 07:00* is **sutra** at half eleven at night
 * and **danas** at five in the morning, and that is the answer a person reading
 * a phone wants.
 */
export type ShiftDay = 'juce' | 'danas' | 'sutra'

/** A shift the clock is not inside: the one before it, or the one after it. */
export interface ShiftTurn {
  window: ShiftWindow
  day: ShiftDay
  /** Minutes until it starts (`next`), or since it ended (`last`). */
  minutes: number
}

/**
 * Where the café is in its own day: the shift that is running, the one that
 * ended most recently, and the one that starts next.
 *
 * `current` is null between shifts and through the night — which is exactly when
 * the screen shows `last` instead, so *Puls* always has two shifts to draw and
 * never an empty state.
 */
export interface ShiftClock {
  current: ShiftWindow | null
  last: ShiftTurn | null
  next: ShiftTurn | null
}

const ORDINALS_BS = ['prva', 'druga', 'treća', 'četvrta', 'peta', 'šesta'] as const

const DAY_MIN = 24 * 60

/** `"16:00"` → `960`; anything else → null, so a bad row is skipped, not guessed. */
function minutesOf(hhmm: string): number | null {
  const parts = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (!parts) return null
  const h = Number(parts[1])
  const m = Number(parts[2])
  return h < 24 && m < 60 ? h * 60 + m : null
}

/** `"16:00"`–`"01:00"` → `"16–01"`; a template with real minutes keeps them. */
function hoursBs(start: string, end: string): string {
  const trim = (t: string) => (t.endsWith(':00') ? t.slice(0, -3) : t)
  return `${trim(start)}–${trim(end)}`
}

/** How far `at` is from `mark` on a 24 h circle, in minutes. Never negative. */
function circularGap(at: number, mark: number): number {
  const gap = Math.abs(at - mark)
  return Math.min(gap, DAY_MIN - gap)
}

/**
 * The venue's shifts, in the roster's own order, with the unreadable and the
 * retired rows dropped.
 *
 * Inactive templates are not shifts anybody works, so they go before the ordinal
 * is counted — otherwise retiring the morning shift would leave the evening one
 * still called "the second".
 */
function activeWindows(templates: ShiftTemplateView[]): ShiftWindow[] {
  return templates
    .filter(t => t.active && minutesOf(t.start_time) !== null && minutesOf(t.end_time) !== null)
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
    .map((t, i) => ({
      id: t.id,
      name: t.name,
      index: i + 1,
      ordinal_bs: `${ORDINALS_BS[i] ?? `${i + 1}.`} smjena`,
      hours: hoursBs(t.start_time, t.end_time),
      start_time: t.start_time,
      end_time: t.end_time,
    }))
}

/** How long a window lasts, in minutes. `end <= start` means it runs past midnight. */
function spanOf(window: ShiftWindow): number {
  const start = minutesOf(window.start_time)!
  const end = minutesOf(window.end_time)!
  return end <= start ? end + DAY_MIN - start : end - start
}

/**
 * Is the wall clock inside this window?
 *
 * The start is inclusive and the end is not, which is what makes 15:00 the first
 * minute of *Druga smjena* rather than the last of *Prva* — the two templates
 * meet on that minute and exactly one of them may own it.
 *
 * `end <= start` is read as "ends the next day", the same reading
 * `plannedHours()` in `shared/dates.ts` gives it, so a café that closes at 01:00
 * needs no change here.
 */
function contains(window: ShiftWindow, at: number): boolean {
  const start = minutesOf(window.start_time)!
  return (at - start + DAY_MIN) % DAY_MIN < spanOf(window)
}

/**
 * Where the café is in its own day — the two cards *Puls* draws, worked out from
 * the roster's templates and the café's wall clock.
 *
 * **Nothing here is an empty state.** The café runs *Prva smjena* 07–15 and
 * *Druga* 15–23, so between 23:00 and 07:00 no template owns the clock. That is
 * not a screen with nothing on it: it is the night, when what the owner wants is
 * the shift that just finished and the one that starts in the morning. So this
 * answers three things and the page picks two of them — `current` and `next`
 * while a shift is running, `last` and `next` when none is.
 *
 * - `current` — the window the clock is inside, or null.
 * - `next` — the window whose start comes soonest **after** now. A window
 *   starting exactly now is the current one, so its own next turn is a full day
 *   away and it does not shadow the other shift.
 * - `last` — the window whose end came most recently, counting 0 as "just
 *   ended": at 23:00 sharp, *Druga smjena* has this second finished.
 *
 * `atHhmm` is a wall clock in the café's own zone — `localTime()` from
 * `shared/dates.ts`, never `getHours()`, which answers in whatever zone the
 * laptop happens to be set to.
 */
export function shiftClock(templates: ShiftTemplateView[], atHhmm: string): ShiftClock {
  const at = minutesOf(atHhmm)
  const windows = activeWindows(templates)
  const empty: ShiftClock = { current: null, last: null, next: null }
  if (at === null || windows.length === 0) return empty

  // The first window that owns the minute wins, so two overlapping shifts read
  // in the roster's own order.
  const current = windows.find(w => contains(w, at)) ?? null

  let next: ShiftTurn | null = null
  let last: ShiftTurn | null = null

  for (const window of windows) {
    const start = minutesOf(window.start_time)!
    const end = minutesOf(window.end_time)!

    // Until it starts again. A gap of nothing means it is starting this minute —
    // which is the shift that is running, and its *next* turn is tomorrow.
    const ahead = ((start - at) % DAY_MIN + DAY_MIN) % DAY_MIN || DAY_MIN
    if (!next || ahead < next.minutes) {
      next = { window, day: start > at ? 'danas' : 'sutra', minutes: ahead }
    }

    // Since it ended. Zero is honest here: at 23:00 the evening has just ended.
    const behind = ((at - end) % DAY_MIN + DAY_MIN) % DAY_MIN
    if (!last || behind < last.minutes) {
      last = { window, day: end <= at ? 'danas' : 'juce', minutes: behind }
    }
  }

  return { current, last, next }
}

/**
 * Which shift a timestamp belongs to — how a shift that has already been worked
 * is named.
 *
 * The clock alone cannot answer that: a shift row carries the minute it was
 * opened, and a bar that opened at 15:04 or ran twenty minutes over is still
 * *Druga smjena*. So the window that contains the minute, and failing that the
 * window with the nearest edge — which keeps a night opened at 23:20 on the
 * evening shift instead of handing it to a morning that had not started.
 */
export function shiftWindowFor(
  templates: ShiftTemplateView[], atHhmm: string,
): ShiftWindow | null {
  const at = minutesOf(atHhmm)
  const windows = activeWindows(templates)
  if (at === null || windows.length === 0) return null

  const inside = windows.find(w => contains(w, at))
  if (inside) return inside

  let best: ShiftWindow | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const window of windows) {
    const distance = Math.min(
      circularGap(at, minutesOf(window.start_time)!),
      circularGap(at, minutesOf(window.end_time)!),
    )
    if (distance < bestDistance) {
      bestDistance = distance
      best = window
    }
  }
  return best
}

/**
 * What the café has taken on the open shift, in feninga.
 *
 * Not a number this screen invents: `summarizeShift` refuses to write a
 * summary unless `Σ by_user.promet_fen === promet_fen` (it throws
 * `SUMMARY_MISMATCH` rather than return), and `live.who` **is** that
 * `by_user` fold for the shift *Puls* is looking at. So adding the rows up is
 * the shift's promet by an invariant the server checks, and it is the shift's
 * rather than the whole business day's — `promet_danas_fen` sums every shift on
 * the date, which on a day with a *Dnevna* behind it is not what the owner is
 * watching.
 */
export function shiftPrometFen(who: LiveWho[]): number {
  return who.reduce((sum, person) => sum + person.promet_fen, 0)
}

// ---------------------------------------------------------------------------
// Ko radi
// ---------------------------------------------------------------------------

/**
 * What one row of *Ko radi* says about a person tonight.
 *
 * - `radi` — the plan has him on and he has signed on. The ordinary case.
 * - `ceka` — the plan has him on and nobody has PIN-ed in as him yet. Before
 *   the shift starts that is simply "not yet"; an hour in it is worth a look,
 *   and the card leaves that judgement to the person reading it rather than
 *   turning into an accusation at a threshold nobody published (PLAN §8).
 * - `planiran` — a shift that is not running. There is no fact to compare the
 *   plan against, so the row is the plan and nothing more.
 * - `bolest` / `odsutan` — the owner marked the day in *Raspored*.
 * - `van-rasporeda` — he is working and the plan does not have him. Not a
 *   flag: covers get arranged by phone all the time. It is on the card because
 *   *Ko radi* that does not name somebody standing behind the bar is wrong.
 */
export type WhoState = 'radi' | 'ceka' | 'planiran' | 'bolest' | 'odsutan' | 'van-rasporeda'

export interface WhoRow {
  user_id: string
  name: string
  initials: string
  state: WhoState
  /** He has handed his envelope in. Only ever true on the running shift. */
  settled: boolean
}

/** One shift of today's plan, with its people. */
export interface WhoShift {
  template_id: string
  name: string
  /** "15–23", from the hours snapshotted on the assignment. */
  hours: string
  running: boolean
  rows: WhoRow[]
}

/**
 * *Ko radi* — today's plan, with tonight's fact laid over the shift that is
 * running.
 *
 * The card used to be `live.who` alone, which is the list of people who have
 * signed on. That answered "who is ringing things up" and not "who is working
 * today": at ten in the morning, before anybody has touched a phone, it was
 * empty, and the owner's plan for the day was two taps away on another screen.
 *
 * So the rows come from *Raspored* and the live list is folded into them:
 *
 * - a planned person who has signed on is `radi`;
 * - a planned person who has not is `ceka`;
 * - somebody signed on whom the plan does not have is added as
 *   `van-rasporeda`, because a card called *Ko radi* has to name him;
 * - every other shift of the day is drawn as plan only.
 *
 * The running shift comes first and the rest keep the roster's own order, which
 * is the template `sort` — the morning before the evening.
 *
 * `running` is the window the money card is about, so the two cards always
 * agree about which shift the screen is describing. It is passed in rather than
 * derived here because `shiftClock()` has already worked it out, including the
 * bar that is still open at half eleven and belongs to a window that has ended.
 */
export function whoShifts(
  rostered: LiveRostered[],
  who: LiveWho[],
  running: { id: string, name: string, hours: string } | null,
): WhoShift[] {
  const signedOn = new Map(who.map(person => [person.user_id, person]))
  const shifts = new Map<string, WhoShift>()

  // A shift the plan has nobody on still gets a group, so the people who turned
  // up without being on it have somewhere to be drawn and the card can say the
  // plan for tonight is empty.
  if (running) {
    shifts.set(running.id, {
      template_id: running.id,
      name: running.name,
      hours: running.hours,
      running: true,
      rows: [],
    })
  }

  for (const person of rostered) {
    const shift = shifts.get(person.template_id) ?? {
      template_id: person.template_id,
      name: person.template_name,
      hours: hoursBs(person.start_time, person.end_time),
      running: false,
      rows: [],
    }
    shifts.set(person.template_id, shift)

    const live = signedOn.get(person.user_id)
    shift.rows.push({
      user_id: person.user_id,
      name: person.name,
      initials: person.initials,
      state: person.status === 'sick'
        ? 'bolest'
        : person.status === 'absent'
          ? 'odsutan'
          : !shift.running
              ? 'planiran'
              : live ? 'radi' : 'ceka',
      settled: shift.running && (live?.settled ?? false),
    })
  }

  // Whoever is working and is on nobody's plan. They belong to the shift that is
  // running — it is the one they are working — and to no other.
  const current = running ? shifts.get(running.id)! : null
  if (current) {
    const planned = new Set(current.rows.map(row => row.user_id))
    for (const person of who) {
      if (planned.has(person.user_id)) continue
      current.rows.push({
        user_id: person.user_id,
        name: person.name,
        initials: person.initials,
        state: 'van-rasporeda',
        settled: person.settled,
      })
    }
  }

  // The running shift first; everything else keeps the roster's order, which the
  // server has already sorted by the template's own `sort`.
  return [...shifts.values()].sort((a, b) => Number(b.running) - Number(a.running))
}

/** The word on a row's pill, and nothing at all for the ordinary case. */
export function whoStateBs(state: WhoState): string {
  switch (state) {
    case 'ceka': return 'nije prijavljen'
    case 'bolest': return 'bolest'
    case 'odsutan': return 'nije došao'
    case 'van-rasporeda': return 'van rasporeda'
    default: return ''
  }
}

// ---------------------------------------------------------------------------
// The floor plan
// ---------------------------------------------------------------------------

/**
 * One tile of the room, with everything the template needs already resolved.
 *
 * **There is no age band on it any more.** The tiles used to be tinted in three
 * shades by how long the guests had been sitting, with a five-word legend under
 * the plan; the owner asked for the waiter's plan instead — *"we can now remove
 * all the reservations, etc.. all should be same color"* — so a tile is either
 * occupied or free and nothing else. The age survives as words, in the tile's
 * accessible name and in the sheet that opens when it is tapped, which is where
 * a number belongs when it is not a colour.
 */
export interface PulsFloorCell {
  table_id: string
  tab_id: string | null
  /** The number alone: every tile would otherwise say "Sto". */
  label: string
  /** The whole name, which is what the sheet's title says. */
  name: string
  /** `"48 min"`, `"1 h 40"`, or empty for a free table. */
  age: string
  remaining_fen: number
  /** The initials or the name of whoever holds the tab. */
  waiter: string
  /** *naplata čeka* — somebody has to look at this one. */
  pending_review: boolean
}

/** The VIP pair and anything like it: its own dashed box under its column. */
export interface PulsFloorGroup {
  name: string
  cells: PulsFloorCell[]
}

/** One vertical run of tables along a wall. */
export interface PulsFloorColumn {
  col: number
  cells: PulsFloorCell[]
  groups: PulsFloorGroup[]
  /**
   * A piece of the room that is not a table, drawn at the foot of this run —
   * today only the bar. See `FIXTURES`.
   */
  foot?: string
}

export interface PulsFloorZone {
  zone: Zone
  label: string
  columns: PulsFloorColumn[]
  /** How many of this zone's tables have guests at them. */
  busy: number
  total: number
}

/** The two words the floor plan is split by. */
export function zoneLabel(zone: Zone): string {
  return zone === 'basta' ? 'Bašta' : 'Unutra'
}

/** "Sto 7" → "7". */
function shortLabel(name: string): string {
  return name.replace(/^sto\s+/i, '')
}

/**
 * The room from above, drawn exactly the way the waiter's `FloorPlan` draws it.
 *
 * **Two reads, and why.** `GET /api/owner/live` carries a `TableState` per
 * table — who is sitting there, for how long, for how much — but no name, no
 * zone and no coordinates: those belong to the catalogue, which every screen in
 * the app already gets from `GET /api/bootstrap` and which changes about twice
 * a year. So the live read stays small and this joins the two by id.
 *
 * The geometry is the catalogue's and never this file's: one vertical stack per
 * `col`, ordered by `row`, the stacks spread across the width in `col` order,
 * and a table with a `grp` (today only the VIP pair) in its own box under the
 * column it belongs to. Add a table to the database with the right col/row and
 * it appears here. A table the live read has nothing to say about is drawn
 * **free** rather than dropped — a room with a hole in it is not the room.
 */
/**
 * The room's architecture: what is on the plan and is not a table.
 *
 * The café has one piece of it — **the bar, at the bottom of the left-hand
 * run** — and drawing it is what turns three columns of squares into a picture
 * of a place. Without it the plan has no landmark at all: every tile looks like
 * every other tile and the owner has to remember which end of the grid is the
 * door and which is the counter.
 *
 * It is a constant and not a row in `tables`, because it is not a table: it
 * seats nobody, opens no tab and can never be tapped. The honest place for it
 * eventually is a `fixtures` table alongside `tables`, so a café that moves its
 * bar does not need a deploy — worth doing the day a second venue exists, and
 * not before.
 *
 * Keyed by zone and column, so it moves with the schematic rather than being
 * positioned in CSS.
 */
const FIXTURES: Partial<Record<Zone, Record<number, string>>> = {
  unutra: { 1: 'Šank' },
}

export function floorZones(
  states: TableState[], catalogue: VenueTable[], nowMs: number,
): PulsFloorZone[] {
  const state = new Map(states.filter(s => s.table_id).map(s => [s.table_id!, s]))

  function toCell(table: VenueTable): PulsFloorCell {
    const live = state.get(table.id)
    const openedAt = live?.tab_id ? live.opened_at : null
    return {
      table_id: table.id,
      tab_id: live?.tab_id ?? null,
      label: shortLabel(table.name),
      name: table.name,
      age: openedAt ? durationBs((nowMs - Date.parse(openedAt)) / 1000) : '',
      remaining_fen: live?.remaining_fen ?? 0,
      waiter: live?.assigned_to_initials ?? live?.opened_by_name ?? '',
      pending_review: live?.pending_review ?? false,
    }
  }

  // `unutra` before `basta`, which is how the room reads, rather than whatever
  // order the catalogue happened to arrive in.
  const order: Zone[] = ['unutra', 'basta']

  return order.flatMap((zone) => {
    const tables = catalogue.filter(t => t.zone === zone)
    if (!tables.length) return []

    const cols = [...new Set(tables.map(t => t.col))].sort((a, b) => a - b)
    const columns = cols.map((col) => {
      const inColumn = tables.filter(t => t.col === col)
      const groupNames = [...new Set(inColumn.filter(t => t.grp).map(t => t.grp!))]
      return {
        col,
        cells: inColumn.filter(t => !t.grp).sort((a, b) => a.row - b.row).map(toCell),
        groups: groupNames.map(name => ({
          name,
          cells: inColumn.filter(t => t.grp === name).sort((a, b) => a.row - b.row).map(toCell),
        })),
        foot: FIXTURES[zone]?.[col],
      }
    })

    const cells = columns.flatMap(c => [...c.cells, ...c.groups.flatMap(g => g.cells)])
    return [{
      zone,
      label: zoneLabel(zone),
      columns,
      busy: cells.filter(c => c.tab_id).length,
      total: cells.length,
    }]
  })
}

// ---------------------------------------------------------------------------
// Small words
// ---------------------------------------------------------------------------

const WEEKDAYS = ['ned', 'pon', 'uto', 'sri', 'čet', 'pet', 'sub'] as const

/**
 * `"2026-09-11"` → `"pet"`.
 *
 * A **business date** is already the café's own day — the one that starts at
 * 06:00 in Sarajevo — so it must never be pushed through a timezone a second
 * time. `Date.UTC` on its three numbers is what keeps this answer the same on a
 * laptop left on UK time as on the one behind the bar.
 */
export function weekdayBs(businessDay: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(businessDay)
  if (!parts) return ''
  const day = new Date(Date.UTC(+parts[1]!, +parts[2]! - 1, +parts[3]!)).getUTCDay()
  return WEEKDAYS[day] ?? ''
}

/**
 * What the pill on a shift card says.
 *
 * Two words at most, because the card already carries the shift's name above it
 * and its hours below: the pill's whole job is *is this still running*. A colour
 * never says it alone — there is always the word in the pill (DESIGN §2).
 */
export function shiftPillBs(
  status: 'open' | 'closing' | 'closed' | 'reviewed' | null,
): string {
  switch (status) {
    case 'open': return 'u toku'
    case 'closing': return 'zatvaranje'
    case 'closed': return 'zatvorena'
    case 'reviewed': return 'pregledana'
    default: return 'nije otvarana'
  }
}

/**
 * *Počinje sutra u 07:00* — when a shift that is not running is, in words.
 *
 * Inside the hour it is a countdown and the day word is dropped, because "za
 * 20 min" is how somebody standing behind a bar thinks about it and "danas" adds
 * nothing to it. Past the hour it is the clock plus the day, which is the
 * reading that stops *07:00* meaning tomorrow morning to one person and this
 * morning to another. `durationBs` is the dashboard's own duration, so this says
 * "3 h 20" exactly the way every other length of time on `/admin` says it.
 */
export function shiftWhenBs(turn: ShiftTurn, tense: 'next' | 'last'): string {
  const day = turn.day === 'danas' ? 'danas' : turn.day === 'sutra' ? 'sutra' : 'jučer'

  if (tense === 'next') {
    return turn.minutes < 60
      ? `počinje za ${durationBs(turn.minutes * 60)}`
      : `počinje ${day} u ${turn.window.start_time}`
  }

  return turn.minutes < 60
    ? `završena prije ${durationBs(turn.minutes * 60)}`
    : `završena ${day} u ${turn.window.end_time}`
}

/**
 * *Dobro veče, Harun* — the one line at the top of *Puls*.
 *
 * It is a **line and not a headline**: the owner opens this screen for a number,
 * and a greeting that pushed that number down a phone screen would be a greeting
 * he learned to scroll past. The hour comes from the café's own wall clock —
 * `localTime()`, never `getHours()` — and only the first name is used, because
 * that is what everybody in the café is called (DESIGN §6, second person
 * singular).
 *
 * An unreadable clock gets the greeting with no time of day in it rather than a
 * guessed one.
 */
export function greetingBs(atHhmm: string, name?: string | null): string {
  const first = (name ?? '').trim().split(/\s+/)[0] ?? ''
  const at = minutesOf(atHhmm)
  const hour = at === null ? null : Math.floor(at / 60)

  const greeting = hour === null
    ? 'Zdravo'
    : hour < 5 ? 'Dobro veče'
      : hour < 11 ? 'Dobro jutro'
        : hour < 18 ? 'Dobar dan'
          : 'Dobro veče'

  return first ? `${greeting}, ${first}` : greeting
}

// ---------------------------------------------------------------------------
// What a shift has sold
// ---------------------------------------------------------------------------

/**
 * One product on the counter behind a shift card: how many went out, and for
 * how much.
 *
 * Aggregated **by the name snapshotted on the line**, which is what the ledger
 * carries — a line records the name and the price the guest was actually charged,
 * not a pointer to a product whose name somebody may rename next week. So
 * renaming *Kafa* to *Espresso* splits tonight from last month on this screen,
 * and that is the honest reading: they were sold under two different names.
 */
export interface SoldRow {
  name: string
  /** Everything that went out, gratis included, storna excluded. */
  qty: number
  /** What was charged for it. Gratis adds nothing, because nothing was charged. */
  fen: number
  /** How many of `qty` went out *na račun kuće*. */
  gratis_qty: number
  /** Cancelled, and therefore not in `qty` at all. */
  storno_qty: number
}

export interface SoldTotals {
  /** How many different articles the shift actually sold. */
  products: number
  qty: number
  fen: number
  gratis_qty: number
  storno_qty: number
}

/**
 * The counter: every product a shift sold, most-sold first.
 *
 * **A counter, not a feed.** `GET /api/owner/shift/:id/lines` answers one row per
 * line rung up — three hundred of them on a busy night — and the owner's question
 * is not *what happened at 21:14*, it is *how many coffees went out tonight*. So
 * the lines are folded by product here, in the browser, off a read that already
 * exists rather than a route added for it.
 *
 * **An applied storno is not a sale.** It is counted on its own row instead, so a
 * product whose only two rounds were cancelled reads as "2 stornirana" rather
 * than disappearing from a screen that is supposed to say what happened. A storno
 * still *waiting* on a decision has not been granted, so it counts as sold — it
 * is money the café is still owed, and that is what every other screen says
 * about it too.
 */
export function soldRows(lines: LineRow[]): SoldRow[] {
  const rows = new Map<string, SoldRow>()

  for (const line of lines) {
    const name = line.name_snapshot
    const row = rows.get(name)
      ?? { name, qty: 0, fen: 0, gratis_qty: 0, storno_qty: 0 }

    if (line.status === 'storno') {
      row.storno_qty += line.qty
    } else {
      row.qty += line.qty
      row.fen += line.charged_fen
      if (line.status === 'gratis') row.gratis_qty += line.qty
    }

    rows.set(name, row)
  }

  // Most sold first, then the biggest money, then alphabetical — so a list of
  // ones and twos has a stable order instead of the ledger's arrival order.
  return [...rows.values()].sort((a, b) =>
    b.qty - a.qty || b.fen - a.fen || a.name.localeCompare(b.name, 'bs'))
}

/** The foot of the counter. `products` counts what actually sold, not the storna. */
export function soldTotals(rows: SoldRow[]): SoldTotals {
  return {
    products: rows.filter(row => row.qty > 0).length,
    qty: rows.reduce((n, row) => n + row.qty, 0),
    fen: rows.reduce((n, row) => n + row.fen, 0),
    gratis_qty: rows.reduce((n, row) => n + row.gratis_qty, 0),
    storno_qty: rows.reduce((n, row) => n + row.storno_qty, 0),
  }
}
