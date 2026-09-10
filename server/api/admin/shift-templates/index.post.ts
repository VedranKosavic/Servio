/** `POST /api/admin/shift-templates`. */
import { shiftTemplateBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson } from '../../../utils/http'
import { createTemplate } from '../../../services/roster'

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, shiftTemplateBody)
  return guard(() =>
    createTemplate(useDb(), event.context.venueId, event.context.actor, body))
})
