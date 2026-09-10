/**
 * `GET /api/chat/since?cursor=` — bootstrap, catch-up, or `reset` (PHASE4 §2.10).
 *
 * S16 calls this on mount, after every own send and on `visibilitychange` —
 * never on a timer of its own. The 15 s `GET /api/changes` carries the badge
 * counts, and that is the whole of "one poll".
 */
import { useDb } from '../../utils/db'
import { guard } from '../../utils/http'
import { withEtag } from '../../utils/etag'
import { chatSince, myReadTag } from '../../services/chat'
import { changeTag } from '../../services/changes'

export default defineEventHandler(event => guard(() => {
  const db = useDb()
  const { venueId, actor } = event.context

  const raw = getQuery(event).cursor
  const parsed = Math.trunc(Number(raw ?? 0))
  const cursor = Number.isFinite(parsed) && parsed > 0 ? parsed : null

  // The reader's own `MAX(last_read_seq)` joins the tag: without it a phone that
  // has just marked a channel read would 304 its way to a stale badge (§2.11).
  const tag = `${changeTag(db, venueId, actor)}-r${myReadTag(db, venueId, actor)}-c${cursor ?? 0}`
  return withEtag(event, tag, () => chatSince(db, venueId, actor, cursor))
}))
