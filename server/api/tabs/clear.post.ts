/**
 * `POST /api/tabs/clear` — *Očisti sto*, from the outbox.
 *
 * The queueable twin of `POST /api/tabs/:id/clear` (docs/OFFLINE.md §4.4): a
 * waiter with no signal gives a table back, the phone frees the tile at once,
 * and this is what the queue posts when the line returns. It names the tab by
 * the phone's own `tab_client_id` or by `tab_id`, answers 200 to a replay and to
 * a table somebody already cleared, and dates the clear by when it happened.
 *
 * `AR`, like every other thing done to a table from the floor.
 */
import { clearTabBody } from '#shared/schemas'
import { useDb } from '../../utils/db'
import { guard, readValidatedJson } from '../../utils/http'
import { clearTabQueued } from '../../services/clearTable'

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, clearTabBody)
  return guard(() => clearTabQueued(useDb(), event.context.venueId, event.context.actor, body))
})
