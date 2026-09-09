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

/**
 * `POST /api/auth/pin`. `user_id` is not a secret — the lock screen just drew
 * the names — and `borrow` is the deliberate "yes, this is Emir's phone and I
 * know it" tap that turns a 403 into a 2 h session.
 */
export const pinLoginBody = z.object({
  user_id: uuid,
  pin,
  borrow: z.boolean().optional(),
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
export type EnrolDeviceBody = z.infer<typeof enrolDeviceBody>
export type CreateEnrolCodeBody = z.infer<typeof createEnrolCodeBody>
export type UpdateDeviceBody = z.infer<typeof updateDeviceBody>
