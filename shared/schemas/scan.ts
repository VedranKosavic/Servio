/**
 * *Prijem sa slike* — the bodies, and the schema the **model** answers in
 * (PHASE4 §2.9).
 *
 * `scanParseSchema` is the one Zod object in this codebase that is not
 * validating a request: `server/services/scanModel.ts` turns it into
 * `output_config.format` with `zodOutputFormat()`, so the model's answer arrives
 * already parsed and already the right shape. The server still trusts none of
 * the ids in it — every `stock_item_id` is looked up in the real catalogue and
 * dropped if it does not exist.
 */
import { z } from 'zod'
import { uuid } from './common'
import { MAX_MONEY_FEN } from '../constants'

export const scanDeliveryBody = z.object({ upload_id: uuid })

export const discardScanBody = z.object({
  reason: z.string().trim().min(3).max(200),
})

export const linkAliasBody = z.object({
  /** The OCR text of the row. Folded (lowercased, diacritics stripped) by the service. */
  alias: z.string().trim().min(2).max(120),
  stock_item_id: uuid,
  supplier_name: z.string().trim().max(80).optional(),
})

/**
 * What the model returns. Deliberately forgiving about *values* and strict about
 * *shape*: a price it could not read is `null`, not a guess, and the owner types
 * it in. `stock_item_id` is a plain string, not a uuid — a hallucinated id must
 * come back as an unknown line, not as a 500 out of a schema.
 */
export const scanParseLineSchema = z.object({
  text: z.string(),
  qty: z.number().nullable(),
  pack: z.string().nullable(),
  unit_price_fen: z.int().min(0).max(MAX_MONEY_FEN).nullable(),
  stock_item_id: z.string().nullable(),
  confidence: z.number().min(0).max(1),
})

export const scanParseSchema = z.object({
  supplier: z.string().nullable(),
  invoice_no: z.string().nullable(),
  date: z.string().nullable(),
  lines: z.array(scanParseLineSchema),
})

export type ScanDeliveryBody = z.infer<typeof scanDeliveryBody>
export type DiscardScanBody = z.infer<typeof discardScanBody>
export type LinkAliasBody = z.infer<typeof linkAliasBody>
