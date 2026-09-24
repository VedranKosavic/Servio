/**
 * `DELETE /api/tables/:id` — *Ukloni sto*: a table brought out with *+ Sto*,
 * taken away again. Only those; the room the owner drew stays on *Stolovi*.
 * The service decides between deleting it and switching it off.
 */
import { useDb } from '../../../utils/db'
import { guard, requiredParam } from '../../../utils/http'
import { removeFloorTable } from '../../../services/admin'

export default defineEventHandler((event) => {
  const tableId = requiredParam(event, 'id')
  return guard(() => removeFloorTable(useDb(), event.context.venueId, event.context.actor, tableId))
})
