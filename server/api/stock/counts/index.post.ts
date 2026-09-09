/** `POST /api/stock/counts` — creates and submits a count in one go (§6.8). */
import { submitCountBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson } from '../../../utils/http'
import { submitCount } from '../../../services/counts'

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, submitCountBody)
  return guard(() => submitCount(useDb(), event.context.venueId, event.context.actor, body))
})
