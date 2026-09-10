/** `GET /api/roster/hours?month=` — *Sati*, every person. Owner only. */
import { useDb } from '../../utils/db'
import { guard } from '../../utils/http'
import { rosterHours } from '../../services/roster'

export default defineEventHandler(event => guard(() => {
  const raw = getQuery(event).month
  const month = typeof raw === 'string' && /^\d{4}-\d{2}$/.test(raw)
    ? raw
    : new Date().toISOString().slice(0, 7)
  return rosterHours(useDb(), event.context.venueId, month)
}))
