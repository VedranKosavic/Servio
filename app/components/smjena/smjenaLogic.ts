/**
 * The arithmetic and the vocabulary behind *Smjena* — everything on that page
 * that is a decision rather than a rendering.
 *
 * It is a plain module and not a composable because none of it touches Vue: it
 * takes the shapes `GET /api/owner/shift/:id` answers and returns rows, words
 * and tones. That is also what makes it testable in `tests/unit/smjena.test.ts`
 * without mounting a component — a test that asserts a button says "Odobri"
 * tests Vue; a test that asserts a 4,00 KM shortfall reads *u toleranciji* on a
 * 5,00 KM tolerance tests Šank.
 *
 * Two house rules it exists to keep in one place:
 *
 * 1. **Money is an integer number of feninga.** Nothing here divides, and the
 *    one place a ratio is unavoidable (grams per bowl) returns a number that is
 *    formatted for display and never added to anything.
 * 2. **A colour is never the message.** Every function that returns a `tone`
 *    returns the Bosnian **word** beside it, because a status has to survive a
 *    colour-blind reader and a black-and-white screenshot.
 */
import type {
  CashMovement,
  CategoryLine,
  Settings,
  Shift,
  ShiftCountBrief,
  ShiftStatus,
  ShiftSummary,
  Settlement,
  LineStatus,
  UserSummary,
} from '#shared/types'

export type Tone = 'good' | 'warn' | 'bad' | 'neutral' | 'accent'

/** A word and the colour that repeats it. Never the colour alone. */
export interface Verdict {
  word: string
  tone: Tone
}

// ---------------------------------------------------------------------------
// Tolerance
// ---------------------------------------------------------------------------

/**
 * How far a count or an envelope may be out before somebody writes a sentence.
 *
 * This mirrors `toleranceFen()` in `server/services/cash.ts` exactly — the same
 * `max(fixed, percentage of the base)` — because the server does not send the
 * number down with a shift summary and the page has to print the word next to
 * the difference. `baseFen` is what the percentage is a percentage *of*: the
 * venue expectation for the drawer, a waiter's own expectation for his envelope.
 *
 * A settlement that carries its own `tolerance_fen` (the server recorded it at
 * the moment of the declaration) always wins over this — see `waiterVerdict`.
 */
export function toleranceFen(baseFen: number, settings: Settings): number {
  return Math.max(
    settings.cash_tolerance_fen,
    Math.round((Math.abs(baseFen) * settings.cash_tolerance_pct) / 100),
  )
}

/** *u toleranciji* / *van tolerancije* — the shift's own cash difference. */
export function cashVerdict(
  diffFen: number | null, baseFen: number, settings: Settings,
): Verdict | null {
  if (diffFen === null) return null
  return Math.abs(diffFen) <= toleranceFen(baseFen, settings)
    ? { word: 'u toleranciji', tone: 'good' }
    : { word: 'van tolerancije', tone: 'bad' }
}

/**
 * One waiter's *ocjena*.
 *
 * **Never an accusation.** A person outside tolerance is *označeno za razgovor*
 * — flagged for a conversation — which is the word `PLAN.md` §12 fixes and the
 * only thing the owner is entitled to say from a number alone.
 *
 * `within_tolerance` is preferred over recomputing, because the server wrote it
 * against the expectation *at the moment of the declaration*; a post-settlement
 * void decision moves today's expectation and must not retroactively re-judge a
 * person who declared honestly against yesterday's.
 */
export function waiterVerdict(user: UserSummary, settings: Settings): Verdict {
  if (user.settled_at === null && user.declared_fen === undefined) {
    return { word: 'nije predao', tone: 'neutral' }
  }
  if (user.within_tolerance !== undefined) {
    return user.within_tolerance
      ? { word: 'u toleranciji', tone: 'good' }
      : { word: 'označeno za razgovor', tone: 'warn' }
  }

  const diff = (user.declared_fen ?? 0) - (user.expected_fen ?? 0)
  const limit = user.tolerance_fen ?? toleranceFen(user.expected_fen ?? 0, settings)
  return Math.abs(diff) <= limit
    ? { word: 'u toleranciji', tone: 'good' }
    : { word: 'označeno za razgovor', tone: 'warn' }
}

