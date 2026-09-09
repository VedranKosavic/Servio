/** `POST /api/admin/tables` — one more table on the zone's schematic. */
import { createTableBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson } from '../../../utils/http'
import { requireRole } from '../../../utils/auth'
import { createTable } from '../../../services/admin'

export default defineEventHandler(async (event) => {
  requireRole(event.context.actor, 'admin')
  const body = await readValidatedJson(event, createTableBody)
  return guard(() => createTable(useDb(), event.context.venueId, event.context.actor, body))
})
