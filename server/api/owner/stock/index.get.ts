/**
 * `GET /api/owner/stock` — *Roba* on the owner's laptop.
 *
 * The whole shelf, priced, with the four statuses that decide the row's colour
 * and the total the stock is worth tonight (§6.8).
 */
import { useDb } from '../../../utils/db'
import { guard } from '../../../utils/http'
import { withEtag } from '../../../utils/etag'
import { changeTag } from '../../../services/changes'
import { ownerStock } from '../../../services/reports'

export default defineEventHandler(event => guard(() => {
  const db = useDb()
  const { venueId, actor } = event.context
  return withEtag(event, changeTag(db, venueId, actor), () => ownerStock(db, venueId))
}))
