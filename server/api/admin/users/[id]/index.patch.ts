/**
 * `PATCH /api/admin/users/:id` — rename, re-role, deactivate, or paste the
 * Telegram chat id the alerts go to (§9).
 *
 * An admin deactivating himself is 400 `SELF_DEACTIVATE`: the admin session is
 * the only door into `/a` that needs no device.
 */
import { updateUserBody } from '#shared/schemas'
import { useDb } from '../../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../../utils/http'
import { requireRole } from '../../../../utils/auth'
import { updateUser } from '../../../../services/admin'

export default defineEventHandler(async (event) => {
  requireRole(event.context.actor, 'admin')
  const id = requiredParam(event, 'id')
  const body = await readValidatedJson(event, updateUserBody)
  return guard(() => updateUser(useDb(), event.context.venueId, event.context.actor, id, body))
})
