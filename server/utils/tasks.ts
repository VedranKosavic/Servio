/**
 * The three pieces every scheduled task needs, in one place.
 *
 * **What a "task" is here.** Nitro can run cron jobs inside the same Node
 * process that serves requests (`nitro.experimental.tasks` +
 * `nitro.scheduledTasks` in `nuxt.config.ts`). There is no system crontab for
 * them and no second process: one café, one SQLite file, one writer. The unit
 * sets `TZ=UTC` (§10), so every cron expression in `nuxt.config.ts` is in UTC
 * and any task that needs to know what time it is *in the café* asks
 * `shared/dates.ts`, never `getHours()`.
 *
 * **They are no-ops under vitest.** A task is a side effect on a shared file and
 * the network; a suite that ran them would be a suite whose results depend on
 * the wall clock. `runTask()` returns immediately when `tasksDisabled()` says so,
 * and the tests exercise the *bodies* (`nightlyRun`, `backupOnce`) directly with
 * an injected `now` instead.
 */
import { and, eq } from 'drizzle-orm'
import { schema } from '../database/client'
import type { Db } from '../database/client'
import { newId, nowIso } from './ids'
import { queueAlert } from '../services/alerts'
import type { AlertRuleKey } from '#shared/constants'

/**
 * Vitest sets `VITEST`; a CI runner or the systemd unit set `NODE_ENV`. Either
 * is enough — the point is that nothing scheduled runs while a test suite owns
 * the database.
 */
export function tasksDisabled(): boolean {
  return Boolean(process.env.VITEST) || process.env.NODE_ENV === 'test'
}

/** Every venue in the file. One today; the loop is what makes a second one an insert. */
export function venueIds(db: Db): string[] {
  return db.select({ id: schema.venues.id }).from(schema.venues).all().map(r => r.id)
}

/**
 * Claim a once-a-day job. `true` means "it is yours to run".
 *
 * `task_runs` has `UNIQUE(venue_id, task, business_date)` and this is an
 * `INSERT OR IGNORE`, so the claim is the insert: if no row appeared, somebody
 * already did it (a restart at 05:20 after the 05:15 run, a dev server left
 * open beside the real one). No lock, no flag file, no window in which two runs
 * both think they are first — SQLite's unique index is the whole mechanism.
 */
export function claimTaskRun(
  db: Db, venueId: string, task: string, businessDate: string, at = nowIso(),
): boolean {
  const row = db.insert(schema.taskRuns)
    .values({ id: newId(), venueId, task, businessDate, ranAt: at, ok: 1, error: null })
    .onConflictDoNothing()
    .returning({ id: schema.taskRuns.id })
    .get()
  return row !== undefined
}

/**
 * Record how it went. The claim above wrote `ok = 1` optimistically, because a
 * task that crashes hard enough never gets to write anything at all and a row
 * saying "ran, and we never heard back" is worse than one saying "ran".
 *
 * `hourly: true` is for the backup, which runs sixteen times a day against a
 * unique key with one slot per day: the row then means "how did today's backups
 * end", which is the question anybody actually asks it.
 */
export function recordTaskRun(
  db: Db, venueId: string, task: string, businessDate: string,
  ok: boolean, error?: string, at = nowIso(),
): void {
  const existing = db.select({ id: schema.taskRuns.id }).from(schema.taskRuns)
    .where(and(
      eq(schema.taskRuns.venueId, venueId),
      eq(schema.taskRuns.task, task),
      eq(schema.taskRuns.businessDate, businessDate),
    ))
    .get()

  const values = { ranAt: at, ok: ok ? 1 : 0, error: error?.slice(0, 500) ?? null }

  if (existing) {
    db.update(schema.taskRuns).set(values).where(eq(schema.taskRuns.id, existing.id)).run()
    return
  }
  db.insert(schema.taskRuns)
    .values({ id: newId(), venueId, task, businessDate, ...values })
    .onConflictDoNothing()
    .run()
}

/**
 * A task blew up: queue the mirror.
 *
 * `health` is one of the two rule keys with no log kind behind it (§9) — there
 * is no *business* event here, only the machine saying it could not do its job.
 * The `ref` is `(task, '<task>:<business date>')`, so a backup that fails every
 * hour for a day sends one message, not sixteen.
 */
export function alertTaskFailure(
  db: Db, venueId: string, task: string, businessDate: string, err: unknown,
  at = nowIso(), ruleKey: AlertRuleKey = 'health',
): void {
  const message = err instanceof Error ? err.message : String(err)
  db.transaction((tx) => {
    queueAlert(tx, venueId, {
      ruleKey,
      ref: { type: 'task', id: `${task}:${businessDate}` },
      payload: { title_bs: `Zadatak "${task}" nije uspio · ${message.slice(0, 160)}` },
      at,
    })
  })
}
