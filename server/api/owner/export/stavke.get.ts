/**
 * `GET /api/owner/export/stavke?from&to&full_names=0|1` — `stavke.csv`.
 *
 * **Initials unless the owner says otherwise.** `full_names=1` is the explicit
 * opt-in; anything else, a missing parameter included, exports "A.H." Per-person
 * money is allowed to exist on `/admin` and is not allowed to walk out of it by
 * default (CLAUDE.md, "accountability, not surveillance").
 */
import { useDb } from '../../../utils/db'
import { guard } from '../../../utils/http'
import { requireRole } from '../../../utils/auth'
import { csvHeaders, dayParam, exportLines, exportPeriod } from '../../../services/export'

export default defineEventHandler(event => guard(() => {
  const db = useDb()
  const { venueId, actor } = event.context
  requireRole(actor, 'admin')

  const query = getQuery(event)
  const { from, to } = exportPeriod(db, venueId, dayParam(query.from), dayParam(query.to))
  const fullNames = query.full_names === '1' || query.full_names === 'true'

  const file = exportLines(db, venueId, from, to, { fullNames })
  for (const [name, value] of Object.entries(csvHeaders(file))) {
    setResponseHeader(event, name, value)
  }
  return file.text
}))
