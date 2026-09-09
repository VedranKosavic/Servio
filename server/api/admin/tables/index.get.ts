/** `GET /api/admin/tables` — the floor plan, with whoever is sitting at it now. */
import { useDb } from '../../../utils/db'
import { guard } from '../../../utils/http'
import { requireRole } from '../../../utils/auth'
import { listTables } from '../../../services/admin'

export default defineEventHandler((event) => {
  requireRole(event.context.actor, 'admin')
  return guard(() => listTables(useDb(), event.context.venueId))
})
