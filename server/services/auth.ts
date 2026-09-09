/**
 * Who you are, and whether you may.
 *
 * Three doors lead into this app and all three come through one verifier
 * (`docs/BACKEND.md` §5):
 *
 * - the owner's laptop, email + password → a 30-day `admin` session;
 * - a phone posting a 6-character enrol code → a device cookie (`services/devices.ts`);
 * - a person tapping a PIN on an enrolled device → a 14-hour `staff` session.
 *
 * **The one rule that makes lockout real.** A failed attempt written *inside*
 * the transaction that then throws is rolled back with it, so the counter would
 * count nothing and a 4-digit PIN would fall in an afternoon. Every function
 * here that meters a secret therefore takes `Db` and not `Tx` — the type system
 * refuses the broken shape — and writes its attempt row in its own committed
 * transaction *before* it throws (§2, "the transaction that rejects must not
 * carry the evidence").
 *
 * **A path with no `auth_attempts` row is a path with no lockout.** That is why
 * nothing here exports a raw comparison and no route calls `verifySecret`
 * directly: `verifyMetered` is the only way to check a secret in this codebase.
 */
import { and, eq, gt, gte, inArray, isNull, sql } from 'drizzle-orm'
import { schema } from '../database/client'
import { SankError, badRequest, forbidden, locked, notFound, unauthorized, unprocessable } from '../utils/errors'
import { newId, nowIso } from '../utils/ids'
import { hashSecret, hashToken, newToken, verifySecret } from '../utils/password'
import { pinLimiter } from '../utils/rate-limit'
import { getSettings, log } from './contracts'
import type { Db, Queryable, Tx } from './types'
import type { Actor, Role } from '#shared/types'
import type {
  AdminLoginResult, DeviceBrief, MeContext, MeUser, PinLoginResult, SessionBrief, VenueBrief,
} from '#shared/types/auth'
import type { AdminLoginBody, PinLoginBody } from '#shared/schemas/auth'
import { ROUTE_ROLES, routeKey, type RouteRole } from '#shared/routeRoles'
import {
  ADMIN_SESSION_S, ADMIN_SLIDE_EVERY_S, BORROWED_SESSION_S, DEVICE_LOCK_FAILS,
  LOCKOUT_STEPS, LOCKOUT_WINDOW_S, STAFF_SESSION_S,
} from '#shared/constants'

type UserRow = typeof schema.users.$inferSelect
type DeviceRow = typeof schema.devices.$inferSelect
type SessionRow = typeof schema.sessions.$inferSelect

// ===========================================================================
// Cross-package calls that have not landed yet
// ===========================================================================

/**
 * Call a `contracts.ts` helper whose work package may not be merged yet.
 *
 * WP1 is written and merged before WP5, which owns `log()`, `bump()` and
 * `queueAlert()`. The call sites below are the real, permanent ones — a device
 * unlock genuinely belongs in the Dnevnik — but on this branch they would throw
 * 501 `NOT_IMPLEMENTED` and turn a lockout into a crash. So the call is made and
 * *only* a `NOT_IMPLEMENTED` is swallowed; every other error still propagates.
 *
 * **WP8 deletes this function** and unwraps its four call sites: by then every
 * package has landed and a missing entry is a bug, not a schedule.
 */
export function ifLanded<T>(call: () => T): T | undefined {
  try {
    return call()
  } catch (err) {
    if (err instanceof SankError && err.code === 'NOT_IMPLEMENTED') return undefined
    throw err
  }
}

// ===========================================================================
// The public shapes
// ===========================================================================

/** A person as every screen sees them — never a hash, never an email (§5.5). */
export function toMeUser(row: UserRow): MeUser {
  return {
    id: row.id,
    name: row.name,
    initials: row.initials,
    role: row.role,
    active: row.active === 1,
    pin_len: row.pinLen === 6 ? 6 : 4,
    has_pin: row.pinHash !== null,
  }
}

export function toDeviceBrief(row: DeviceRow): DeviceBrief {
  return {
    id: row.id,
    label: row.label,
    mode: row.mode,
    bound_user_id: row.boundUserId,
    locked_at: row.lockedAt,
    pending_count: row.pendingCount,
    clock_skew_s: row.clockSkewS,
  }
}

function toSessionBrief(row: SessionRow): SessionBrief {
  return {
    id: row.id,
    kind: row.kind,
    expires_at: row.expiresAt,
    borrowed: row.borrowed === 1,
  }
}

