/**
 * Deliveries, waste, counts and corrections.
 *
 * WP4 owns this fragment (`docs/BACKEND.md` §6.8). WP0 seeds it with the Korak 1
 * delivery body; WP4 replaces it with the typed packs/loose/`line_cost_fen`
 * shape and adds the count and waste bodies.
 */
import { z } from 'zod'
import { shortNote, uuid } from './common'

/** `POST /api/stock/deliveries` — *prijem robe*. Quantities are in base units. */
export const createDeliveryBody = z.object({
  user_id: uuid,
  lines: z.array(z.object({
    stock_item_id: uuid,
    qty: z.number().positive().max(1_000_000),
    note: shortNote.optional(),
  })).min(1).max(200),
})

export type CreateDeliveryBody = z.infer<typeof createDeliveryBody>
