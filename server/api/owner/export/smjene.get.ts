/**
 * `GET /api/owner/export/smjene?from&to` — `smjene.csv`.
 *
 * A read: no body, no transaction, no `bump`, no Dnevnik entry — which is why
 * `changes-coverage.test.ts` needs no exemption for it. Owner-only, like every
 * other `/api/owner/*` route, and declared `A` in `ROUTE_ROLES` (a route nobody
 * declares is dead rather than open).
 *
 * No ETag: a download is a one-shot navigation the browser never revalidates,
 * and a cached CSV is exactly what the owner does not want when he re-exports
 * after correcting a number.
 */
import { useDb } from '../../../utils/db'
import { guard } from '../../../utils/http'
import { requireRole } from '../../../utils/auth'
import { csvHeaders, dayParam, exportPeriod, exportShifts } from '../../../services/export'

export default defineEventHandler(event => guard(() => {
  const db = useDb()
  const { venueId, actor } = event.context
  requireRole(actor, 'admin')

  const query = getQuery(event)
  const { from, to } = exportPeriod(db, venueId, dayParam(query.from), dayParam(query.to))

  const file = exportShifts(db, venueId, from, to)
  for (const [name, value] of Object.entries(csvHeaders(file))) {
    setResponseHeader(event, name, value)
  }
  return file.text
}))
