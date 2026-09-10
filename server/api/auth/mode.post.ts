/**
 * `POST /api/auth/mode` — *Na čemu si večeras?*
 *
 * The second step behind the PIN pad: a `radnik` picks *Konobar* or *Šanker*
 * and the choice is written on his **session**, so a reload at 02:00 lands him
 * where he was. The same route is the switch — both screens stay open to every
 * worker and nobody signs out to move between them.
 *
 * `any` in `ROUTE_ROLES` rather than a role list: an admin may tap it too (he
 * also serves tables), and the service simply keeps his mode null, because his
 * landing is `/admin` either way.
 */
import { setModeBody } from '#shared/schemas'
import { useDb } from '../../utils/db'
import { guard, readValidatedJson } from '../../utils/http'
import { setSessionMode } from '../../services/auth'

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, setModeBody)
  const db = useDb()
  return guard(() => setSessionMode(db, event.context.venueId, event.context.actor, body.mode))
})
