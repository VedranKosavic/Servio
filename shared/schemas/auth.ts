/**
 * The bodies of the auth and device routes (`docs/BACKEND.md` §5, §7).
 *
 * WP1 owns this fragment. `shared/schemas.ts` re-exports it, and
 * `tests/unit/pin-routes.test.ts` walks the fragments — not the barrel —
 * looking for every exported Zod object with a `pin`-shaped key, so that no
 * route can quietly start reading a PIN without going through the metered
 * verifier (§5.2).
 *
 * Everything here is `.strict()`: an unknown key in an auth body is a
 * programming error or an attack, never something to shrug at.
 */
import { z } from 'zod'
import { ENROL_CODE_LEN } from '../constants'
import { pin, uuid } from './common'

/**
 * `POST /api/auth/admin/login`. The email is lowercased and trimmed here, so
 * `users_email_uq` and the lockout subject see the same string every time —
 * otherwise `Haris@…` and `haris@…` would be two different lockout buckets and
 * five guesses each.
 */
export const adminLoginBody = z.object({
  email: z.email().max(120).trim().toLowerCase(),
  password: z.string().min(1).max(200),
}).strict()

/** *Konobar* or *Šanker* — the screen a worker is on tonight. */
export const screenMode = z.enum(['konobar', 'sanker'])

/**
 * `POST /api/auth/pin` — **the PIN identifies the person**.
 *
 * There is no `user_id` any more, and there is no list of names in front of the
 * pad: the server tries the digits against the active accounts of the venue the
 * enrolled device belongs to and answers 401 when nothing matches. That is why
 * `POST /api/admin/users` and `POST /api/admin/users/:id/pin` refuse a PIN that
 * is already somebody's (409 `PIN_TAKEN`) — a PIN two people share identifies
 * neither.
 *
 * `borrow` went with `user_id`, and for the same reason. It used to be the
 * deliberate "yes, this is Emir's phone and I know it" tap, but the pad no
 * longer asks *who* — so the server, which knows whose phone this is the moment
 * the PIN resolves, marks the session `borrowed` itself and gives it two hours
 * instead of fourteen. The property survives; the extra tap and its 403 do not.
 *
 * `mode` is the optional second step folded into the first call: a worker who
 * already knows he is on the šank tonight can send it here instead of posting
 * `/api/auth/mode` a moment later. It is ignored for an admin, who has no mode.
 */
export const pinLoginBody = z.object({
  pin,
  mode: screenMode.optional(),
}).strict()

/**
 * `POST /api/auth/mode` — the chooser, and the switch.
 *
 * The same route serves both: a worker who has just PIN'd in and is looking at
 * *Na čemu si večeras?*, and one who moves from the bar to the floor at
 * midnight. Nobody signs out to change screens.
 */
export const setModeBody = z.object({
  mode: screenMode,
}).strict()

/**
 * `POST /api/devices/enrol`. The code is uppercased before it is looked up:
 * somebody typing it on a phone keyboard will send lower case half the time,
 * and `enrol_codes_code_uq` stores the alphabet's own upper case.
 */
export const enrolDeviceBody = z.object({
  code: z.string().trim().toUpperCase().length(ENROL_CODE_LEN),
  label: z.string().trim().min(1).max(40).optional(),
  app_version: z.string().trim().max(20).optional(),
}).strict()

/** `POST /api/dev/enrol` — no body at all; the whole route is a dev convenience. */
export const devEnrolBody = z.object({}).strict()

/** `POST /api/auth/logout`. */
export const logoutBody = z.object({}).strict()

/**
 * `POST /api/admin/enrol-codes`. A `personal` code carries the person it binds
 * the phone to; a `shared` one is the bar tablet anybody may PIN into.
 */
export const createEnrolCodeBody = z.object({
  mode: z.enum(['personal', 'shared']),
  bound_user_id: uuid.optional(),
  label: z.string().trim().min(1).max(40),
}).strict()

/** `PATCH /api/admin/devices/:id` — the label is the only mutable field. */
export const updateDeviceBody = z.object({
  label: z.string().trim().min(1).max(40),
}).strict()

/** `POST /api/admin/devices/:id/revoke` and `/unlock`. */
export const deviceActionBody = z.object({}).strict()

// `heartbeatBody` lived here on the WP1 branch as well. It is WP5's, in
// `shared/schemas/sync.ts`, together with the route and the service that answer
// it — and that copy is the one the shipped `services/heartbeat.ts` is written
// against: it treats `app_version` and `standalone` as optional, so a phone that
// has not been updated still checks in instead of 400ing every 60 s.

export type AdminLoginBody = z.infer<typeof adminLoginBody>
export type PinLoginBody = z.infer<typeof pinLoginBody>
export type SetModeBody = z.infer<typeof setModeBody>
export type EnrolDeviceBody = z.infer<typeof enrolDeviceBody>
export type CreateEnrolCodeBody = z.infer<typeof createEnrolCodeBody>
export type UpdateDeviceBody = z.infer<typeof updateDeviceBody>
