/** `GET /api/roster/pattern` — the owner's weekly *Raspored*: weekdays × shifts, with names. */
import { useDb } from '../../../utils/db'
import { guard } from '../../../utils/http'
import { getPattern } from '../../../services/roster'

export default defineEventHandler(event => guard(() =>
  getPattern(useDb(), event.context.venueId)))