export function venueBrief(q: Queryable, venueId: string): VenueBrief {
  const row = q.select().from(schema.venues).where(eq(schema.venues.id, venueId)).get()
  if (!row) throw notFound('NO_VENUE', 'no venue in the database — run `npm run db:seed`')
  return { id: row.id, name: row.name, slug: row.slug, settings: getSettings(q, venueId) }
}

/**
 * The sync cursor right now.
 *
 * WP5 owns the feed itself (`services/changes.ts`); this is one indexed
 * `MAX(seq)` over a table, which every envelope in §7 carries so a screen can
 * start polling from where it booted.
 */
export function currentSeq(q: Queryable, venueId: string): number {
  const row = q.select({ max: sql<number | null>`max(${schema.changes.seq})` })
    .from(schema.changes)
    .where(eq(schema.changes.venueId, venueId))
    .get()
  return row?.max ?? 0
}

// ===========================================================================
// Metered secret verification (§5.2)
// ===========================================================================

export type AttemptKind = 'pin' | 'password' | 'enrol' | 'approve'

/**
 * What the failures are counted against.
 *
 * `auth_attempts` has no column for a free-text handle, so the two doors that
 * have no user *row* to point at are keyed on what they do have (§5.2's table,
 * expressed in the columns that exist):
 *
 * | kind | counted against |
 * |---|---|
 * | `pin`, `approve` | `(device_id, user_id)` |
 * | `password` | `(ip, user_id)` — resolved from the email, `NULL` when it matches nobody, so every unknown address from one address shares one bucket and a real admin's bucket is his own |
 * | `enrol` | `(ip)` — a code is not a person |
 */
export interface AttemptSubject {
  deviceId: string | null
  userId: string | null
  ip: string
}

export interface LockoutState {
  locked: boolean
  /** Whole seconds until the door opens again. 0 when not locked. */
  retryAfterS: number
  /** Consecutive failures since the last success or PIN reset, unwindowed. */
  fails: number
  /** The same count, inside `LOCKOUT_WINDOW_S` — what the step-ups read. */
  windowedFails: number
}

/** The `WHERE` that says "this subject", per the table above. */
function subjectWhere(venueId: string, kind: AttemptKind, s: AttemptSubject) {
  const venue = eq(schema.authAttempts.venueId, venueId)
  if (kind === 'pin' || kind === 'approve') {
    return and(
      venue,
      inArray(schema.authAttempts.kind, ['pin', 'approve']),
      // `IS` and not `=`: SQL equality against NULL is never true, and an admin
      // email session legitimately has no device.
      sql`${schema.authAttempts.deviceId} IS ${s.deviceId}`,
      sql`${schema.authAttempts.userId} IS ${s.userId}`,
    )
  }
  if (kind === 'password') {
    return and(
      venue,
      eq(schema.authAttempts.kind, 'password'),
      eq(schema.authAttempts.ip, s.ip),
      sql`${schema.authAttempts.userId} IS ${s.userId}`,
    )
  }
  return and(venue, eq(schema.authAttempts.kind, 'enrol'), eq(schema.authAttempts.ip, s.ip))
}

/**
 * How many failures stand against this subject, and whether the door is shut.
 *
 * `last_clear` is the moment the counter was reset: the subject's own last
 * success, or an admin resetting this person's PIN on **any** device — because
 * "Emir forgot his PIN, here is a new one" has to clear Emir's failures
 * everywhere, not only on the tablet he happened to be holding.
 *
 * Two windows, and the difference is the whole design: the 5-fail and 10-fail
 * step-ups only count the last 15 minutes, so an honest person who fat-fingers
 * a PIN twice a night is never locked; the 15-fail **device** lock counts
 * everything since `last_clear`, so pacing the guesses one an hour cannot walk
 * the 10 000 candidates.
 */
