/**
 * Orders, tabs, payments and adjustments.
 *
 * WP3 owns this fragment (`docs/BACKEND.md` §6.1–§6.4, §7 *Orders, tabs,
 * payments, adjustments*).
 *
 * Note what these bodies do NOT contain: prices, totals, `user_id`. The server
 * reads the price from the catalogue at the moment it writes the row and the
 * person from the session. A phone that could send a price could send any price;
 * a phone that could send a `user_id` could spend anybody's night.
 *
 * The three money fields that *are* here — `amount_fen`, `received_fen`,
 * `tip_fen` — are amounts of **physical cash** only the human at the till can
 * know (§2), and every one is checked against something the server computed:
 * `amount_fen > remaining_fen` is a 422. The fourth, `POST /api/drafts/discard`'s
 * `total_fen`, describes a cart the server never saw: it is written into a log
 * entry and summed into nothing, which is the only reason it is allowed at all.
 *
 * `.strict()` everywhere: a typo in a key is a 400, not a field that silently
 * does nothing.
 */
import { z } from 'zod'
import { clientAt, moneyFen, pin, shortNote, uuid } from './common'

/** An empty body, spelled once. `POST … {}` still has to parse. */
const nothing = z.object({}).strict()

/** *Na račun kuće*: why a line is free. Three of the four need an approval. */
export const COMP_REASONS = ['staff_drink', 'owner_guest', 'complaint', 'promo'] as const

/**
 * Why a line is struck. The first three put the goods back on the shelf
 * (`restock = 1`); `complaint` and `other` do not — the bowl was lit and the
 * coffee was drunk (PLAN F6 step 2).
 */
export const VOID_REASONS = [
  'wrong_entry', 'guest_changed_mind', 'not_served', 'complaint', 'other',
] as const

/** Reasons that return the goods. Read by `requestAdjustment` and by the sheet. */
export const RESTOCK_REASONS = ['wrong_entry', 'guest_changed_mind', 'not_served'] as const

// -- the lock ----------------------------------------------------------------

/**
 * One tapped line of a round.
 *
 * `id` is minted **on the phone**, which is not ceremony: a waiter who locks a
 * round offline and then strikes one of its lines has to be able to name that
 * line in a queued `POST /api/adjustments` the server has not seen yet.
 */
export const orderLineInput = z.object({
  id: uuid,
  product_id: uuid,
  qty: z.int().min(1).max(99),
  /** Only for `kind='shisha'` products: 1–3 tobacco stock items. */
  flavour_ids: z.array(uuid).min(1).max(3).optional(),
  note: shortNote.optional(),
  /** A draft *gratis*. Only `staff_drink` under the cap and an admin's
   *  `owner_guest` lock at zero; anything else locks at full price and waits. */
  comp_reason: z.enum(COMP_REASONS).optional(),
  /** *Dodatni žar* points at the bowl it tops up. */
  parent_line_id: uuid.optional(),
}).strict()

/**
 * `POST /api/orders` — lock a round.
 *
 * `client_id` is a uuid minted on the phone. Sending the same one twice is how
 * a phone retries safely over bad Wi-Fi: the server recognises the replay and
 * answers with the row it already wrote instead of charging the guest twice.
 * That property is called idempotency and it is the reason this app can go
 * offline.
 *
 * `client_created_at` is one of exactly three timestamps a body may carry — it
 * records when the round happened in the *world*, while the phone was in a
 * cellar with no signal. It is a claim, not a fact: the server stores it and
 * stores the clamped value it actually used beside it.
 */
export const createOrderBody = z.object({
  client_id: uuid,
  table_id: uuid,
  /** Optional: the phone's own id for the tab, if it opened one while offline. */
  tab_client_id: uuid.optional(),
  note: shortNote.optional(),
  client_created_at: clientAt.optional(),
  lines: z.array(orderLineInput).min(1).max(50),
}).strict()

/**
 * `POST /api/drafts/discard` — *Odbaci*.
 *
 * The one route that writes nothing but a log entry. A shift cannot close while
 * an unlocked cart sits on somebody's phone, so the waiter either locks it or
 * discards it — and discarding has to leave a trace, or the closing check is a
 * check on nothing.
 */
export const discardDraftBody = z.object({
  table_id: uuid,
  lines: z.int().min(1),
  total_fen: moneyFen,
}).strict()

// -- naplata -----------------------------------------------------------------

/**
 * `POST /api/payments`.
 *
 * `amount_fen` is what the café keeps; `received_fen` is what the guest handed
 * over, and the difference is the change — neither `received_fen` nor `tip_fen`
 * moves what is still owed. `covers_order_client_ids` is what the payer said
 * this payment covers, which is how *naplata bez pokrića* is noticed.
 */
export const createPaymentBody = z.object({
  client_id: uuid,
  tab_id: uuid.optional(),
  tab_client_id: uuid.optional(),
  method: z.enum(['cash', 'card']),
  amount_fen: moneyFen,
  received_fen: moneyFen.optional(),
  tip_fen: moneyFen.default(0),
  covers_order_client_ids: z.array(uuid).max(100).default([]),
  client_created_at: clientAt.optional(),
}).strict()

