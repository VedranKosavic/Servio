/**
 * `PATCH /api/admin/products/:id` — including the price change.
 *
 * A new `price_fen` closes the open `price_history` row and opens the next one
 * (§6.10). Lines already sold keep the price the guest was charged.
 */
import { updateProductBody } from '#shared/schemas'
import { useDb } from '../../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../../utils/http'
import { requireRole } from '../../../../utils/auth'
import { updateProduct } from '../../../../services/admin'

export default defineEventHandler(async (event) => {
  requireRole(event.context.actor, 'admin')
  const id = requiredParam(event, 'id')
  const body = await readValidatedJson(event, updateProductBody)
  return guard(() => updateProduct(useDb(), event.context.venueId, event.context.actor, id, body))
})
