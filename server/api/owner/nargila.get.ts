/**
 * `GET /api/owner/nargila?month=YYYY-MM` — the tobacco-to-bowls reconciliation
 * the owner does on paper today (§6.8).
 */
import { useDb } from '../../utils/db'
import { guard } from '../../utils/http'
import { monthBounds, nargilaReport, periodBounds } from '../../services/reports'

const MONTH = /^\d{4}-\d{2}$/

export default defineEventHandler(event => guard(() => {
  const db = useDb()
  const { venueId } = event.context
  const query = getQuery(event)

  const month = typeof query.month === 'string' && MONTH.test(query.month)
    ? query.month
    : new Date().toISOString().slice(0, 7)

  const { fromDay, toDay } = monthBounds(month)
  const period = periodBounds(db, venueId, fromDay, toDay)
  return nargilaReport(db, venueId, period.from, period.to, month)
}))