/**
 * `POST /api/tabs/unpaid` — *Nije plaćeno*.
 *
 * Queueable, and therefore keyed by `tab_client_id` rather than by a tab id the
 * phone may never have seen: a guest can walk out while the phone is offline.
 */
export const markUnpaidBody = z.object({
  client_id: uuid,
  tab_client_id: uuid,
  reason: z.enum(['walked_out', 'dispute', 'other']),
  note: shortNote.optional(),
  client_created_at: clientAt.optional(),
}).strict()

/** `POST /api/tabs/:id/unpaid/decide` — the owner writes it off, or chases it. */
export const decideUnpaidBody = z.object({
  outcome: z.enum(['otpis', 'naplatiti']),
  note: shortNote.optional(),
}).strict()

// -- the tab -----------------------------------------------------------------

/** `POST /api/tabs/:id/move` — the guests changed table. */
export const moveTabBody = z.object({ table_id: uuid }).strict()

/** `POST /api/tabs/:id/assign` — *Predaj sto kolegi*. Online only. */
export const assignTabBody = z.object({ user_id: uuid }).strict()

/** `POST /api/tabs/:id/accept` — the colleague takes it. */
export const acceptTabBody = nothing

// -- storno i gratis ---------------------------------------------------------

/**
 * `POST /api/adjustments` — *Zatraži storno* / *Zatraži gratis*.
 *
 * The reason is discriminated by the kind, which one `.refine()` enforces
 * rather than a discriminated union: `tests/unit/pin-routes.test.ts` walks the
 * fragments for every schema with a `pin`-shaped key, and it can only see into a
 * `ZodObject`. A union here would hide this body's `pin` from the one test that
 * makes `PIN_BEARING_ROUTES` self-maintaining.
 *
 * There is no `qty` and no `amount_fen`: v1 voids a whole line, and both numbers
 * are read from the line inside the transaction.
 */
export const createAdjustmentBody = z.object({
  client_id: uuid,
  order_line_id: uuid,
  kind: z.enum(['void', 'comp']),
  reason: z.enum([...VOID_REASONS, ...COMP_REASONS]),
  note: shortNote.optional(),
  /** Whose PIN authorises it on the spot — a bartender's, or the owner's. */
  approver_user_id: uuid.optional(),
  pin: pin.optional(),
}).strict().refine(
  b => (b.kind === 'void'
    ? (VOID_REASONS as readonly string[]).includes(b.reason)
    : (COMP_REASONS as readonly string[]).includes(b.reason)),
  { path: ['reason'], message: 'razlog ne odgovara vrsti' },
).refine(
  // `other` is the reason that says nothing, so it has to be written out.
  b => b.reason !== 'other' || (b.note?.trim().length ?? 0) >= 5,
  { path: ['note'], message: 'napiši šta se desilo (najmanje 5 znakova)' },
)

/**
 * `POST /api/adjustments/:id/decide`.
 *
 * `refund` is the question the old design answered by itself and got wrong:
 * a void changes what the *guest* owes, and handing cash back is a separate
 * physical act that needs its own signed row. `none` is the default and it
 * writes no money row at all.
 */
export const decideAdjustmentBody = z.object({
  outcome: z.enum(['applied', 'rejected']),
  /** The approver may flip what the reason suggested about the shelf. */
  restock: z.boolean().optional(),
  refund: z.enum(['none', 'from_waiter', 'from_drawer']).optional(),
  note: shortNote.optional(),
  pin: pin.optional(),
}).strict()

/**
 * `POST /api/prep/:orderId/done` — an empty body, and that is the point.
 *
 * Korak 1 carried a `user_id` here: the bartender's phone said who was tapping.
 * §5.7 removes it from this body and from every other one, because a client that
 * names the actor is a client that can name somebody else. Who tapped comes from
 * `event.context.actor`, which comes from the session cookie, which the server
 * minted. `.strict()` so an old build sending the field gets a 400 rather than a
 * silently ignored claim.
 */
export const markPreparedBody = z.object({}).strict()

export type OrderLineInput = z.infer<typeof orderLineInput>
export type CreateOrderBody = z.infer<typeof createOrderBody>
export type DiscardDraftBody = z.infer<typeof discardDraftBody>
export type CreatePaymentBody = z.infer<typeof createPaymentBody>
export type MarkUnpaidBody = z.infer<typeof markUnpaidBody>
export type DecideUnpaidBody = z.infer<typeof decideUnpaidBody>
export type MoveTabBody = z.infer<typeof moveTabBody>
export type AssignTabBody = z.infer<typeof assignTabBody>
export type CreateAdjustmentBody = z.infer<typeof createAdjustmentBody>
export type DecideAdjustmentBody = z.infer<typeof decideAdjustmentBody>
export type MarkPreparedBody = z.infer<typeof markPreparedBody>
