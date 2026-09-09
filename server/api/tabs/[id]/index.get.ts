/** `GET /api/tabs/:id` — *Pokaži narudžbu* and the naplata sheet. */
import { useDb } from '../../../utils/db'
import { guard, requiredParam } from '../../../utils/http'
import { getTab } from '../../../services/tabs'

export default defineEventHandler((event) => {
  const tabId = requiredParam(event, 'id')
  return guard(() => getTab(useDb(), event.context.venueId, tabId, event.context.actor))
})
