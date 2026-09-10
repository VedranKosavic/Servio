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
  logout, resetPin, setSessionMode, verifyMetered, verifyPinMetered,
} from '../../server/services/auth'
import {
  devEnrol, enrolDevice, mintEnrolCode, requireEnrolledDevice, revokeDevice, unlockDevice,
} from '../../server/services/devices'
import { maxSeq } from '../../server/services/changes'
import { resetLimiters } from '../../server/utils/rate-limit'
import { DEVICE_LOCK_FAILS } from '#shared/constants'
import { landingFor } from '#shared/landing'
import { ROUTE_ROLES, routeKey } from '#shared/routeRoles'

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

  /**
   * A missing pepper is not "no pepper", it is a *different* pepper — and it
   * used to be silent. `npm run db:seed` runs outside Nuxt, so nothing loaded
   * `.env` for it; `peppered()` read `?? ''` and wrote a database whose every
   * PIN was refused by a server holding the real one, with no symptom but a pad
   * that turned everybody away until the device locked. It now throws, at both
   * doors, and `--env-file-if-exists=.env` in `package.json` is the other half.
   *
   * The `VITEST` escape is what makes `vitest.config.ts` the one place the
   * fixture pepper is set, so this test has to step outside it to see the guard.
   * A refusal to verify is deliberately *not* a false: false means "wrong PIN"
   * on every screen, and a server that cannot verify anybody is not that.
   */
  it('refuses to hash or verify at all when PIN_PEPPER is missing', () => {
    const pepper = process.env.PIN_PEPPER
    const vitest = process.env.VITEST
    delete process.env.PIN_PEPPER
    delete process.env.VITEST

    try {
      expect(() => hashSecret('1111', 'user-a')).toThrow(/PIN_PEPPER/)
      expect(() => verifySecret('1111', 'user-a', 'scrypt$1024$8$1$aa$bb')).toThrow(/PIN_PEPPER/)
    } finally {
      if (pepper === undefined) delete process.env.PIN_PEPPER
      else process.env.PIN_PEPPER = pepper
      if (vitest === undefined) delete process.env.VITEST
      else process.env.VITEST = vitest
    }

    // And the escape hatch really is the only reason the rest of this file runs.
    expect(verifySecret('1111', 'user-a', hashSecret('1111', 'user-a'))).toBe(true)
  })
})

// ===========================================================================

