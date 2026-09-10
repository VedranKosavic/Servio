/** `POST /api/stock/scans/:id/discard` — *Odbaci sken*, with a reason. */
import { discardScanBody } from '#shared/schemas'
import { useDb } from '../../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../../utils/http'
import { discardScan } from '../../../../services/scan'

export default defineEventHandler(async (event) => {
  const id = requiredParam(event, 'id')
  const body = await readValidatedJson(event, discardScanBody)
  return guard(() => {
    discardScan(useDb(), event.context.venueId, event.context.actor, id, body)
    return { ok: true as const }
  })
})
