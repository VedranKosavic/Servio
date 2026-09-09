/** `GET /api/admin/categories` — with the count of products each one still holds. */
import { useDb } from '../../../utils/db'
import { guard } from '../../../utils/http'
import { requireRole } from '../../../utils/auth'
import { listCategories } from '../../../services/admin'

export default defineEventHandler((event) => {
  requireRole(event.context.actor, 'admin')
  return guard(() => listCategories(useDb(), event.context.venueId))
})
