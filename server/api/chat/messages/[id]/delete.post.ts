/**
 * `POST /api/chat/messages/:id/delete` — a soft delete, once.
 *
 * The path is static up to `messages`, so Nitro routes it here and not to
 * `POST /api/chat/:channel/messages`; `tests/unit/route-roles.test.ts` asserts
 * that the two keys stay distinct, because "the static branch wins" is the kind
 * of thing that is true until it isn't.
 */
import { useDb } from '../../../../utils/db'
import { guard, requiredParam } from '../../../../utils/http'
import { deleteMessage } from '../../../../services/chat'

export default defineEventHandler(event => guard(() => {
  deleteMessage(
    useDb(), event.context.venueId, event.context.actor, requiredParam(event, 'id'),
  )
  return { ok: true as const }
}))
