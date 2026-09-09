/**
 * The three doors, and the counter that makes a 4-digit PIN safe.
 *
 * Everything here runs against the real migrations, the real triggers and a real
 * scrypt (at `SANK_SCRYPT_LOG2N=10`, set in `vitest.config.ts`) — a lockout
 * proven against a mock is a lockout proven against nothing.
 *
 * The assertion this whole file is built around: **every door leaves a committed
 * `auth_attempts` row**. A path with no attempt row has no lockout, and a 4-digit
 * PIN with no lockout falls in an afternoon (`docs/BACKEND.md` §5.1).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { makeFixture, schema, type Fixture } from '../helpers/db'
import { hashSecret, verifySecret } from '../../server/utils/password'
import {
  adminLogin, authorizeRequest, getMe, listLoginUsers, lockoutState, loginWithPin,
  logout, resetPin, verifyMetered, verifyPinMetered,
} from '../../server/services/auth'
import {
  devEnrol, enrolDevice, mintEnrolCode, requireEnrolledDevice, revokeDevice, unlockDevice,
} from '../../server/services/devices'
import { maxSeq } from '../../server/services/changes'
import { resetLimiters } from '../../server/utils/rate-limit'
import { DEVICE_LOCK_FAILS } from '#shared/constants'

const IP = '10.0.0.7'

/** Enrol a device the way a phone would, and hand back its raw cookie token. */
function enrol(f: Fixture, mode: 'personal' | 'shared', boundUserName?: string) {
  const code = mintEnrolCode(f.db, f.venueId, f.adminActor(), {
    mode,
    bound_user_id: boundUserName ? f.userId(boundUserName) : undefined,
    label: boundUserName ? `${boundUserName} telefon` : 'Šank tablet',
  }, f.clock.now())

  const { result, token } = enrolDevice(f.db, { code: code.code }, { ip: IP, now: f.clock.now() })
  return { deviceId: result.device.id, token, code: code.code }
}

function deviceRow(f: Fixture, deviceId: string) {
  return f.db.select().from(schema.devices).where(eq(schema.devices.id, deviceId)).get()!
}

function attempts(f: Fixture, where?: { ok?: boolean, kind?: string }) {
  return f.db.select().from(schema.authAttempts).all()
    .filter(a => (where?.ok === undefined ? true : a.ok === (where.ok ? 1 : 0)))
    .filter(a => (where?.kind === undefined ? true : a.kind === where.kind))
}

let f: Fixture
beforeEach(() => {
  resetLimiters()
  f = makeFixture()
  return () => f.close()
})

// ===========================================================================

describe('hashing', () => {
  it('round-trips, and the same PIN for two people hashes differently', () => {
    const a = hashSecret('1111', 'user-a')
    const b = hashSecret('1111', 'user-b')

    expect(verifySecret('1111', 'user-a', a)).toBe(true)
    expect(verifySecret('1111', 'user-b', b)).toBe(true)
    expect(a).not.toBe(b)
    // The salt is per hash, so even one user hashing the same PIN twice differs.
    expect(hashSecret('1111', 'user-a')).not.toBe(a)
  })

  it('a hash made under one pepper does not verify under another', () => {
    const stored = hashSecret('1111', 'user-a')
    const pepper = process.env.PIN_PEPPER

    process.env.PIN_PEPPER = 'a different secret'
    expect(verifySecret('1111', 'user-a', stored)).toBe(false)

    process.env.PIN_PEPPER = pepper
    expect(verifySecret('1111', 'user-a', stored)).toBe(true)
  })

  it('a corrupt stored string is false, not a crash on the login screen', () => {
    expect(verifySecret('1111', 'user-a', 'nonsense')).toBe(false)
    expect(verifySecret('1111', 'user-a', 'scrypt$16384$8$1$zz$zz')).toBe(false)
  })
})

// ===========================================================================

