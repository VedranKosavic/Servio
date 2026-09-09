/**
 * `POST /api/prep/:orderId/done` — the bartender taps a ticket off the queue.
 *
 * The body is empty (§5.7). Who tapped is `event.context.actor`, put there by
 * `server/middleware/tenant.ts` out of the session cookie — never a `user_id` a
 * phone chose for itself.
 */
import { markPreparedBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../utils/http'
import { markPrepared } from '../../../services/prep'

export default defineEventHandler(async (event) => {
  const orderId = requiredParam(event, 'orderId')
  await readValidatedJson(event, markPreparedBody)
  return guard(() =>
    markPrepared(useDb(), event.context.venueId, orderId, event.context.actor.userId))
})
