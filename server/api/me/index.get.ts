/**
 * `GET /api/me` — the envelope every screen boots from.
 *
 * The same objects `POST /api/auth/pin`, `POST /api/auth/admin/login` and
 * `GET /api/bootstrap` answer with, built by the same `getMe()`, so the client
 * has one parser and not four (§5.5).
 */
import { useDb } from '../../utils/db'
import { guard } from '../../utils/http'
import { getMe } from '../../services/auth'

export default defineEventHandler(event => guard(
  () => getMe(useDb(), event.context.venueId, event.context.actor),
))
