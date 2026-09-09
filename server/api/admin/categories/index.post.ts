/** `POST /api/admin/categories`. */
import { createCategoryBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson } from '../../../utils/http'
import { requireRole } from '../../../utils/auth'
import { createCategory } from '../../../services/admin'

export default defineEventHandler(async (event) => {
  requireRole(event.context.actor, 'admin')
  const body = await readValidatedJson(event, createCategoryBody)
  return guard(() => createCategory(useDb(), event.context.venueId, event.context.actor, body))
})
