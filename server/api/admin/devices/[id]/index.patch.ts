/** `PATCH /api/admin/devices/:id` — rename a phone. The label is all that moves. */
import { updateDeviceBody } from '#shared/schemas'
import { useDb } from '../../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../../utils/http'
import { updateDevice } from '../../../../services/devices'

export default defineEventHandler(async (event) => {
  const id = requiredParam(event, 'id')
  const body = await readValidatedJson(event, updateDeviceBody)
  return guard(() => updateDevice(useDb(), event.context.venueId, event.context.actor, id, body))
})
