import { markPreparedBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../utils/http'
import { currentVenueId } from '../../../utils/venue'
import { markPrepared } from '../../../services/prep'

export default defineEventHandler(async (event) => {
  const orderId = requiredParam(event, 'orderId')
  const body = await readValidatedJson(event, markPreparedBody)
  return guard(() => {
    const db = useDb()
    return markPrepared(db, currentVenueId(db), orderId, body.user_id)
  })
})
