/** `GET /api/owner/stock/:id/movements?before&limit` — one page of the ledger. */
import { useDb } from '../../../../utils/db'
import { guard, requiredParam } from '../../../../utils/http'
import { itemMovements } from '../../../../services/reports'

export default defineEventHandler(event => guard(() => {
  const query = getQuery(event)
  return itemMovements(useDb(), event.context.venueId, requiredParam(event, 'id'), {
    before: typeof query.before === 'string' ? query.before : undefined,
    limit: query.limit ? Number(query.limit) : undefined,
  })
}))
