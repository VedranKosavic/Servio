/**
 * `PATCH /api/admin/stock-items/:id`.
 *
 * `base_unit` is frozen once the item has a movement (409 `UNIT_FROZEN`), and a
 * `last_cost_mfen` set while the moving average is still 0 seeds it too.
 */
import { updateStockItemBody } from '#shared/schemas'
import { useDb } from '../../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../../utils/http'
import { requireRole } from '../../../../utils/auth'
import { updateStockItem } from '../../../../services/admin'

export default defineEventHandler(async (event) => {
  requireRole(event.context.actor, 'admin')
  const id = requiredParam(event, 'id')
  const body = await readValidatedJson(event, updateStockItemBody)
  return guard(() => updateStockItem(useDb(), event.context.venueId, event.context.actor, id, body))
})
