import { randomUUID } from 'node:crypto'

/** A new row id. Every id in this database is a uuid, server- or phone-minted. */
export function newId(): string {
  return randomUUID()
}

/**
 * Now, as an ISO-8601 UTC string ("2026-09-09T20:41:07.000Z").
 *
 * Every timestamp in the database is UTC and written by the server. Local time
 * (Europe/Sarajevo) is a display concern and a business-day concern, computed
 * from these strings — never stored, so a DST night cannot corrupt a row.
 */
export function nowIso(): string {
  return new Date().toISOString()
}
