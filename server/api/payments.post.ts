/**
 * `POST /api/payments` — *naplati*.
 *
 * Idempotent by `client_id`, which is the whole of a payment's replay safety:
 * `payments_client_uq` is the hard guarantee and the lookup inside the
 * transaction is the graceful path.
 */
import { createPaymentBody } from '#shared/schemas'
import { useDb } from '../utils/db'
import { guard, readValidatedJson } from '../utils/http'
import { createPayment } from '../services/payments'

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, createPaymentBody)
  return guard(() => createPayment(useDb(), event.context.venueId, event.context.actor, body))
})
