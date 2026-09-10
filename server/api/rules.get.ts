/** `GET /api/rules` — the published text, and whether this reader owes an ack. */
import { useDb } from '../utils/db'
import { guard } from '../utils/http'
import { latestRules } from '../services/rules'

export default defineEventHandler(event => guard(() =>
  latestRules(useDb(), event.context.venueId, event.context.actor)))
