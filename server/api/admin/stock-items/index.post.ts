/**
 * `POST /api/admin/stock-items`.
 *
 * `last_cost_mfen` is mandatory (422 `COST_REQUIRED`): an item with no cost
 * silently reports zero variance, zero waste value and zero utrošak (§3.1).
 */
import { z } from 'zod'
import { createStockItemBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson } from '../../../utils/http'
import { requireRole } from '../../../utils/auth'
import { createStockItem } from '../../../services/admin'

/**
 * *Minimalna zaliha* is required on every new article (the owner, 16.09.2026):
 * *Stanje šanka* turns an article red when it reaches it, and an article with
 * no minimum could never turn red. Required here, at the door the screens use;
 * `createStockItem` itself still takes none, for the seed and the aroma CLI.
 */
const createStockItemRoute = createStockItemBody.extend({
  par_qty: z.number().min(0).max(1_000_000),
})

export default defineEventHandler(async (event) => {
  requireRole(event.context.actor, 'admin')
  const body = await readValidatedJson(event, createStockItemRoute)
  return guard(() => createStockItem(useDb(), event.context.venueId, event.context.actor, body))
})
