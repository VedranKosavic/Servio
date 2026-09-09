/**
 * `GET /api/tables/state` — the floor plan and the shift strip in one envelope,
 * so a phone can never draw one against a stale version of the other.
 */
import { useDb } from '../../utils/db'
import { guard } from '../../utils/http'
import { getTablesState } from '../../services/tabs'

export default defineEventHandler(event => guard(() =>
  getTablesState(useDb(), event.context.venueId, event.context.actor)))
