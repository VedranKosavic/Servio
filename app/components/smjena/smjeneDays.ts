/**
 * *Smjene* as days — the date, and under it the shifts a day is made of.
 *
 * The café runs **two shifts a day**: *Prva smjena* 07:00–15:00 and *Druga
 * smjena* 15:00–23:00, which is what `shift_templates` holds. So the screen is
 * not a flat list of shifts any more: it is a list of days, each with its two
 * cards. This module is the part of that which is a decision rather than a
 * rendering, kept out of the components so it can be tested without mounting
 * anything (`tests/unit/smjena.test.ts`).
 *
 * **How a shift is assigned to a slot.** A `shifts` row carries its own
 * `opened_at` and nothing that names a template — a shift is opened by the
 * first round of the night, not by the roster — so the match is the **opening
 * time against the template windows**, read on the café's wall clock through
 * `shared/dates.ts` and never through `getHours()`. A shift opened at 16:00
 * belongs to *Druga smjena* even though it ran until 02:00: which window it
 * *started* in is the question the owner is asking, and the card prints the
 * real clock underneath so nothing is claimed that did not happen.
 *
 * `end_time <= start_time` means the window crosses midnight, and `covers()`
 * handles it. Neither of the café's two templates does today, but a venue that
 * closes at 01:00 is one settings change away.
 *
 * **Nothing is allowed to vanish.** A shift that matches no window — the
 * 16:00–02:00 night under the old templates is still in the owner's database,
 * and a 04:00 open would be one too — gets a card of its own after the two,
 * and so does a second shift inside one window. The period total on the page is
 * the sum of the rows it was handed, so every row has to be *somewhere* or the
 * total would stop matching the screen.
 *
 * **A day exists because the café worked it.** A date with no shift at all
 * produces no day, rather than a heading over two empty cards: the owner's
 * database holds weeks the app was not in use yet, and a month of "nije radila"
 * would bury the four nights that have numbers on them. A day that *was* worked
 * shows its missing shift, because that is the fact the owner came for — one
 * shift worked out of two is not the same as two shifts and one of them empty.
 */
import { localTime } from '#shared/dates'
import { toMinutes, windowCovers } from '#shared/shiftSlots'
import type { OwnerShiftRow, ShiftTemplateView } from '#shared/types'

/**
 * What a card says about a shift the templates do not explain: it happened, at
 * hours the café does not run, or it is the second shift inside one window.
 */
export const EXTRA_SLOT_NAME = 'Vanredna smjena'

/**
 * …and what it says when the venue has **no** templates at all — a fresh
 * database before `db:roster`, or every template switched off. Then there are
 * no windows for a shift to be outside of, so calling it *vanredna* would be
 * the screen inventing a judgement.
 */
export const PLAIN_SLOT_NAME = 'Smjena'

/** One card under a date: the slot, and the shift that filled it or did not. */
export interface DayShiftSlot {
  /** `v-for` key: the template's id, or the shift's own when it has no slot. */
  key: string
  /** *Prva smjena*, *Druga smjena* — or `EXTRA_SLOT_NAME`. */
  name: string
  /** The template's nominal window, `HH:MM`. `null` on a shift with no slot. */
  start_time: string | null
  end_time: string | null
  /** The shift that was worked here. `null` means nobody worked it. */
  shift: OwnerShiftRow | null
}

/** One date on *Smjene*: the heading, and the cards beneath it. */
export interface ShiftDay {
  business_date: string
  /** The templates in their own order, then any shift that matched none. */
  slots: DayShiftSlot[]
  /** What the day's shifts made, in feninga — the sum of its worked cards. */
  promet_fen: number
  /** How many shifts were actually worked that day, out of the slots drawn. */
  worked: number
}

/**
 * The minute of the café's day a shift was opened at, 0–1439.
 *
 * `localTime` reads the stored UTC instant on the Europe/Sarajevo wall clock.
 * The database stores UTC and the laptop may be on any zone at all, so this is
 * the only honest way to ask "was this a 07:00 shift or a 15:00 one".
 */
export function openingMinute(shift: OwnerShiftRow): number {
  if (!shift.opened_at || Number.isNaN(Date.parse(shift.opened_at))) return Number.NaN
  return toMinutes(localTime(shift.opened_at))
}

/** Is `minute` inside this template's window? Start inclusive, end exclusive. */
function covers(template: ShiftTemplateView, minute: number): boolean {
  return windowCovers(template.start_time, template.end_time, minute)
}

/**
 * Which slot a shift belongs to, or `null` if nothing explains it.
 *
 * **The shift's own answer first** (23.09.2026). Since the picker a shift
 * carries the slot the worker named when he signed in, and that is a fact; the
 * window match below is the guess it replaced, kept for every night worked
 * before. The guess is wrong exactly where the handover lives — a crew starting
 * at 14:50 opens inside *Prva smjena*'s window — which is why the café kept
 * seeing a *Vanredna smjena* it does not have.
 */
