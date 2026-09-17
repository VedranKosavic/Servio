/**
 * The shift, cash and settlement bodies.
 *
 * WP2 owns this fragment (`docs/BACKEND.md` §6.5–§6.6, §7 *Shifts, cash,
 * settlement*).
 *
 * Every money field here is one of the few a body is *allowed* to carry (§2):
 * not a price the catalogue already knows, but **a declaration or an amount of
 * physical cash** that only the human standing at the till can know —
 * `amount_fen` on a float or a payout, `declared_fen` in the envelope,
 * `cash_counted_fen` in the drawer. Every one of them is then checked against
 * something the server computed: `declared_fen` against `expectedCash`,
 * `cash_counted_fen` against the venue expectation, `card_total_fen` against
 * Σ card payments.
 *
 * `.strict()` everywhere: a typo in a key is a 400, not a field that silently
 * does nothing.
 */
import { z } from 'zod'
import { moneyFen, pin, uuid } from './common'
import { MAX_MONEY_FEN } from '../constants'

/** An empty body, spelled once. `POST … {}` still has to parse. */
const nothing = z.object({}).strict()

/** A note that has to say something — `min(3)` is the difference from optional. */
const requiredNote = z.string().trim().min(3).max(500)
const closingNote = z.string().trim().max(500)
const movementNote = z.string().trim().max(200)

/** Cash actually handed over: never zero, or the row records nothing. */
const positiveFen = z.int().min(1).max(MAX_MONEY_FEN)

// -- the shift ---------------------------------------------------------------

/** `POST /api/shifts/open` — the explicit open, when nobody has locked a round yet. */
export const openShiftBody = nothing

/** `POST /api/shifts/:id/closing` — *Zatvori smjenu*: collect the envelopes. */
export const startClosingBody = nothing

/**
 * `POST /api/shifts/:id/close`.
 *
 * `cash_counted_fen` is what is physically in the drawer. `pin` is the closer's,
 * verified through `verifyPinMetered` **before** the transaction opens, so a
 * wrong PIN leaves an `auth_attempts` row that the rejected transaction cannot
 * roll back (§2).
 */
export const closeShiftBody = z.object({
  cash_counted_fen: moneyFen,
  closing_note: closingNote.optional(),
  pin,
  /** Admin only: close without the opening count, recorded as an `override`. */
  override_no_open_count: z.boolean().optional(),
}).strict()

/** `POST /api/shifts/:id/force-close` — admin, no count, no tab check, a reason. */
export const forceCloseBody = z.object({
  note: requiredNote,
}).strict()

/** `POST /api/shifts/:id/review` — the morning after. */
export const reviewShiftBody = z.object({
  card_total_fen: moneyFen.optional(),
  closing_note: closingNote.optional(),
}).strict()

/**
 * `POST /api/shifts/:id/zakljucenje` — *Zaključi smjenu*, the šanker's close.
 *
 * Five amounts the šanker paid out of the takings tonight, each typed and each
 * optional (a field he left empty is 0), plus *Dodatna plaćanja* — the same
 * thing without a fixed name. They are the only money in this body,
 * and they are allowed for the same reason `declared_fen` is: nobody but the
 * person at the bar knows what the supplier was paid. Prihod, dnevnica, otpis,
 * rashod and policija are **not** here — the server computes all five from the
 * ledger, and a phone that sent them would be ignored. `rashod_fen` left this
 * body on 16.09.2026, when *Rashod* became a mark on a table.
 */
/**
 * One *Dodatno plaćanje*: a name the šanker types and what it cost.
 *
 * It exists because the fixed five never cover a real night — "config 15 KM",
 * a taxi, a plumber — and a *Napomena* nobody could subtract was the wrong
 * shape for it (the owner, 16.09.2026). The label is short on purpose: it is a
 * line on a receipt, not a story, and the story still belongs in *Dnevnik*.
 */
export const closingExtraBody = z.object({
  label: z.string().trim().min(1).max(40),
  amount_fen: moneyFen,
}).strict()

export const closeByBarBody = z.object({
  client_id: uuid,
  roba_fen: moneyFen.default(0),
  okusi_fen: moneyFen.default(0),
  zar_fen: moneyFen.default(0),
  kafa_fen: moneyFen.default(0),
  merkator_fen: moneyFen.default(0),
  /** Their **sum** is never sent: the server adds them up itself. */
  extras: z.array(closingExtraBody).max(20).default([]),
  note: closingNote.optional(),
}).strict()

