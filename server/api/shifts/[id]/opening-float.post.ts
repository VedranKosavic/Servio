/** `POST /api/shifts/:id/opening-float` — the admin corrects the derived float. */
import { openingFloatBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../utils/http'
import { setOpeningFloat } from '../../../services/cash'

export default defineEventHandler(async (event) => {
  const shiftId = requiredParam(event, 'id')
  const body = await readValidatedJson(event, openingFloatBody)
  return guard(() =>
    setOpeningFloat(useDb(), event.context.venueId, event.context.actor, shiftId, body))
})
