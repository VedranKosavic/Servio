/**
 * `GET /api/admin/products` — the menu as *Meni & Postavke* edits it.
 *
 * Everything the list screen needs in one round trip: the category name, the
 * recipe, and when the current price started. Inactive products are included —
 * an admin cannot un-hide what he cannot see.
 */
import { useDb } from '../../../utils/db'
import { guard } from '../../../utils/http'
import { requireRole } from '../../../utils/auth'
import { listProducts } from '../../../services/admin'

export default defineEventHandler((event) => {
  requireRole(event.context.actor, 'admin')
  return guard(() => listProducts(useDb(), event.context.venueId))
})