export function lockoutState(
  q: Queryable, venueId: string, kind: AttemptKind, s: AttemptSubject, now: string,
): LockoutState {
  const mine = subjectWhere(venueId, kind, s)

  // The last thing that wiped the slate: a success of this exact subject, or a
  // PIN reset for this person on any device at all.
  const clearedBySuccess = q.select({ at: sql<string | null>`max(${schema.authAttempts.createdAt})` })
    .from(schema.authAttempts)
    .where(and(mine, eq(schema.authAttempts.ok, 1)))
    .get()?.at ?? null

  const clearedByReset = s.userId
    ? q.select({ at: sql<string | null>`max(${schema.authAttempts.createdAt})` })
        .from(schema.authAttempts)
        .where(and(
          eq(schema.authAttempts.venueId, venueId),
          eq(schema.authAttempts.kind, 'reset'),
          eq(schema.authAttempts.userId, s.userId),
        ))
        .get()?.at ?? null
    : null

  // ISO-8601 UTC strings sort exactly like the instants they describe, which is
  // why every timestamp in this database is one.
  const lastClear = [clearedBySuccess, clearedByReset].filter(Boolean).sort().pop() ?? ''

  const failed = and(mine, eq(schema.authAttempts.ok, 0), gt(schema.authAttempts.createdAt, lastClear))

  const fails = q.select({ n: sql<number>`count(*)` })
    .from(schema.authAttempts).where(failed).get()?.n ?? 0

  const windowStart = new Date(Date.parse(now) - LOCKOUT_WINDOW_S * 1000).toISOString()
  const windowed = q.select({
    n: sql<number>`count(*)`,
    last: sql<string | null>`max(${schema.authAttempts.createdAt})`,
  })
    .from(schema.authAttempts)
    .where(and(failed, gte(schema.authAttempts.createdAt, windowStart)))
    .get()

  const windowedFails = windowed?.n ?? 0
  const lastFailAt = windowed?.last ?? null

  // The longest step this many failures has reached. The lock runs from the
  // *last* failure, so waiting it out works and knocking again restarts it.
  let lockS = 0
  for (const step of LOCKOUT_STEPS) if (windowedFails >= step.fails) lockS = step.lockS

  if (lockS === 0 || !lastFailAt) return { locked: false, retryAfterS: 0, fails, windowedFails }

  const openAtMs = Date.parse(lastFailAt) + lockS * 1000
  const remainingS = Math.ceil((openAtMs - Date.parse(now)) / 1000)
  return remainingS > 0
    ? { locked: true, retryAfterS: remainingS, fails, windowedFails }
    : { locked: false, retryAfterS: 0, fails, windowedFails }
}

/**
 * One committed row, in its own transaction.
 *
 * It takes `Db` and not `Tx` on purpose (§2): a caller who tried to write the
 * evidence inside the transaction it is about to roll back would not compile.
 */
export function recordAttempt(db: Db, venueId: string, e: {
  kind: typeof schema.authAttempts.$inferInsert['kind']
  subject: AttemptSubject
  ok: boolean
  now: string
}): void {
  db.transaction((tx) => {
    tx.insert(schema.authAttempts).values({
      id: newId(),
      venueId,
      deviceId: e.subject.deviceId,
      userId: e.subject.userId,
      ip: e.subject.ip,
      kind: e.kind,
      ok: e.ok ? 1 : 0,
      createdAt: e.now,
    }).run()
  })
}

/**
 * A hash that matches nothing, so an unknown email costs the same milliseconds
 * as a known one.
 *
 * Without this, "no such address" is a free answer to anybody enumerating
 * emails: the wrong-password path spends ~50 ms in scrypt and the unknown-email
 * path returns instantly. Computed once per process, at the same cost as a real
 * hash, because the cost is the point.
 */
let dummy: string | undefined
function dummyHash(): string {
  if (!dummy) dummy = hashSecret('a secret that is nobody\'s', 'dummy')
  return dummy
}

/**
 * The one verifier. Returns on success; throws on failure, having first
 * committed the evidence.
 *
 * Order matters and is fixed (§5.2): look up the lockout, refuse early if the
 * door is shut, compare **always** — even when there is no stored hash, against
 * the dummy above — then write the attempt row, then escalate, then throw.
 *
 * `venueId` may be null on the password door, where nobody knows the venue until
 * the email resolves; the single venue is used, because `auth_attempts.venue_id`
 * is `NOT NULL REFERENCES venues(id)` and evidence with no venue is evidence
 * nobody can query.
 */
