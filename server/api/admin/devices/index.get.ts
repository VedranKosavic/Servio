/**
 * `GET /api/admin/devices` — the *Uređaji* list in `/a`.
 *
 * Every phone that has ever enrolled, with the two numbers that matter on a
 * Saturday night: how many rounds its outbox still holds, and how far its clock
 * has drifted. Revoked devices stay in the list — a device you cannot see is a
 * device you cannot revoke twice, and the row is the record that it existed.
 */
import { useDb } from '../../../utils/db'
import { guard } from '../../../utils/http'
import { listDevices } from '../../../services/devices'

export default defineEventHandler(event => guard(
  () => listDevices(useDb(), event.context.venueId),
))
