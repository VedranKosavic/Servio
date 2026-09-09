/**
 * The phones and the tablet.
 *
 * A device is the app's second credential and it is the one that makes every
 * other rule affordable: because a `sank_d` cookie proves *which* phone is
 * asking, a 4-digit PIN is enough for the person holding it. Without it, the
 * PIN would have to be a password.
 *
 * Two modes (`docs/BACKEND.md` §3.2, §5.1):
 *
 * - **`shared`** — the bar tablet. Anybody on the staff may PIN into it, 14 h.
 * - **`personal`** — somebody's own phone, `bound_user_id`. Its owner gets 14 h;
 *   a colleague has to say "I am borrowing this" and gets 2 h and a flag.
 *
 * The raw token exists in exactly two places: the `Set-Cookie` header once, and
 * the browser. What the database holds is its sha256, so a copy of the file is
 * not a drawer full of enrolled phones.
 */
import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import { schema } from '../database/client'
import { badRequest, conflict, notFound, unauthorized } from '../utils/errors'
import { newId, nowIso } from '../utils/ids'
import { hashSecret, hashToken, newEnrolCode, newToken, verifySecret } from '../utils/password'
import {
  DEV_DEVICE_LABEL, activeUsers, currentSeq, ifLanded, revokeSessionsOfDevice,
  toDeviceBrief, toMeUser, venueBrief, verifyMetered,
} from './auth'
import { currentShift, getSettings, log } from './contracts'
import type { Db, Queryable, Tx } from './types'
import type { Actor } from '#shared/types'
import type {
  DeviceAdmin, EnrolCodeResult, EnrolResult, HeartbeatResult, StaleDevice,
} from '#shared/types/auth'
import type { CreateEnrolCodeBody, EnrolDeviceBody, HeartbeatBody, UpdateDeviceBody } from '#shared/schemas/auth'
import { ENROL_CODE_TTL_S, ENROL_CODE_USES } from '#shared/constants'
import { businessDate } from '#shared/dates'

type DeviceRow = typeof schema.devices.$inferSelect

// ===========================================================================
// Enrolment
// ===========================================================================

/**
 * `POST /api/admin/enrol-codes` — six characters an admin reads out across the
 * bar.
 *
 * The code is hashed like a PIN, not stored in plain text: it is a credential
 * for ten minutes, and ten minutes is long enough to matter if the file leaks.
 * The plain code is returned to the caller once and never again, which is why
 * the response is the only place it exists.
 */
export function mintEnrolCode(
  db: Db, venueId: string, actor: Actor, body: CreateEnrolCodeBody, now = nowIso(),
): EnrolCodeResult {
  if (body.mode === 'personal' && !body.bound_user_id) {
    throw badRequest('BOUND_USER_REQUIRED', 'a personal device must be bound to somebody')
  }

  if (body.bound_user_id) {
    const user = db.select({ id: schema.users.id }).from(schema.users)
      .where(and(eq(schema.users.id, body.bound_user_id), eq(schema.users.venueId, venueId)))
      .get()
    if (!user) throw notFound('USER_NOT_FOUND', 'no such user in this venue')
  }

  const code = newEnrolCode()
  const id = newId()
  const expiresAt = new Date(Date.parse(now) + ENROL_CODE_TTL_S * 1000).toISOString()

  db.insert(schema.enrolCodes).values({
    id,
    venueId,
    // Hashed with the row's own id as the salt, exactly like a PIN — see
    // `verifyEnrolCode` for why the lookup can still find it.
    code: hashSecret(code, id),
    mode: body.mode,
    boundUserId: body.bound_user_id ?? null,
    label: body.label,
    createdBy: actor.userId,
    createdAt: now,
    expiresAt,
    usesLeft: ENROL_CODE_USES,
  }).run()

  return { code, expires_at: expiresAt, uses_left: ENROL_CODE_USES }
}

