/**
 * `GET /api/owner/categories?from&to` — the *Kategorije* report (§6.8).
 *
 * `from` and `to` are **business days** (`YYYY-MM-DD`), not instants: the period
 * runs 06:00 to 06:00 so a round at 02:30 lands on the night it was served.
 * Missing bounds default to the current month.
 */
import { useDb } from '../../utils/db'
import { guard } from '../../utils/http'
import { categoriesReport, monthBounds, periodBounds } from '../../services/reports'

const DAY = /^\d{4}-\d{2}-\d{2}$/

export default defineEventHandler(event => guard(() => {
  const db = useDb()
  const { venueId } = event.context
  const query = getQuery(event)

  const thisMonth = monthBounds(new Date().toISOString().slice(0, 7))
  const fromDay = typeof query.from === 'string' && DAY.test(query.from)
    ? query.from
    : thisMonth.fromDay
  const toDay = typeof query.to === 'string' && DAY.test(query.to) ? query.to : thisMonth.toDay

  const period = periodBounds(db, venueId, fromDay, toDay)
  return categoriesReport(db, venueId, period.from, period.to)
}))
