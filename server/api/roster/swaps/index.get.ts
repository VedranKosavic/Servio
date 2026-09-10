/** `GET /api/roster/swaps?status=` — the owner's *Zamjene* panel. */
import { useDb } from '../../../utils/db'
import { guard } from '../../../utils/http'
import { listSwaps } from '../../../services/roster'

export default defineEventHandler(event => guard(() => {
  const raw = getQuery(event).status
  const status = typeof raw === 'string' && raw ? raw : undefined
  return listSwaps(useDb(), event.context.venueId, status)
}))
