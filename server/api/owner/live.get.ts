/**
 * `GET /api/owner/live` — *Puls*, the first screen of `/a`, polled every 15 s
 * with an `If-None-Match` (§4.4).
 *
 * **Why the tag carries a minute.** The default `changeTag` is
 * `MAX(seq)-role-user`, which is right for every screen whose body only changes
 * when something is *written*. This one is not: a device goes stale, a table
 * gets older and an attention row climbs the list purely because time passed,
 * with no `changes` row anywhere. Without the minute the owner's browser would
 * revalidate into a 304 all night and *Puls* would freeze on a quiet hour, which
 * is exactly the hour he is watching it. One minute is the resolution of every
 * badge on the screen, so it is the resolution of the tag (§4.2).
 *
 * Admin-only, and that is a product rule rather than a convenience: CLAUDE.md
 * keeps per-person money off every staff screen. `ROUTE_ROLES` already declares
 * it `A`; `requireRole` here is the belt to that braces.
 */
import { useDb } from '../../utils/db'
import { guard } from '../../utils/http'
import { withEtag } from '../../utils/etag'
import { requireRole } from '../../utils/auth'
import { changeTag } from '../../services/changes'
import { getLive } from '../../services/owner'

export default defineEventHandler(event => guard(() => {
  const db = useDb()
  const { venueId, actor } = event.context
  requireRole(actor, 'admin')

  const tag = `${changeTag(db, venueId, actor)}-${Math.floor(Date.now() / 60_000)}`
  return withEtag(event, tag, () => getLive(db, venueId, actor))
}))
