/**
 * `GET /api/tables/state` — the floor plan and the shift strip in one envelope,
 * so a phone can never draw one against a stale version of the other.
 *
 * ETagged (§4.2): the answer is stamped with a fingerprint, and a phone that
 * already holds that version gets a 304 with no body and no query behind it.
 * The fingerprint carries the user, because `my_settled` and `my_open_tabs` are
 * the actor's own numbers — see `tablesStateTag`.
 */
import { useDb } from '../../utils/db'
import { guard } from '../../utils/http'
import { withEtag } from '../../utils/etag'
import { getTablesState, tablesStateTag } from '../../services/tabs'

export default defineEventHandler(event => guard(() => {
  const db = useDb()
  const { venueId, actor } = event.context
  return withEtag(event, tablesStateTag(db, venueId, actor), () =>
    getTablesState(db, venueId, actor))
}))
