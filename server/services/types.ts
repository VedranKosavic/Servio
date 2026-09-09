import type { Db } from '../database/client'

export type { Db }

/**
 * The handle Drizzle gives a transaction callback. Inside `db.transaction(...)`
 * every query must go through this object, not through `db` — a query on `db`
 * would run on a different connection and outside the transaction, which is the
 * classic way to half-write a round.
 *
 * Derived from the type of `db.transaction` rather than spelled out, because
 * Drizzle's own generic signature is long and changes between versions.
 */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/** Anything that can run a query: the connection, or a transaction on it. */
export type Queryable = Db | Tx

/**
 * Who is making this request.
 *
 * The shape itself lives in `shared/types.ts` because the client needs it too;
 * it is re-exported here so every service can write
 * `import type { Actor, Db, Tx } from './types'` and get the whole vocabulary
 * from one line.
 *
 * The signature convention that goes with it (BACKEND §2):
 *
 *   mutations  `service(db: Db, venueId: string, actor: Actor, body)`
 *   reads      `service(q: Queryable, venueId: string, …)`
 *   helpers    `helper(tx: Tx, venueId: string, …)` — must run inside a caller's
 *              transaction, and the type system is what says so.
 *
 * `venueId` is always the second argument even though `actor` carries it: the
 * reads have no actor, and one convention beats two.
 */
export type { Actor, Role } from '#shared/types'