/**
 * Find the live code row that matches this plain code.
 *
 * The hash is salted per row, so there is no index to look it up by: this walks
 * the codes that are still alive and compares each one. That sounds wasteful and
 * is not — a venue has at most a handful of unexpired codes at any moment, and
 * `enrol_codes_venue_idx` narrows it to those. The alternative (an unsalted
 * hash) would make one rainbow table of 32^6 break every code ever minted.
 */
function findEnrolCode(db: Db, plain: string, now: string) {
  const live = db.select().from(schema.enrolCodes)
    .where(and(gt(schema.enrolCodes.expiresAt, now), gt(schema.enrolCodes.usesLeft, 0)))
    .all()
  return live.find(row => verifySecret(plain, row.id, row.code)) ?? null
}

/**
 * `POST /api/devices/enrol` — a phone joins the venue.
 *
 * A 6-character code from a 32-letter alphabet is a billion candidates, which is
 * plenty — but only while somebody is counting the guesses, and `uses_left`
 * counts *successes*. So the failures go through `verifyMetered` like every
 * other secret in the app and leave an `auth_attempts` row behind.
 *
 * The response carries the venue and the staff list, so the phone can draw its
 * lock screen the moment the code is accepted, before any session exists.
 */
export function enrolDevice(
  db: Db, body: EnrolDeviceBody, ctx: { ip: string, now?: string },
): { result: EnrolResult, token: string } {
  const now = ctx.now ?? nowIso()
  const row = findEnrolCode(db, body.code, now)

  // A code that matched nothing still costs a full scrypt and still writes an
  // attempt row: `verifyMetered` with `stored: null` is how a miss and a hit
  // take the same milliseconds and are counted the same way.
  verifyMetered(db, row?.venueId ?? null, {
    kind: 'enrol',
    subject: { deviceId: null, userId: null, ip: ctx.ip },
    stored: row ? row.code : null,
    saltId: row?.id ?? 'dummy',
    plain: body.code,
    now,
  })

  const code = row!
  const token = newToken()
  const deviceId = newId()

  db.transaction((tx) => {
    tx.update(schema.enrolCodes)
      .set({ usesLeft: code.usesLeft - 1 })
      .where(eq(schema.enrolCodes.id, code.id))
      .run()

    tx.insert(schema.devices).values({
      id: deviceId,
      venueId: code.venueId,
      label: body.label ?? code.label,
      tokenHash: hashToken(token),
      mode: code.mode,
      boundUserId: code.boundUserId,
      enrolledAt: now,
      enrolledBy: code.createdBy,
      appVersion: body.app_version ?? null,
      pendingCount: 0,
      clockSkewS: 0,
    }).run()

    ifLanded(() => log(tx, code.venueId, {
      kind: 'device_enrolled',
      body: { device_id: deviceId, label: body.label ?? code.label },
      actorId: code.boundUserId,
      deviceId,
      ref: { type: 'device', id: deviceId },
    }))
  })

  const device = db.select().from(schema.devices).where(eq(schema.devices.id, deviceId)).get()!
  return { result: enrolResult(db, device), token }
}

function enrolResult(db: Db, device: DeviceRow): EnrolResult {
  return {
    device: toDeviceBrief(device),
    venue: venueBrief(db, device.venueId),
    users: activeUsers(db, device.venueId).map(toMeUser),
  }
}

/**
 * `POST /api/dev/enrol` — the one-tap dev door (§5.6).
 *
 * It keeps a single `label='dev'` shared device per venue and mints it a fresh
 * token every time, so the last browser to tap the button wins. That is the
 * documented trade (open decision 7): if two dev browsers are ever needed side
 * by side, key it on a `?name=` query.
 *
 * The route file is the thing that refuses to exist without `SANK_DEV_ENROL=1`;
 * this service is only reachable through it.
 */
