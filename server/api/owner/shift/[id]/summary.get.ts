/**
 * `GET /api/owner/shift/:id/summary` — the latest `shift_summaries` row, with
 * the category and user names joined onto the numeric JSON.
 *
 * A shift that is still running has no row yet, and a screen that got `null`
 * would have to grow a second code path for the case it is used in most: the
 * owner watching tonight. So an unwritten summary is folded live, exactly as
 * `getOwnerShift` and *Puls* fold it, and comes back with `version: 0` — the
 * one field that says "this is tonight's arithmetic, not a record". Every
 * written version is ≥ 1 (`shift_summaries` is append-only and closing writes
 * v1), so the distinction is unambiguous.
 */
import { useDb } from '../../../../utils/db'
import { guard, requiredParam } from '../../../../utils/http'
import { requireRole } from '../../../../utils/auth'
import { ownerShiftSummary } from '../../../../services/owner'

export default defineEventHandler(event => guard(() => {
  const db = useDb()
  const { venueId, actor } = event.context
  requireRole(actor, 'admin')

  return ownerShiftSummary(db, venueId, requiredParam(event, 'id'))
}))