describe('admin login', () => {
  it('accepts the seeded owner and answers with no secret in the body', () => {
    const { result } = adminLogin(f.db, { email: 'haris@lounge.ba', password: '1111' }, { ip: IP })

    expect(result.user.name).toBe('Haris')
    expect(result.user.role).toBe('admin')
    expect(JSON.stringify(result)).not.toMatch(/_hash|password|pepper|token/)
    expect(attempts(f, { kind: 'password', ok: true })).toHaveLength(1)
  })

  /**
   * Phase 2 (WP0): the laptop door answers the same envelope as `GET /api/me`,
   * so `/admin/login.vue` hands it to `useMe().refreshAfterLogin()` rather than
   * assembling a `MeContext` by hand — which is what that function exists to
   * prevent. `AdminLoginResult` is gone.
   */
  it('answers a full MeContext, with no device and the venue settings', () => {
    const { result } = adminLogin(f.db, { email: 'haris@lounge.ba', password: '1111' }, { ip: IP })

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

  it('a radnik with no password cannot get an admin session', () => {
    f.db.update(schema.users).set({ email: 'amar@lounge.ba' })
      .where(eq(schema.users.id, f.userId('Amar'))).run()

    expect(catchError(() => adminLogin(f.db, { email: 'amar@lounge.ba', password: '1111' }, { ip: IP })).code)
      .toBe('INVALID_CREDENTIALS')
  })

  it('locks (ip, email) after five wrong passwords, and a different email is unaffected', () => {
    for (let i = 0; i < 5; i++) {
      catchError(() => adminLogin(f.db, { email: 'haris@lounge.ba', password: 'x' }, { ip: IP }))
    }

    const locked = catchError(() => adminLogin(f.db, { email: 'haris@lounge.ba', password: '1111' }, { ip: IP }))
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

  /**
   * It used to answer with the roster too — `users`, every active person's name,
   * initials and **role** — because the lock screen drew faces. The lock screen
   * is a pad now and draws nothing, so what was left was a list of which of the
   * three PINs opens the dashboard, handed to whoever posts a six-character
   * code. The envelope is the device and the venue, and nothing else.
   */
  it('answers with the device and the venue, and never the roster', () => {
    const code = mintEnrolCode(f.db, f.venueId, f.adminActor(), { mode: 'shared', label: 'Tablet' })
    const { result } = enrolDevice(f.db, { code: code.code }, { ip: IP })

    expect(result.venue.slug).toBe('lounge')
    expect(result).not.toHaveProperty('users')
    const body = JSON.stringify(result)
    expect(body).not.toMatch(/_hash|password|pepper|token/)
    for (const name of ['Amar', 'Emir', 'Haris']) expect(body).not.toContain(name)
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
      pin: f.pin('Amar'),
    }, { ip: IP })

    expect(result.user.name).toBe('Amar')
    expect(result.session.kind).toBe('staff')
    expect(result.session.borrowed).toBe(false)
    expect(attempts(f, { kind: 'pin', ok: true })).toHaveLength(1)
  })

  /**
   * The whole idea in one assertion: the body names nobody, and the same pad on
   * the same tablet answers with a different person for different digits.
   */
  it('the PIN identifies the person — different digits, different account', () => {
    const device = enrol(f, 'shared')
    const pad = (pin: string) =>
      loginWithPin(f.db, deviceRow(f, device.deviceId), { pin }, { ip: IP }).result.user

    expect(pad(f.pin('Amar')).name).toBe('Amar')
    expect(pad(f.pin('Emir')).name).toBe('Emir')
    expect(pad(f.pin('Lejla')).role).toBe('radnik')
  })

  it('refuses digits that belong to nobody, and names nobody in the refusal', () => {
    const device = enrol(f, 'shared')
    const err = catchError(() => loginWithPin(f.db, deviceRow(f, device.deviceId), {
      pin: '9999',
    }, { ip: IP }))

    expect(err.status).toBe(401)
    expect(err.code).toBe('INVALID_PIN')
    // A 401 that leaked a name would hand a stranger the staff list the pad
    // deliberately stopped drawing.
    expect(JSON.stringify(err)).not.toMatch(/Amar|Emir|Haris/)
  })

  /**
   * A worker may fold the choice into the first call, or post `/api/auth/mode`
   * a moment later — both write the same column, and a reload reads it back.
   */
  it('stores the screen mode from the PIN body, and null when it is not sent', () => {
    const device = enrol(f, 'shared')

    const withMode = loginWithPin(f.db, deviceRow(f, device.deviceId), {
      pin: f.pin('Amar'), mode: 'sanker',
    }, { ip: IP })
    expect(withMode.result.session.mode).toBe('sanker')
    expect(f.db.select().from(schema.sessions)
      .where(eq(schema.sessions.id, withMode.result.session.id)).get()!.mode).toBe('sanker')

    const without = loginWithPin(f.db, deviceRow(f, device.deviceId), {
      pin: f.pin('Emir'),
    }, { ip: IP })
    // `null` is the chooser: *Na čemu si večeras?* stands in front of him.
    expect(without.result.session.mode).toBeNull()
  })

  it('gives an admin no mode, whatever the body asks for', () => {
    const his = enrol(f, 'personal', 'Haris')
    const { result } = loginWithPin(f.db, deviceRow(f, his.deviceId), {
      pin: f.pin('Haris'), mode: 'konobar',
    }, { ip: IP })

    expect(result.user.role).toBe('admin')
    // His landing is `/admin`; `/konobar` stays reachable by hand, because the
    // owner also serves tables, but nothing sends him there.
    expect(result.session.mode).toBeNull()
  })

  /**
   * `borrowed` survived the loss of `user_id`; the tap that used to declare it
   * did not. The pad no longer asks who is typing, so there is nothing for a
   * colleague to answer `NOT_YOUR_DEVICE` with — and nothing needs answering,
   * because the server knows whose phone this is the moment the PIN resolves.
   */
  it('gives the owner of a personal phone a full session and a colleague a borrowed one', () => {
    const device = enrol(f, 'personal', 'Amar')

    const own = loginWithPin(f.db, deviceRow(f, device.deviceId), {
      pin: f.pin('Amar'),
    }, { ip: IP })
    expect(own.result.session.borrowed).toBe(false)
    expect(own.maxAgeS).toBe(14 * 3600)

    const borrowed = loginWithPin(f.db, deviceRow(f, device.deviceId), {
      pin: f.pin('Lejla'),
    }, { ip: IP })
    expect(borrowed.result.session.borrowed).toBe(true)
    // Two hours, not fourteen.
    expect(borrowed.maxAgeS).toBe(2 * 3600)
  })

  it('refuses an admin PIN on a phone that is not his', () => {
    const shared = enrol(f, 'shared')
    expect(catchError(() => loginWithPin(f.db, deviceRow(f, shared.deviceId), {
      pin: f.pin('Haris'),
    }, { ip: IP })).code).toBe('ADMIN_DEVICE_ONLY')

    const his = enrol(f, 'personal', 'Haris')
    expect(loginWithPin(f.db, deviceRow(f, his.deviceId), {
      pin: f.pin('Haris'),
    }, { ip: IP }).result.user.role).toBe('admin')
  })

  it('exempts the dev device from the admin PIN rule', () => {
    const { result } = devEnrol(f.db, f.venueId)
    expect(loginWithPin(f.db, deviceRow(f, result.device.id), {
      pin: f.pin('Haris'),
    }, { ip: IP }).result.user.role).toBe('admin')
  })

  /**
   * `USER_NOT_ACTIVE` and `NO_PIN` were the two answers the pad gave back when
   * the body named a person. It names nobody now, so neither of them can be
   * asked for: a deactivated account and one with no digits set are simply not
   * among the candidates, and what comes back is the stranger's `INVALID_PIN`.
   * Telling somebody holding an enrolled phone *which* of the two he had found
   * would answer a question the pad refused to ask.
   */
  it('leaves a deactivated person and one with no PIN out of the candidates', () => {
    const device = enrol(f, 'shared')
    const dinoPin = f.pin('Dino')
    const tarikPin = f.pin('Tarik')
    f.db.update(schema.users).set({ active: 0 }).where(eq(schema.users.id, f.userId('Dino'))).run()
    f.db.update(schema.users).set({ pinHash: null }).where(eq(schema.users.id, f.userId('Tarik'))).run()

    expect(catchError(() => loginWithPin(f.db, deviceRow(f, device.deviceId), {
      pin: dinoPin,
    }, { ip: IP })).code).toBe('INVALID_PIN')

    expect(catchError(() => loginWithPin(f.db, deviceRow(f, device.deviceId), {
      pin: tarikPin,
    }, { ip: IP })).code).toBe('INVALID_PIN')
  })

  /**
   * The evidence row, and the one column that moved. There is no account to
   * file a failure under at this door — the digits have been compared against
   * every candidate and matched none — so `user_id` is NULL and the IP joins the
   * device as the key. The success rows carry NULL too, deliberately: a success
   * filed under Amar would not clear failures filed under nobody.
   */
  it('leaves a committed attempt row after a wrong PIN — the first door', () => {
    const device = enrol(f, 'shared')
    expect(catchError(() => loginWithPin(f.db, deviceRow(f, device.deviceId), {
      pin: '9999',
    }, { ip: IP })).code).toBe('INVALID_PIN')

    const row = attempts(f, { kind: 'pin', ok: false })
    expect(row).toHaveLength(1)
    expect(row[0]!.deviceId).toBe(device.deviceId)
    expect(row[0]!.userId).toBeNull()
    expect(row[0]!.ip).toBe(IP)

    loginWithPin(f.db, deviceRow(f, device.deviceId), { pin: f.pin('Amar') }, { ip: IP })
    expect(attempts(f, { kind: 'pin', ok: true })[0]!.userId).toBeNull()
  })

  it('counts down `fails_left`', () => {
    const device = enrol(f, 'shared')
    const wrong = () => catchError(() => loginWithPin(f.db, deviceRow(f, device.deviceId), {
      pin: '9999',
    }, { ip: IP, now: f.clock.now() }))

    expect(wrong().data?.fails_left).toBe(4)
    expect(wrong().data?.fails_left).toBe(3)
  })
})

// ===========================================================================

/**
 * The counter that makes four digits safe — and the key it now turns on.
 *
 * The login door used to count against `(device, user)`, because the body named
 * the user. It names nobody now, so there is nothing to count against until the
 * digits have already been compared against every account — and the bucket is
 * `(device, ip)` instead. The thresholds are untouched (5 / 10 / 15) and so is
 * everything they trigger.
 *
 * Note which way that trade runs. One bucket per phone is **tighter** than one
 * bucket per phone per person: a stranger with an enrolled tablet used to get
 * five guesses at Amar and five more at Emir, and now gets five in total. What
 * it costs is a colleague standing at the same tablet on the same Wi-Fi, who is
 * locked out by somebody else's fumbling — which is the honest price of a pad
 * that cannot tell the two of them apart until the digits are right.
 */
describe('lockout', () => {
  /** Wrong digits at the pad, `times` over, at the fixture's clock. */
  function fail(device: string, times: number, ip = IP) {
    const errors = []
    for (let i = 0; i < times; i++) {
      errors.push(catchError(() => loginWithPin(f.db, deviceRow(f, device), {
        pin: '9999',
      }, { ip, now: f.clock.now() })))
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
      pin: f.pin('Amar'),
    }, { ip: IP, now: f.clock.now() }))
    expect(refused.status).toBe(423)

    f.clock.advance(61)
    expect(loginWithPin(f.db, deviceRow(f, device.deviceId), {
      pin: f.pin('Amar'),
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
        pin: '9999',
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

  /**
   * The half of the old key that survived, and the half that replaced the other.
   * Two guesses at the pad are the same subject whoever they were aimed at —
   * there is no "aimed at" any more — so the whole tablet is shut after five;
   * and the phone next to it, on its own address, is untouched.
   */
  it('is per (device, ip): the same tablet is shut for everybody, another address is not', () => {
    const device = enrol(f, 'shared')
    fail(device.deviceId, 5)

    // Lejla's own digits are correct and still refused: the door is shut, and it
    // was shut by somebody whose name nobody knows.
    expect(catchError(() => loginWithPin(f.db, deviceRow(f, device.deviceId), {
      pin: f.pin('Lejla'),
    }, { ip: IP, now: f.clock.now() })).status).toBe(423)

    // The address is the other half of the key, so a second phone on the café's
    // other uplink is not carrying this tablet's failures.
    expect(loginWithPin(f.db, deviceRow(f, device.deviceId), {
      pin: f.pin('Lejla'),
    }, { ip: '10.0.0.9', now: f.clock.now() }).result.user.name).toBe('Lejla')
  })

  it('is per device: the same address on a second tablet is not locked', () => {
    const one = enrol(f, 'shared')
    const two = enrol(f, 'shared')
    fail(one.deviceId, 5)

    expect(loginWithPin(f.db, deviceRow(f, two.deviceId), {
      pin: f.pin('Amar'),
    }, { ip: IP, now: f.clock.now() }).result.user.name).toBe('Amar')
  })

  it('a success clears the counter', () => {
    const device = enrol(f, 'shared')
    fail(device.deviceId, 4)

    loginWithPin(f.db, deviceRow(f, device.deviceId), {
      pin: f.pin('Amar'),
    }, { ip: IP, now: f.clock.now() })
    f.clock.advance(1)

    // The subject is the one the door actually counts on: no user, an address.
    const state = lockoutState(f.db, f.venueId, 'pin', {
      deviceId: device.deviceId, userId: null, ip: IP,
    }, f.clock.now())
    expect(state.fails).toBe(0)
    expect(state.locked).toBe(false)
  })
})

// ===========================================================================

describe('getting back in', () => {
  /**
   * The half of the old promise that survives: a reset still unlocks the phone
   * this person is *bound* to, and still writes the row every counter of his
   * measures from. The half that could not survive is the tablet shut by
   * anonymous guessing at the pad — see the two tests below.
   */
  it('resetPin unlocks this person\'s own phone, and writes the reset row', () => {
    const his = enrol(f, 'personal', 'Emir')
    for (let i = 0; i < DEVICE_LOCK_FAILS; i++) {
      catchError(() => loginWithPin(f.db, deviceRow(f, his.deviceId), {
        pin: '9999',
      }, { ip: IP, now: f.clock.now() }))
      f.clock.advance(901)
    }
    expect(deviceRow(f, his.deviceId).lockedAt).not.toBeNull()

    const before = attempts(f).length
    resetPin(f.db, f.venueId, f.adminActor(), f.userId('Emir'), '6543', f.clock.now())

    expect(deviceRow(f, his.deviceId).lockedAt).toBeNull()
    // Two clears: the person's, and the device-shaped one for the phone this
    // reset actually reopened. The evidence is not deleted, only superseded.
    expect(attempts(f, { kind: 'reset' })).toHaveLength(2)
    expect(attempts(f).length).toBe(before + 2)

    f.clock.advance(1)
    expect(loginWithPin(f.db, deviceRow(f, his.deviceId), {
      pin: '6543',
    }, { ip: IP, now: f.clock.now() }).result.user.name).toBe('Emir')
  })

  /**
   * A shared tablet shut by a stranger belongs to nobody, so nobody's reset
   * reopens it. This is not an oversight to fix later: the fifteen failures
   * behind that lock were filed against `user_id NULL` precisely because the pad
   * refuses to ask who is typing, and a reset that reached them would have to
   * guess whose they were.
   */
  it('does not reopen a shared tablet the pad shut — that is the device\'s own key', () => {
    const tablet = enrol(f, 'shared')
    for (let i = 0; i < DEVICE_LOCK_FAILS; i++) {
      catchError(() => loginWithPin(f.db, deviceRow(f, tablet.deviceId), {
        pin: '9999',
      }, { ip: IP, now: f.clock.now() }))
      f.clock.advance(901)
    }

    resetPin(f.db, f.venueId, f.adminActor(), f.userId('Emir'), '6543', f.clock.now())
    expect(deviceRow(f, tablet.deviceId).lockedAt).not.toBeNull()
  })

  /**
   * …and the key that does work has to clear the counter, not just the flag.
   * Before this, `unlockDevice` reopened a tablet whose unwindowed fifteen were
   * still standing, so the first fat-fingered PIN after the unlock read the same
   * fifteen and shut it again — an unlock that lasted one tap.
   */
  it('unlockDevice reopens it for good: the counter goes with the flag', () => {
    const tablet = enrol(f, 'shared')
    for (let i = 0; i < DEVICE_LOCK_FAILS; i++) {
      catchError(() => loginWithPin(f.db, deviceRow(f, tablet.deviceId), {
        pin: '9999',
      }, { ip: IP, now: f.clock.now() }))
      f.clock.advance(901)
    }

    const before = attempts(f, { ok: false }).length
    unlockDevice(f.db, f.venueId, f.adminActor(), tablet.deviceId, f.clock.now())
    f.clock.advance(1)

    // One more wrong PIN must cost one step, not the whole tablet again.
    catchError(() => loginWithPin(f.db, deviceRow(f, tablet.deviceId), {
      pin: '9999',
    }, { ip: IP, now: f.clock.now() }))
    f.clock.advance(1)
    expect(deviceRow(f, tablet.deviceId).lockedAt).toBeNull()

    // And the record of that night is intact — a clear supersedes, never deletes.
    expect(attempts(f, { ok: false }).length).toBe(before + 1)

    expect(loginWithPin(f.db, deviceRow(f, tablet.deviceId), {
      pin: f.pin('Amar'),
    }, { ip: IP, now: f.clock.now() }).result.user.name).toBe('Amar')
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
    // One row more, and it is the clear, not a deletion: the failed attempts
    // this tablet collected are all still on the record.
    expect(attempts(f).length).toBe(before + 1)
    expect(attempts(f, { kind: 'reset' })).toHaveLength(1)
    expect(attempts(f, { ok: false })).toHaveLength(1)
  })

  /**
   * The bar tablet at 23:00, and the reason *Otključaj* stopped asking whether
   * `locked_at` is set. Ten wrong PINs are a 15-minute lock that is *counted*
   * and never flagged — the pad's failures are filed against the device with no
   * user, so no PIN reset reaches them either. The old 409 made the owner's one
   * key answer "this device is not locked" to a tablet nobody could type on.
   */
  it('unlockDevice clears a counter-only lock, with locked_at never set', () => {
    const device = enrol(f, 'shared')
    // Ten wrong PINs at the pad, written the way the pad writes them: against
    // the device, with `user_id NULL`, because the pad does not know who typed.
    for (let i = 0; i < 10; i++) {
      f.db.insert(schema.authAttempts).values({
        id: `att-${i}`, venueId: f.venueId, deviceId: device.deviceId, userId: null,
        ip: IP, kind: 'pin', ok: 0, createdAt: f.clock.now(),
      }).run()
    }

    const subject = { deviceId: device.deviceId, userId: null, ip: IP }
    expect(lockoutState(f.db, f.venueId, 'pin', subject, f.clock.now()).locked).toBe(true)
    // The 15-minute step is *counted*, never flagged — which is exactly why the
    // old `DEVICE_NOT_LOCKED` guard refused the case the owner most needed.
    expect(deviceRow(f, device.deviceId).lockedAt).toBeNull()

    const after = unlockDevice(f.db, f.venueId, f.adminActor(), device.deviceId)

    expect(after.locked_at).toBeNull()
    expect(lockoutState(f.db, f.venueId, 'pin', subject, f.clock.now()).locked).toBe(false)
    // Cleared, not erased: the ten failures are still on the record.
    expect(attempts(f, { ok: false })).toHaveLength(10)
    expect(attempts(f, { kind: 'reset' })).toHaveLength(1)
  })
})

// ===========================================================================

describe('sessions', () => {
  function loginAmar() {
    const device = enrol(f, 'shared')
    const { result, token } = loginWithPin(f.db, deviceRow(f, device.deviceId), {
      pin: f.pin('Amar'),
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
    expect(verdict.actor?.role).toBe('radnik')
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
    const admin = adminLogin(f.db, { email: 'haris@lounge.ba', password: '1111' },
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

    const admin = adminLogin(f.db, { email: 'haris@lounge.ba', password: '1111' }, { ip: IP })
    const adminVerdict = authorizeRequest(f.db, {
      path: '/api/me', method: 'GET', cookies: { s: admin.token }, ip: IP, now: f.clock.now(),
    })
    if (!adminVerdict.ok || !adminVerdict.actor) throw new Error('expected an actor')

    // No device at all on an email session — that is what `kind: 'admin'` means.
    expect(getMe(f.db, f.venueId, adminVerdict.actor).device).toBeNull()
  })
})

// ===========================================================================

/**
 * The second step behind the pad, and the rule that reads it.
 *
 * The screen a person works tonight stopped being a property of the account
 * when `waiter` and `bartender` became one `radnik`. It is a `ScreenMode` on the
 * **session**: a shift's worth of choice, not a fact about the person, so Emir
 * can be on the šank tonight and on the floor tomorrow and a reload at 02:00
 * still lands him where he was.
 */
describe('the screen mode', () => {
  /** PIN in and hand back the actor the middleware would have built. */
  function signIn(name: string, mode?: 'konobar' | 'sanker') {
    const device = enrol(f, 'shared')
    const { token } = loginWithPin(f.db, deviceRow(f, device.deviceId), {
      pin: f.pin(name), ...(mode ? { mode } : {}),
    }, { ip: IP, now: f.clock.now() })

    const verdict = authorizeRequest(f.db, {
      path: '/api/me', method: 'GET', cookies: { s: token, d: device.token },
      ip: IP, now: f.clock.now(),
    })
    if (!verdict.ok || !verdict.actor) throw new Error('expected an actor')
    return verdict.actor
  }

  it('is written by the chooser and read back by `GET /api/me`', () => {
    const amar = signIn('Amar')
    expect(getMe(f.db, f.venueId, amar).session.mode).toBeNull()

    expect(setSessionMode(f.db, f.venueId, amar, 'konobar').session.mode).toBe('konobar')
    // The reload: a fresh envelope off the same session row.
    expect(getMe(f.db, f.venueId, amar).session.mode).toBe('konobar')
  })

  it('switches at midnight without signing out', () => {
    const emir = signIn('Emir', 'sanker')
    expect(getMe(f.db, f.venueId, emir).session.mode).toBe('sanker')

    // Both screens stay open to every worker: moving between them is this one
    // call and not a logout, which is the whole point of putting it here.
    expect(setSessionMode(f.db, f.venueId, emir, 'konobar').session.mode).toBe('konobar')
    expect(getMe(f.db, f.venueId, emir).session.mode).toBe('konobar')
  })

  it('stays null for an admin, who is answered rather than refused', () => {
    const device = enrol(f, 'personal', 'Haris')
    const { token } = loginWithPin(f.db, deviceRow(f, device.deviceId), {
      pin: f.pin('Haris'),
    }, { ip: IP, now: f.clock.now() })
    const verdict = authorizeRequest(f.db, {
      path: '/api/me', method: 'GET', cookies: { s: token, d: device.token },
      ip: IP, now: f.clock.now(),
    })
    if (!verdict.ok || !verdict.actor) throw new Error('expected an actor')

    // Not a 403: it is a tap he can only reach by accident, and his landing
    // ignores the value either way.
    expect(setSessionMode(f.db, f.venueId, verdict.actor, 'sanker').session.mode).toBeNull()
  })

  it('belongs to one session, not to the person', () => {
    const first = signIn('Amar', 'sanker')
    const second = signIn('Amar', 'konobar')

    expect(getMe(f.db, f.venueId, first).session.mode).toBe('sanker')
    expect(getMe(f.db, f.venueId, second).session.mode).toBe('konobar')
  })

  /** `shared/landing.ts` — the one rule, and the client reads the same table. */
  it('decides where a fresh session is sent', () => {
    expect(landingFor('admin', null)).toBe('/admin')
    // An admin has no mode; if a row ever carried one it would still be /admin.
    expect(landingFor('admin', 'sanker')).toBe('/admin')
    expect(landingFor('radnik', 'konobar')).toBe('/konobar')
    expect(landingFor('radnik', 'sanker')).toBe('/sanker')
    // `null` is the chooser, and deliberately not a path: that screen is the
    // client's and the server has no opinion about its address.
    expect(landingFor('radnik', null)).toBeNull()
  })

  it('leaves the staff screens open to the owner, who also serves tables', () => {
    for (const [method, path] of [['GET', '/api/tables/state'], ['POST', '/api/orders']] as const) {
      const key = routeKey(method, path)
      expect([key, ROUTE_ROLES[key]]).toEqual([key, ['admin', 'radnik']])
    }
  })
})

// ===========================================================================

describe('the lock screen list', () => {
  it('is the active staff and nothing more than the screen draws', () => {
    f.db.update(schema.users).set({ active: 0 }).where(eq(schema.users.id, f.userId('Dino'))).run()

    const users = listLoginUsers(f.db, f.venueId)
    expect(users).toHaveLength(5)
    expect(Object.keys(users[0]!).sort()).toEqual(
      ['active', 'has_pin', 'id', 'initials', 'last_login_at', 'name', 'pin_len', 'role'],
    )
  })

  /**
   * PHASE3 §1.8. The lock screen offers the last three faces first, and the
   * recency it sorts on is **this device's** — the one thing this body may grow.
   * Asked without a device (the enrol response, which has no history yet) every
   * row answers `null` rather than a café-wide ranking nobody outside the bar
   * should be able to read off an unlocked phone.
   */
  it('answers last_login_at for the asking device, and null without one', () => {
    const here_ = enrol(f, 'shared')
    const there = enrol(f, 'shared')

    loginWithPin(f.db, deviceRow(f, here_.deviceId), { pin: f.pin('Amar') }, { ip: IP })
    loginWithPin(f.db, deviceRow(f, there.deviceId), { pin: f.pin('Lejla') }, { ip: IP })

    const here = listLoginUsers(f.db, f.venueId, here_.deviceId)
    expect(here.find(u => u.name === 'Amar')?.last_login_at).toBeTruthy()
    // Lejla signed in on the terrace tablet, not on this one.
    expect(here.find(u => u.name === 'Lejla')?.last_login_at).toBeNull()

    expect(listLoginUsers(f.db, f.venueId).every(u => u.last_login_at === null)).toBe(true)
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
      f.db, f.venueId, f.userId('Emir'), device.deviceId, '0000', { ip: IP, kind: 'approve' },
    )).code).toBe('INVALID_PIN')

    expect(attempts(f, { kind: 'approve', ok: false })).toHaveLength(1)
    expect(f.db.select().from(schema.lineAdjustments).all()).toHaveLength(before)
  })

  it('the right one returns quietly and records the success', () => {
    const device = enrol(f, 'shared')
    verifyPinMetered(f.db, f.venueId, f.userId('Emir'), device.deviceId, f.pin('Emir'),
      { ip: IP, kind: 'approve' })
    expect(attempts(f, { kind: 'approve', ok: true })).toHaveLength(1)
  })

  /**
   * The one place the two doors came apart, and it is worth being explicit
   * about rather than discovering at 01:00.
   *
   * `approve` still knows exactly whose PIN it is asking for — an approval names
   * its approver — so it still counts against `(device, user)`. The pad no
   * longer knows, so it counts against `(device, ip)`. Two different keys are
   * two different buckets, and five failed approvals for Emir therefore do
   * **not** shut the pad the way they did when the pad also named him.
   *
   * The honest cost is a second budget of five, and it is worth naming: the
   * unwindowed 15 that shuts the device is counted per subject too, so the two
   * doors now walk toward it separately rather than together. What keeps that
   * from mattering is that they are not equally open — the pad is the anonymous
   * door, reachable by anyone holding the tablet, and it is fully metered at 15
   * on its own (see `describe('lockout')`), while an approval already needs a
   * live session and carries `pinLimiter` on top. The next test is the other
   * half: the approver door reaches the same device lock by itself.
   */
  it('no longer shares the pad\'s bucket — approve knows its user, the pad does not', () => {
    const device = enrol(f, 'shared')
    for (let i = 0; i < 5; i++) {
      catchError(() => verifyPinMetered(f.db, f.venueId, f.userId('Emir'), device.deviceId, '0000',
        { ip: IP, kind: 'approve', now: f.clock.now() }))
      f.clock.advance(1)
    }

    // Emir's approver bucket is shut.
    expect(catchError(() => verifyPinMetered(f.db, f.venueId, f.userId('Emir'), device.deviceId,
      f.pin('Emir'), { ip: IP, kind: 'approve', now: f.clock.now() })).status).toBe(423)

    // The pad's is not: nobody has typed a wrong digit at it.
    expect(loginWithPin(f.db, deviceRow(f, device.deviceId), {
      pin: f.pin('Emir'),
    }, { ip: IP, now: f.clock.now() }).result.user.name).toBe('Emir')
  })

  /** …and it still shuts the tablet on its own fifteen, exactly as the pad does. */
  it('reaches the device lock by itself, unwindowed', () => {
    const device = enrol(f, 'shared')

    // Paced past the 900 s window each time, so only the unwindowed count is
    // still standing when the fifteenth lands.
    for (let i = 0; i < DEVICE_LOCK_FAILS; i++) {
      catchError(() => verifyPinMetered(f.db, f.venueId, f.userId('Emir'), device.deviceId, '0000',
        { ip: IP, kind: 'approve', now: f.clock.now() }))
      f.clock.advance(901)
    }

    expect(deviceRow(f, device.deviceId).lockedAt).not.toBeNull()
    expect(catchError(() => requireEnrolledDevice(f.db, device.token)).code).toBe('DEVICE_REVOKED')
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
