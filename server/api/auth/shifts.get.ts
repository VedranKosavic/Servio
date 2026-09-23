/**
 * `GET /api/auth/shifts` — *Koju smjenu radiš?*
 *
 * The chooser's whole screen: the café's two slots, which one is running, who
 * is already on it, and what a tap would do. Read-only, and `any` in
 * `ROUTE_ROLES` for the same reason the mode route is — an admin who serves
 * tables picks a shift like anybody else.
 */
import { useDb } from '../../utils/db'
import { guard } from '../../utils/http'
import { shiftChoices } from '../../services/shifts'

export default defineEventHandler((event) => {
  return guard(() => shiftChoices(useDb(), event.context.venueId, event.context.actor))
})
