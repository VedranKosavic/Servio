/**
 * `POST /api/chat/read` — the badge cursor, debounced 1 s on the client.
 *
 * The one chat write that deliberately does **not** bump: a read cursor that
 * invalidated every phone's ETag every few seconds would cost the venue its
 * 304s, exactly as the heartbeat would (PHASE4 §2.11). The reader's own cursor
 * is in the ETag instead, so his badge still moves.
 */
import { markReadBody } from '#shared/schemas'
import type { ChannelKind } from '#shared/chat'
import { useDb } from '../../utils/db'
import { guard, readValidatedJson } from '../../utils/http'
import { markRead } from '../../services/chat'

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, markReadBody)
  return guard(() => {
    markRead(
      useDb(), event.context.venueId, event.context.actor,
      body.channel as ChannelKind, body.seq,
    )
    return { ok: true as const }
  })
})
