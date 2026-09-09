/**
 * `GET /api/me/shift` — the waiter's own night.
 *
 * `summary` is null until he has declared; `float_out_fen` and his own
 * `cash_movements` are there from the start (§6.5).
 */
import { useDb } from '../../../utils/db'
import { guard } from '../../../utils/http'
import { getMyShift } from '../../../services/summaries'

export default defineEventHandler((event) => {
  return guard(() => getMyShift(useDb(), event.context.venueId, event.context.actor.userId))
})
