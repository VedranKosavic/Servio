/** `GET /api/shifts/:id/zakljucenje` — the server's numbers before *Zaključi smjenu*. */
import { useDb } from '../../../utils/db'
import { guard, requiredParam } from '../../../utils/http'
import { closingPreview } from '../../../services/closings'

export default defineEventHandler((event) => {
  const shiftId = requiredParam(event, 'id')
  return guard(() =>
    closingPreview(useDb(), event.context.venueId, event.context.actor, shiftId))
})
