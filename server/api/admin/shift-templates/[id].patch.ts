/**
 * `PATCH /api/admin/shift-templates/:id`.
 *
 * The weekly *Raspored* reads a template's hours as they stand, so an edit here
 * shows on every weekday at once. Switching a template off hides its cells and
 * keeps its people for the day it is switched back on.
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
