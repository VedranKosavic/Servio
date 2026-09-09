/**
 * `PATCH /api/admin/settings` — a partial, and an unknown key is a 400.
 *
 * `settingsSchema` is `.strict().partial()`, so a typo in *Postavke* is an error
 * instead of a setting that silently does nothing. One Dnevnik entry per key
 * that actually moved; the answer is the merged `Settings`.
 */
import { settingsSchema } from '#shared/settings'
import { useDb } from '../../utils/db'
import { guard, readValidatedJson } from '../../utils/http'
import { requireRole } from '../../utils/auth'
import { updateSettings } from '../../services/admin'

export default defineEventHandler(async (event) => {
  requireRole(event.context.actor, 'admin')
  const body = await readValidatedJson(event, settingsSchema)
  return guard(() => updateSettings(useDb(), event.context.venueId, event.context.actor, body))
})
