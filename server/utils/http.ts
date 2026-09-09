/**
 * The bridge between the pure services and Nitro's HTTP layer.
 *
 * Everything a route needs: validate a body against a Zod schema, run a service
 * and translate its `SankError` into a real HTTP status with a `{ code, message }`
 * body. Routes stay four lines long and every error in the app looks the same.
 */
import type { ZodType } from 'zod'
import type { H3Event } from 'h3'
import { SankError } from './errors'

/**
 * Turn any error into an h3 error whose JSON body carries `{ code, message }` —
 * plus whatever the screen needs to *render* the sentence.
 *
 * `extra` is the fourth argument of `SankError` (`docs/BACKEND.md` §2), and it is
 * not decoration: the Bosnian sentences in `shared/errors.ts` interpolate it.
 * "PIN je zaključan. Pokušaj ponovo za {retry_after_s} s." with no
 * `retry_after_s` in the body is a waiter staring at a literal `{retry_after_s}`
 * — so a 423 carries its countdown, a wrong PIN carries `fails_left`, and an
 * overpay carries `remaining_fen`.
 */
export function apiError(
  status: number, code: string, message: string, extra?: Record<string, unknown>,
) {
  return createError({
    statusCode: status,
    statusMessage: code,
    message,
    data: { code, message, ...extra },
  })
}

/** Run a service call, translating its `SankError` into an HTTP response. */
export function guard<T>(fn: () => T): T {
  try {
    return fn()
  } catch (err) {
    if (err instanceof SankError) throw apiError(err.status, err.code, err.message, err.data)
    throw err
  }
}

/** Read and validate a JSON body. A body that fails the schema is a 400. */
export async function readValidatedJson<T>(event: H3Event, schema: ZodType<T>): Promise<T> {
  const raw = await readBody(event).catch(() => undefined)
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const where = first?.path.join('.') || 'body'
    throw apiError(400, 'INVALID_BODY', `${where}: ${first?.message ?? 'nevalidan zahtjev'}`)
  }
  return parsed.data
}

/** A route param that must be there. */
export function requiredParam(event: H3Event, name: string): string {
  const value = getRouterParam(event, name)
  if (!value) throw apiError(400, 'INVALID_PARAM', `missing route param: ${name}`)
  return value
}
