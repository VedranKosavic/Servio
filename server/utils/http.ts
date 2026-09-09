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

/** Turn any error into an h3 error whose JSON body carries `{ code, message }`. */
export function apiError(status: number, code: string, message: string) {
  return createError({
    statusCode: status,
    statusMessage: code,
    message,
    data: { code, message },
  })
}

/** Run a service call, translating its `SankError` into an HTTP response. */
export function guard<T>(fn: () => T): T {
  try {
    return fn()
  } catch (err) {
    if (err instanceof SankError) throw apiError(err.status, err.code, err.message)
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
