/**
 * The logic behind *Puls*, kept out of the templates.
 *
 * Everything here is a **pure function**: an argument in, a value out, no
 * `fetch`, no `ref`, no component. That is what makes it testable in
 * `tests/unit/puls.test.ts` without a browser, and it is where the rules that
 * are easy to get quietly wrong live — which shift the café is in, how old a
 * table has to be before its tile turns amber, and which body a decide route
 * wants.
 *
 * Files in `app/utils/` are auto-imported by Nuxt exactly like composables, so
 * no component below writes an `import` line for any of this.
 */
import type {
  AttentionAction,
  AttentionRefType,
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
 * How the screen names tonight's shift.
 *
 * `name` is the template's own word — *Dnevna*, *Večernja* — and `ordinal_bs`
 * is the owner's way of asking for it ("first or second shift"). Both come out
 * of the roster's `shift_templates`, because a café that adds a third shift
 * must not have to have this file edited.
 */
export interface ShiftNaming {
  /** The template's own name: "Večernja". */
  name: string
  /** Where it sits among the venue's active shifts, 1-based. */
  index: number
  /** "prva smjena", "druga smjena" — what the owner calls it. */
  ordinal_bs: string
  /** "16–01", with an en dash, from the template's own wall clock. */
  hours: string
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
 * Which of the venue's shift templates the café is in, named the owner's way.
 *
 * **The window first, and the nearest edge when no window has it.** *Dnevna* is
 * 08–16 and *Večernja* 16–01, so between them they leave 01:00–08:00 owned by
 * nobody — and that gap is exactly when a long night is still being counted.
 * The rule is therefore two steps: the template whose own hours contain the
 * clock (`end <= start` means it runs past midnight, the same reading
 * `plannedHours()` in `shared/dates.ts` gives it), and failing that the
 * template with the nearest edge — which keeps 02:30 on the evening that ended
 * at one and puts 07:45 on the morning that starts at eight.
 *
 * `atHhmm` is a wall clock in the café's own zone — `localTime()` from
 * `shared/dates.ts`, never `getHours()`.
 *
 * Inactive templates are not shifts anybody works, so they are dropped before
 * the ordinal is counted — otherwise retiring the morning shift would leave the
 * evening one called "the second".
 */
export function shiftNaming(
  templates: ShiftTemplateView[], atHhmm: string,
): ShiftNaming | null {
  const at = minutesOf(atHhmm)
  if (at === null) return null

  const active = templates
    .filter(t => t.active && minutesOf(t.start_time) !== null && minutesOf(t.end_time) !== null)
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))

  let index = -1
  let bestDistance = Number.POSITIVE_INFINITY

  for (let i = 0; i < active.length; i++) {
    const start = minutesOf(active[i]!.start_time)!
    const end = minutesOf(active[i]!.end_time)!
    const span = end <= start ? end + DAY_MIN - start : end - start

    // Inside its own hours: nothing beats that, and the first such template
    // wins, so two overlapping shifts read in the roster's own order.
    if ((at - start + DAY_MIN) % DAY_MIN < span) {
      index = i
      break
    }

    const distance = Math.min(circularGap(at, start), circularGap(at, end))
    if (distance < bestDistance) {
      bestDistance = distance
      index = i
    }
  }

  const template = active[index]
  if (!template) return null

  return {
    name: template.name,
    index: index + 1,
    ordinal_bs: `${ORDINALS_BS[index] ?? `${index + 1}.`} smjena`,
    hours: hoursBs(template.start_time, template.end_time),
  }
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
// The floor plan
// ---------------------------------------------------------------------------

/**
 * How long the guests have been sitting there, as a colour band.
 *
 * `free` is an empty table, then under an hour, one to three, over three. The
 * band is only ever half the message: every tile prints the age in words
 * beside it, because a colour on its own is not a status anybody can read out
 * loud (or see, colour-blind, in a bright bar).
 */
export type TableTone = 'free' | 'fresh' | 'warm' | 'old'

const HOUR_MS = 3_600_000

export function tableTone(openedAt: string | null, nowMs: number): TableTone {
  if (!openedAt) return 'free'
  const opened = Date.parse(openedAt)
  if (Number.isNaN(opened)) return 'fresh'
  const age = nowMs - opened
  if (age >= 3 * HOUR_MS) return 'old'
  if (age >= HOUR_MS) return 'warm'
  return 'fresh'
}

/** One tile of the room, with everything the template needs already resolved. */
export interface PulsFloorCell {
  table_id: string
  tab_id: string | null
  /** The number alone: every circle would otherwise say "Sto". */
  label: string
  /** The whole name, which is what the sheet's title says. */
  name: string
  tone: TableTone
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
      tone: tableTone(openedAt, nowMs),
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

/** What the header says about tonight's shift, in Bosnian and never guessed. */
export function shiftLineBs(
  status: 'open' | 'closing' | 'closed' | 'reviewed' | null,
  closerName: string | null,
): string {
  switch (status) {
    case 'open': return 'smjena otvorena'
    case 'closing': return closerName ? `zatvaranje · ${closerName}` : 'zatvaranje smjene'
    case 'closed': return 'smjena zatvorena'
    case 'reviewed': return 'smjena pregledana'
    default: return 'nema otvorene smjene'
  }
}