export function verifyMetered(db: Db, venueId: string | null, args: {
  kind: AttemptKind
  subject: AttemptSubject
  /** The stored hash, or null when the subject does not exist. */
  stored: string | null
  /** Whose salt the hash is bound to: `users.id`, or the enrol code's own id. */
  saltId: string
  plain: string
  now?: string
}): void {
  const now = args.now ?? nowIso()
  const venue = venueId ?? soleVenueId(db)
  const { kind, subject } = args

  const before = lockoutState(db, venue, kind, subject, now)
  if (before.locked) throw lockedOut(kind, before.retryAfterS)

  const ok = args.stored
    ? verifySecret(args.plain, args.saltId, args.stored)
    // Same work, same milliseconds, no answer leaked. The result is discarded.
    : (verifySecret(args.plain, 'dummy', dummyHash()), false)

  recordAttempt(db, venue, { kind, subject, ok, now })
  if (ok) return

  const after = lockoutState(db, venue, kind, subject, now)

  // The 10th consecutive failure is worth a line in the Dnevnik and a message to
  // the owner's phone; the 15th shuts the device itself, and that one is
  // unwindowed, so pacing cannot evade it.
  if (after.windowedFails === LOCKOUT_STEPS[1].fails) {
    ifLanded(() => db.transaction(tx => log(tx, venue, {
      kind: 'lockout',
      body: { device_id: subject.deviceId, user_id: subject.userId, fails: after.windowedFails },
      actorId: subject.userId,
      deviceId: subject.deviceId,
      ref: subject.deviceId ? { type: 'device', id: subject.deviceId } : undefined,
    })))
  }

  if (subject.deviceId && after.fails >= DEVICE_LOCK_FAILS) {
    db.update(schema.devices)
      .set({ lockedAt: now })
      .where(and(eq(schema.devices.id, subject.deviceId), isNull(schema.devices.lockedAt)))
      .run()
  }

  if (after.locked) throw lockedOut(kind, after.retryAfterS)
  throw refusal(kind, after)
}

function lockedOut(kind: AttemptKind, retryAfterS: number): SankError {
  return kind === 'enrol'
    ? badRequest('ENROL_CODE_INVALID', 'too many enrolment attempts')
    : locked('LOCKED', `locked for ${retryAfterS}s`, retryAfterS)
}

function refusal(kind: AttemptKind, state: LockoutState): SankError {
  if (kind === 'enrol') return badRequest('ENROL_CODE_INVALID', 'enrol code invalid or expired')
  // Never `fails_left` on the password door: the count would confirm that the
  // email exists, which is exactly what the constant-time compare above hides.
  if (kind === 'password') return unauthorized('INVALID_CREDENTIALS', 'wrong email or password')

  const next = [...LOCKOUT_STEPS.map(s => s.fails), DEVICE_LOCK_FAILS]
    .find(threshold => threshold > state.windowedFails) ?? DEVICE_LOCK_FAILS
  return unauthorized('INVALID_PIN', 'wrong pin', { fails_left: next - state.windowedFails })
}

function soleVenueId(db: Db): string {
  const row = db.select({ id: schema.venues.id }).from(schema.venues).limit(1).get()
  if (!row) throw notFound('NO_VENUE', 'no venue in the database — run `npm run db:seed`')
  return row.id
}

/**
 * The pin-shaped call every approving service makes — a void, a settle, a close,
 * a waste over the threshold.
 *
 * Same rules as `verifyMetered`, plus the leash that the login door does not
 * need: `pinLimiter` on `(deviceId, approverUserId)`. Without it, any logged-in
 * waiter could loop `POST /api/adjustments` with an admin's user id and walk the
 * 6-digit space in minutes — the lockout would stop him at 15, but only after he
 * had also locked the admin out of his own tablet.
 */
export function verifyPinMetered(
  db: Db, venueId: string, userId: string, deviceId: string | null,
  pin: string, ctx: { ip: string, kind: 'pin' | 'approve', now?: string },
): void {
  if (pinLimiter.take(`${deviceId ?? 'no-device'}:${userId}`, 1) === 0) {
    throw new SankError(429, 'RATE_LIMITED', 'too many pin attempts', { retry_after_s: 60 })
  }

  const user = db.select().from(schema.users)
    .where(and(eq(schema.users.id, userId), eq(schema.users.venueId, venueId)))
    .get()

  verifyMetered(db, venueId, {
    kind: ctx.kind,
    subject: { deviceId, userId, ip: ctx.ip },
    // A user who does not exist, is deactivated or has no PIN still costs a full
    // scrypt and still leaves an attempt row — anything else is an oracle.
    stored: user && user.active === 1 ? user.pinHash : null,
    saltId: userId,
    plain: pin,
    now: ctx.now,
  })
}

// ===========================================================================
// The doors
// ===========================================================================

