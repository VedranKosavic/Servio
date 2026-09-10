/**
 * Deliveries, opening stock, waste, corrections and counts.
 *
 * WP4 owns this fragment (`docs/BACKEND.md` §6.8, §7). Korak 1's quick delivery
 * body — `{ user_id, lines[{ stock_item_id, qty }] }` — is **gone**, replaced by
 * the typed invoice shape §7 specifies: no body ever carries a `user_id` again
 * (§5.7, the actor comes from the session), and a delivery line carries the
 * packs/loose the bartender actually counted plus `line_cost_fen`, the one money
 * field only the invoice in his hand knows.
 *
 * `line_cost_fen` is `z.int().min(1)` and that minimum is load-bearing: a
 * zero-cost line fed into the moving average drags every future variance toward
 * 0,00 KM, and a delivery you were not charged for is a `correction`, not a
 * delivery (§6.8).
 */
import { z } from 'zod'
import { clientAt, pin, shortNote, uuid } from './common'
import { MAX_MONEY_FEN } from '../constants'

/** A quantity in an item's own base unit — `kom`, `g` or `ml` (§2). */
const qty = z.number().min(0).max(1_000_000)

/** Money on a delivery line: the exact amount the supplier charged. */
const lineCostFen = z.int().min(1).max(MAX_MONEY_FEN)

// ===========================================================================
// Deliveries
// ===========================================================================

/**
 * `POST /api/stock/deliveries` — *prijem robe*, always posted.
 *
 * The `client_id` is not ceremony (§3.2): `bartender_can_receive_goods` means a
 * phone on café wifi, and without a replay key one retried post books twelve
 * crates twice and silently doubles the moving average's numerator.
 */
export const createDeliveryBody = z.object({
  client_id: uuid,
  supplier_name: z.string().trim().min(1).max(80),
  invoice_no: z.string().trim().max(40).optional(),
  /** The invoice date — one of exactly three timestamps a body may carry (§2). */
  delivered_at: clientAt.optional(),
  note: shortNote.optional(),
  /**
   * *Prijem sa slike* (PHASE4 §2.9). `deliveries.source` and `deliveries.scan_id`
   * have existed since Korak 2 and are written for the first time here: the scan
   * produces a draft, the owner edits every line, and *Proknjiži* posts through
   * this same route with `source: 'scan'`. The route then flips the scan to
   * `applied` inside the delivery's own transaction.
   */
  source: z.enum(['manual', 'scan']).optional(),
  scan_id: uuid.optional(),
  lines: z.array(z.object({
    stock_item_id: uuid,
    /** Whole packs off the invoice: "2 gajbe". */
    packs: qty.default(0),
    /** Loose units beside the packs: "i još 5 flaša". */
    loose: qty.default(0),
    /** The pack size *this* invoice used, when it is not the item's usual one. */
    pack_qty_used: z.number().positive().max(100_000).optional(),
    line_cost_fen: lineCostFen,
    note: shortNote.optional(),
  })).min(1).max(200),
})

/** `POST /api/stock/deliveries/:id/reverse` — the one reversal a delivery gets. */
export const reverseDeliveryBody = z.object({
  note: z.string().trim().min(3).max(200),
})

// ===========================================================================
// Opening stock — the *Početno stanje* screen
// ===========================================================================

/**
 * `POST /api/stock/opening`.
 *
 * `unit_cost_mfen` is `min(1)` for the same reason `line_cost_fen` is: the whole
 * point of this screen is that the owner reads out real purchase prices once, so
 * that variance, waste value and *utrošak* stop being 0,00 KM (§3.1).
 */
export const openingStockBody = z.object({
  note: shortNote.optional(),
  lines: z.array(z.object({
    stock_item_id: uuid,
    qty,
    unit_cost_mfen: z.int().min(1).max(100_000_000),
  })).min(1).max(300),
})

// ===========================================================================
// Waste
// ===========================================================================

export const WASTE_REASONS = ['razbijeno', 'isteklo', 'prosuto', 'degustacija', 'ostalo'] as const

/**
 * `POST /api/stock/waste` — *otpis*.
 *
 * Queueable from a phone, so it carries a `client_id` and a `client_created_at`.
 * The `pin` pair is in `PIN_BEARING_ROUTES`: a bartender standing beside the
 * waiter can acknowledge a big breakage on the spot.
 */
export const logWasteBody = z.object({
  client_id: uuid,
  stock_item_id: uuid,
  qty: z.number().positive().max(1_000_000),
  reason: z.enum(WASTE_REASONS),
  note: shortNote.optional(),
  approver_user_id: uuid.optional(),
  pin: pin.optional(),
  client_created_at: clientAt.optional(),
})

/** `POST /api/stock/waste/:id/approve` — acknowledgement, never gating. */
export const approveWasteBody = z.object({}).loose()

// ===========================================================================
// Corrections
// ===========================================================================

/**
 * `POST /api/stock/corrections` — the admin's fix, and the way goods go back to
 * a supplier.
 *
 * `occurred_at` is the third and last body timestamp (§2), clamped like the
 * other two so a mistyped year cannot back-date a correction past a confirmed
 * count and rewrite its theoretical stock.
 */
export const correctStockBody = z.object({
  stock_item_id: uuid,
  type: z.enum(['correction', 'return_supplier']),
  qty_delta: z.number().min(-1_000_000).max(1_000_000)
    .refine(n => n !== 0, { message: 'qty_delta must not be 0' }),
  note: z.string().trim().min(3).max(200),
  occurred_at: clientAt.optional(),
})

// ===========================================================================
// Counts
// ===========================================================================

/**
 * `POST /api/stock/counts` — creates **and** submits, in one transaction.
 *
 * There is no server-side draft in Korak 2 (§14.5): the phone keeps the
 * in-progress count in IndexedDB exactly like the cart, and this body is what
 * arrives when the custodian taps *Predaj popis*.
 */
export const submitCountBody = z.object({
  kind: z.enum(['spot', 'full']),
  phase: z.enum(['open', 'close', 'adhoc']),
  note: shortNote.optional(),
  /** An admin pushing past a phone that still holds rounds (§6.6). */
  override: z.boolean().optional(),
  lines: z.array(z.object({
    stock_item_id: uuid,
    /** `count_method='count'`: whole packs and loose units. */
    packs: qty.optional(),
    loose: qty.optional(),
    /** `count_method='weigh'`: gross grams on the scale, tare removed by the server. */
    weighed_g: z.number().min(0).max(1_000_000).optional(),
    note: shortNote.optional(),
  })).min(1).max(300),
})

/** `POST /api/stock/counts/:id/confirm` — the admin's signature on the variance. */
export const confirmCountBody = z.object({
  override: z.boolean().optional(),
  note: shortNote.optional(),
})

export type CreateDeliveryBody = z.infer<typeof createDeliveryBody>
export type ReverseDeliveryBody = z.infer<typeof reverseDeliveryBody>
export type OpeningStockBody = z.infer<typeof openingStockBody>
export type LogWasteBody = z.infer<typeof logWasteBody>
export type ApproveWasteBody = z.infer<typeof approveWasteBody>
export type CorrectStockBody = z.infer<typeof correctStockBody>
export type SubmitCountBody = z.infer<typeof submitCountBody>
export type ConfirmCountBody = z.infer<typeof confirmCountBody>
export type WasteReason = (typeof WASTE_REASONS)[number]
