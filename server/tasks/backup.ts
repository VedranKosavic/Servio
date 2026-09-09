/**
 * An hourly copy of the database, for a machine with no cron and no `sqlite3`.
 *
 * **Why a copy needs a special API at all.** The database runs in WAL mode
 * (Write-Ahead Logging): a commit is written to a side file, `sank.db-wal`, and
 * folded back into `sank.db` later. So `cp sank.db elsewhere.db` taken while a
 * waiter is locking a round copies the file as of some arbitrary earlier moment,
 * silently missing everything still in the WAL — you find out the day you
 * restore it and last night is gone. better-sqlite3's `sqlite.backup(dest)` is a
 * binding to SQLite's own **online backup API**: it reads a consistent snapshot
 * including the WAL, while the app keeps writing, and never blocks anybody.
 *
 * **This is the laptop's backup, not the VPS's.** It is skipped entirely unless
 * `BACKUP_DIR` is set, and `/opt/sank/.env` deliberately does not set it (§10):
 * on the server `/etc/cron.d/sank-backup` runs `deploy/backup-db.sh`, which
 * survives a wedged Node process — and an in-process task cannot back up a
 * process that has stopped running. The two write the same two folders with the
 * same retention, so a restore reads the same either way.
 *
 * The schedule mirrors cron's: hourly into `hourly/` while the café is open
 * (local 12:00–04:00, keep 48 ≈ two days) and once into `daily/` at local 05:00,
 * after the night is over and before the business day rolls at 06:00 (keep 30).
 * Between 06:00 and 11:00 nothing happens, because nothing has changed.
 */
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { useDb, useSqlite } from '../utils/db'
import { nowIso } from '../utils/ids'
import { businessDate, localTime } from '#shared/dates'
import { getSettings } from '../services/contracts'
import { alertTaskFailure, recordTaskRun, tasksDisabled, venueIds } from '../utils/tasks'
import type { Db } from '../database/client'
import type Database from 'better-sqlite3'

/** Which folder this hour writes into, and how many files it keeps there. */
interface Bucket { name: 'hourly' | 'daily', keep: number }

const HOURLY: Bucket = { name: 'hourly', keep: 48 }
const DAILY: Bucket = { name: 'daily', keep: 30 }

/**
 * The café's own clock decides, not the server's: the unit sets `TZ=UTC`, so
 * `new Date().getHours()` on the VPS is an hour or two off the wall clock in
 * Sarajevo and would file a 05:00 daily copy as an hourly one.
 */
export function bucketForHour(localHour: number): Bucket | null {
  if (localHour === 5) return DAILY
  if (localHour >= 12 || localHour <= 4) return HOURLY
  return null
}

/**
 * Take one backup. Exported so a test can call it with an explicit `now` and a
 * temporary directory instead of waiting for the top of an hour.
 */
export async function backupOnce(
  db: Db, sqlite: Database.Database, dir: string, at = nowIso(),
): Promise<string | null> {
  const settings = getSettings(db, venueIds(db)[0] ?? '')
  const hour = Number(localTime(at, settings.timezone).slice(0, 2))
  const bucket = bucketForHour(hour)
  if (!bucket) return null

  const target = resolve(dir, bucket.name)
  mkdirSync(target, { recursive: true })

  const stamp = at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  const file = join(target, `sank-${stamp}.db`)

  // The one `await` in this file, and it is why the whole function is async:
  // SQLite's backup runs in steps so the writer is never locked out for long.
  await sqlite.backup(file)

  prune(target, bucket.keep)
  return file
}

/** Keep the newest `keep` files, delete the rest. Names sort by time. */
function prune(dir: string, keep: number): void {
  const files = readdirSync(dir)
    .filter(name => name.startsWith('sank-') && name.endsWith('.db'))
    .sort()
  for (const name of files.slice(0, Math.max(0, files.length - keep))) {
    // The sidecars too: opening a WAL-mode copy can leave a `-wal` and a `-shm`
    // beside it, and a backup should be one self-contained file.
    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(join(dir, name + suffix), { force: true })
    }
  }
}

export default defineTask({
  meta: {
    name: 'backup',
    description: 'Online SQLite backup into BACKUP_DIR (unset on the VPS: cron owns it there)',
  },
  async run() {
    if (tasksDisabled()) return { result: 'skipped' as const }

    const dir = process.env.BACKUP_DIR
    if (!dir) return { result: 'skipped' as const }

    const db = useDb()
    const at = nowIso()
    const venue = venueIds(db)[0]
    if (!venue) return { result: 'skipped' as const }

    const settings = getSettings(db, venue)
    const day = businessDate(at, settings.timezone, settings.business_day_start_hour)

    try {
      const file = await backupOnce(db, useSqlite(), dir, at)
      if (!file) return { result: 'skipped' as const }

      recordTaskRun(db, venue, 'backup', day, true, undefined, at)
      // Not `console.info` per file at INFO on the VPS — but this task only ever
      // runs where BACKUP_DIR is set, which is a developer's machine.
      console.info(`[sank] backup → ${file}`)
      return { result: 'ok' as const }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      recordTaskRun(db, venue, 'backup', day, false, message, at)
      alertTaskFailure(db, venue, 'backup', day, err, at)
      console.error('[sank] backup failed', err)
      return { result: 'failed' as const }
    }
  },
})
