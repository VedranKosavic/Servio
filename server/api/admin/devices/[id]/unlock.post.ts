/**
 * `POST /api/admin/devices/:id/unlock` — reopen a tablet the 15-fail lock shut.
 *
 * An unwindowed lock with no key is a bar tablet that dies at 23:00 on a
 * Saturday and stays dead. There are two keys: resetting the PIN of the person
 * who locked it, and this — for the case where the locked-out person is not the
 * one you want to re-PIN.
 *
 * It clears `locked_at` and nothing else. `auth_attempts` is untouched: the
 * evidence stays, only the door reopens (§5.2).
 */
import { deviceActionBody } from '#shared/schemas'
import { useDb } from '../../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../../utils/http'
import { unlockDevice } from '../../../../services/devices'

export default defineEventHandler(async (event) => {
  const id = requiredParam(event, 'id')
  await readValidatedJson(event, deviceActionBody)
  return guard(() => unlockDevice(useDb(), event.context.venueId, event.context.actor, id))
})
