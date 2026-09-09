/**
 * `GET /api/me/sessions` — *Moji podaci*, this person's own sign-ins (§1.7).
 *
 * Own rows only. There is no `?user=` and there will not be one: a waiter
 * reading a colleague's sessions would be surveillance, and the owner already
 * has *Uređaji* on `/a` for the device side of the same question.
 */
import { useDb } from '../../utils/db'
import { guard } from '../../utils/http'
import { listMySessions } from '../../services/auth'

export default defineEventHandler(event => guard(
  () => listMySessions(useDb(), event.context.venueId, event.context.actor),
))
