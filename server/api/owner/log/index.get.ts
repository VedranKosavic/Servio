/**
 * `GET /api/owner/log` — *Dnevnik*, the owner's read of `log_entries`.
 *
 * Owner-only, and that is a product rule rather than a convenience: CLAUDE.md
 * says the Dnevnik and its drill-downs are the owner's, the same way the
 * *Konobari* channel is the staff's. `ROUTE_ROLES` already declares it `A`;
 * `requireRole` here is the belt to that braces.
 *
 * The ETag is the newest entry's timestamp, not `MAX(seq)`: this page changes
 * only when something is written to it, and *Puls* polls it every 15 s.
 */
import { createHash } from 'node:crypto'
import type { LogKind, LogQuery } from '#shared/types'
import { useDb } from '../../../utils/db'
import { guard } from '../../../utils/http'
import { withEtag } from '../../../utils/etag'
import { requireRole } from '../../../utils/auth'
import { listLog, maxAt } from '../../../services/log'

export default defineEventHandler(event => guard(() => {
  const db = useDb()
  const { venueId, actor } = event.context
  requireRole(actor, 'admin')

  const q = getQuery(event)
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.length > 0 ? v : undefined

  const query: LogQuery = {
    before: str(q.before),
    after: str(q.after),
    kind: str(q.kind) as LogKind | undefined,
    group: str(q.group),
    actor: str(q.actor),
    from: str(q.from),
    to: str(q.to),
    important: q.important === '1' || q.important === 'true',
    limit: q.limit ? Number(q.limit) : undefined,
  }

  // The tag has to move when the query does, or the owner would tap *važno* and
  // be served the unfiltered list out of his own browser cache. The filters go
  // in as a short hash rather than verbatim: an ETag is a quoted string, and a
  // `"` from a stringified query inside it would end the quoting early and
  // break every `If-None-Match` comparison after it.
  const filters = createHash('sha256').update(JSON.stringify(query)).digest('hex').slice(0, 12)
  const tag = `${maxAt(db, venueId)}-${actor.userId.slice(0, 8)}-${filters}`

  return withEtag(event, tag, () => listLog(db, venueId, query))
}))
