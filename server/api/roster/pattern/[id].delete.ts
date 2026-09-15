/** `DELETE /api/roster/pattern/:id` — take one person off one cell of the week. */
import { useDb } from '../../../utils/db'
import { guard, requiredParam } from '../../../utils/http'
import { removeFromPattern } from '../../../services/roster'

export default defineEventHandler(event => guard(() => {
  removeFromPattern(useDb(), event.context.venueId, event.context.actor, requiredParam(event, 'id'))
  return { ok: true as const }
}))
