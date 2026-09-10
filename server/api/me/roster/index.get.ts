/**
 * `GET /api/me/roster` — my week, offers awaiting me, my own requests (S17).
 *
 * **The staff projection belongs here too.** `GET /api/roster` applies it and
 * this route did not, so a waiter's S17 was handed a colleague's `sick` — the
 * one status *Pravila* promises only the owner sees ("Bolovanje vidi samo
 * vlasnik"), and S17 caches its answer in IndexedDB, so the leak was written to
 * every phone's disk. A colleague's `sick | absent | removed` is a **hole**; my
 * own rows keep their status, because I typed the reason myself.
 *
 * (Found while building WP2's S17 — see the PR body. The rule itself is
 * PHASE4 §2.7 and it is not new.)
 */
import { useDb } from '../../../utils/db'
import { guard } from '../../../utils/http'
import { getMyRoster, projectForStaff } from '../../../services/roster'

export default defineEventHandler(event => guard(() => {
  const { venueId, actor } = event.context
  const mine = getMyRoster(useDb(), venueId, actor)
  if (actor.role === 'admin') return mine
  projectForStaff([mine.this_week, mine.next_week], actor.userId)
  return mine
}))
