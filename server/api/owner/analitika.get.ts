/**
 * `GET /api/owner/analitika?month=YYYY-MM` — *Analitika*, one month.
 *
 * A missing or malformed month is the café's current one — the business day's
 * month, so at 02:00 on the 1st the page still shows the month whose last night
 * is still running.
 */
import { MONTH_RE, monthOf } from '#shared/analytics'
import { businessDate } from '#shared/dates'
import { useDb } from '../../utils/db'
import { guard } from '../../utils/http'
import { requireRole } from '../../utils/auth'
import { monthAnalytics } from '../../services/analytics'
import { getSettings } from '../../services/contracts'
import { nowIso } from '../../utils/ids'

export default defineEventHandler(event => guard(() => {
  const db = useDb()
  const { venueId, actor } = event.context
  requireRole(actor, 'admin')

  const query = getQuery(event)
  const now = nowIso()
  const settings = getSettings(db, venueId)
  const month = typeof query.month === 'string' && MONTH_RE.test(query.month)
    ? query.month
    : monthOf(businessDate(now, settings.timezone, settings.business_day_start_hour))

  return monthAnalytics(db, venueId, month, now)
}))
