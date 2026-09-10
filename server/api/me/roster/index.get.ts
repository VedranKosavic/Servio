/** `GET /api/me/roster` — my week, offers awaiting me, my own requests (S17). */
import { useDb } from '../../../utils/db'
import { guard } from '../../../utils/http'
import { getMyRoster } from '../../../services/roster'

export default defineEventHandler(event => guard(() =>
  getMyRoster(useDb(), event.context.venueId, event.context.actor)))
