/**
 * Orders, tabs, payments and adjustments.
 *
 * WP3 owns this fragment (`docs/BACKEND.md` §6.1–§6.4). WP0 seeds it with the
 * Korak 1 bodies exactly as they are, so the frozen waiter screens keep working
 * against the Korak 1 routes until WP9 rewires them; WP3 then drops `user_id`
 * and adds `client_created_at`, line ids and the comp fields (§5.7).
 *
 * Note what these bodies do NOT contain: prices, totals, amounts. The server
 * reads those from the database at the moment it writes the row. A phone that
 * could send a price could send any price.
 */
import { z } from 'zod'
import { shortNote, uuid } from './common'

/** One tapped line of a round. `qty` is whole units; the price is not ours to send. */
export const orderLineInput = z.object({
  product_id: uuid,
  qty: z.int().min(1).max(99),
  /** Only for `kind='shisha'` products: 1–3 tobacco stock items. */
  flavour_ids: z.array(uuid).min(1).max(3).optional(),
  note: shortNote.optional(),
})

/**
 * `POST /api/orders` — lock a round.
 *
 * `client_id` is a uuid minted on the phone. Sending the same one twice is how
 * a phone retries safely over bad Wi-Fi: the server recognises the replay and
 * answers with the row it already wrote instead of charging the guest twice.
 * That property is called idempotency and it is the reason this app can go
 * offline.
 */
export const createOrderBody = z.object({
  client_id: uuid,
  table_id: uuid,
  user_id: uuid,
  /** Optional: the phone's own id for the tab, if it opened one while offline. */
  tab_client_id: uuid.optional(),
  note: shortNote.optional(),
  lines: z.array(orderLineInput).min(1).max(50),
})

/** `POST /api/tabs/:id/pay`. Deleted by WP3 together with its route. */
export const payTabBody = z.object({
  user_id: uuid,
})

/** `POST /api/prep/:orderId/done` */
export const markPreparedBody = z.object({
  user_id: uuid,
})

export type OrderLineInput = z.infer<typeof orderLineInput>
export type CreateOrderBody = z.infer<typeof createOrderBody>
export type PayTabBody = z.infer<typeof payTabBody>
export type MarkPreparedBody = z.infer<typeof markPreparedBody>
