/**
 * `GET /api/auth/users` — the names the lock screen draws.
 *
 * This is the one response a stranger holding an enrolled device can read
 * without a session, so it contains no more than the screen shows: name,
 * initials, role, PIN length, whether a PIN is set at all — and, since PHASE3
 * §1.8, when each person last signed in **on this very device**, which is what
 * lets the pad offer the last three faces first. No email, no hash, nothing
 * that would make the list worth stealing (§5.5).
 */
import { getCookie } from 'h3'
import { useDb } from '../../utils/db'
import { guard } from '../../utils/http'
import { DEVICE_COOKIE } from '../../utils/auth'
import { listLoginUsers } from '../../services/auth'
import { requireEnrolledDevice } from '../../services/devices'

export default defineEventHandler(event => guard(() => {
  const db = useDb()
  const device = requireEnrolledDevice(db, getCookie(event, DEVICE_COOKIE))
  return listLoginUsers(db, device.venueId, device.id)
}))