describe('admin login', () => {
  it('accepts the seeded owner and answers with no secret in the body', () => {
    const { result } = adminLogin(f.db, { email: 'haris@lounge.ba', password: 'lounge' }, { ip: IP })

    expect(result.user.name).toBe('Haris')
    expect(result.user.role).toBe('admin')
    expect(JSON.stringify(result)).not.toMatch(/_hash|password|pepper|token/)
    expect(attempts(f, { kind: 'password', ok: true })).toHaveLength(1)
  })

  /**
   * Phase 2 (WP0): the laptop door answers the same envelope as `GET /api/me`,
   * so `/a/login.vue` hands it to `useMe().refreshAfterLogin()` rather than
   * assembling a `MeContext` by hand — which is what that function exists to
   * prevent. `AdminLoginResult` is gone.
   */
  it('answers a full MeContext, with no device and the venue settings', () => {
    const { result } = adminLogin(f.db, { email: 'haris@lounge.ba', password: 'lounge' }, { ip: IP })

    expect(result.session.kind).toBe('admin')
    expect(result.session.borrowed).toBe(false)
    expect(Date.parse(result.session.expires_at)).toBeGreaterThan(Date.now())
    // A laptop is not an enrolled phone and never becomes one.
    expect(result.device).toBeNull()
    expect(result.venue.slug).toBe('lounge')
    expect(result.venue.settings.cash_tolerance_fen).toBeGreaterThan(0)
    // The cursor the dashboard starts polling `/api/changes?since=` from.
    expect(typeof result.seq).toBe('number')
  })

  it('answers the same 401 for an unknown email and a wrong password', () => {
    const unknown = catchError(() => adminLogin(f.db, { email: 'niko@lounge.ba', password: 'x' }, { ip: IP }))
    const wrong = catchError(() => adminLogin(f.db, { email: 'haris@lounge.ba', password: 'x' }, { ip: IP }))

    expect(unknown.code).toBe('INVALID_CREDENTIALS')
    expect(wrong.code).toBe('INVALID_CREDENTIALS')
    expect(unknown.status).toBe(401)
    // `fails_left` would confirm that the address exists.
    expect(unknown.data?.fails_left).toBeUndefined()
    expect(wrong.data?.fails_left).toBeUndefined()

    // Both doors left evidence, which is the whole point of the constant-time path.
    expect(attempts(f, { kind: 'password', ok: false })).toHaveLength(2)
  })

  it('a waiter with no password cannot get an admin session', () => {
    f.db.update(schema.users).set({ email: 'amar@lounge.ba' })
      .where(eq(schema.users.id, f.userId('Amar'))).run()

    expect(catchError(() => adminLogin(f.db, { email: 'amar@lounge.ba', password: 'lounge' }, { ip: IP })).code)
      .toBe('INVALID_CREDENTIALS')
  })

  it('locks (ip, email) after five wrong passwords, and a different email is unaffected', () => {
    for (let i = 0; i < 5; i++) {
      catchError(() => adminLogin(f.db, { email: 'haris@lounge.ba', password: 'x' }, { ip: IP }))
    }

    const locked = catchError(() => adminLogin(f.db, { email: 'haris@lounge.ba', password: 'lounge' }, { ip: IP }))
    expect(locked.status).toBe(423)
    expect(locked.code).toBe('LOCKED')
    expect(locked.data?.retry_after_s).toBeGreaterThan(0)

    // Another address from the same machine has its own bucket.
    expect(catchError(() => adminLogin(f.db, { email: 'niko@lounge.ba', password: 'x' }, { ip: IP })).code)
      .toBe('INVALID_CREDENTIALS')
  })
})

// ===========================================================================

