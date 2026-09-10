/** `GET /api/admin/rules` — every version, with the current one's acknowledgements. */
import { useDb } from '../../../utils/db'
import { guard } from '../../../utils/http'
import { listRuleVersions } from '../../../services/rules'

export default defineEventHandler(event => guard(() =>
  listRuleVersions(useDb(), event.context.venueId)))