function newSession(db: Db, e: {
  venueId: string
  userId: string
  deviceId: string | null
  kind: 'admin' | 'staff'
  borrowed: boolean
  ttlS: number
  now: string
  ip?: string | null
  userAgent?: string | null
}): { row: SessionRow, token: string, maxAgeS: number } {
  const token = newToken()
  const id = newId()
  const expiresAt = new Date(Date.parse(e.now) + e.ttlS * 1000).toISOString()

  db.insert(schema.sessions).values({
    id,
    venueId: e.venueId,
    userId: e.userId,
    deviceId: e.deviceId,
    tokenHash: hashToken(token),
    kind: e.kind,
    borrowed: e.borrowed ? 1 : 0,
    createdAt: e.now,
    lastSeenAt: e.now,
    expiresAt,
    revokedAt: null,
    ip: e.ip ?? null,
    userAgent: e.userAgent ?? null,
  }).run()

  const row = db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get()!
  return { row, token, maxAgeS: e.ttlS }
}

/**
 * `POST /api/auth/admin/login` — the owner's laptop.
 *
 * The one door with no device cookie in front of it, which is why it is the one
 * that must count its failures: everywhere else an attacker needs a phone that
 * has already been enrolled.
 */
export function adminLogin(db: Db, body: AdminLoginBody, ctx: { ip: string, userAgent?: string, now?: string }): {
  result: AdminLoginResult, token: string, maxAgeS: number
} {
  const now = ctx.now ?? nowIso()
  const email = body.email.trim().toLowerCase()

  const user = db.select().from(schema.users).where(eq(schema.users.email, email)).get()
  const venueId = user?.venueId ?? soleVenueId(db)

  verifyMetered(db, venueId, {
    kind: 'password',
    subject: { deviceId: null, userId: user?.id ?? null, ip: ctx.ip },
    // An inactive admin, a waiter who somehow has an email, and an address that
    // matches nobody all take the same path and the same milliseconds.
    stored: user && user.active === 1 && user.role === 'admin' ? user.passwordHash : null,
    saltId: user?.id ?? 'dummy',
    plain: body.password,
    now,
  })

  const session = newSession(db, {
    venueId, userId: user!.id, deviceId: null, kind: 'admin', borrowed: false,
    ttlS: ADMIN_SESSION_S, now, ip: ctx.ip, userAgent: ctx.userAgent,
  })

  return {
    result: {
      user: toMeUser(user!),
      venue: venueBrief(db, venueId),
      expires_at: session.row.expiresAt,
    },
    token: session.token,
    maxAgeS: session.maxAgeS,
  }
}

/** `GET /api/auth/users` — the names the lock screen draws, and nothing else. */
export function listLoginUsers(q: Queryable, venueId: string): MeUser[] {
  return q.select().from(schema.users)
    .where(and(eq(schema.users.venueId, venueId), eq(schema.users.active, 1)))
    .all()
    .map(toMeUser)
}

/**
 * `POST /api/auth/pin` — a person on an enrolled device.
 *
 * The checks run in the order of §5.1, and the order is the point: the lockout
 * is consulted before anything else is even looked up, and the two 403s below
 * are decided *before* the PIN is compared, so a wrong PIN on somebody else's
 * phone does not tell you whether the PIN was right.
 */
export function loginWithPin(
  db: Db, device: DeviceRow, body: PinLoginBody, ctx: { ip: string, userAgent?: string, now?: string },
): { result: PinLoginResult, token: string, maxAgeS: number } {
  const now = ctx.now ?? nowIso()
  const venueId = device.venueId

  const user = db.select().from(schema.users)
    .where(and(eq(schema.users.id, body.user_id), eq(schema.users.venueId, venueId)))
    .get()
  if (!user) throw notFound('USER_NOT_FOUND', 'no such user in this venue')
  if (user.active !== 1) throw forbidden('USER_NOT_ACTIVE', 'user is deactivated')
  if (!user.pinHash) throw forbidden('NO_PIN', 'this user has no pin set')

  // The admin PIN rule. A PIN typed on a waiter's phone is captured once and
  // approves everything afterwards, so an admin PINs only on a device bound to
  // him. The dev device is exempt so that one laptop can test every screen.
  const devDevice = device.label === DEV_DEVICE_LABEL
  if (user.role === 'admin' && !devDevice && device.boundUserId !== user.id) {
    throw forbidden('ADMIN_DEVICE_ONLY', 'an admin may only pin in on his own device')
  }

  // A personal phone belongs to somebody. A colleague may still use it — a
  // waiter whose battery died is a real Saturday night — but he has to say so,
  // and he gets two hours instead of fourteen and a `borrowed` flag on the row.
  let borrowed = false
  if (device.mode === 'personal' && device.boundUserId && device.boundUserId !== user.id) {
    if (!body.borrow) throw forbidden('NOT_YOUR_DEVICE', 'this is a colleague\'s phone')
    borrowed = true
  }

  verifyMetered(db, venueId, {
    kind: 'pin',
    subject: { deviceId: device.id, userId: user.id, ip: ctx.ip },
    stored: user.pinHash,
    saltId: user.id,
    plain: body.pin,
    now,
  })

  const session = newSession(db, {
    venueId, userId: user.id, deviceId: device.id, kind: 'staff', borrowed,
    ttlS: borrowed ? BORROWED_SESSION_S : STAFF_SESSION_S,
    now, ip: ctx.ip, userAgent: ctx.userAgent,
  })

  return {
    result: {
      user: toMeUser(user),
      session: toSessionBrief(session.row),
      device: toDeviceBrief(device),
    },
    token: session.token,
    maxAgeS: session.maxAgeS,
  }
}