describe('device enrolment', () => {
  it('spends its two uses and then refuses', () => {
    const code = mintEnrolCode(f.db, f.venueId, f.adminActor(), { mode: 'shared', label: 'Tablet' })
    expect(code.uses_left).toBe(2)

    enrolDevice(f.db, { code: code.code }, { ip: IP })
    enrolDevice(f.db, { code: code.code }, { ip: IP })

    expect(catchError(() => enrolDevice(f.db, { code: code.code }, { ip: IP })).code)
      .toBe('ENROL_CODE_INVALID')
  })

  it('refuses an expired code', () => {
    const code = mintEnrolCode(f.db, f.venueId, f.adminActor(), { mode: 'shared', label: 'Tablet' }, f.clock.now())
    f.clock.advance(601)

    expect(catchError(() => enrolDevice(f.db, { code: code.code }, { ip: IP, now: f.clock.now() })).code)
      .toBe('ENROL_CODE_INVALID')
  })

  it('leaves a committed attempt row after a bad code — the third door', () => {
    catchError(() => enrolDevice(f.db, { code: 'ZZZZZZ' }, { ip: IP }))
    expect(attempts(f, { kind: 'enrol', ok: false })).toHaveLength(1)
  })

  it('a personal code needs somebody to bind to', () => {
    expect(catchError(() => mintEnrolCode(f.db, f.venueId, f.adminActor(), { mode: 'personal', label: 'Amar' })).code)
      .toBe('BOUND_USER_REQUIRED')
  })

  it('answers with the venue and the staff list so the lock screen can draw', () => {
    const code = mintEnrolCode(f.db, f.venueId, f.adminActor(), { mode: 'shared', label: 'Tablet' })
    const { result } = enrolDevice(f.db, { code: code.code }, { ip: IP })

    expect(result.venue.slug).toBe('lounge')
    expect(result.users).toHaveLength(6)
    expect(result.users[0]).toHaveProperty('has_pin', true)
    expect(JSON.stringify(result)).not.toMatch(/_hash|password|pepper|token/)
  })

  it('stores only a hash of the code and of the device token', () => {
    const code = mintEnrolCode(f.db, f.venueId, f.adminActor(), { mode: 'shared', label: 'Tablet' })
    const { token } = enrolDevice(f.db, { code: code.code }, { ip: IP })

    const stored = f.db.select().from(schema.enrolCodes).all()[0]!
    expect(stored.code).not.toBe(code.code)
    expect(f.db.select().from(schema.devices).all()[0]!.tokenHash).not.toBe(token)
  })
})

// ===========================================================================

