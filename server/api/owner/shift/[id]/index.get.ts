/**
 * `GET /api/owner/shift/:id` — *Smjena*: one night, everything the owner can
 * drill into.
 *
 * The per-waiter strip, the cash box, the counts and the "stiglo nakon
 * zatvaranja" card all come out of `getOwnerShift`, which reads the written
 * `shift_summaries` row when there is one and folds the ledger live when there
 * is not — the same rule *Puls* follows, so the two screens cannot print two
 * different prometi for one night.
 *
 * The tag is the role-and-user one **plus the shift id**: one browser reads many
 * nights and `MAX(seq)` is venue-wide, so without the id the owner would tap
 * from Friday to Saturday and be served Friday out of his own cache (§4.2).
 */
import { useDb } from '../../../../utils/db'
import { guard, requiredParam } from '../../../../utils/http'
import { withEtag } from '../../../../utils/etag'
import { requireRole } from '../../../../utils/auth'
import { changeTag } from '../../../../services/changes'
import { getOwnerShift } from '../../../../services/owner'

export default defineEventHandler(event => guard(() => {
  const db = useDb()
  const { venueId, actor } = event.context
  requireRole(actor, 'admin')

  const shiftId = requiredParam(event, 'id')
  const tag = `${changeTag(db, venueId, actor)}-${shiftId.slice(0, 8)}`
  return withEtag(event, tag, () => getOwnerShift(db, venueId, shiftId))
}))