export function devEnrol(db: Db, venueId: string, now = nowIso()): { result: EnrolResult, token: string } {
  const token = newToken()

  const existing = db.select().from(schema.devices)
    .where(and(eq(schema.devices.venueId, venueId), eq(schema.devices.label, DEV_DEVICE_LABEL)))
    .get()

  const deviceId = existing?.id ?? newId()

  db.transaction((tx) => {
    if (existing) {
      tx.update(schema.devices).set({
        tokenHash: hashToken(token),
        revokedAt: null,
        revokedBy: null,
        // A dev device that locked itself on a lockout test must come back with
        // the next tap, or the test that proved the lock also broke the laptop.
        lockedAt: null,
        lastSeenAt: now,
      }).where(eq(schema.devices.id, deviceId)).run()
    } else {
      tx.insert(schema.devices).values({
        id: deviceId,
        venueId,
        label: DEV_DEVICE_LABEL,
        tokenHash: hashToken(token),
        mode: 'shared',
        boundUserId: null,
        enrolledAt: now,
        enrolledBy: null,
        lastSeenAt: now,
        pendingCount: 0,
        clockSkewS: 0,
      }).run()
    }
  })

  const device = db.select().from(schema.devices).where(eq(schema.devices.id, deviceId)).get()!
  return { result: enrolResult(db, device), token }
}

// ===========================================================================
// The admin's device list
// ===========================================================================

export function listDevices(q: Queryable, venueId: string): DeviceAdmin[] {
  const users = new Map(
    q.select({ id: schema.users.id, name: schema.users.name }).from(schema.users)
      .where(eq(schema.users.venueId, venueId)).all()
      .map(u => [u.id, u.name] as const),
  )

  return q.select().from(schema.devices)
    .where(eq(schema.devices.venueId, venueId))
    .all()
    .map(d => ({
      id: d.id,
      label: d.label,
      mode: d.mode,
      bound_user_id: d.boundUserId,
      bound_user_name: d.boundUserId ? users.get(d.boundUserId) ?? null : null,
      enrolled_at: d.enrolledAt,
      last_seen_at: d.lastSeenAt,
      app_version: d.appVersion,
      standalone: d.standalone === null ? null : d.standalone === 1,
      pending_count: d.pendingCount,
      clock_skew_s: d.clockSkewS,
      locked_at: d.lockedAt,
      revoked_at: d.revokedAt,
    }))
}

function requireDevice(q: Queryable, venueId: string, deviceId: string): DeviceRow {
  const device = q.select().from(schema.devices)
    .where(and(eq(schema.devices.id, deviceId), eq(schema.devices.venueId, venueId)))
    .get()
  if (!device) throw notFound('DEVICE_NOT_FOUND', 'no such device in this venue')
  return device
}

/** `PATCH /api/admin/devices/:id` — the label, and nothing else. */
export function updateDevice(
  db: Db, venueId: string, _actor: Actor, deviceId: string, body: UpdateDeviceBody,
): DeviceAdmin {
  requireDevice(db, venueId, deviceId)
  db.update(schema.devices).set({ label: body.label })
    .where(eq(schema.devices.id, deviceId)).run()
  return listDevices(db, venueId).find(d => d.id === deviceId)!
}

/**
 * `POST /api/admin/devices/:id/revoke` — the phone is lost, or the person left.
 *
 * Revoking kills every live session on it in the same transaction. A revoke that
 * left the sessions alive would mean the phone kept working for fourteen hours,
 * which is the opposite of what the button says.
 */
export function revokeDevice(
  db: Db, venueId: string, actor: Actor, deviceId: string, now = nowIso(),
): DeviceAdmin {
  const device = requireDevice(db, venueId, deviceId)
  if (device.revokedAt) throw conflict('DEVICE_ALREADY_REVOKED', 'this device is already revoked')

  db.transaction((tx) => {
    tx.update(schema.devices)
      .set({ revokedAt: now, revokedBy: actor.userId })
      .where(eq(schema.devices.id, deviceId))
      .run()
    revokeSessionsOfDevice(tx, venueId, deviceId, now)
    ifLanded(() => log(tx, venueId, {
      kind: 'device_revoked',
      body: { device_id: deviceId, label: device.label },
      actorId: actor.userId,
      ref: { type: 'device', id: deviceId },
    }))
  })

  return listDevices(db, venueId).find(d => d.id === deviceId)!
}

