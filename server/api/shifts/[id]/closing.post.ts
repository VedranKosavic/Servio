/** `POST /api/shifts/:id/closing` — *Zatvori smjenu*: start collecting envelopes. */
import { startClosingBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../utils/http'
import { startClosing } from '../../../services/shifts'

export default defineEventHandler(async (event) => {
  const shiftId = requiredParam(event, 'id')
  await readValidatedJson(event, startClosingBody)
  return guard(() => startClosing(useDb(), event.context.venueId, event.context.actor, shiftId))
})
