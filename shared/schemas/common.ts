/**
 * The primitives every body is built out of. WP0 owns this fragment; each work
 * package owns its own file beside it, so `POST /api/payments` and
 * `POST /api/stock/counts` can be written on two branches in the same week.
 *
 * Zod is a runtime validator: `schema.parse(x)` either returns a value that is
 * provably the right shape or throws. TypeScript alone cannot do this — its
 * types vanish when the code is compiled, and a request body is whatever the
 * network delivered.
 */
import { z } from 'zod'
import { MAX_MONEY_FEN } from '../constants'

export const uuid = z.uuid()

/**
 * Money in a body. Never a price — the server reads those from the catalogue
 * (`docs/BACKEND.md` §2). What a body may carry is a **declaration or an amount
 * of physical cash**, and every one of them is validated against something the
 * server computed.
 */
export const moneyFen = z.int().min(0).max(MAX_MONEY_FEN)

/** One of exactly three timestamps a phone may send. Always clamped on arrival. */
export const clientAt = z.iso.datetime()

/** A 4- or 6-digit PIN. Never logged, never stored, never echoed back. */
export const pin = z.string().regex(/^\d{4}$|^\d{6}$/)

export const shortNote = z.string().trim().max(200)
