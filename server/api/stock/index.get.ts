/**
 * `GET /api/stock` — *Stanje šanka*.
 *
 * ETagged with the role-and-user tag (§4.2): the body is the same for everybody
 * today, but the tag is shared with every other read so a phone that polls this
 * screen and `/api/changes` in the same minute revalidates both for one
 * `MAX(seq)`.
 */
import { useDb } from '../../utils/db'
import { guard } from '../../utils/http'
import { withEtag } from '../../utils/etag'
import { changeTag, maxSeq } from '../../services/changes'
import { getStock } from '../../services/stock'

export default defineEventHandler(event => guard(() => {
  const db = useDb()
  const { venueId, actor } = event.context

  return withEtag(event, changeTag(db, venueId, actor), () => ({
    seq: maxSeq(db, venueId),
    items: getStock(db, venueId),
  }))
}))
