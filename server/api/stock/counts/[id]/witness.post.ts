/**
 * `POST /api/stock/counts/:id/witness` — *Potvrđujem stanje* (F9 step 4).
 *
 * Empty body on purpose: who witnessed is the session's business, never a
 * field a phone fills in (BACKEND §5.7). The tap happens on the counter's own
 * phone, handed across the bar — which is exactly why the witness is read from
 * the cookie of whoever is logged in at that moment.
 */
import { useDb } from '../../../../utils/db'
import { guard, requiredParam } from '../../../../utils/http'
import { witnessCount } from '../../../../services/counts'

export default defineEventHandler(event => guard(() =>
  witnessCount(useDb(), event.context.venueId, event.context.actor, requiredParam(event, 'id'))))