/**
 * `POST /api/admin/devices/:id/unlock` — the other way back in after the 15-fail
 * device lock (§5.2), for when the locked-out person is not the one you want to
 * re-PIN.
 *
 * It deliberately does **not** clear `auth_attempts`. The evidence stays; only
 * the door reopens.
 */
export function unlockDevice(
  db: Db, venueId: string, actor: Actor, deviceId: string, now = nowIso(),
): DeviceAdmin {
  const device = requireDevice(db, venueId, deviceId)
  if (!device.lockedAt) throw conflict('DEVICE_NOT_LOCKED', 'this device is not locked')

  db.transaction((tx) => {
    tx.update(schema.devices).set({ lockedAt: null }).where(eq(schema.devices.id, deviceId)).run()
    ifLanded(() => log(tx, venueId, {
      kind: 'device_unlocked',
      body: { device_id: deviceId, label: device.label, via: 'unlock' },
      actorId: actor.userId,
      ref: { type: 'device', id: deviceId },
    }))
  })

  return listDevices(db, venueId).find(d => d.id === deviceId)!
}

// ===========================================================================
// Heartbeat (§4.3) — the route is WP5's, the service is here
// ===========================================================================

/**
 * `POST /api/devices/heartbeat`, every 60 s while the app is visible and after
 * every successful flush of the offline outbox.
 *
 * It answers two questions the rest of the app cannot answer on its own: how
 * many rounds are still sitting in this phone's outbox (which is what blocks a
 * settle), and how far the phone's clock is from the server's (which is why a
 * round queued at 02:30 lands on the right business date).
 *
 * **It never bumps `changes`.** A bump every 60 s per device would invalidate
 * every waiter's ETag every minute and turn the whole polling design into a
 * full read on every poll.
 */
export function heartbeat(
  db: Db, venueId: string, deviceId: string, body: HeartbeatBody, at = nowIso(),
): HeartbeatResult {
  const settings = getSettings(db, venueId)

  // Clamped to an hour either way: past that it is not a clock that drifted, it
  // is a clock that was never set, and a six-month offset in an integer column
  // would poison every `clampEventAt` that reads it.
  const rawSkew = Math.round((Date.parse(body.client_now) - Date.parse(at)) / 1000)
  const clockSkewS = Math.max(-3600, Math.min(3600, rawSkew))

  db.transaction((tx) => {
    tx.update(schema.devices).set({
      pendingCount: body.pending,
      oldestPendingAt: body.oldest_pending_at ?? null,
      lastSeenAt: at,
      appVersion: body.app_version,
      standalone: body.standalone ? 1 : 0,
      clockSkewS,
    }).where(and(eq(schema.devices.id, deviceId), eq(schema.devices.venueId, venueId))).run()

    if (Math.abs(clockSkewS) > settings.clock_skew_alert_s) {
      // The ref is the device *and the business date*, so a phone with a wrong
      // clock produces one entry a night rather than one a minute.
      //
      // No `queueAlert` here, deliberately: §4.3 describes one with a
      // `'clock_skew'` rule key, but `ALERT_RULE_KEYS` is frozen for Korak 2 and
      // has no such key — `queueAlert` would not typecheck, and a drifting clock
      // is a Dnevnik line, not a reason to wake the owner. The entry is the
      // record; WP5 adds the key if the owner ever wants the message.
      const day = businessDate(at, settings.timezone, settings.business_day_start_hour)
      ifLanded(() => log(tx, venueId, {
        kind: 'clock_skew',
        body: { device_id: deviceId, skew_s: clockSkewS },
        deviceId,
        ref: { type: 'device', id: `${deviceId}:${day}` },
      }))
    }
  })

  const shift = currentShift(db, venueId)
  return {
    server_now: at,
    clock_skew_s: clockSkewS,
    seq: currentSeq(db, venueId),
    shift_closing: shift?.status === 'closing',
    revoked: false,
  }
}