// ---------------------------------------------------------------------------
// The shift's own words
// ---------------------------------------------------------------------------

/** The pill on `/a/smjene` and in the page header. */
export function shiftStatusPill(status: ShiftStatus): Verdict {
  switch (status) {
    case 'open': return { word: 'otvorena', tone: 'accent' }
    case 'closing': return { word: 'predaja u toku', tone: 'warn' }
    case 'reviewed': return { word: 'pregledano', tone: 'good' }
    case 'closed':
    default: return { word: 'zatvorena', tone: 'neutral' }
  }
}

/** What one line of the drill-down says about itself. */
export const LINE_STATUS_WORDS: Record<LineStatus, Verdict> = {
  otvoreno: { word: 'otvoreno', tone: 'neutral' },
  naplaceno: { word: 'naplaćeno', tone: 'good' },
  nije_placeno: { word: 'nije plaćeno', tone: 'bad' },
  storno: { word: 'storno', tone: 'bad' },
  storno_na_cekanju: { word: 'storno na čekanju', tone: 'warn' },
  gratis: { word: 'gratis', tone: 'warn' },
}

// ---------------------------------------------------------------------------
// The drill-down's `kat`
// ---------------------------------------------------------------------------

/**
 * The four pseudo-categories `GET /api/owner/shift/:id/lines` understands
 * beside a real category id (`matchesKat` in `server/services/summaries.ts`).
 * A chip on this page sends one of these or a category id, and nothing else.
 */
export const KAT_PRESETS = [
  { value: 'sve', label: 'Sve' },
  { value: 'storno', label: 'Storna' },
  { value: 'gratis', label: 'Gratis' },
  { value: 'nijeplaceno', label: 'Nije plaćeno' },
] as const

/** One chip in a waiter's row: a category, its count and where it drills to. */
export interface KatChip {
  kat: string
  label: string
  qty: number
  fen: number
}

/**
 * "Nargila 34" — the per-category chips off one person's `by_category`.
 *
 * `names` is needed because only the *venue* fold comes back with the category
 * names joined: `by_user[].by_category` is the stored numeric JSON, ids only
 * (`namedSummary` in `server/services/owner.ts` names the outer one and leaves
 * the inner ones alone). The page passes the map it already has from
 * `summary.by_category`, so no screen goes and asks for the catalogue again.
 */
export function katChips(
  lines: CategoryLine[], names: Record<string, string> = {},
): KatChip[] {
  return lines
    .filter(line => line.qty > 0)
    .map(line => ({
      kat: line.category_id,
      label: line.name ?? names[line.category_id] ?? '—',
      qty: line.qty,
      fen: line.fen,
    }))
}

// ---------------------------------------------------------------------------
// The cash box
// ---------------------------------------------------------------------------

export interface CashRow {
  key: string
  label: string
  /** The quiet second line: a name, a time, a reason. */
  sub?: string
  fen: number | null
  /** A total the rows above add up to — drawn heavier, with a rule over it. */
  total?: boolean
  verdict?: Verdict
  /** A pending `payout` or `float_out` waiting for the owner's yes. */
  movementId?: string
}

/** The two types that are born `pending` and need a decision (§6.5). */
export function pendingMovements(movements: CashMovement[]): CashMovement[] {
  return movements.filter(m => m.status === 'pending')
}

const MOVEMENT_WORDS: Record<CashMovement['type'], string> = {
  float_in: 'Dopuna kase',
  float_out: 'Izdato konobaru',
  payout: 'Isplata iz kase',
  owner_pickup: 'Uzeo iz kase',
  refund: 'Povrat gostu',
}

/** The three `payout` reasons, spelled the way the screen has to spell them. */
const REASON_WORDS: Record<string, string> = {
  dobavljac: 'dobavljač',
  sitno: 'sitno',
  ostalo: 'ostalo',
}

const STATUS_WORDS: Record<CashMovement['status'], string> = {
  pending: 'na čekanju',
  approved: 'odobreno',
  rejected: 'odbijeno',
}

