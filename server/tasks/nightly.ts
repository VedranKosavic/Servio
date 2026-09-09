/**
 * The housekeeping hour (§10).
 *
 * Two jobs on two different clocks, in one task because they share a run:
 *
 *   **Every hour** — did anybody forget to close the night? A shift still `open`
 *   or `closing` more than `SHIFT_NOT_CLOSED_GRACE_H` past the café's
 *   `closing_time` raises `shift_not_closed`. This one is deliberately *not*
 *   behind the once-a-day claim below. §10 puts the whole body at local 05:xx,
 *   but the default `closing_time` is 03:00 and 03:00 + 3 h is 06:00 — an hour
 *   *after* the 05:xx run — so a daily check would report a forgotten shift a
 *   full day late, which is the one thing this alert exists to prevent. Hourly
 *   costs one indexed select an hour and the alert dedupes on the shift id, so
 *   the owner still gets exactly one message per shift, at 06:15 instead of
 *   tomorrow.
 *
 *   **At local 05:xx, once per business date** — the pruning. The night is over
 *   (the business day rolls at 06:00) and nobody is holding a phone. The claim
 *   is an `INSERT OR IGNORE` on `task_runs(venue_id, task, business_date)`, so a
 *   restart at 05:20 finds the row already there and does nothing.
 *
 * The hour is read through `shared/dates.ts` and never `getHours()`: the unit
 * sets `TZ=UTC` (§10) precisely so the cron expressions are unambiguous, which
 * means the process's own idea of "05:00" is not the café's.
 */
import { and, eq, inArray, lt } from 'drizzle-orm'
import { schema } from '../database/client'
import type { Db } from '../database/client'
import { useDb } from '../utils/db'
import { nowIso } from '../utils/ids'
import { businessDate, cutoffIso, localTime } from '#shared/dates'
import { SHIFT_NOT_CLOSED_GRACE_H } from '#shared/constants'
import type { Settings } from '#shared/settings'
import { getSettings } from '../services/contracts'
import { queueAlert } from '../services/alerts'
import { pruneChanges } from '../services/changes'
import { alertTaskFailure, claimTaskRun, recordTaskRun, tasksDisabled, venueIds } from '../utils/tasks'

/** `changes` is a cursor, not history: a week is longer than any phone is offline. */
const CHANGES_KEEP_DAYS = 7
/** An expired session is dead the moment it expires; the row is kept only for forensics. */
const SESSIONS_KEEP_DAYS = 30
/** The hour, local, at which the daily half runs. */
const NIGHTLY_HOUR = 5

/**
 * When should this shift have been closed?
 *
 * `closing_time` is a wall clock ('03:00'), and 03:00 belongs to the *next*
 * calendar day when the business day starts at 06:00 — so it is converted to
 * minutes since the day started, which makes the after-midnight case ordinary
 * arithmetic rather than a special case. `cutoffIso` anchors that to the real
 * instant the business date began, DST included.
 */
export function closingDeadline(businessDay: string, settings: Settings): number {
  const [h, m] = settings.closing_time.split(':').map(Number)
  const startMin = settings.business_day_start_hour * 60
  const raw = (h ?? 0) * 60 + (m ?? 0)
  const sinceStart = raw < startMin ? raw + 24 * 60 - startMin : raw - startMin
  const dayStart = Date.parse(cutoffIso(businessDay, settings.timezone, settings.business_day_start_hour))
  return dayStart + (sinceStart + SHIFT_NOT_CLOSED_GRACE_H * 60) * 60_000
}

/**
 * The hourly half. Returns the shifts it flagged, so a test can assert on them.
 */
export function checkOpenShifts(db: Db, venueId: string, at = nowIso()): string[] {
  const settings = getSettings(db, venueId)
  // No date filter in SQL: the deadline is per shift and depends on settings the
  // database does not know how to evaluate. There is at most one non-terminal
  // shift per venue anyway — a trigger enforces it (`shifts_status_guard`) — so
  // this reads one row.
  const stale = db.select().from(schema.shifts)
    .where(and(
      eq(schema.shifts.venueId, venueId),
      inArray(schema.shifts.status, ['open', 'closing']),
    ))
    .all()
    .filter(shift => Date.parse(at) > closingDeadline(shift.businessDate, settings))

  for (const shift of stale) {
    db.transaction((tx) => {
      queueAlert(tx, venueId, {
        ruleKey: 'shift_not_closed',
        // Dedupes on the shift, so this fires once however many hours it runs.
        ref: { type: 'shift', id: shift.id },
        payload: {
          title_bs: `Smjena od ${shift.businessDate} još nije zatvorena.`,
          shift_id: shift.id,
          business_date: shift.businessDate,
        },
        at,
      })
    })
  }
  return stale.map(s => s.id)
}

/**
 * The daily half: throw away what nobody will ask for again. Both deletes are
 * plain SQL on tables `shared/constants.ts` lists as deliberately unguarded —
 * a cursor and a credential, not a ledger.
 */
export function pruneNightly(db: Db, at = nowIso()): { changes: number, sessions: number } {
  const changesBefore = new Date(Date.parse(at) - CHANGES_KEEP_DAYS * 86_400_000).toISOString()
  const sessionsBefore = new Date(Date.parse(at) - SESSIONS_KEEP_DAYS * 86_400_000).toISOString()

  const changes = pruneChanges(db, changesBefore)
  const sessions = db.delete(schema.sessions)
    .where(lt(schema.sessions.expiresAt, sessionsBefore))
    .run().changes

  return { changes, sessions }
}

/** The whole body, with an injectable `now` so a test never waits for 05:15. */
export function nightlyRun(db: Db, at = nowIso()): void {
  for (const venueId of venueIds(db)) {
    const settings = getSettings(db, venueId)
    const day = businessDate(at, settings.timezone, settings.business_day_start_hour)

    try {
      checkOpenShifts(db, venueId, at)

      if (Number(localTime(at, settings.timezone).slice(0, 2)) !== NIGHTLY_HOUR) continue
      if (!claimTaskRun(db, venueId, 'nightly', day, at)) continue

      const pruned = pruneNightly(db, at)
      recordTaskRun(db, venueId, 'nightly', day, true, undefined, at)
      console.info(`[sank] nightly ${day}: ${pruned.changes} changes, ${pruned.sessions} sessions pruned`)
    } catch (err) {
      recordTaskRun(db, venueId, 'nightly', day, false, err instanceof Error ? err.message : String(err), at)
      alertTaskFailure(db, venueId, 'nightly', day, err, at)
      console.error('[sank] nightly failed', err)
    }
  }
}

export default defineTask({
  meta: {
    name: 'nightly',
    description: 'Flag a shift nobody closed; prune old changes and sessions at local 05:00',
  },
  run() {
    if (tasksDisabled()) return Promise.resolve({ result: 'skipped' as const })
    nightlyRun(useDb())
    return Promise.resolve({ result: 'ok' as const })
  },
})
