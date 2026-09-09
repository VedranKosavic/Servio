/**
 * The one contract between the phones and the server.
 *
 * Zod is a runtime validator: `schema.parse(x)` either returns a value that is
 * provably the right shape or throws. TypeScript alone cannot do this — its
 * types vanish when the code is compiled, and a request body is whatever the
 * network delivered. So every POST body in `server/api/*` goes through a schema
 * here first, and `shared/types.ts` derives the TypeScript types from these same
 * schemas, so client and server can never drift apart.
 *
 * Note what the request bodies do NOT contain: prices, totals, amounts. The
 * server reads those from the database at the moment it writes the row. A phone
 * that could send a price could send any price.
 */
import { z } from 'zod'

export const uuid = z.uuid()

/** One tapped line of a round. `qty` is whole units; the price is not ours to send. */
export const orderLineInput = z.object({
  product_id: uuid,
  qty: z.int().min(1).max(99),
  /** Only for `kind='shisha'` products: 1–3 tobacco stock items. */
  flavour_ids: z.array(uuid).min(1).max(3).optional(),
  note: z.string().trim().max(200).optional(),
})

/**
 * `POST /api/orders` — lock a round.
 *
 * `client_id` is a uuid minted on the phone. Sending the same one twice is how
 * a phone retries safely over bad Wi-Fi: the server recognises the replay and
 * answers with the row it already wrote instead of writing a second one. That
 * property is called idempotency and it is the reason this app can go offline.
 */
export const createOrderBody = z.object({
  client_id: uuid,
  table_id: uuid,
  user_id: uuid,
  /** Optional: the phone's own id for the tab, if it opened one while offline. */
  tab_client_id: uuid.optional(),
  note: z.string().trim().max(200).optional(),
  lines: z.array(orderLineInput).min(1).max(50),
})

/** `POST /api/tabs/:id/pay` */
export const payTabBody = z.object({
  user_id: uuid,
})

/** `POST /api/prep/:orderId/done` */
export const markPreparedBody = z.object({
  user_id: uuid,
})

/** `POST /api/stock/deliveries` — *prijem robe*. Quantities are in base units. */
export const createDeliveryBody = z.object({
  user_id: uuid,
  lines: z.array(z.object({
    stock_item_id: uuid,
    qty: z.number().positive().max(1_000_000),
    note: z.string().trim().max(200).optional(),
  })).min(1).max(200),
})

export type OrderLineInput = z.infer<typeof orderLineInput>
export type CreateOrderBody = z.infer<typeof createOrderBody>
export type PayTabBody = z.infer<typeof payTabBody>
export type MarkPreparedBody = z.infer<typeof markPreparedBody>
export type CreateDeliveryBody = z.infer<typeof createDeliveryBody>
