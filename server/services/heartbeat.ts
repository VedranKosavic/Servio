/**
 * `POST /api/devices/heartbeat` (`docs/BACKEND.md` §4.3).
 *
 * Every 60 s while it is visible, and after every successful flush, a phone says
 * three things about itself: how many rounds are still stuck in its offline
 * outbox, how old the oldest one is, and what time it thinks it is. The server
 * writes all three onto the `devices` row and answers with its own clock.
 *
 * **The heartbeat never bumps `changes`.** Sixty seconds is faster than
 * anything on the floor moves, and a bump would invalidate every waiter's ETag
 * on every tick — turning the cheap 304 poll the whole sync design rests on back
 * into a full floor-plan read. The one exception is the once-per-device-per-night
 * `clock_skew` entry: a Dnevnik entry nobody is told about is a Dnevnik entry
 * nobody reads, so *that* path bumps `log`, exactly once a night per device.
 *
 * **Where this file goes when WP1 lands.** §12 puts `heartbeat()` in
 * `services/devices.ts`, which belongs to the auth package — but that package
 * has not landed, and creating its file here would be the merge conflict §12
 * exists to prevent. So the implementation sits in its own file and
 * `contracts.ts` re-exports it; WP1 moves the body into `devices.ts` and
 * repoints one line, and no caller changes.
 */
import { and, eq } from 'drizzle-orm'
import { schema } from '../database/client'
import { SankError } from '../utils/errors'
import { emitChange } from '../utils/bus'
import { nowIso } from '../utils/ids'
import { businessDate } from '#shared/dates'
import type { HeartbeatBody } from '#shared/schemas'
import type { HeartbeatResult } from '#shared/types'
import type { Db } from './types'
import { getSettings, currentShift } from './contracts'
import { maxSeq } from './changes'
import { hasEntryFor, log } from './log'

/** A clock more than an hour out is broken, not skewed; ±1 h is the useful range. */
const MAX_SKEW_S = 3600

export function heartbeat(
  db: Db, venueId: string, deviceId: string, body: HeartbeatBody, at = nowIso(),
): HeartbeatResult {
  const result = db.transaction((tx) => {
    const device = tx.select().from(schema.devices)
      .where(and(eq(schema.devices.venueId, venueId), eq(schema.devices.id, deviceId)))
      .get()
    if (!device) {
      // WP1 owns the sentence for this code (`shared/errors/auth.ts`); the
      // heartbeat is simply the first route that needs to throw it.
      throw new SankError(401, 'NO_DEVICE', `device ${deviceId} not enrolled`)
    }

    const settings = getSettings(tx, venueId)
    const skewS = clockSkewS(body.client_now, at)

    tx.update(schema.devices)
      .set({
        pendingCount: body.pending,
        oldestPendingAt: body.oldest_pending_at ?? null,
        lastSeenAt: at,
        appVersion: body.app_version ?? device.appVersion,
        standalone: body.standalone === undefined ? device.standalone : (body.standalone ? 1 : 0),
        clockSkewS: skewS,
      })
      .where(eq(schema.devices.id, deviceId))
      .run()

    // Once per device per business date. There is no unique index on
    // `log_entries`, so the dedupe is an explicit existence check on the
    // composed ref — which is safe here for the same reason `ensureOpenShift`
    // needs no retry: better-sqlite3 is synchronous and there is one process.
    let entry: string | null = null
    if (Math.abs(skewS) > settings.clock_skew_alert_s) {
      const day = businessDate(at, settings.timezone, settings.business_day_start_hour)
      const ref = { type: 'device', id: `${deviceId}:${day}` }
      if (!hasEntryFor(tx, venueId, 'clock_skew', ref)) {
        entry = log(tx, venueId, {
          kind: 'clock_skew',
          body: { device_id: deviceId, skew_s: skewS },
          actorId: null,
          deviceId,
          ref,
          at,
        })
      }
    }

    const shift = currentShift(tx, venueId)

    return {
      entry,
      value: {
        server_now: at,
        clock_skew_s: skewS,
        seq: maxSeq(tx, venueId),
        shift_closing: shift?.status === 'closing',
        revoked: device.revokedAt !== null,
      } satisfies HeartbeatResult,
    }
  })

  // Only the once-a-night skew entry has anything to announce; the routine
  // heartbeat commits no `changes` row and emits nothing (see the header).
  if (result.entry) {
    emitChange(venueId, { seq: result.value.seq, entity: 'log', entityId: result.entry })
  }

  return result.value
}

/**
 * **device clock − server clock**, clamped to ±1 h. Negative means the phone is
 * behind, which is what the Bosnian title renders as *sat kasni*.
 *
 * The sign is not arbitrary: `clampEventAt` (`shared/dates.ts`) subtracts this
 * number from a claimed `client_created_at` to turn what the phone *thinks* it
 * is into what it actually was, so it must be the phone's error, not the
 * server's. §4.3 writes the subtraction the other way round; the two consumers
 * that already exist — that clamp and the `clock_skew` title — both need this
 * one, so this is the sign that ships.
 */
export function clockSkewS(clientNow: string, serverNow: string): number {
  const skew = Math.round((Date.parse(clientNow) - Date.parse(serverNow)) / 1000)
  if (!Number.isFinite(skew)) return 0
  return Math.max(-MAX_SKEW_S, Math.min(MAX_SKEW_S, skew))
}
