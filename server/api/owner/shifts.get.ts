/**
 * `GET /api/owner/shifts?from&to` — the list of nights, newest first.
 *
 * `from` and `to` are **business dates** (`YYYY-MM-DD`), not instants: the café's
 * day starts at 06:00 and a round rung up at 02:30 belongs to the night before
 * (`shared/dates.ts`). Defaults to the last 30 days ending today, because that
 * is the screen the owner opens.
 *
 * No ETag: §4.2 tags `/api/owner/live` and `/api/owner/shift/:id`, the two reads
 * that are polled or heavy. This one is opened by hand and is a single indexed
 * scan of `shifts` with one summary row each.
 */
import { useDb } from '../../utils/db'
import { guard } from '../../utils/http'
import { requireRole } from '../../utils/auth'
import { nowIso } from '../../utils/ids'
import { getSettings } from '../../services/contracts'
import { listOwnerShifts } from '../../services/owner'
import { businessDate } from '#shared/dates'

const DAY = /^\d{4}-\d{2}-\d{2}$/
const DEFAULT_SPAN_DAYS = 30

export default defineEventHandler(event => guard(() => {
  const db = useDb()
  const { venueId, actor } = event.context
  requireRole(actor, 'admin')

  const settings = getSettings(db, venueId)
  const today = businessDate(nowIso(), settings.timezone, settings.business_day_start_hour)
  const query = getQuery(event)

  const day = (v: unknown): string | undefined =>
    typeof v === 'string' && DAY.test(v) ? v : undefined

  const to = day(query.to) ?? today
  const from = day(query.from)
    ?? new Date(Date.parse(`${to}T00:00:00Z`) - DEFAULT_SPAN_DAYS * 86_400_000)
      .toISOString().slice(0, 10)

  return listOwnerShifts(db, venueId, from, to)
}))
