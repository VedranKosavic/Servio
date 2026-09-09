/**
 * `POST /api/drafts/discard` — *Odbaci*.
 *
 * The one route that writes nothing but a log entry, and deliberately does not
 * `bump`: no ledger row moved. `total_fen` describes a cart the server never
 * saw, so it is evidence and is summed into nothing.
 */
import { discardDraftBody } from '#shared/schemas'
import { useDb } from '../../utils/db'
import { guard, readValidatedJson } from '../../utils/http'
import { discardDraft } from '../../services/orders'

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, discardDraftBody)
  return guard(() => discardDraft(useDb(), event.context.venueId, event.context.actor, body))
})