/**
 * `POST /api/auth/logout`.
 *
 * It revokes the session and clears `sank_s` — and it deliberately **does not
 * touch `shift_members`**. On the shared bar tablet *Promijeni korisnika* is a
 * logout and it happens a dozen times a night; ending Emir's shift membership
 * every time he hands the tablet to Haris would end his *Moji sati* at 21:40,
 * and `shift_members_update_guard` lets `left_at` be set exactly once, so
 * rejoining could never undo it. Leaving a shift is its own deliberate act.
 */
export function logout(db: Db, venueId: string, actor: Actor, now = nowIso()): { ok: true } {
  db.update(schema.sessions)
    .set({ revokedAt: now })
    .where(and(
      eq(schema.sessions.id, actor.sessionId),
      eq(schema.sessions.venueId, venueId),
      isNull(schema.sessions.revokedAt),
    ))
    .run()
  return { ok: true }
}

/** The envelope every screen boots from. One builder, four routes (§5.5). */
export function getMe(q: Queryable, venueId: string, actor: Actor): MeContext {
  const user = q.select().from(schema.users).where(eq(schema.users.id, actor.userId)).get()
  if (!user) throw notFound('USER_NOT_FOUND', 'session points at a user that is gone')

  const session = q.select().from(schema.sessions).where(eq(schema.sessions.id, actor.sessionId)).get()
  const device = actor.deviceId
    ? q.select().from(schema.devices).where(eq(schema.devices.id, actor.deviceId)).get()
    : undefined

  return {
    user: toMeUser(user),
    session: session
      ? toSessionBrief(session)
      : { id: actor.sessionId, kind: actor.sessionKind, expires_at: '', borrowed: actor.borrowed },
    device: device ? toDeviceBrief(device) : null,
    venue: venueBrief(q, venueId),
    seq: currentSeq(q, venueId),
  }
}

/**
 * `POST /api/admin/users/:id/pin` — the way back in (§5.2).
 *
 * The route file is WP6's (it is admin CRUD like every other file in that
 * folder); the logic is auth's and lives here. Two things happen and both
 * matter: the new hash, and a `kind='reset'` attempt row that becomes the
 * `last_clear` every lockout count measures from — *and* the unlock of every
 * device this person locked. Resetting Emir's PIN unlocks the tablet Emir
 * locked; an unwindowed device lock with no key is a bar tablet that dies at
 * 23:00 on a Saturday and stays dead.
 */
