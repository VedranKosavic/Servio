/**
 * `POST /api/admin/devices/:id/revoke` — the phone is lost, or the person left.
 *
 * Every live session on it dies in the same transaction. A revoke that left the
 * sessions alive would mean the phone kept taking orders for another fourteen
 * hours, which is the opposite of what the button says.
 */
import { deviceActionBody } from '#shared/schemas'
import { useDb } from '../../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../../utils/http'
import { revokeDevice } from '../../../../services/devices'

export default defineEventHandler(async (event) => {
  const id = requiredParam(event, 'id')
  await readValidatedJson(event, deviceActionBody)
  return guard(() => revokeDevice(useDb(), event.context.venueId, event.context.actor, id))
})
