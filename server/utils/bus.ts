/**
 * The one in-process event bus (`docs/BACKEND.md` §4.1).
 *
 * There is no Redis, no queue and no WebSocket in Korak 2 — one Node process
 * holds one SQLite file, so "tell the rest of the process something changed" is
 * a plain Node `EventEmitter`. An emitter is the Node standard library's
 * publish/subscribe object: `on(name, fn)` registers a listener, `emit(name, x)`
 * calls every listener registered under that name, synchronously.
 *
 * **The rule that makes this safe: emit *after* `db.transaction()` returns.**
 * Inside the callback the rows are written but not committed, so a listener that
 * went looking for them could either see nothing or — worse — see rows that a
 * later throw rolls back. `bump()` therefore only *returns* the seq; the caller
 * emits once the transaction has come back. `emitChange` is deliberately not
 * importable from anything that takes a `Tx`.
 *
 * In Korak 2 the only listener is the alert drainer (`server/plugins/alerts.ts`).
 * A Phase 5 SSE endpoint plugs in here and touches no business logic.
 */
import { EventEmitter } from 'node:events'
import type { ChangeEntity } from '#shared/types'

export interface ChangeEvent {
  seq: number
  entity: ChangeEntity
  entityId?: string | null
}

/**
 * Listeners are keyed by `venueId`, so a second café's traffic never wakes the
 * first one's drainer. `setMaxListeners(0)` removes Node's 10-listener warning:
 * the count here is bounded by the number of venues, not by request volume.
 */
export const bus = new EventEmitter()
bus.setMaxListeners(0)

/** Announce a committed change. Never call this inside a transaction callback. */
export function emitChange(venueId: string, event: ChangeEvent): void {
  bus.emit(venueId, event)
}

/** Listen to one venue. Returns the unsubscribe, which the plugin needs on HMR. */
export function onChange(venueId: string, fn: (event: ChangeEvent) => void): () => void {
  bus.on(venueId, fn)
  return () => { bus.off(venueId, fn) }
}
