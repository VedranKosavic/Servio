/** `POST /api/me/rules/ack` — *Potvrđujem*, once per version. */
import { ackRulesBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson } from '../../../utils/http'
import { ackRules } from '../../../services/rules'

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, ackRulesBody)
  return guard(() =>
    ackRules(useDb(), event.context.venueId, event.context.actor, body.version))
})
