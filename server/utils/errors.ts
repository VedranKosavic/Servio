/**
 * The services in `server/services/*` are plain functions — they take a database
 * and return data, and a vitest can call them with no HTTP anywhere in sight.
 * So they must not throw an h3 error object; they throw this instead, and the
 * route handler turns it into the HTTP response (`server/utils/http.ts`).
 *
 * `code` is a stable machine string the phone can branch on (and later map to a
 * Bosnian sentence in `shared/errors.ts`); `message` is the developer-facing
 * explanation. The response body is `{ code, message }`.
 */
export class SankError extends Error {
  readonly status: number
  readonly code: string
  /** Extra fields the screen needs to render the sentence: `{ retry_after_s }`. */
  readonly data?: Record<string, unknown>

  constructor(status: number, code: string, message: string, data?: Record<string, unknown>) {
    super(message)
    this.name = 'SankError'
    this.status = status
    this.code = code
    this.data = data
  }
}

export function notFound(code: string, message: string): SankError {
  return new SankError(404, code, message)
}

export function badRequest(code: string, message: string): SankError {
  return new SankError(400, code, message)
}

/** 409: the request was well formed but the world has moved on (already paid…). */
export function conflict(code: string, message: string): SankError {
  return new SankError(409, code, message)
}

/** 401: nobody is logged in, or the session is no longer valid. */
export function unauthorized(code: string, message: string, data?: Record<string, unknown>): SankError {
  return new SankError(401, code, message, data)
}

/** 403: somebody is logged in, and this is not theirs to do. */
export function forbidden(code: string, message: string, data?: Record<string, unknown>): SankError {
  return new SankError(403, code, message, data)
}

/**
 * 422: the request is well formed and the world has not moved on — the *value*
 * is wrong. `amount_fen` over what is left to pay; a close outside tolerance
 * with no note.
 */
export function unprocessable(code: string, message: string, data?: Record<string, unknown>): SankError {
  return new SankError(422, code, message, data)
}

/** 423: locked out after too many wrong secrets. `retry_after_s` is the way back. */
export function locked(code: string, message: string, retryAfterS: number): SankError {
  return new SankError(423, code, message, { retry_after_s: retryAfterS })
}

/** 429: too many requests in the window. */
export function tooMany(retryAfterS: number): SankError {
  return new SankError(429, 'RATE_LIMITED', 'too many requests', { retry_after_s: retryAfterS })
}
