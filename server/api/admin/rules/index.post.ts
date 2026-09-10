/** `POST /api/admin/rules` — *Objavi novu verziju*, and one *Svi* line. */
import { publishRulesBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson } from '../../../utils/http'
import { publishRules } from '../../../services/rules'

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, publishRulesBody)
  return guard(() =>
    publishRules(useDb(), event.context.venueId, event.context.actor, body))
})
