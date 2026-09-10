/** `POST /api/stock/supplier-aliases` — *Poveži*: the next photo comes back green. */
import { linkAliasBody } from '#shared/schemas'
import { useDb } from '../../utils/db'
import { guard, readValidatedJson } from '../../utils/http'
import { linkAlias } from '../../services/scan'

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, linkAliasBody)
  return guard(() => {
    linkAlias(useDb(), event.context.venueId, event.context.actor, body)
    return { ok: true as const }
  })
})
