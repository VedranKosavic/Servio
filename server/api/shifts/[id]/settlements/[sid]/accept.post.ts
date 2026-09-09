/** `POST /api/shifts/:id/settlements/:sid/accept` — sign for a colleague's envelope. */
import { acceptSettlementBody } from '#shared/schemas'
import { useDb } from '../../../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../../../utils/http'
import { acceptSettlement } from '../../../../../services/settlements'

export default defineEventHandler(async (event) => {
  const shiftId = requiredParam(event, 'id')
  const settlementId = requiredParam(event, 'sid')
  await readValidatedJson(event, acceptSettlementBody)
  return guard(() => acceptSettlement(
    useDb(), event.context.venueId, event.context.actor, shiftId, settlementId,
  ))
})