// ===========================================================================
// The one outbox check (§6.6)
// ===========================================================================

/**
 * "Is a phone still holding rounds that belong in this shift?"
 *
 * One rule, one implementation, living with the column it reads
 * (`devices.pending_count`, written by the heartbeat above). Both callers — the
 * settle in WP2 and the count confirm in WP4 — import it from `contracts.ts`.
 *
 * The fresh/stale split is the whole subtlety. A device that heartbeat within
 * `heartbeat_fresh_s` and still reports an outbox is *actively* holding money:
 * that is a 409, because settling now would leave rounds outside the numbers.
 * A device that has not been heard from in an hour is probably in a coat pocket
 * or switched off; blocking on it would make an honest hand-over impossible, so
 * it is **returned** to the caller and reported on the screen instead.
 */
export function assertNoPendingOutbox(
  tx: Tx, venueId: string, shiftId: string | null, opts: {
    actor: Actor
    override?: boolean
    /** Settle looks at one person's devices; a count looks at every device in the shift. */
    userId?: string
  },
  now = nowIso(),
): StaleDevice[] {
  if (!shiftId) return []

  const settings = getSettings(tx, venueId)

  const deviceIds = tx.selectDistinct({ id: schema.orders.deviceId })
    .from(schema.orders)
    .where(and(
      eq(schema.orders.venueId, venueId),
      eq(schema.orders.shiftId, shiftId),
      opts.userId ? eq(schema.orders.lockedBy, opts.userId) : sql`1 = 1`,
      sql`${schema.orders.deviceId} IS NOT NULL`,
    ))
    .all()
    .map(r => r.id)
    .filter((id): id is string => id !== null)

  if (deviceIds.length === 0) return []

  const rows = tx.select().from(schema.devices)
    .where(and(
      eq(schema.devices.venueId, venueId),
      inArray(schema.devices.id, deviceIds),
      gt(schema.devices.pendingCount, 0),
      isNull(schema.devices.revokedAt),
    ))
    .all()

  const freshFrom = new Date(Date.parse(now) - settings.heartbeat_fresh_s * 1000).toISOString()
  const brief = (d: DeviceRow): StaleDevice => ({
    device_id: d.id, label: d.label, pending_count: d.pendingCount, last_seen_at: d.lastSeenAt,
  })

  const fresh = rows.filter(d => d.lastSeenAt !== null && d.lastSeenAt >= freshFrom)
  const stale = rows.filter(d => d.lastSeenAt === null || d.lastSeenAt < freshFrom)

  if (fresh.length > 0) {
    if (!(opts.override && opts.actor.role === 'admin')) {
      throw conflict('PENDING_OUTBOX', 'a phone is still holding rounds for this shift')
    }
    ifLanded(() => log(tx, venueId, {
      kind: 'override',
      body: { what: 'unsent' },
      actorId: opts.actor.userId,
      shiftId,
    }))
  }

  return stale.map(brief)
}

/**
 * The device behind a `sank_d` cookie, refused when it is revoked or locked.
 * Used by the two `public` routes that still need one (`POST /api/auth/pin`,
 * `GET /api/auth/users`).
 */
export function requireEnrolledDevice(q: Queryable, token: string | undefined): DeviceRow {
  const device = token
    ? q.select().from(schema.devices).where(eq(schema.devices.tokenHash, hashToken(token))).get()
    : undefined
  if (!device) throw unauthorized('NO_DEVICE', 'this device is not enrolled')
  if (device.revokedAt) throw unauthorized('DEVICE_REVOKED', 'this device was revoked')
  if (device.lockedAt) throw unauthorized('DEVICE_REVOKED', 'this device is locked')
  return device
}
