/** `DELETE /api/admin/products/:id/image` — the tile goes back to name and price. */
import { useDb } from '../../../../utils/db'
import { guard, requiredParam } from '../../../../utils/http'
import { requireRole } from '../../../../utils/auth'
import { deleteProductImage } from '../../../../services/admin'

export default defineEventHandler((event) => {
  requireRole(event.context.actor, 'admin')
  const id = requiredParam(event, 'id')
  return guard(() => deleteProductImage(useDb(), event.context.venueId, event.context.actor, id))
})
