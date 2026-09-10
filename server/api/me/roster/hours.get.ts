/** `GET /api/me/roster/hours?month=` — *Moji sati*, own rows only. */
import { useDb } from '../../../utils/db'
import { guard } from '../../../utils/http'
import { rosterHours } from '../../../services/roster'

export default defineEventHandler(event => guard(() => {
  const raw = getQuery(event).month
  const month = typeof raw === 'string' && /^\d{4}-\d{2}$/.test(raw)
    ? raw
    : new Date().toISOString().slice(0, 7)
  // The `userId` argument is the actor's own, never a query parameter: nobody
  // reads a colleague's hours through this door.
  return rosterHours(useDb(), event.context.venueId, month, event.context.actor.userId)
}))
