/**
 * `POST /api/chat/:channel/pin` — *Za naručiti*.
 *
 * `{text}` replaces, `{append}` adds one line (two taps, no keyboard, no lost
 * update), `{cleared:true}` is *Naručeno ✓* and is admin-only.
 */
import { setPinBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../utils/http'
import { setPin } from '../../../services/chat'
import { requireChannelParam } from '../../../utils/channel'

export default defineEventHandler(async (event) => {
  const kind = requireChannelParam(requiredParam(event, 'channel'))
  const body = await readValidatedJson(event, setPinBody)
  return guard(() => {
    setPin(useDb(), event.context.venueId, event.context.actor, kind, body)
    return { ok: true as const }
  })
})
