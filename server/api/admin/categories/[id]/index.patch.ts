/** `PATCH /api/admin/categories/:id`. */
import { updateCategoryBody } from '#shared/schemas'
import { useDb } from '../../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../../utils/http'
import { requireRole } from '../../../../utils/auth'
import { updateCategory } from '../../../../services/admin'

export default defineEventHandler(async (event) => {
  requireRole(event.context.actor, 'admin')
  const id = requiredParam(event, 'id')
  const body = await readValidatedJson(event, updateCategoryBody)
  return guard(() => updateCategory(useDb(), event.context.venueId, event.context.actor, id, body))
})
