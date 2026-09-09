/** `GET /api/me/shifts?limit=30` — *Moja smjena*, the last few nights. */
import { useDb } from '../../utils/db'
import { guard } from '../../utils/http'
import { listMyShifts } from '../../services/summaries'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const limit = Number(query.limit ?? 30)
  return guard(() => listMyShifts(
    useDb(), event.context.venueId, event.context.actor.userId,
    Number.isFinite(limit) ? limit : 30,
  ))
})
