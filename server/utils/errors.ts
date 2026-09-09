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

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'SankError'
    this.status = status
    this.code = code
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
