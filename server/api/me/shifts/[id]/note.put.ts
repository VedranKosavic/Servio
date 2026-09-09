/**
 * `PUT /api/me/shifts/:id/note` — *Napomena* on one of his own nights (§1.6).
 *
 * `PUT` and not `POST` because it is one row per person per night and the body
 * *is* the row: sending it twice leaves the same note, and an empty `body`
 * deletes it. No `user_id` in the body — whose note it is comes out of the
 * session, like everything else (CLAUDE.md).
 */
import { staffNoteBody } from '#shared/schemas'
import { useDb } from '../../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../../utils/http'
import { putStaffNote } from '../../../../services/summaries'

export default defineEventHandler(async (event) => {
  const shiftId = requiredParam(event, 'id')
  const body = await readValidatedJson(event, staffNoteBody)
  return guard(() => putStaffNote(
    useDb(), event.context.venueId, event.context.actor.userId, shiftId, body.body,
  ))
})