/** `POST /api/shifts/:id/leave` */
export const leaveShiftBody = nothing

// -- the envelope ------------------------------------------------------------

/**
 * `POST /api/shifts/:id/settle` — *Završi smjenu*.
 *
 * `declared_fen` is typed **before** the server says a word about what it
 * expected; that is the whole design. `outbox_len` is the phone's own count of
 * rounds it has not managed to send — a settle with anything queued is refused,
 * because the number under discussion would change a minute later.
 */
export const settleBody = z.object({
  declared_fen: moneyFen,
  outbox_len: z.int().min(0).max(10_000),
  /** The colleague taking the envelope, typing his PIN on this phone. */
  receiver_user_id: uuid.optional(),
  receiver_pin: pin.optional(),
  /** Admin only: settle past a phone that still reports an outbox. */
  override: z.boolean().optional(),
}).strict()

/** `POST /api/shifts/:id/settlements/:sid/accept` */
export const acceptSettlementBody = nothing

// -- the drawer --------------------------------------------------------------

/** `POST /api/shifts/:id/float` — cash into the drawer, or out to a waiter. */
export const moveFloatBody = z.object({
  type: z.enum(['float_in', 'float_out']),
  /** Whose money it becomes: the waiter receiving it. */
  user_id: uuid,
  amount_fen: positiveFen,
  note: movementNote.optional(),
}).strict()

/** `POST /api/shifts/:id/payout` — money out of the drawer, waiting for a yes. */
export const requestPayoutBody = z.object({
  amount_fen: positiveFen,
  reason: z.enum(['dobavljac', 'sitno', 'ostalo']),
  note: movementNote.optional(),
}).strict()

/** `POST /api/shifts/:id/pickup` — the owner takes the pazar. */
export const pickupBody = z.object({
  amount_fen: positiveFen,
  note: movementNote.optional(),
}).strict()

/** `POST /api/shifts/:id/opening-float` — the admin corrects the derived float. */
export const openingFloatBody = z.object({
  fen: moneyFen,
}).strict()

// -- napomena ----------------------------------------------------------------

/**
 * `PUT /api/me/shifts/:id/note` — *Napomena* on his own night (PHASE3 §1.6).
 *
 * An **empty string deletes the row**, which is why the trim has no `min()`:
 * clearing a note is a thing people do, and making them type a space to do it
 * would be a rule invented by a form rather than by a café.
 */
export const staffNoteBody = z.object({
  body: z.string().trim().max(500),
}).strict()

/** `POST /api/cash-movements/:id/decide` — the two types born `pending` (§6.5). */
export const decideCashMovementBody = z.object({
  outcome: z.enum(['approved', 'rejected']),
  note: movementNote.optional(),
  pin: pin.optional(),
}).strict()

/** `POST /api/cash-movements/:id/ack` — *Primio sam*, by the receiver himself. */
export const ackCashMovementBody = nothing

export type CloseShiftBody = z.infer<typeof closeShiftBody>
export type ForceCloseBody = z.infer<typeof forceCloseBody>
export type ReviewShiftBody = z.infer<typeof reviewShiftBody>
export type SettleBody = z.infer<typeof settleBody>
export type MoveFloatBody = z.infer<typeof moveFloatBody>
export type RequestPayoutBody = z.infer<typeof requestPayoutBody>
export type PickupBody = z.infer<typeof pickupBody>
export type OpeningFloatBody = z.infer<typeof openingFloatBody>
export type DecideCashMovementBody = z.infer<typeof decideCashMovementBody>
export type StaffNoteBody = z.infer<typeof staffNoteBody>

/**
 * `POST /api/owner/shift/:id/naknadni-troskovi` — one cost paid out of a closed
 * shift afterwards. *Ostalo* needs a name; a named kind takes none.
 */
export const addShiftExtraCostBody = z.object({
  client_id: uuid,
  kind: z.enum(['roba', 'okusi', 'zar', 'kafa', 'merkator', 'dnevnica', 'struja', 'voda', 'kirija', 'ostalo']),
  label: z.string().trim().min(1).max(60).optional(),
  amount_fen: moneyFen.min(1),
}).strict().refine(body => body.kind !== 'ostalo' || !!body.label, {
  message: 'Ostalo needs a label', path: ['label'],
})
export type AddShiftExtraCostBody = z.infer<typeof addShiftExtraCostBody>
