/** `POST /api/chat/messages/:id/forward` — *Proslijedi u…* and *Prijavi vlasniku*. */
import { forwardMessageBody } from '#shared/schemas'
import type { ChannelKind } from '#shared/chat'
import { useDb } from '../../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../../utils/http'
import { forwardMessage } from '../../../../services/chat'

export default defineEventHandler(async (event) => {
  const id = requiredParam(event, 'id')
  const body = await readValidatedJson(event, forwardMessageBody)
  return guard(() =>
    forwardMessage(useDb(), event.context.venueId, event.context.actor, id, body.to as ChannelKind))
})
