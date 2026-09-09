/**
 * `GET /api/owner/export/dnevni-pazar?from&to` — `dnevni_pazar.csv`.
 *
 * The path has a **hyphen** and the saved file an **underscore**: BACKEND
 * §14.15 mandates hyphens in path segments and PLAN §11 names the file with an
 * underscore, and both are honoured (`shared/types/export.ts`).
 */
import { useDb } from '../../../utils/db'
import { guard } from '../../../utils/http'
import { requireRole } from '../../../utils/auth'
import {
  csvHeaders, dayParam, exportDailyRevenue, exportPeriod,
} from '../../../services/export'

export default defineEventHandler(event => guard(() => {
  const db = useDb()
  const { venueId, actor } = event.context
  requireRole(actor, 'admin')

  const query = getQuery(event)
  const { from, to } = exportPeriod(db, venueId, dayParam(query.from), dayParam(query.to))

  const file = exportDailyRevenue(db, venueId, from, to)
  for (const [name, value] of Object.entries(csvHeaders(file))) {
    setResponseHeader(event, name, value)
  }
  return file.text
}))
