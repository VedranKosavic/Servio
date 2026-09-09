/** `GET /api/stock/counts/:id` — one count with its lines. */
import { useDb } from '../../../../utils/db'
import { guard, requiredParam } from '../../../../utils/http'
import { getCount } from '../../../../services/counts'

export default defineEventHandler(event => guard(() =>
  getCount(useDb(), event.context.venueId, requiredParam(event, 'id'))))