describe('PIN login', () => {
  it('works on the shared tablet for anybody on the staff', () => {
    const device = enrol(f, 'shared')
    const { result } = loginWithPin(f.db, deviceRow(f, device.deviceId), {
      user_id: f.userId('Amar'), pin: '1111',
    }, { ip: IP })

    expect(result.user.name).toBe('Amar')
    expect(result.session.kind).toBe('staff')
    expect(result.session.borrowed).toBe(false)
    expect(attempts(f, { kind: 'pin', ok: true })).toHaveLength(1)
  })

  it('gives the owner of a personal phone a full session and a colleague a borrowed one', () => {
    const device = enrol(f, 'personal', 'Amar')

    const own = loginWithPin(f.db, deviceRow(f, device.deviceId), {
      user_id: f.userId('Amar'), pin: '1111',
    }, { ip: IP })
    expect(own.result.session.borrowed).toBe(false)

    // A colleague has to say so out loud.
    expect(catchError(() => loginWithPin(f.db, deviceRow(f, device.deviceId), {
      user_id: f.userId('Lejla'), pin: '2222',
    }, { ip: IP })).code).toBe('NOT_YOUR_DEVICE')

    const borrowed = loginWithPin(f.db, deviceRow(f, device.deviceId), {
      user_id: f.userId('Lejla'), pin: '2222', borrow: true,
    }, { ip: IP })
    expect(borrowed.result.session.borrowed).toBe(true)
    // Two hours, not fourteen.
    expect(borrowed.maxAgeS).toBe(2 * 3600)
  })

  it('refuses an admin PIN on a phone that is not his', () => {
    const shared = enrol(f, 'shared')
    expect(catchError(() => loginWithPin(f.db, deviceRow(f, shared.deviceId), {
      user_id: f.userId('Haris'), pin: '123456',
    }, { ip: IP })).code).toBe('ADMIN_DEVICE_ONLY')

    const his = enrol(f, 'personal', 'Haris')
    expect(loginWithPin(f.db, deviceRow(f, his.deviceId), {
      user_id: f.userId('Haris'), pin: '123456',
    }, { ip: IP }).result.user.role).toBe('admin')
  })

  it('exempts the dev device from the admin PIN rule', () => {
    const { result } = devEnrol(f.db, f.venueId)
    expect(loginWithPin(f.db, deviceRow(f, result.device.id), {
      user_id: f.userId('Haris'), pin: '123456',
    }, { ip: IP }).result.user.role).toBe('admin')
  })

  it('refuses a deactivated person and one with no PIN', () => {
    const device = enrol(f, 'shared')
    f.db.update(schema.users).set({ active: 0 }).where(eq(schema.users.id, f.userId('Dino'))).run()
    f.db.update(schema.users).set({ pinHash: null }).where(eq(schema.users.id, f.userId('Tarik'))).run()

    expect(catchError(() => loginWithPin(f.db, deviceRow(f, device.deviceId), {
      user_id: f.userId('Dino'), pin: '3333',
    }, { ip: IP })).code).toBe('USER_NOT_ACTIVE')

    expect(catchError(() => loginWithPin(f.db, deviceRow(f, device.deviceId), {
      user_id: f.userId('Tarik'), pin: '4444',
    }, { ip: IP })).code).toBe('NO_PIN')
  })

  it('leaves a committed attempt row after a wrong PIN — the first door', () => {
    const device = enrol(f, 'shared')
    expect(catchError(() => loginWithPin(f.db, deviceRow(f, device.deviceId), {
      user_id: f.userId('Amar'), pin: '9999',
    }, { ip: IP })).code).toBe('INVALID_PIN')

    const row = attempts(f, { kind: 'pin', ok: false })
    expect(row).toHaveLength(1)
    expect(row[0]!.deviceId).toBe(device.deviceId)
    expect(row[0]!.userId).toBe(f.userId('Amar'))
  })

  it('counts down `fails_left`', () => {
    const device = enrol(f, 'shared')
    const wrong = () => catchError(() => loginWithPin(f.db, deviceRow(f, device.deviceId), {
      user_id: f.userId('Amar'), pin: '9999',
    }, { ip: IP, now: f.clock.now() }))

    expect(wrong().data?.fails_left).toBe(4)
    expect(wrong().data?.fails_left).toBe(3)
  })
})

// ===========================================================================

