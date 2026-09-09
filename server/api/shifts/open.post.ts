/**
 * `POST /api/shifts/open` — open the night explicitly.
 *
 * The usual way a shift opens is the first lock of the evening; this route is
 * for the evening somebody needs it running first — an opening count, a float
 * into the drawer.
 */
import { openShiftBody } from '#shared/schemas'
import { useDb } from '../../utils/db'
import { guard, readValidatedJson } from '../../utils/http'
import { openShift } from '../../services/shifts'

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, openShiftBody)
  return guard(() => openShift(useDb(), event.context.venueId, event.context.actor, body))
})
