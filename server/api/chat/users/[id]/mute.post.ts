/** `POST /api/chat/users/:id/mute` — *Utišaj*, with an until-time picker. */
import { muteUserBody } from '#shared/schemas'
import { useDb } from '../../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../../utils/http'
import { muteUser } from '../../../../services/chat'

export default defineEventHandler(async (event) => {
  const userId = requiredParam(event, 'id')
  const body = await readValidatedJson(event, muteUserBody)
  return guard(() => {
    muteUser(useDb(), event.context.venueId, event.context.actor, userId, body.until)
    return { ok: true as const }
  })
})