describe('lockout', () => {
  /** Five wrong PINs for Amar on this device, at the fixture's clock. */
  function fail(device: string, times: number, name = 'Amar') {
    const errors = []
    for (let i = 0; i < times; i++) {
      errors.push(catchError(() => loginWithPin(f.db, deviceRow(f, device), {
        user_id: f.userId(name), pin: '9999',
      }, { ip: IP, now: f.clock.now() })))
      f.clock.advance(1)
    }
    return errors
  }

  it('five failures lock for 60 s, a correct PIN inside the window is still refused, +61 s works', () => {
    const device = enrol(f, 'shared')

    const errors = fail(device.deviceId, 5)
    expect(errors[4]!.status).toBe(423)
    expect(errors[4]!.code).toBe('LOCKED')
    expect(errors[4]!.data?.retry_after_s).toBe(60)

    // The right PIN, inside the lock. The lockout is consulted *before* the
    // compare, so being right is not a way out.
    const refused = catchError(() => loginWithPin(f.db, deviceRow(f, device.deviceId), {
      user_id: f.userId('Amar'), pin: '1111',
    }, { ip: IP, now: f.clock.now() }))
    expect(refused.status).toBe(423)

    f.clock.advance(61)
    expect(loginWithPin(f.db, deviceRow(f, device.deviceId), {
      user_id: f.userId('Amar'), pin: '1111',
    }, { ip: IP, now: f.clock.now() }).result.user.name).toBe('Amar')
  })

  it('knocking while locked out is refused without being counted', () => {
    const device = enrol(f, 'shared')
    fail(device.deviceId, 5)

    // Four more guesses inside the 60 s lock. They never reach the compare, so
    // they leave no attempt row — which is why walking up to the 900 s step-up
    // costs a minute of waiting per guess and not four seconds.
    const before = attempts(f, { ok: false }).length
    fail(device.deviceId, 4)
    expect(attempts(f, { ok: false })).toHaveLength(before)
  })

  it('ten failures step up to 900 s — but only by waiting each lock out', () => {
    const device = enrol(f, 'shared')

    const errors = []
    for (let i = 0; i < 10; i++) {
      errors.push(catchError(() => loginWithPin(f.db, deviceRow(f, device.deviceId), {
        user_id: f.userId('Amar'), pin: '9999',
      }, { ip: IP, now: f.clock.now() })))
      // Past the 60 s step-up, and well inside the 900 s counting window, so all
      // ten failures are still on the record when the tenth lands.
      f.clock.advance(61)
    }

    expect(errors[9]!.status).toBe(423)
    expect(errors[9]!.data?.retry_after_s).toBe(900)
    expect(attempts(f, { ok: false })).toHaveLength(10)
  })

  it('fifteen failures lock the device itself, unwindowed', () => {
    const device = enrol(f, 'shared')

    // Paced across three windows, so the 900 s step-up expires between them —
    // this is exactly the evasion the unwindowed count exists to close.
    for (let round = 0; round < 3; round++) {
      fail(device.deviceId, 5)
      f.clock.advance(901)
    }

    expect(deviceRow(f, device.deviceId).lockedAt).not.toBeNull()
    expect(attempts(f, { ok: false })).toHaveLength(DEVICE_LOCK_FAILS)

    // And the device is now refused everywhere, not just at the PIN pad.
    expect(catchError(() => requireEnrolledDevice(f.db, device.token)).code).toBe('DEVICE_REVOKED')
  })

  it('is per (device, user): Lejla is unaffected by Amar being locked out', () => {
    const device = enrol(f, 'shared')
    fail(device.deviceId, 5)

    expect(loginWithPin(f.db, deviceRow(f, device.deviceId), {
      user_id: f.userId('Lejla'), pin: '2222',
    }, { ip: IP, now: f.clock.now() }).result.user.name).toBe('Lejla')
  })

  it('is per device: the same person on a second tablet is not locked', () => {
    const one = enrol(f, 'shared')
    const two = enrol(f, 'shared')
    fail(one.deviceId, 5)

    expect(loginWithPin(f.db, deviceRow(f, two.deviceId), {
      user_id: f.userId('Amar'), pin: '1111',
    }, { ip: IP, now: f.clock.now() }).result.user.name).toBe('Amar')
  })

  it('a success clears the counter', () => {
    const device = enrol(f, 'shared')
    fail(device.deviceId, 4)

    loginWithPin(f.db, deviceRow(f, device.deviceId), {
      user_id: f.userId('Amar'), pin: '1111',
    }, { ip: IP, now: f.clock.now() })
    f.clock.advance(1)

    const state = lockoutState(f.db, f.venueId, 'pin', {
      deviceId: device.deviceId, userId: f.userId('Amar'), ip: IP,
    }, f.clock.now())
    expect(state.fails).toBe(0)
    expect(state.locked).toBe(false)
  })
})

// ===========================================================================

