/**
 * `POST /api/roster/pattern` — `{ weekday, template_id, user_id }`, one person
 * into one cell, saved for every week. `409 SHIFT_FULL` at the third person,
 * `409 ALREADY_IN_SHIFT` for the same person twice.
 */
import { patternBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson } from '../../../utils/http'
import { addToPattern } from '../../../services/roster'

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, patternBody)
  return guard(() =>
    addToPattern(useDb(), event.context.venueId, event.context.actor, body))
})
