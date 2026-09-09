/**
 * `POST /api/orders` — lock a round (*zaključi turu*).
 *
 * The body carries product ids, quantities and phone-minted line ids. It carries
 * no prices, no totals and no `user_id`: the price comes from the catalogue
 * inside the transaction and the person comes from the session. Replaying the
 * same `client_id` answers 200 with the same ids and `already_applied: true`.
 */
import { createOrderBody } from '#shared/schemas'
import { useDb } from '../utils/db'
import { guard, readValidatedJson } from '../utils/http'
import { createOrder } from '../services/orders'

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, createOrderBody)
  return guard(() => createOrder(useDb(), event.context.venueId, event.context.actor, body))
})
