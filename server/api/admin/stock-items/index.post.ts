/**
 * `POST /api/admin/stock-items`.
 *
 * `last_cost_mfen` is mandatory (422 `COST_REQUIRED`): an item with no cost
 * silently reports zero variance, zero waste value and zero utrošak (§3.1).
 */
import { createStockItemBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson } from '../../../utils/http'
import { requireRole } from '../../../utils/auth'
import { createStockItem } from '../../../services/admin'

export default defineEventHandler(async (event) => {
  requireRole(event.context.actor, 'admin')
  const body = await readValidatedJson(event, createStockItemBody)
  return guard(() => createStockItem(useDb(), event.context.venueId, event.context.actor, body))
})
