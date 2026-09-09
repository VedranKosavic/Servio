/** `POST /api/shifts/:id/settle` — *Završi smjenu*, the blind declaration. */
import { settleBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../utils/http'
import { settle } from '../../../services/settlements'

export default defineEventHandler(async (event) => {
  const shiftId = requiredParam(event, 'id')
  const body = await readValidatedJson(event, settleBody)
  return guard(() => settle(useDb(), event.context.venueId, event.context.actor, shiftId, body))
})
