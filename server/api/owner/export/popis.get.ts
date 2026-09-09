/**
 * `GET /api/owner/export/popis?count_id=…` — `popis.csv`.
 *
 * One count and not a range: a popis is a single moment on the shelf, so the
 * *Izvoz* page picks one rather than sweeping a period.
 */
import { useDb } from '../../../utils/db'
import { apiError, guard } from '../../../utils/http'
import { requireRole } from '../../../utils/auth'
import { csvHeaders, exportCount } from '../../../services/export'

export default defineEventHandler((event) => {
  const countId = getQuery(event).count_id
  if (typeof countId !== 'string' || countId === '') {
    throw apiError(400, 'INVALID_PARAM', 'missing query param: count_id')
  }

  return guard(() => {
    const db = useDb()
    const { venueId, actor } = event.context
    requireRole(actor, 'admin')

    const file = exportCount(db, venueId, countId)
    for (const [name, value] of Object.entries(csvHeaders(file))) {
      setResponseHeader(event, name, value)
    }
    return file.text
  })
})
