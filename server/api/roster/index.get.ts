/**
 * `GET /api/roster?from=&to=` — whole weeks.
 *
 * The staff projection is applied in the service, as a different query; the one
 * extra pass here drops a colleague's `sick`/`absent` from the rows the query
 * did return, so a hole is a hole (PHASE4 §2.7).
 */
import { useDb } from '../../utils/db'
import { guard } from '../../utils/http'
import { businessDate } from '#shared/dates'
import { getRoster, projectForStaff } from '../../services/roster'

export default defineEventHandler(event => guard(() => {
  const query = getQuery(event)
  const today = businessDate(new Date().toISOString())
  const from = typeof query.from === 'string' ? query.from : today
  const to = typeof query.to === 'string' ? query.to : from

  const { venueId, actor } = event.context
  const weeks = getRoster(useDb(), venueId, actor, from, to)
  return actor.role === 'admin' ? weeks : projectForStaff(weeks, actor.userId)
}))
