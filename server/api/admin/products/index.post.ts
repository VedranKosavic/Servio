/** `POST /api/admin/products` — a new item on the menu, with its first price row. */
import { createProductBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson } from '../../../utils/http'
import { requireRole } from '../../../utils/auth'
import { createProduct } from '../../../services/admin'

export default defineEventHandler(async (event) => {
  requireRole(event.context.actor, 'admin')
  const body = await readValidatedJson(event, createProductBody)
  return guard(() => createProduct(useDb(), event.context.venueId, event.context.actor, body))
})
