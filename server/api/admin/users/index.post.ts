/** `POST /api/admin/users` — a new waiter, bartender or admin, with his first PIN. */
import { createUserBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson } from '../../../utils/http'
import { requireRole } from '../../../utils/auth'
import { createUser } from '../../../services/admin'

export default defineEventHandler(async (event) => {
  requireRole(event.context.actor, 'admin')
  const body = await readValidatedJson(event, createUserBody)
  return guard(() => createUser(useDb(), event.context.venueId, event.context.actor, body))
})