export function matchTemplate(
  shift: OwnerShiftRow, templates: ShiftTemplateView[],
): ShiftTemplateView | null {
  if (shift.template_id) {
    return templates.find(template => template.id === shift.template_id) ?? null
  }
  const minute = openingMinute(shift)
  return templates.find(template => covers(template, minute)) ?? null
}

/**
 * *Prva smjena*, *Druga smjena* — what one shift is called on its own page.
 *
 * The same rule *Smjene* uses to put a shift in a slot: the shift's own
 * `template_id` where it has one, and otherwise the window its opening time
 * falls in, against active templates only. Outside every window it is
 * `EXTRA_SLOT_NAME`, and with no templates at all it is plain *Smjena*.
 */
export function shiftSlotName(
  shift: { opened_at: string, template_id: string | null }, templates: ShiftTemplateView[],
): string {
  const active = templates.filter(template => template.active)
  if (active.length === 0) return PLAIN_SLOT_NAME
  if (shift.template_id) {
    return active.find(template => template.id === shift.template_id)?.name ?? EXTRA_SLOT_NAME
  }
  const minute = shift.opened_at && !Number.isNaN(Date.parse(shift.opened_at))
    ? toMinutes(localTime(shift.opened_at))
    : Number.NaN
  return active.find(template => covers(template, minute))?.name ?? EXTRA_SLOT_NAME
}

/**
 * Who worked a shift, as the header names them.
 *
 * Which screen a worker was on is a property of his **session**, and the
 * shift does not keep it — so the crew is read from what the shift does keep.
 * The šanker is whoever closed it (*Zaključi smjenu* admits a šanker-mode
 * session only), `null` while it is open. The konobari are everybody who locked
 * a round, less that šanker, in the fold's own order.
 */
export function shiftCrew(
  users: Array<{ user_id: string, name: string, rounds: number }>,
  closing: { closed_by: string, closed_by_name: string } | null,
): { konobari: string[], sanker: string | null } {
  return {
    konobari: users
      .filter(user => user.rounds > 0 && user.user_id !== closing?.closed_by)
      .map(user => user.name),
    sanker: closing?.closed_by_name ?? null,
  }
}

/** Earliest opening first — the order the day was actually worked in. */
function byOpenedAt(a: OwnerShiftRow, b: OwnerShiftRow): number {
  return a.opened_at < b.opened_at ? -1 : a.opened_at > b.opened_at ? 1 : 0
}

function buildDay(
  businessDate: string, shifts: OwnerShiftRow[], templates: ShiftTemplateView[],
): ShiftDay {
  /**
   * The earliest shift takes the slot. Two shifts inside one window happens —
   * one closed at 10:00 and another opened at 11:00 — and the first of them is
   * the one the slot is about; the second gets its own card rather than
   * overwriting it, because a card that silently dropped a night's pazar would
   * take the period total with it.
   */
  const taken = new Map<string, OwnerShiftRow>()
  const spare: OwnerShiftRow[] = []

  for (const shift of [...shifts].sort(byOpenedAt)) {
    const template = matchTemplate(shift, templates)
    if (template && !taken.has(template.id)) taken.set(template.id, shift)
    else spare.push(shift)
  }

  const slots: DayShiftSlot[] = templates.map(template => ({
    key: template.id,
    name: template.name,
    start_time: template.start_time,
    end_time: template.end_time,
    shift: taken.get(template.id) ?? null,
  }))

  const spareName = templates.length > 0 ? EXTRA_SLOT_NAME : PLAIN_SLOT_NAME
  for (const shift of spare) {
    slots.push({
      key: shift.id, name: spareName, start_time: null, end_time: null, shift,
    })
  }

  return {
    business_date: businessDate,
    slots,
    promet_fen: shifts.reduce((sum, shift) => sum + shift.promet_fen, 0),
    worked: shifts.length,
  }
}

/**
 * The period's shifts as days, newest first.
 *
 * `templates` is `GET /api/admin/shift-templates` — the inactive ones filtered
 * out here rather than in the read, because that route answers with all of them
 * and a switched-off template is not a slot the owner is still running.
 *
 * The dates are sorted rather than taken in the order the read arrived, so the
 * page does not silently depend on the server's `ORDER BY`.
 */
export function groupShiftsByDay(
  rows: OwnerShiftRow[], templates: ShiftTemplateView[],
): ShiftDay[] {
  const slots = templates.filter(template => template.active)
  const byDate = new Map<string, OwnerShiftRow[]>()

  for (const row of rows) {
    const day = byDate.get(row.business_date)
    if (day) day.push(row)
    else byDate.set(row.business_date, [row])
  }

  return [...byDate.keys()]
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .map(date => buildDay(date, byDate.get(date)!, slots))
}