describe('getting back in', () => {
  it('resetPin unlocks the device this person locked, and writes the reset row', () => {
    const device = enrol(f, 'shared')
    for (let i = 0; i < 15; i++) {
      catchError(() => loginWithPin(f.db, deviceRow(f, device.deviceId), {
        user_id: f.userId('Emir'), pin: '999999',
      }, { ip: IP, now: f.clock.now() }))
      f.clock.advance(901)
    }
    expect(deviceRow(f, device.deviceId).lockedAt).not.toBeNull()

    const before = attempts(f).length
    resetPin(f.db, f.venueId, f.adminActor(), f.userId('Emir'), '654321', f.clock.now())

    expect(deviceRow(f, device.deviceId).lockedAt).toBeNull()
    expect(attempts(f, { kind: 'reset' })).toHaveLength(1)
    // The evidence is not deleted, only superseded.
    expect(attempts(f).length).toBe(before + 1)

    f.clock.advance(1)
    expect(loginWithPin(f.db, deviceRow(f, device.deviceId), {
      user_id: f.userId('Emir'), pin: '654321',
    }, { ip: IP, now: f.clock.now() }).result.user.name).toBe('Emir')
  })

  it('resetPin refuses a PIN that is not 4 or 6 digits', () => {
    expect(catchError(() => resetPin(f.db, f.venueId, f.adminActor(), f.userId('Amar'), '12345')).code)
      .toBe('PIN_LENGTH')
  })

  it('unlockDevice reopens one device and leaves auth_attempts intact', () => {
    const device = enrol(f, 'shared')
    f.db.update(schema.devices).set({ lockedAt: f.clock.now() })
      .where(eq(schema.devices.id, device.deviceId)).run()
    f.authAttempt('Amar', false)

    const before = attempts(f).length
    const after = unlockDevice(f.db, f.venueId, f.adminActor(), device.deviceId)

    expect(after.locked_at).toBeNull()
    expect(attempts(f).length).toBe(before)
    expect(catchError(() => unlockDevice(f.db, f.venueId, f.adminActor(), device.deviceId)).code)
      .toBe('DEVICE_NOT_LOCKED')
  })
})

// ===========================================================================

