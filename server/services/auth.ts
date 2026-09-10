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
import { and, desc, eq, gt, gte, inArray, isNull, sql } from 'drizzle-orm'
import { schema } from '../database/client'
import { SankError, badRequest, conflict, forbidden, locked, notFound, unauthorized, unprocessable } from '../utils/errors'
import { newId, nowIso } from '../utils/ids'
import { hashSecret, hashToken, newToken, verifySecret } from '../utils/password'
import { pinLimiter } from '../utils/rate-limit'
import { getSettings, log } from './contracts'
import type { Db, Queryable, Tx } from './types'
import type { Actor, Role, ScreenMode } from '#shared/types'
import type {
  DeviceBrief, LoginUser, MeContext, MeUser, MySession,
  PinLoginResult, SessionBrief, VenueBrief,
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
    mode: row.mode ?? null,
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
 * `auth_attempts` has no column for a free-text handle, so the doors that have
 * no user *row* to point at are keyed on what they do have (§5.2's table,
 * expressed in the columns that exist):
 *
 * | kind | counted against |
 * |---|---|
 * | `approve`, and `pin` with a known user | `(device_id, user_id)` |
 * | **`pin` at the login door** | `(device_id, ip)`, with `user_id NULL` |
 * | `password` | `(ip, user_id)` — resolved from the email, `NULL` when it matches nobody, so every unknown address from one address shares one bucket and a real admin's bucket is his own |
 * | `enrol` | `(ip)` — a code is not a person |
 *
 * The middle row is what "the PIN identifies the person" costs. There is no
 * user to count against at the login door any more — the account is unknown
 * until the digits have already been compared against every one of them — so
 * the bucket is the phone and the address it is dialling from. The thresholds
 * are unchanged (5 / 10 / 15) and so is everything they trigger; only the key
 * moved. Note that the **success** rows of that door carry `user_id NULL` too,
 * even though by then the person is known: `lockoutState` clears a counter with
 * a success *of the same subject*, and a success filed under Amar would not
 * clear the failures filed under nobody.
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
      // The login door, where the account is unknown: `user_id IS NULL` alone
      // would put every phone on the network into one bucket, so the address
      // joins the device in the key. An approval, which knows its user, is
      // deliberately *not* narrowed by IP — a waiter walking from the terrace's
      // Wi-Fi to the bar's must not get five fresh guesses at the owner's PIN.
      ...(s.userId === null ? [eq(schema.authAttempts.ip, s.ip)] : []),
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

  /**
   * The key to the tablet, and the reason it had to be cut.
   *
   * A `reset` row used to belong to a person, because every counter did: an
   * admin gave Emir new digits and Emir's failures everywhere went quiet. The
   * pad's failures belong to nobody now, so a person-shaped reset can never
   * reach them — and the count they feed is the unwindowed fifteen that shuts
   * the device itself. Without a second shape of clear, a bar tablet locked at
   * 23:00 on a Saturday stays locked: `unlockDevice` would clear `locked_at`
   * and the very next wrong PIN would re-read the same fifteen and shut it
   * again.
   *
   * So a reset row with a `device_id` and no `user_id` is the device's own
   * clear, written by `clearDeviceCounter` below, and it wipes the slate for
   * every subject standing at that device.
   */
  const clearedByDeviceReset = s.deviceId
    ? q.select({ at: sql<string | null>`max(${schema.authAttempts.createdAt})` })
        .from(schema.authAttempts)
        .where(and(
          eq(schema.authAttempts.venueId, venueId),
          eq(schema.authAttempts.kind, 'reset'),
          eq(schema.authAttempts.deviceId, s.deviceId),
          isNull(schema.authAttempts.userId),
        ))
        .get()?.at ?? null
    : null

  // ISO-8601 UTC strings sort exactly like the instants they describe, which is
  // why every timestamp in this database is one.
  const lastClear = [clearedBySuccess, clearedByReset, clearedByDeviceReset]
    .filter(Boolean).sort().pop() ?? ''

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
 * "This tablet is forgiven." The device-shaped half of a PIN reset.
 *
 * One committed row — `kind='reset'`, this device, **no user** — which
 * `lockoutState` reads as `lastClear` for every subject standing at it. It is
 * what makes an unlock an unlock: clearing `locked_at` without it leaves the
 * fifteen failures on the record, and the next fat-fingered PIN shuts the
 * device again before anybody has typed a right one.
 *
 * It clears counters; it does not delete evidence. The failed rows stay exactly
 * where they were — `lockoutState` measures *from* the clear rather than
 * emptying the table — so the *Dnevnik* and any later question about that night
 * still have every attempt.
 */
export function clearDeviceCounter(db: Db, venueId: string, deviceId: string, now = nowIso()): void {
  recordAttempt(db, venueId, {
    kind: 'reset',
    subject: { deviceId, userId: null, ip: '' },
    ok: true,
    now,
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

  requireDoorOpen(db, venue, kind, subject, now)

  const ok = args.stored
    ? verifySecret(args.plain, args.saltId, args.stored)
    // Same work, same milliseconds, no answer leaked. The result is discarded.
    : (verifySecret(args.plain, 'dummy', dummyHash()), false)

  meterOutcome(db, venue, kind, subject, ok, now)
}

/**
 * Step one of the order above, on its own so the login door can share it.
 *
 * It is the *first* thing either verifier does: a locked subject is refused
 * before a hash is even fetched, let alone compared.
 */
function requireDoorOpen(
  db: Db, venue: string, kind: AttemptKind, subject: AttemptSubject, now: string,
): void {
  const before = lockoutState(db, venue, kind, subject, now)
  if (before.locked) throw lockedOut(kind, before.retryAfterS)
}

/**
 * Steps three to five, likewise shared: commit the evidence, escalate, throw.
 *
 * Splitting this out is what lets `resolvePinToUser` below — which cannot use
 * `verifyMetered`, because it compares one typed PIN against *every* account
 * rather than one stored hash — keep byte-for-byte the same metering,
 * thresholds, Dnevnik entry and device lock. Two counters that drift apart is
 * exactly the bug that makes a lockout theatre.
 */
function meterOutcome(
  db: Db, venue: string, kind: AttemptKind, subject: AttemptSubject, ok: boolean, now: string,
): void {
  recordAttempt(db, venue, { kind, subject, ok, now })
  if (ok) return

  const after = lockoutState(db, venue, kind, subject, now)

  // The 10th consecutive failure is worth a line in the Dnevnik and a message to
  // the owner's phone; the 15th shuts the device itself, and that one is
  // unwindowed, so pacing cannot evade it.
  if (after.windowedFails === LOCKOUT_STEPS[1].fails) {
    db.transaction(tx => log(tx, venue, {
      kind: 'lockout',
      body: { device_id: subject.deviceId, user_id: subject.userId, fails: after.windowedFails },
      actorId: subject.userId,
      deviceId: subject.deviceId,
      ref: subject.deviceId ? { type: 'device', id: subject.deviceId } : undefined,
    }))
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

/**
 * **The PIN identifies the person.** Four digits in, an account out.
 *
 * The pad draws no names, so nothing tells the server who is typing: it
 * compares the digits against every active account of this venue that has a PIN
 * at all, and answers 401 `INVALID_PIN` when none of them matches. Three
 * accounts × one scrypt is a few hundred milliseconds at the login door, once a
 * night per person, which is the price of the whole idea and cheap at it.
 *
 * Two details that are not decoration:
 *
 * - **The loop does not stop at the match.** Every candidate costs the same
 *   scrypt whether it is the first or the last, so the time the door takes says
 *   nothing about whose PIN was typed. It also costs one dummy hash when the
 *   venue has nobody with a PIN, so an empty venue answers in the same beat as
 *   a full one.
 * - **The failures are counted against `(device, ip)`**, not against a person —
 *   there is no person to count against yet. See the subject table above.
 *
 * A PIN unique inside the venue is what makes any of this an identity, which is
 * why `createUser` and `resetPin` refuse a duplicate with 409 `PIN_TAKEN`.
 */
export function resolvePinToUser(
  db: Db, venueId: string, deviceId: string | null, pin: string,
  ctx: { ip: string, now?: string },
): UserRow {
  const now = ctx.now ?? nowIso()
  const subject: AttemptSubject = { deviceId, userId: null, ip: ctx.ip }

  requireDoorOpen(db, venueId, 'pin', subject, now)

  const candidates = db.select().from(schema.users)
    .where(and(eq(schema.users.venueId, venueId), eq(schema.users.active, 1)))
    .all()
    .filter(row => row.pinHash !== null)

  const matches: UserRow[] = []
  for (const row of candidates) {
    if (verifySecret(pin, row.id, row.pinHash!)) matches.push(row)
  }
  if (candidates.length === 0) verifySecret(pin, 'dummy', dummyHash())

  meterOutcome(db, venueId, 'pin', subject, matches.length > 0, now)

  // Two people, one PIN. `requirePinFree` stops this being *set*, and
  // `updateUser` drops a returning person's stale PIN rather than trust it — but
  // a database edited by hand can still get here, and the one thing this door
  // must never do is guess which of them is standing at the till. The attempt
  // above is metered as a success, because the secret was correct and this is
  // not somebody guessing.
  if (matches.length > 1) {
    throw conflict('PIN_AMBIGUOUS', 'that pin belongs to more than one active person')
  }
  return matches[0]!
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

/**
 * A PIN belongs to at most one active person in a venue — 409 `PIN_TAKEN`.
 *
 * This is the invariant `resolvePinToUser` rests on: two people sharing 2222
 * would make the pad ambiguous, and it would resolve to whichever row the
 * `SELECT` happened to return first. So the rule is enforced where PINs are
 * *set* rather than where they are used, which is the only place it can be —
 * every PIN is a peppered scrypt hash salted with its own user id, so a unique
 * index on `pin_hash` would be a unique index on random noise. It has to be a
 * loop of `verifySecret`, and it has to run inside the same call that writes
 * the new hash.
 *
 * Deactivated people do not hold a PIN against anybody: Lejla's account stays
 * for the history on February's rounds, not for the lock screen, and
 * `resolvePinToUser` never looks at it either. `except` is the person being
 * given this PIN, so re-setting somebody's own PIN to the digits he already has
 * is not a collision with himself.
 */
export function requirePinFree(
  db: Db, venueId: string, pin: string, except: string | null,
): void {
  const others = db.select().from(schema.users)
    .where(and(eq(schema.users.venueId, venueId), eq(schema.users.active, 1)))
    .all()
    .filter(row => row.pinHash !== null && row.id !== except)

  for (const row of others) {
    if (verifySecret(pin, row.id, row.pinHash!)) {
      // The message never says *whose* it is. An admin setting a PIN would learn
      // a colleague's four digits from the answer, and the whole point of the
      // pad is that those digits are an identity.
      throw conflict('PIN_TAKEN', 'that pin already belongs to somebody in this venue')
    }
  }
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
  /** The staff screen this session starts on; `null` until the worker picks. */
  mode?: ScreenMode | null
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
    mode: e.mode ?? null,
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
 *
 * It answers a full `MeContext`, the same envelope `GET /api/me` returns, so
 * `/admin/login.vue` hands the answer straight to `useMe().refreshAfterLogin()`
 * instead of assembling a context by hand. `device` is `null`: a laptop is not
 * an enrolled phone and never becomes one.
 */
export function adminLogin(db: Db, body: AdminLoginBody, ctx: { ip: string, userAgent?: string, now?: string }): {
  result: MeContext, token: string, maxAgeS: number
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
    result: getMe(db, venueId, {
      venueId,
      userId: user!.id,
      role: user!.role,
      sessionId: session.row.id,
      sessionKind: 'admin',
      deviceId: null,
      deviceBoundUserId: null,
      borrowed: false,
    }),
    token: session.token,
    maxAgeS: session.maxAgeS,
  }
}

/**
 * `GET /api/auth/users` — the names the lock screen draws, and nothing else.
 *
 * With a device id it also answers `last_login_at`, **for that device only**
 * (PHASE3 §1.8): the lock screen offers the three people who most recently
 * signed in *here* as faces, with the rest one tap away. Who signs in at this
 * bar is already visible to anybody standing at it; who signs in across the
 * café would not be, and this body is readable with no session at all.
 *
 * A revoked session still counts as a login — logging out is not un-logging-in,
 * and *Promijeni korisnika* revokes on every hand-over of the shared tablet.
 */
export function listLoginUsers(
  q: Queryable, venueId: string, deviceId?: string | null,
): LoginUser[] {
  const lastLogin = new Map<string, string>()
  if (deviceId) {
    for (const row of q.select({
      userId: schema.sessions.userId,
      at: sql<string>`max(${schema.sessions.createdAt})`,
    })
      .from(schema.sessions)
      .where(and(
        eq(schema.sessions.venueId, venueId),
        eq(schema.sessions.deviceId, deviceId),
      ))
      .groupBy(schema.sessions.userId)
      .all()) lastLogin.set(row.userId, row.at)
  }

  return q.select().from(schema.users)
    .where(and(eq(schema.users.venueId, venueId), eq(schema.users.active, 1)))
    .all()
    .map(row => ({ ...toMeUser(row), last_login_at: lastLogin.get(row.id) ?? null }))
}

/**
 * `GET /api/me/sessions` — *Moji podaci* (PHASE3 §1.7).
 *
 * Own rows only, newest first, twenty at most. PLAN §5 wants a waiter able to
 * notice a sign-in on a phone that is not his — which is the whole feature, and
 * the reason the device *label* is joined in: "Emirov telefon" is a sentence a
 * person can act on and a uuid is not.
 */
export function listMySessions(
  q: Queryable, venueId: string, actor: Actor,
): MySession[] {
  return q.select({
    id: schema.sessions.id,
    kind: schema.sessions.kind,
    borrowed: schema.sessions.borrowed,
    createdAt: schema.sessions.createdAt,
    lastSeenAt: schema.sessions.lastSeenAt,
    label: schema.devices.label,
  })
    .from(schema.sessions)
    .leftJoin(schema.devices, eq(schema.devices.id, schema.sessions.deviceId))
    .where(and(
      eq(schema.sessions.venueId, venueId),
      eq(schema.sessions.userId, actor.userId),
    ))
    .orderBy(desc(schema.sessions.createdAt))
    .limit(20)
    .all()
    .map(row => ({
      id: row.id,
      // An admin session has no device at all: it is the owner's laptop.
      device_label: row.label ?? 'Računar',
      kind: row.kind,
      borrowed: row.borrowed === 1,
      created_at: row.createdAt,
      last_seen_at: row.lastSeenAt,
      current: row.id === actor.sessionId,
    }))
}

/**
 * `POST /api/auth/pin` — four digits on an enrolled device, and nothing else.
 *
 * The order is the whole design and it is not the old one. The pad no longer
 * names anybody, so there is no user to look up, no deactivated account to
 * refuse and no missing PIN to report *before* the compare — those three cases
 * are simply "these digits belong to nobody", which is one 401 and one
 * sentence. What is left runs in this order:
 *
 * 1. the lockout for `(device, ip)`, consulted before a hash is touched;
 * 2. the digits against every active account with a PIN → the person, or 401;
 * 3. the device rules, now that there *is* a person to apply them to;
 * 4. the session, with the screen mode if he sent one.
 *
 * Step 3 after step 2 is deliberate: the PIN was right, and the metered attempt
 * has already been committed as a success, so the 403 a wrong-phone admin gets
 * is about the phone and never about the digits.
 */
export function loginWithPin(
  db: Db, device: DeviceRow, body: PinLoginBody, ctx: { ip: string, userAgent?: string, now?: string },
): { result: PinLoginResult, token: string, maxAgeS: number } {
  const now = ctx.now ?? nowIso()
  const venueId = device.venueId

  const user = resolvePinToUser(db, venueId, device.id, body.pin, { ip: ctx.ip, now })

  // The admin PIN rule, unchanged. A PIN typed on a worker's phone is watched
  // once and approves everything afterwards, so an admin PINs only on a device
  // bound to him. The dev device is exempt so that one laptop can test every
  // screen. This is the one place the owner still has to be on his own phone —
  // he may open any screen once he is in.
  const devDevice = device.label === DEV_DEVICE_LABEL
  if (user.role === 'admin' && !devDevice && device.boundUserId !== user.id) {
    throw forbidden('ADMIN_DEVICE_ONLY', 'an admin may only pin in on his own device')
  }

  // A personal phone belongs to somebody. A colleague may still use it — a
  // worker whose battery died is a real Saturday night — and he no longer has
  // to declare it, because the pad did not ask his name and the server already
  // knows whose phone this is. He gets two hours instead of fourteen and a
  // `borrowed` flag on the row, which is what that flag was ever for.
  const borrowed = device.mode === 'personal'
    && device.boundUserId !== null
    && device.boundUserId !== user.id

  // An admin has no mode: his landing is `/admin` (`shared/landing.ts`), and he
  // reaches `/konobar` or `/sanker` by opening them, not by being sent there.
  const mode = user.role === 'admin' ? null : body.mode ?? null

  const session = newSession(db, {
    venueId, userId: user.id, deviceId: device.id, kind: 'staff', borrowed, mode,
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
 * `POST /api/auth/mode` — *Na čemu si večeras?*, and the midnight switch.
 *
 * The second step of the login for a `radnik` who did not fold his choice into
 * the PIN call, and the same route again whenever he moves between the bar and
 * the floor. Nobody signs out to change screens: both screens are open to every
 * worker, and the mode only decides where he is *sent*.
 *
 * For an admin it is a no-op that answers the same envelope. Refusing him would
 * be a 403 on a tap he can only reach by accident, and storing a mode for him
 * would put a value on a session whose landing ignores it.
 */
export function setSessionMode(
  db: Db, venueId: string, actor: Actor, mode: ScreenMode, now = nowIso(),
): MeContext {
  if (actor.role !== 'admin') {
    db.update(schema.sessions)
      .set({ mode, lastSeenAt: now })
      .where(and(
        eq(schema.sessions.id, actor.sessionId),
        eq(schema.sessions.venueId, venueId),
        isNull(schema.sessions.revokedAt),
      ))
      .run()
  }
  return getMe(db, venueId, actor)
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
      : { id: actor.sessionId, kind: actor.sessionKind, expires_at: '', borrowed: actor.borrowed, mode: null },
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
 * device this reset can still be shown to be about: the ones bound to him, and
 * the ones he failed on at the **approver** door, which names its approver.
 *
 * The pad's failures name nobody now, so the tablet a stranger shut by guessing
 * is no longer reachable from a person's reset. Its key is `unlockDevice` in
 * *Uređaji*, which since this change clears the counter as well as the flag —
 * an unwindowed device lock with no key is a bar tablet that dies at 23:00 on a
 * Saturday and stays dead, and clearing the flag alone would have been no key
 * at all.
 */
export function resetPin(
  db: Db, venueId: string, actor: Actor, userId: string, pin: string, now = nowIso(),
): { ok: true, unlocked: string[] } {
  if (!/^\d{4}$|^\d{6}$/.test(pin)) throw unprocessable('PIN_LENGTH', 'a pin is 4 or 6 digits')

  const user = db.select().from(schema.users)
    .where(and(eq(schema.users.id, userId), eq(schema.users.venueId, venueId)))
    .get()
  if (!user) throw notFound('USER_NOT_FOUND', 'no such user in this venue')

  requirePinFree(db, venueId, pin, userId)

  // The devices this person actually failed on since his last success, plus the
  // one he is bound to — which is the tablet he was standing at.
  //
  // "Failed on" is a smaller set than it used to be, and the reason is the whole
  // rekey: a wrong PIN at the **pad** is now filed against nobody, so it cannot
  // be traced back to Emir here. What this still finds is Emir's failures at the
  // *approver* door, which does name him. A tablet shut by anonymous fumbling at
  // the pad is therefore not a person's problem to reset any more — it is the
  // device's, and `unlockDevice` in *Uređaji* is its key. Both doors need an
  // admin either way, so the Saturday-night story is unchanged; only which of
  // the two screens he taps has moved.
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
      log(tx, venueId, {
        kind: 'device_unlocked',
        body: { device_id: device.id, label: device.label, via: 'reset_pin' },
        actorId: actor.userId,
        ref: { type: 'device', id: device.id },
      })
    }

    log(tx, venueId, {
      kind: 'user_changed',
      body: { user_id: userId, what: 'pin_resetovan' },
      actorId: actor.userId,
      ref: { type: 'user', id: userId },
    })
  })

  // Outside the transaction above, and after it: this row is what clears the
  // lockout counter, and a counter cleared by a rolled-back row is not cleared.
  recordAttempt(db, venueId, {
    kind: 'reset',
    subject: { deviceId: null, userId, ip: '' },
    ok: true,
    now,
  })

  // Any device this reset actually reopened gets the device-shaped clear too,
  // for the same reason `unlockDevice` writes one: the fifteen behind the lock
  // are filed against nobody, and the row above only speaks for this person.
  for (const device of unlocked) clearDeviceCounter(db, venueId, device.id, now)

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
