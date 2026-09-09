/**
 * `POST /api/admin/enrol-codes` — the admin mints a code and reads it out.
 *
 * Ten minutes, two uses. Two rather than one because the first attempt is often
 * a typo across a noisy bar; ten minutes because a code left on a screen is a
 * credential.
 */
import { createEnrolCodeBody } from '#shared/schemas'
import { useDb } from '../../utils/db'
import { guard, readValidatedJson } from '../../utils/http'
import { mintEnrolCode } from '../../services/devices'

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, createEnrolCodeBody)
  return guard(() => mintEnrolCode(useDb(), event.context.venueId, event.context.actor, body))
})
