import { floorLayoutBody } from '#shared/floor'
import { useDb } from '../../utils/db'
import { guard, readValidatedJson } from '../../utils/http'
import { requireRole } from '../../utils/auth'
import { saveFloor } from '../../services/admin'

/** *Stolovi* → *Sačuvaj raspored*: the whole arrangement of the room, at once. */
export default defineEventHandler(async (event) => {
  requireRole(event.context.actor, 'admin')
  const body = await readValidatedJson(event, floorLayoutBody)
  return guard(() => saveFloor(useDb(), event.context.venueId, event.context.actor, body))
})
