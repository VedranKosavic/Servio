/**
 * `GET /api/prep` — *Priprema*, the bartender's ticket queue.
 *
 * The venue comes off `event.context`, which `server/middleware/tenant.ts` fills
 * from the session. Korak 1 read it out of the `venues` table with
 * `currentVenueId()`; that helper now survives only for the seed CLI and the
 * tests, because a request handler that picks the venue itself is a handler that
 * would serve the wrong café the day there are two.
 */
import { useDb } from '../../utils/db'
import { guard } from '../../utils/http'
import { getPrep } from '../../services/prep'

export default defineEventHandler(event => guard(() =>
  getPrep(useDb(), event.context.venueId)))
