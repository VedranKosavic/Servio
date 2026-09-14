/**
 * `POST /api/tabs/:id/clear` — *Očisti sto*, the table given back.
 *
 * The other half of a split that used to be one act: `POST /api/payments`
 * takes the money and `cleared_at` gives back the tile. A waiter taking over a
 * shift can then tell an empty table from one that was settled an hour ago and
 * nobody has wiped down.
 *
 * `AR` — any worker, like every other thing done to a table from the floor.
 * The service refuses a second clear rather than silently rewriting who gave
 * the table back and when.
 */
import { useDb } from '../../../utils/db'
import { guard } from '../../../utils/http'
import { clearTab } from '../../../services/clearTable'

export default defineEventHandler(event => guard(() => clearTab(
  useDb(),
  event.context.venueId,
  event.context.actor,
  getRouterParam(event, 'id')!,
)))
