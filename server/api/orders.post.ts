/**
 * `POST /api/orders` — lock a round (*zaključi turu*).
 *
 * The body carries product ids and quantities. It carries no prices and no
 * totals: those are read from the database inside the transaction. Replaying
 * the same `client_id` answers 200 with the same ids and `already_applied: true`.
 */
import { createOrderBody } from '#shared/schemas'
import { useDb } from '../utils/db'
import { guard, readValidatedJson } from '../utils/http'
import { currentVenueId } from '../utils/venue'
import { createOrder } from '../services/orders'

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, createOrderBody)
  return guard(() => {
    const db = useDb()
    return createOrder(db, currentVenueId(db), body)
  })
})