describe('sessions', () => {
  function loginAmar() {
    const device = enrol(f, 'shared')
    const { result, token } = loginWithPin(f.db, deviceRow(f, device.deviceId), {
      user_id: f.userId('Amar'), pin: '1111',
    }, { ip: IP, now: f.clock.now() })
    return { device, sessionToken: token, session: result.session }
  }

  it('resolves into an actor', () => {
    const { device, sessionToken } = loginAmar()

    const verdict = authorizeRequest(f.db, {
      path: '/api/tables/state', method: 'GET',
      cookies: { s: sessionToken, d: device.token }, ip: IP, now: f.clock.now(),
    })

    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.actor?.userId).toBe(f.userId('Amar'))
    expect(verdict.actor?.role).toBe('waiter')
    expect(verdict.actor?.sessionKind).toBe('staff')
    expect(verdict.actor?.deviceId).toBe(device.deviceId)
  })

  it('expires', () => {
    const { device, sessionToken } = loginAmar()
    f.clock.advance(15 * 3600)

    expect(refuse(f, '/api/tables/state', 'GET', sessionToken, device.token)).toEqual({
      status: 401, code: 'NO_SESSION',
    })
  })

  it('logout revokes it and leaves the device enrolled', () => {
    const { device, sessionToken } = loginAmar()
    const actor = authorizeRequest(f.db, {
      path: '/api/me', method: 'GET', cookies: { s: sessionToken, d: device.token },
      ip: IP, now: f.clock.now(),
    })
    expect(actor.ok && actor.actor).toBeTruthy()
    if (!actor.ok || !actor.actor) return

    logout(f.db, f.venueId, actor.actor, f.clock.now())

    expect(refuse(f, '/api/me', 'GET', sessionToken, device.token)).toEqual({
      status: 401, code: 'SESSION_REVOKED',
    })
    // Still enrolled: the tablet stays, only the person changed.
    expect(requireEnrolledDevice(f.db, device.token).id).toBe(device.deviceId)
  })

  it('revoking the device kills every session on it', () => {
    const { device, sessionToken } = loginAmar()
    revokeDevice(f.db, f.venueId, f.adminActor(), device.deviceId, f.clock.now())

    expect(refuse(f, '/api/me', 'GET', sessionToken, device.token)).toEqual({
      status: 401, code: 'DEVICE_REVOKED',
    })
    expect(catchError(() => revokeDevice(f.db, f.venueId, f.adminActor(), device.deviceId)).code)
      .toBe('DEVICE_ALREADY_REVOKED')
  })

  it('a staff session presented with somebody else\'s device cookie is a mismatch', () => {
    const { sessionToken } = loginAmar()
    const other = enrol(f, 'shared')

    expect(refuse(f, '/api/me', 'GET', sessionToken, other.token)).toEqual({
      status: 401, code: 'DEVICE_MISMATCH',
    })
    expect(refuse(f, '/api/me', 'GET', sessionToken, undefined)).toEqual({
      status: 401, code: 'DEVICE_MISMATCH',
    })
  })

  it('an admin session slides once a day; a staff session never slides', () => {
    const admin = adminLogin(f.db, { email: 'haris@lounge.ba', password: 'lounge' },
      { ip: IP, now: f.clock.now() })

    const soon = authorizeRequest(f.db, {
      path: '/api/me', method: 'GET', cookies: { s: admin.token }, ip: IP, now: f.clock.now(),
    })
    expect(soon.ok && soon.slideTo).toBeFalsy()

    f.clock.advance(25 * 3600)
    const later = authorizeRequest(f.db, {
      path: '/api/me', method: 'GET', cookies: { s: admin.token }, ip: IP, now: f.clock.now(),
    })
    expect(later.ok && later.slideTo).toBeTruthy()

    const { device, sessionToken } = loginAmar()
    const staff = authorizeRequest(f.db, {
      path: '/api/me', method: 'GET', cookies: { s: sessionToken, d: device.token },
      ip: IP, now: f.clock.now(),
    })
    expect(staff.ok && staff.slideTo).toBeFalsy()
  })

  it('getMe answers the same envelope for a staff and an admin session', () => {
    const { device, sessionToken } = loginAmar()
    const verdict = authorizeRequest(f.db, {
      path: '/api/me', method: 'GET', cookies: { s: sessionToken, d: device.token },
      ip: IP, now: f.clock.now(),
    })
    if (!verdict.ok || !verdict.actor) throw new Error('expected an actor')

    const me = getMe(f.db, f.venueId, verdict.actor)
    expect(me.user.name).toBe('Amar')
    expect(me.device?.id).toBe(device.deviceId)
    expect(me.venue.settings.timezone).toBe('Europe/Sarajevo')
    // The cursor the phone starts polling from, and it is `MAX(changes.seq)`
    // rather than a literal 0: the enrolment above wrote a `device_enrolled`
    // entry, and `log()` bumps. (On the WP1 branch `log()` was still WP5's
    // unlanded stub, so nothing had ever been bumped and 0 was the honest
    // number. This is the same assertion, written so it cannot go stale again.)
    expect(me.seq).toBe(maxSeq(f.db, f.venueId))
    expect(me.seq).toBeGreaterThan(0)
    expect(JSON.stringify(me)).not.toMatch(/_hash|password|pepper|token/)

    const admin = adminLogin(f.db, { email: 'haris@lounge.ba', password: 'lounge' }, { ip: IP })
    const adminVerdict = authorizeRequest(f.db, {
      path: '/api/me', method: 'GET', cookies: { s: admin.token }, ip: IP, now: f.clock.now(),
    })
    if (!adminVerdict.ok || !adminVerdict.actor) throw new Error('expected an actor')

    // No device at all on an email session — that is what `kind: 'admin'` means.
    expect(getMe(f.db, f.venueId, adminVerdict.actor).device).toBeNull()
  })
})

// ===========================================================================

describe('the lock screen list', () => {
  it('is the active staff and nothing more than the screen draws', () => {
    f.db.update(schema.users).set({ active: 0 }).where(eq(schema.users.id, f.userId('Dino'))).run()

    const users = listLoginUsers(f.db, f.venueId)
    expect(users).toHaveLength(5)
    expect(Object.keys(users[0]!).sort()).toEqual(
      ['active', 'has_pin', 'id', 'initials', 'name', 'pin_len', 'role'],
    )
  })
})

// ===========================================================================

