/** `GET /api/admin/stock-items` — the shelf as the owner edits it, costs included. */
import { useDb } from '../../../utils/db'
import { guard } from '../../../utils/http'
import { requireRole } from '../../../utils/auth'
import { listStockItems } from '../../../services/admin'

export default defineEventHandler((event) => {
  requireRole(event.context.actor, 'admin')
  return guard(() => listStockItems(useDb(), event.context.venueId))
})
