/**
 * The logic behind *Puls*, kept out of the templates.
 *
 * Everything here is a **pure function**: an argument in, a value out, no
 * `fetch`, no `ref`, no component. That is what makes it testable in
 * `tests/unit/puls.test.ts` without a browser, and it is where the three rules
 * that are easy to get quietly wrong live — which body a decide route wants,
 * how old a table has to be before its tile turns amber, and how a storno is
 * written in the feed.
 *
 * Files in `app/utils/` are auto-imported by Nuxt exactly like composables, so
 * no component below writes an `import` line for any of this.
 */
import type {
  AttentionAction,
  AttentionRefType,
  Flag,
  LineRow,
  LineStatus,
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
// The table grid
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

/** One tile of the floor plan, with everything the template needs already resolved. */
export interface PulsTableTile {
  table_id: string
  tab_id: string | null
  name: string
  tone: TableTone
  /** `"48 min"`, `"1 h 40"`, or empty for a free table. */
  age: string
  /** The initials or the name of whoever owns the tab. */
  waiter: string
  remaining_fen: number
  /** *naplata čeka* — somebody has to look at this one. */
  pending_review: boolean
  late_sync: boolean
}

export interface PulsZoneGroup {
  zone: Zone
  label: string
  tiles: PulsTableTile[]
}

/** The two words the floor plan is split by. */
export function zoneLabel(zone: Zone): string {
  return zone === 'basta' ? 'Bašta' : 'Unutra'
}

/**
 * The floor plan, grouped the way the room is.
 *
 * **Two reads, and why.** `GET /api/owner/live` carries a `TableState` per
 * table — who is sitting there, for how long, for how much — but no name and no
 * zone: those belong to the catalogue, which every screen in the app already
 * gets from `GET /api/bootstrap` and which changes about twice a year. So the
 * live read stays small and this joins the two by id, exactly as the waiter's
 * floor plan does. A table that is in one and not the other is dropped rather
 * than drawn nameless.
 */
export function groupTablesByZone(
  tables: TableState[], catalogue: VenueTable[], nowMs: number,
): PulsZoneGroup[] {
  const state = new Map(tables.map(t => [t.table_id, t]))
  const groups = new Map<Zone, PulsZoneGroup>()

  for (const table of [...catalogue].sort((a, b) => a.sort - b.sort)) {
    const live = state.get(table.id)
    if (!live) continue

    let group = groups.get(table.zone)
    if (!group) {
      group = { zone: table.zone, label: zoneLabel(table.zone), tiles: [] }
      groups.set(table.zone, group)
    }

    group.tiles.push({
      table_id: table.id,
      tab_id: live.tab_id,
      name: table.name,
      tone: tableTone(live.opened_at, nowMs),
      age: live.opened_at
        ? durationBs((nowMs - Date.parse(live.opened_at)) / 1000)
        : '',
      waiter: live.assigned_to_initials ?? live.opened_by_name ?? '',
      remaining_fen: live.remaining_fen,
      pending_review: live.pending_review,
      late_sync: live.late_sync,
    })
  }

  // `unutra` before `basta`, which is how the room reads and how the mockup
  // draws it, rather than whatever order the catalogue happened to arrive in.
  const order: Zone[] = ['unutra', 'basta']
  return order.flatMap(zone => groups.get(zone) ?? [])
}

// ---------------------------------------------------------------------------
// Zadnje stavke
// ---------------------------------------------------------------------------

/** A feed row's colour: a storno is red, a gratis amber, everything else plain. */
export type FeedTone = 'void' | 'comp' | 'plain'

export function feedTone(status: LineStatus): FeedTone {
  if (status === 'storno' || status === 'storno_na_cekanju') return 'void'
  if (status === 'gratis') return 'comp'
  return 'plain'
}

/**
 * What the feed prints in the amount column.
 *
 * `charged_fen` is what the guest was charged and stays that way whatever
 * happens to the line afterwards — the ledger is append-only, so a storno does
 * not go back and rewrite it. A storno therefore reads as the money coming
 * back off the night: `−12,00`.
 */
export function feedAmountFen(row: LineRow): number {
  return feedTone(row.status) === 'void' ? -row.charged_fen : row.charged_fen
}

/** "Sto 9 · 2× Kafa", with the flavours a nargila was packed with. */
export function feedTitle(row: LineRow): string {
  const qty = row.qty > 1 ? `${row.qty}× ` : ''
  const flavours = row.flavour_names.length ? ` (${row.flavour_names.join(' + ')})` : ''
  return `${row.table_name} · ${qty}${row.name_snapshot}${flavours}`
}

/** The word after the item: the status, when the status is worth a word. */
export function feedMark(row: LineRow): string {
  switch (row.status) {
    case 'storno': return 'storno'
    case 'storno_na_cekanju': return 'storno na čekanju'
    case 'gratis': return 'gratis'
    case 'nije_placeno': return 'nije plaćeno'
    default: return ''
  }
}

// ---------------------------------------------------------------------------
// Small words
// ---------------------------------------------------------------------------

/**
 * `1 sto · 2 stola · 5 stolova`.
 *
 * Bosnian counts in three: one, a few (2–4), many (5+), and the teens go with
 * "many" whatever their last digit says — 21 stolova is wrong, 21 sto is right,
 * and 11 sto is wrong.
 */
export function stolovaBs(n: number): string {
  const abs = Math.abs(n)
  const last = abs % 10
  const teens = abs % 100
  if (last === 1 && teens !== 11) return 'sto'
  if (last >= 2 && last <= 4 && (teens < 12 || teens > 14)) return 'stola'
  return 'stolova'
}

/** A stable `v-for` key for a flag, which has no id of its own. */
export function flagKey(flag: Flag): string {
  return `${flag.kind}:${flag.ref_type}:${flag.ref_id}`
}

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
