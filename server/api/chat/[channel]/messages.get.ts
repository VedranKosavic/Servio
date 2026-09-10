/** `GET /api/chat/:channel/messages?before_seq=&limit=` — *Učitaj starije*. */
import { useDb } from '../../../utils/db'
import { guard, requiredParam } from '../../../utils/http'
import { chatHistory } from '../../../services/chat'
import { requireChannelParam } from '../../../utils/channel'

export default defineEventHandler(event => guard(() => {
  const kind = requireChannelParam(requiredParam(event, 'channel'))
  const query = getQuery(event)
  const before = Math.trunc(Number(query.before_seq ?? 0))
  const limit = Math.trunc(Number(query.limit ?? 50))

  return chatHistory(
    useDb(), event.context.venueId, event.context.actor, kind,
    Number.isFinite(before) && before > 0 ? before : null,
    Number.isFinite(limit) && limit > 0 ? limit : 50,
  )
}))
