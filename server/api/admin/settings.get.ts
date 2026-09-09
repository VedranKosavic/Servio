/**
 * `GET /api/admin/settings` — `DEFAULT_SETTINGS` with the owner's overrides on
 * top, so a key nobody has ever touched reads as its documented default rather
 * than as a blank field on the form.
 */
import { useDb } from '../../utils/db'
import { guard } from '../../utils/http'
import { requireRole } from '../../utils/auth'
import { getVenueSettings } from '../../services/admin'

export default defineEventHandler((event) => {
  requireRole(event.context.actor, 'admin')
  return guard(() => getVenueSettings(useDb(), event.context.venueId))
})
