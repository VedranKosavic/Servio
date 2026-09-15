/**
 * `GET /api/me/roster` — the weekly *Raspored* as the waiter and the šanker read
 * it (S17), read-only.
 *
 * The same answer the owner's `GET /api/roster/pattern` gives: with no dates, no
 * sick days and no swaps left, a pattern row holds nothing a colleague may not
 * see — a name on a weekday and a shift.
 */
import { useDb } from '../../../utils/db'
import { guard } from '../../../utils/http'
import { getPattern } from '../../../services/roster'

export default defineEventHandler(event => guard(() =>
  getPattern(useDb(), event.context.venueId)))
