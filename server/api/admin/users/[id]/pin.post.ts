/**
 * `POST /api/admin/users/:id/pin` — the admin gives somebody a new PIN.
 *
 * §12 gives this file to WP6 (it is admin CRUD like every other file in the
 * folder) and the logic to WP1: `resetPin` in `services/auth.ts` hashes with the
 * pepper, clears `devices.locked_at` on every phone this person locked out, and
 * writes the `user_changed` and `device_unlocked` entries. Two PIN-writing code
 * paths would be one too many, so this route only carries the request across.
 *
 * It is deliberately not on `PIN_BEARING_ROUTES`: that list is the *approval*
 * routes, where a PIN authorises somebody else's money and `pinLimiter` is keyed
 * on `(deviceId, approverUserId)`. Here the admin's own session is the
 * authority, and the PIN is being written rather than verified.
 */
import { resetUserPinBody } from '#shared/schemas'
import { useDb } from '../../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../../utils/http'
import { requireRole } from '../../../../utils/auth'
import { resetPin } from '../../../../services/auth'

export default defineEventHandler(async (event) => {
  requireRole(event.context.actor, 'admin')
  const id = requiredParam(event, 'id')
  const body = await readValidatedJson(event, resetUserPinBody)
  return guard(() => resetPin(useDb(), event.context.venueId, event.context.actor, id, body.pin))
})
