/**
 * `POST /api/auth/pin` — a person taps four (or six) digits on an enrolled
 * device and gets a session.
 *
 * `public` in `ROUTE_ROLES` means "before a session exists", not "before
 * anything exists": this route still requires a valid `sank_d`, which is what
 * makes a 4-digit secret an acceptable one.
 */
import { getCookie, getRequestHeader } from 'h3'
import { pinLoginBody } from '#shared/schemas'
import { useDb } from '../../utils/db'
import { guard, readValidatedJson } from '../../utils/http'
import { DEVICE_COOKIE, clientIp, setSessionCookie } from '../../utils/auth'
import { loginWithPin } from '../../services/auth'
import { requireEnrolledDevice } from '../../services/devices'

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, pinLoginBody)
  const db = useDb()
  const { result, token, maxAgeS } = guard(() => {
    const device = requireEnrolledDevice(db, getCookie(event, DEVICE_COOKIE))
    return loginWithPin(db, device, body, {
      ip: clientIp(event),
      userAgent: getRequestHeader(event, 'user-agent'),
    })
  })
  setSessionCookie(event, token, maxAgeS)
  return result
})
