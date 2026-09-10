/** `GET /api/admin/shift-templates` — *Šabloni smjena*. */
import { useDb } from '../../../utils/db'
import { guard } from '../../../utils/http'
import { listTemplates } from '../../../services/roster'

export default defineEventHandler(event => guard(() =>
  listTemplates(useDb(), event.context.venueId)))
