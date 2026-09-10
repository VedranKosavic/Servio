/** `POST /api/roster/weeks/publish` — *Objavi raspored*, and one *Svi* line. */
import { weekBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson } from '../../../utils/http'
import { publishWeek } from '../../../services/roster'

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, weekBody)
  return guard(() =>
    publishWeek(useDb(), event.context.venueId, event.context.actor, body.week_start))
})
