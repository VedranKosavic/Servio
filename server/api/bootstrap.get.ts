/**
 * `GET /api/bootstrap` — the whole boot in one request (§7).
 *
 * Fetched once when a screen opens and again only when `menu_version` moves;
 * everything that changes during a shift arrives through `GET /api/changes`
 * instead (§4.4). There is no second timer on this route.
 *
 * ETagged (§4.2). The envelope carries `me`, `device` and `shift`, so its
 * fingerprint carries the user too — see `bootstrapTag`.
 */
import { useDb } from '../utils/db'
import { guard } from '../utils/http'
import { withEtag } from '../utils/etag'
import { bootstrapTag, getBootstrap } from '../services/bootstrap'

export default defineEventHandler(event => guard(() => {
  const db = useDb()
  const { venueId, actor } = event.context
  return withEtag(event, bootstrapTag(db, venueId, actor), () =>
    getBootstrap(db, venueId, actor))
}))