describe('an approver PIN inside another service', () => {
  it('a wrong one leaves one committed attempt row and no business row', () => {
    const device = enrol(f, 'shared')
    const before = f.db.select().from(schema.lineAdjustments).all().length

    // What `requestAdjustment` (WP3) does: verify on `db`, outside its own
    // transaction, *before* it opens one. A wrong PIN throws here, so nothing
    // downstream ever runs — and the evidence is already committed.
    expect(catchError(() => verifyPinMetered(
      f.db, f.venueId, f.userId('Emir'), device.deviceId, '000000', { ip: IP, kind: 'approve' },
    )).code).toBe('INVALID_PIN')

    expect(attempts(f, { kind: 'approve', ok: false })).toHaveLength(1)
    expect(f.db.select().from(schema.lineAdjustments).all()).toHaveLength(before)
  })

  it('the right one returns quietly and records the success', () => {
    const device = enrol(f, 'shared')
    verifyPinMetered(f.db, f.venueId, f.userId('Emir'), device.deviceId, '123456',
      { ip: IP, kind: 'approve' })
    expect(attempts(f, { kind: 'approve', ok: true })).toHaveLength(1)
  })

  it('shares its lockout bucket with the PIN pad — approve and pin are one subject', () => {
    const device = enrol(f, 'shared')
    for (let i = 0; i < 5; i++) {
      catchError(() => verifyPinMetered(f.db, f.venueId, f.userId('Emir'), device.deviceId, '000000',
        { ip: IP, kind: 'approve', now: f.clock.now() }))
      f.clock.advance(1)
    }

    expect(catchError(() => loginWithPin(f.db, deviceRow(f, device.deviceId), {
      user_id: f.userId('Emir'), pin: '123456',
    }, { ip: IP, now: f.clock.now() })).status).toBe(423)
  })

  it('a user who does not exist still costs an attempt row rather than answering "no such person"', () => {
    const device = enrol(f, 'shared')
    expect(catchError(() => verifyMetered(f.db, f.venueId, {
      kind: 'approve',
      subject: { deviceId: device.deviceId, userId: null, ip: IP },
      stored: null, saltId: 'nobody', plain: '000000',
    })).code).toBe('INVALID_PIN')
    expect(attempts(f, { kind: 'approve', ok: false })).toHaveLength(1)
  })
})

// ===========================================================================

describe('the dev door', () => {
  it('keeps one device and re-mints its token, last browser wins', () => {
    const first = devEnrol(f.db, f.venueId)
    const second = devEnrol(f.db, f.venueId)

    expect(second.result.device.id).toBe(first.result.device.id)
    expect(second.token).not.toBe(first.token)
    // The old cookie is now dead: only one token hash is stored.
    expect(catchError(() => requireEnrolledDevice(f.db, first.token)).code).toBe('NO_DEVICE')
    expect(requireEnrolledDevice(f.db, second.token).label).toBe('dev')
    expect(f.db.select().from(schema.devices)
      .where(and(eq(schema.devices.venueId, f.venueId), eq(schema.devices.label, 'dev')))
      .all()).toHaveLength(1)
  })
})

// ===========================================================================

interface CaughtError { status: number, code: string, data?: Record<string, unknown> }

/** Run something that must throw a `SankError`, and hand back its shape. */
function catchError(fn: () => unknown): CaughtError {
  try {
    fn()
  } catch (err) {
    const e = err as { status?: number, code?: string, data?: Record<string, unknown> }
    if (typeof e.status === 'number' && typeof e.code === 'string') {
      return { status: e.status, code: e.code, data: e.data }
    }
    throw err
  }
  throw new Error('expected a SankError, got a value')
}

function refuse(fixture: Fixture, path: string, method: string, s?: string, d?: string) {
  const verdict = authorizeRequest(fixture.db, {
    path, method, cookies: { s, d }, ip: IP, now: fixture.clock.now(),
  })
  if (verdict.ok) throw new Error(`expected ${method} ${path} to be refused`)
  return { status: verdict.status, code: verdict.code }
}