export function resetPin(
  db: Db, venueId: string, actor: Actor, userId: string, pin: string, now = nowIso(),
): { ok: true, unlocked: string[] } {
  if (!/^\d{4}$|^\d{6}$/.test(pin)) throw unprocessable('PIN_LENGTH', 'a pin is 4 or 6 digits')

  const user = db.select().from(schema.users)
    .where(and(eq(schema.users.id, userId), eq(schema.users.venueId, venueId)))
    .get()
  if (!user) throw notFound('USER_NOT_FOUND', 'no such user in this venue')

  // The devices this person actually failed on since his last success, plus the
  // one he is bound to — which is the tablet he was standing at.
  const failedOn = db.selectDistinct({ id: schema.authAttempts.deviceId })
    .from(schema.authAttempts)
    .where(and(
      eq(schema.authAttempts.venueId, venueId),
      eq(schema.authAttempts.userId, userId),
      eq(schema.authAttempts.ok, 0),
    ))
    .all()
    .map(r => r.id)
    .filter((id): id is string => id !== null)

  const bound = db.select({ id: schema.devices.id }).from(schema.devices)
    .where(and(eq(schema.devices.venueId, venueId), eq(schema.devices.boundUserId, userId)))
    .all()
    .map(r => r.id)

  const candidates = [...new Set([...failedOn, ...bound])]

  const unlocked = candidates.length
    ? db.select().from(schema.devices)
        .where(and(
          eq(schema.devices.venueId, venueId),
          inArray(schema.devices.id, candidates),
          sql`${schema.devices.lockedAt} IS NOT NULL`,
        ))
        .all()
    : []

  db.transaction((tx) => {
    tx.update(schema.users).set({
      pinHash: hashSecret(pin, userId),
      pinLen: pin.length === 6 ? 6 : 4,
      pinSetAt: now,
      pinPepperV: 1,
    }).where(eq(schema.users.id, userId)).run()

    for (const device of unlocked) {
      tx.update(schema.devices).set({ lockedAt: null }).where(eq(schema.devices.id, device.id)).run()
      ifLanded(() => log(tx, venueId, {
        kind: 'device_unlocked',
        body: { device_id: device.id, label: device.label, via: 'reset_pin' },
        actorId: actor.userId,
        ref: { type: 'device', id: device.id },
      }))
    }

    ifLanded(() => log(tx, venueId, {
      kind: 'user_changed',
      body: { user_id: userId, what: 'pin_resetovan' },
      actorId: actor.userId,
      ref: { type: 'user', id: userId },
    }))
  })

  // Outside the transaction above, and after it: this row is what clears the
  // lockout counter, and a counter cleared by a rolled-back row is not cleared.
  recordAttempt(db, venueId, {
    kind: 'reset',
    subject: { deviceId: null, userId, ip: '' },
    ok: true,
    now,
  })

  return { ok: true, unlocked: unlocked.map(d => d.id) }
}

// ===========================================================================
// The gate every request goes through (§5.5)
// ===========================================================================

/** The label `POST /api/dev/enrol` keeps its one device under. */
export const DEV_DEVICE_LABEL = 'dev'

/** Routes that are `public` but still need an enrolled device in front of them. */
const DEVICE_REQUIRED_PUBLIC = new Set(['POST /api/auth/pin', 'GET /api/auth/users'])

export interface AuthzOk {
  ok: true
  actor?: Actor
  device?: DeviceRow
  /** An admin session due its once-a-day extension: the new `expires_at`. */
  slideTo?: string
  /** The route's declared role, so the middleware knows which limiter to spend. */
  role?: RouteRole
}

export interface AuthzFail {
  ok: false
  status: number
  code: string
  /** Both cookies are stale: the browser should be told to drop them. */
  clearCookies?: boolean
}

export type AuthzResult = AuthzOk | AuthzFail

export function resolveDeviceByToken(q: Queryable, token: string | undefined): DeviceRow | null {
  if (!token) return null
  return q.select().from(schema.devices)
    .where(eq(schema.devices.tokenHash, hashToken(token)))
    .get() ?? null
}

/**
 * May this request proceed, and as whom?
 *
 * A pure function of the database and four strings — no h3, no cookies, no
 * headers — so `tests/unit/tenant.test.ts` can walk every branch of it without
 * a server. `server/middleware/tenant.ts` is the fifteen lines of glue that
 * turn an `H3Event` into this argument and this answer into a response.
 *
 * The order is fixed and each step exists for a reason:
 *
 * 1. not an `/api/` path → not ours (the pages are public HTML);
 * 2. `public` route → resolve the device where the route needs one, and pass;
 * 3. resolve the session — a dead session is a 401 and never a 403, because
 *    "log in again" and "you may not" are different instructions to a waiter;
 * 4. `ROUTE_ROLES` → **absent is 403**. A new route is dead until somebody
 *    declares it, so forgetting to guard one fails closed;
 * 5. build the actor.
 */
