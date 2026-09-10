/**
 * `POST /api/chat/:channel/messages`.
 *
 * Rate-limited at 10/min per device through the existing limiter table — the
 * same leash shape as `POST /api/orders`, for the same reason: an outbox retry
 * loop is exactly what runs away.
 */
import { postMessageBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { apiError, guard, readValidatedJson, requiredParam } from '../../../utils/http'
import { errorMessage } from '#shared/errors'
import { chatLimiter } from '../../../utils/rate-limit'
import { postMessage } from '../../../services/chat'
import { requireChannelParam } from '../../../utils/channel'

export default defineEventHandler(async (event) => {
  const kind = requireChannelParam(requiredParam(event, 'channel'))
  const body = await readValidatedJson(event, postMessageBody)

  const actor = event.context.actor
  const bucket = actor.deviceId ?? actor.sessionId
  if (chatLimiter.take(bucket, 1) === 0) {
    setResponseHeader(event, 'Retry-After', 60)
    throw apiError(429, 'RATE_LIMITED', errorMessage('RATE_LIMITED'), { retry_after_s: 60 })
  }

  return guard(() => postMessage(useDb(), event.context.venueId, actor, kind, body))
})
