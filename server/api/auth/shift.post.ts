/**
 * `POST /api/auth/shift` — the tap on *Prva smjena* or *Druga smjena*.
 *
 * It joins the shift running on that slot, or opens it. The answer is the whole
 * `MeContext`, exactly as the mode route answers, so the client has the
 * session's new shift on the store before it navigates.
 *
 * `getMe` is called here rather than inside the service: `contracts.ts` already
 * re-exports two functions from `services/shifts.ts`, so a shift service that
 * imported `auth.ts` would close a circle. The route has both in scope.
 */
import { setShiftBody } from '#shared/schemas'
import { useDb } from '../../utils/db'
import { guard, readValidatedJson } from '../../utils/http'
import { pickShift } from '../../services/shifts'
import { getMe } from '../../services/auth'

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, setShiftBody)
  const db = useDb()
  const { venueId, actor } = event.context
  return guard(() => {
    pickShift(db, venueId, actor, body.template_id)
    return getMe(db, venueId, actor)
  })
})