export function authorizeRequest(db: Db, req: {
  path: string
  method: string
  cookies: { s?: string, d?: string }
  ip: string
  now: string
}): AuthzResult {
  if (!req.path.startsWith('/api/') && req.path !== '/api') return { ok: true }

  const key = routeKey(req.method, req.path)
  const declared: RouteRole | undefined = ROUTE_ROLES[key]

  if (declared === 'public') {
    if (!DEVICE_REQUIRED_PUBLIC.has(key)) return { ok: true, role: declared }
    const device = resolveDeviceByToken(db, req.cookies.d)
    if (!device || device.revokedAt || device.lockedAt) {
      return { ok: false, status: 401, code: 'NO_DEVICE', clearCookies: !!device }
    }
    return { ok: true, device, role: declared }
  }

  // -- The session ---------------------------------------------------------
  const session = req.cookies.s
    ? db.select().from(schema.sessions)
        .where(eq(schema.sessions.tokenHash, hashToken(req.cookies.s)))
        .get()
    : undefined

  if (!session) return { ok: false, status: 401, code: 'NO_SESSION' }

  // The device is checked **before** the session's own `revoked_at`, and the
  // order is not cosmetic: revoking a device revokes every session on it, so
  // checking the session first would answer `SESSION_REVOKED` for a phone that
  // is actually gone. The phone would then clear `sank_s`, keep `sank_d` and
  // draw the PIN pad — a lock screen that can never be got past. `DEVICE_REVOKED`
  // tells it to drop both cookies and show the enrolment screen instead.
  let device: DeviceRow | undefined
  if (session.deviceId) {
    device = db.select().from(schema.devices).where(eq(schema.devices.id, session.deviceId)).get()
    if (!device || device.revokedAt || device.lockedAt) {
      return { ok: false, status: 401, code: 'DEVICE_REVOKED', clearCookies: true }
    }
    const presented = resolveDeviceByToken(db, req.cookies.d)
    if (!presented || presented.id !== device.id) {
      return { ok: false, status: 401, code: 'DEVICE_MISMATCH', clearCookies: true }
    }
  }

  if (session.revokedAt) return { ok: false, status: 401, code: 'SESSION_REVOKED', clearCookies: true }
  if (session.expiresAt <= req.now) return { ok: false, status: 401, code: 'NO_SESSION', clearCookies: true }

  const user = db.select().from(schema.users).where(eq(schema.users.id, session.userId)).get()
  if (!user || user.active !== 1) {
    return { ok: false, status: 401, code: 'SESSION_REVOKED', clearCookies: true }
  }

  // -- Deny by default -----------------------------------------------------
  if (declared === undefined) return { ok: false, status: 403, code: 'FORBIDDEN' }
  if (declared !== 'any' && !declared.includes(user.role)) {
    return { ok: false, status: 403, code: 'FORBIDDEN' }
  }

  const actor: Actor = {
    venueId: session.venueId,
    userId: user.id,
    role: user.role as Role,
    sessionId: session.id,
    sessionKind: session.kind,
    deviceId: session.deviceId,
    deviceBoundUserId: device?.boundUserId ?? null,
    borrowed: session.borrowed === 1,
  }

  // An admin's 30 days slide forward, at most once a day so a dashboard left
  // open on a laptop does not write a row every fifteen seconds. A staff session
  // never slides: fourteen hours is a shift, and it ends when the shift does.
  let slideTo: string | undefined
  if (session.kind === 'admin') {
    const seenAt = Date.parse(session.lastSeenAt ?? session.createdAt)
    if (Date.parse(req.now) - seenAt >= ADMIN_SLIDE_EVERY_S * 1000) {
      slideTo = new Date(Date.parse(req.now) + ADMIN_SESSION_S * 1000).toISOString()
    }
  }

  return { ok: true, actor, device, slideTo, role: declared }
}

/** Write the slide `authorizeRequest` asked for. */
export function slideSession(db: Db, sessionId: string, expiresAt: string, now: string): void {
  db.update(schema.sessions)
    .set({ expiresAt, lastSeenAt: now })
    .where(eq(schema.sessions.id, sessionId))
    .run()
}

/** Every live session on a device dies with it (revoke, or the 15-fail lock). */
export function revokeSessionsOfDevice(tx: Tx, venueId: string, deviceId: string, now: string): void {
  tx.update(schema.sessions)
    .set({ revokedAt: now })
    .where(and(
      eq(schema.sessions.venueId, venueId),
      eq(schema.sessions.deviceId, deviceId),
      isNull(schema.sessions.revokedAt),
    ))
    .run()
}

/** Used by `GET /api/auth/users` and the enrol response: the venue's live staff. */
export function activeUsers(q: Queryable, venueId: string): UserRow[] {
  return q.select().from(schema.users)
    .where(and(eq(schema.users.venueId, venueId), eq(schema.users.active, 1)))
    .orderBy(schema.users.name)
    .all()
}
