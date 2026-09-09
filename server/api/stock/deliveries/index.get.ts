/** `GET /api/stock/deliveries?from&to` — the delivery notes, newest first. */
import { useDb } from '../../../utils/db'
import { guard } from '../../../utils/http'
import { listDeliveries } from '../../../services/stock'

export default defineEventHandler(event => guard(() => {
  const query = getQuery(event)
  return listDeliveries(useDb(), event.context.venueId, {
    from: typeof query.from === 'string' ? query.from : undefined,
    to: typeof query.to === 'string' ? query.to : undefined,
  })
}))
