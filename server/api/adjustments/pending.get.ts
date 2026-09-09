/** `GET /api/adjustments/pending` — *Na čekanju*, scoped by role. */
import { useDb } from '../../utils/db'
import { guard } from '../../utils/http'
import { listPending } from '../../services/adjustments'

export default defineEventHandler(event => guard(() =>
  listPending(useDb(), event.context.venueId, event.context.actor)))
