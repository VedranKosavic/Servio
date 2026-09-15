/** `DELETE /api/admin/categories/:id` — hard when nothing points at it, soft otherwise. */
import { useDb } from '../../../../utils/db'
import { guard, requiredParam } from '../../../../utils/http'
import { requireRole } from '../../../../utils/auth'
import { deleteCategory } from '../../../../services/admin'

export default defineEventHandler((event) => {
  requireRole(event.context.actor, 'admin')
  const id = requiredParam(event, 'id')
  return guard(() => deleteCategory(useDb(), event.context.venueId, event.context.actor, id))
})
