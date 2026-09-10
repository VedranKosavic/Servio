/** `POST /api/roster/weeks/copy` — *Kopiraj prošlu sedmicu*. */
import { weekBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson } from '../../../utils/http'
import { copyWeek } from '../../../services/roster'

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, weekBody)
  return guard(() =>
    copyWeek(useDb(), event.context.venueId, event.context.actor, body.week_start))
})
