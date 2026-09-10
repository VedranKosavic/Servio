/**
 * `POST /api/stock/deliveries/scan` — the photo becomes a draft.
 *
 * The one `async` service in the app, and the only route that can answer
 * `503 SCAN_NOT_CONFIGURED` — which is a supported state, not a fault: with no
 * `ANTHROPIC_API_KEY` the phone renders a calm card and the typed *Ručno* form
 * beneath it.
 */
import { scanDeliveryBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { readValidatedJson } from '../../../utils/http'
import { SankError } from '../../../utils/errors'
import { apiError } from '../../../utils/http'
import { scanDelivery } from '../../../services/scan'

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, scanDeliveryBody)
  try {
    // `guard()` is synchronous by design (BACKEND §2); this is the one route
    // that has to await, so it translates its own SankError.
    return await scanDelivery(useDb(), event.context.venueId, event.context.actor, body)
  } catch (err) {
    if (err instanceof SankError) throw apiError(err.status, err.code, err.message, err.data)
    throw err
  }
})
