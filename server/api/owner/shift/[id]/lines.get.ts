/**
 * `GET /api/owner/shift/:id/lines?user=&kat=&cursor=` — the drill-down: every
 * line behind a number, by person and by category, with the time it was rung up.
 *
 * This is the route that makes every other number on the owner's screen
 * checkable: a promet he does not recognise is one tap from the rounds that made
 * it. `kat` is a category id, or one of the four pseudo-categories `storno`,
 * `gratis`, `nijeplaceno` and `sve`; `user` narrows to one person.
 *
 * **`totals` covers the whole filtered set, never the page** (§6.7), so the
 * footer of page 1 and the footer of page 3 agree — the one thing paging a money
 * screen must not get wrong. The cursor is a keyset on `(at, shift_seq,
 * line_id)`, so a round that lands mid-scroll cannot shift a row past the
 * reader.
 *
 * Unlike `/api/me/shift/lines` this one is never blind: the owner is the person
 * the blindness is for.
 */
import { useDb } from '../../../../utils/db'
import { guard, requiredParam } from '../../../../utils/http'
import { requireRole } from '../../../../utils/auth'
import { shiftLines } from '../../../../services/owner'

export default defineEventHandler(event => guard(() => {
  const db = useDb()
  const { venueId, actor } = event.context
  requireRole(actor, 'admin')

  const query = getQuery(event)
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.length > 0 ? v : undefined

  return shiftLines(db, venueId, requiredParam(event, 'id'), {
    kat: str(query.kat) ?? 'sve',
    ...(str(query.user) ? { userId: str(query.user)! } : {}),
    ...(str(query.cursor) ? { cursor: str(query.cursor)! } : {}),
    ...(query.limit ? { limit: Number(query.limit) } : {}),
  })
}))
