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
