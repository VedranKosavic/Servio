import { payTabBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../utils/http'
import { currentVenueId } from '../../../utils/venue'
import { payTab } from '../../../services/tabs'

export default defineEventHandler(async (event) => {
  const tabId = requiredParam(event, 'id')
  const body = await readValidatedJson(event, payTabBody)
  return guard(() => {
    const db = useDb()
    return payTab(db, currentVenueId(db), tabId, body.user_id)
  })
})
