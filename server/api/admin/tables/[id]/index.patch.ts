/**
 * `PATCH /api/admin/tables/:id` — move it, rename it, or take it out of use.
 *
 * Deactivating a table that has guests on it is 409 `TABLE_HAS_OPEN_TAB`.
 */
import { updateTableBody } from '#shared/schemas'
import { useDb } from '../../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../../utils/http'
import { requireRole } from '../../../../utils/auth'
import { updateTable } from '../../../../services/admin'

export default defineEventHandler(async (event) => {
  requireRole(event.context.actor, 'admin')
  const id = requiredParam(event, 'id')
  const body = await readValidatedJson(event, updateTableBody)
  return guard(() => updateTable(useDb(), event.context.venueId, event.context.actor, id, body))
})
