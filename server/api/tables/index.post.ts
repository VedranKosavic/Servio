import { addTableBody } from '#shared/floor'
import { useDb } from '../../utils/db'
import { guard, readValidatedJson } from '../../utils/http'
import { addFloorTable } from '../../services/admin'

/** *+ Sto* on the waiter's plan: a table brought out mid-shift, where he put it. */
export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, addTableBody)
  return guard(() => addFloorTable(useDb(), event.context.venueId, event.context.actor, body))
})
