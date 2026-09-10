/**
 * `PATCH /api/admin/shift-templates/:id`.
 *
 * Editing a template never rewrites an existing assignment: the times were
 * snapshotted at insert, and the grid shows "16–01 (staro 15–00)" for the week
 * that kept the old ones.
 */
import { shiftTemplatePatch } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../utils/http'
import { updateTemplate } from '../../../services/roster'

export default defineEventHandler(async (event) => {
  const id = requiredParam(event, 'id')
  const body = await readValidatedJson(event, shiftTemplatePatch)
  return guard(() =>
    updateTemplate(useDb(), event.context.venueId, event.context.actor, id, body))
})