/**
 * The *Kasa* card, top to bottom, exactly in the order PLAN §11 lists it:
 * početni polog → float in/out → isplate → povrati → uzeo iz kase → očekivano →
 * prebrojano → razlika.
 *
 * **What is not here and why.** *Ostalo u kasi sinoć* is the previous close's
 * counted cash minus what the owner took out of it. No read on `/a` carries it
 * and the drawer's own expectation is folded into `summary.expected_cash_fen`
 * together with the waiters who have settled, so it cannot be recovered
 * arithmetically either. Rather than print a number this page cannot stand
 * behind, the *početni polog* row says where the figure came from — entered by
 * hand, or derived by the server from last night — and offers the correction.
 */
export function cashRows(
  shift: Shift, summary: ShiftSummary, movements: CashMovement[],
): CashRow[] {
  const rows: CashRow[] = []
  const sum = (type: CashMovement['type'], status?: CashMovement['status']) =>
    movements
      .filter(m => m.type === type && (status === undefined || m.status === status))
      .reduce((n, m) => n + m.amount_fen, 0)

  rows.push({
    key: 'opening',
    label: 'Početni polog',
    sub: shift.opening_float_override_fen === null
      ? 'izveden iz sinoćnjeg brojanja'
      : 'unesen ručno',
    fen: shift.opening_float_override_fen,
  })

  const floatIn = sum('float_in')
  if (floatIn > 0) rows.push({ key: 'float_in', label: 'Dopuna kase', fen: floatIn })

  for (const movement of movements.filter(m => m.type === 'float_out')) {
    rows.push({
      key: `float_out:${movement.id}`,
      label: 'Izdato konobaru',
      sub: `${movement.user_name} · ${STATUS_WORDS[movement.status]}`,
      fen: -movement.amount_fen,
      ...(movement.status === 'pending' ? { movementId: movement.id } : {}),
    })
  }

  for (const movement of movements.filter(m => m.type === 'payout')) {
    rows.push({
      key: `payout:${movement.id}`,
      label: MOVEMENT_WORDS.payout,
      sub: [
        movement.user_name,
        movement.reason ? REASON_WORDS[movement.reason] ?? movement.reason : null,
        STATUS_WORDS[movement.status],
      ].filter(Boolean).join(' · '),
      fen: movement.status === 'rejected' ? 0 : -movement.amount_fen,
      ...(movement.status === 'pending' ? { movementId: movement.id } : {}),
    })
  }

  const refunds = sum('refund', 'approved')
  if (refunds > 0) rows.push({ key: 'refund', label: MOVEMENT_WORDS.refund, fen: -refunds })

  const pickups = sum('owner_pickup', 'approved')
  if (pickups > 0) rows.push({ key: 'pickup', label: MOVEMENT_WORDS.owner_pickup, fen: -pickups })

  rows.push({
    key: 'expected',
    label: 'Očekivano u kasi',
    sub: 'kasa + konobari koji su predali',
    fen: summary.expected_cash_fen,
    total: true,
  })

  if (summary.outstanding_fen !== 0) {
    rows.push({
      key: 'outstanding',
      label: 'Još kod konobara',
      sub: 'nije predano',
      fen: summary.outstanding_fen,
    })
  }

  rows.push({
    key: 'counted',
    label: 'Prebrojano',
    sub: shift.cash_counted_fen === null ? 'smjena još nije zatvorena' : undefined,
    fen: summary.counted_cash_fen,
  })

  rows.push({
    key: 'diff',
    label: 'Razlika gotovine',
    fen: summary.diff_fen,
    total: true,
  })

  return rows
}

/**
 * The card half of the same card: what the terminal says against what the
 * payments add up to. A difference here is a card slip nobody rang up, or a
 * cash payment somebody recorded as a card one — never a rounding error.
 */
export function cardRows(shift: Shift, summary: ShiftSummary): CashRow[] {
  const rows: CashRow[] = [
    { key: 'card_lines', label: 'Kartica iz naplata', fen: summary.card_fen },
  ]
  if (shift.card_total_fen === null) {
    rows.push({ key: 'card_total', label: 'Ukupno s terminala', fen: null })
    return rows
  }
  rows.push({ key: 'card_total', label: 'Ukupno s terminala', fen: shift.card_total_fen })
  rows.push({
    key: 'card_diff',
    label: 'Razlika kartice',
    fen: shift.card_total_fen - summary.card_fen,
    total: true,
  })
  return rows
}

