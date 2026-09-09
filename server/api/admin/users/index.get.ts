/**
 * `GET /api/admin/users` — the staff list in *Meni & Postavke*.
 *
 * Inactive people are included: somebody who left in June still has to be
 * findable, and reactivating is the only way back. No hash, no password, no
 * token — `admin.test.ts` greps this response for exactly that.
 */
import { useDb } from '../../../utils/db'
import { guard } from '../../../utils/http'
import { requireRole } from '../../../utils/auth'
import { listUsers } from '../../../services/admin'

export default defineEventHandler((event) => {
  requireRole(event.context.actor, 'admin')
  return guard(() => listUsers(useDb(), event.context.venueId))
})
