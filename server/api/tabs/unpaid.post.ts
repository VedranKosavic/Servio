/**
 * `POST /api/tabs/unpaid` — *Nije plaćeno*.
 *
 * Queueable, and therefore keyed by the phone's own `tab_client_id`: a guest can
 * walk out while the phone has no signal.
 */
import { markUnpaidBody } from '#shared/schemas'
import { useDb } from '../../utils/db'
import { guard, readValidatedJson } from '../../utils/http'
import { markUnpaid } from '../../services/tabs'

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, markUnpaidBody)
  return guard(() => markUnpaid(useDb(), event.context.venueId, event.context.actor, body))
})