// ---------------------------------------------------------------------------
// Settlements
// ---------------------------------------------------------------------------

/**
 * "u trenutku predaje −12,00 · sada −2,00".
 *
 * `diff_fen` on the settlement is what the difference was when the envelope was
 * sealed; the waiter's row in tonight's summary is what it is now. They differ
 * exactly when something was decided afterwards — a void approved at 09:41
 * moves the expectation and nothing else — and printing only one of the two is
 * how a person gets asked about a shortfall that has since been explained.
 */
export function settlementDrift(
  settlement: Settlement, user: UserSummary | undefined,
): { then: number, now: number | null } {
  const now = user?.expected_fen === undefined
    ? null
    : settlement.declared_fen - user.expected_fen
  return { then: settlement.diff_fen, now }
}

// ---------------------------------------------------------------------------
// Counts and bowls
// ---------------------------------------------------------------------------

/** *Popisi* — the opening card, the closing card, and anything ad hoc. */
export const COUNT_PHASE_WORDS: Record<ShiftCountBrief['phase'], string> = {
  open: 'Početni popis',
  close: 'Završni popis',
  adhoc: 'Vanredni popis',
}

export const COUNT_KIND_WORDS: Record<ShiftCountBrief['kind'], string> = {
  full: 'inventura',
  spot: 'brzi popis',
}

export function countPill(count: ShiftCountBrief): Verdict {
  if (count.status === 'submitted') return { word: 'predan', tone: 'warn' }
  return { word: 'potvrđeno', tone: 'good' }
}

/**
 * Bosnian counts nouns in three shapes: 1 *tura*, 2–4 *ture*, 5+ *tura* (and
 * 11–14 go back to the last shape). One helper, so no screen writes
 * "5 ture" — which is the kind of thing the owner notices immediately.
 */
export function pluralBs(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n)
  const last = abs % 10
  const lastTwo = abs % 100
  if (last === 1 && lastTwo !== 11) return one
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return few
  return many
}

/**
 * What the *Manjak robe* tile says under the amount.
 *
 * A shift with no confirmed closing count has no shortage figure at all, and
 * saying "0,00" without saying why would be the screen inventing a fact. So the
 * three cases are spelled out: no count, a count nobody has applied yet, and a
 * count that came back clean.
 */
export function stockVarianceNote(counts: ShiftCountBrief[]): string {
  if (counts.length === 0) return 'KM · nema popisa'

  const confirmed = counts.filter(c => c.status === 'confirmed')
  if (confirmed.length === 0) return 'KM · popis još nije primijenjen'

  const off = confirmed.filter(c => c.variance_fen !== 0).length
  return off === 0
    ? 'KM · popis bez odstupanja'
    : `KM · ${off} ${pluralBs(off, 'popis', 'popisa', 'popisa')} s odstupanjem`
}

/**
 * Grams of tobacco per bowl and coals per bowl, as the *Lule* tile prints them.
 *
 * The one division on this page. Both come back as plain numbers formatted to
 * one decimal for the eye; neither is money and neither is ever added to
 * anything, so a float is harmless here in a way it never is above.
 */
export function perBowl(summary: ShiftSummary): { grams: number, coals: number } | null {
  if (summary.bowls <= 0) return null
  return {
    grams: Math.round((summary.tobacco_g / summary.bowls) * 10) / 10,
    coals: Math.round((summary.coals / summary.bowls) * 10) / 10,
  }
}

/** "19,4" — a Bosnian decimal comma for a quantity that is not money. */
export function decimalBs(value: number, places = 1): string {
  return value.toFixed(places).replace('.', ',')
}

// ---------------------------------------------------------------------------
// The category mix
// ---------------------------------------------------------------------------

export interface CategorySlice extends CategoryLine {
  /** 0–100, of the night's promet. Only ever a width, never a number on screen. */
  pct: number
}

/** The stacked bar under the per-waiter strip, largest category first. */
export function categoryMix(lines: CategoryLine[]): CategorySlice[] {
  const total = lines.reduce((n, line) => n + Math.max(0, line.fen), 0)
  return lines
    .filter(line => line.fen > 0)
    .sort((a, b) => b.fen - a.fen)
    .map(line => ({ ...line, pct: total === 0 ? 0 : (line.fen / total) * 100 }))
}
