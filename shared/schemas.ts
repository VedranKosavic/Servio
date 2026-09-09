/**
 * The one contract between the phones and the server — a **barrel**.
 *
 * Every POST body in `server/api/*` goes through a schema in one of the
 * fragments under `shared/schemas/`, and `shared/types.ts` derives its request
 * types from those same schemas, so client and server can never drift apart.
 * The split is what lets five work packages add bodies in the same week without
 * editing the same file; `tests/unit/pin-routes.test.ts` walks the fragments (not
 * this file) looking for every schema with a `pin` key.
 */
export * from './schemas/common'
export * from './schemas/auth'
export * from './schemas/money'
export * from './schemas/shifts'
export * from './schemas/stock'
export * from './schemas/admin'
