/** `GET /api/stock/counts?shift_id&status` — the count list. */
import { useDb } from '../../../utils/db'
import { guard } from '../../../utils/http'
import { listCounts } from '../../../services/counts'

export default defineEventHandler(event => guard(() => {
  const query = getQuery(event)
  return listCounts(useDb(), event.context.venueId, {
    shiftId: typeof query.shift_id === 'string' ? query.shift_id : undefined,
    status: query.status === 'submitted' || query.status === 'confirmed'
      ? query.status
      : undefined,
  })
}))
