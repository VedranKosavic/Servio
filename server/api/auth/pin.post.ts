/**
 * `POST /api/auth/pin` — somebody taps four (or six) digits and gets a session.
 * The body is `{ pin, mode? }` and names nobody: **the PIN identifies the
 * person**.
 *
 * **There is no enrolment wall in front of this any more.** A phone the server
 * has never seen used to be sent to a six-character code screen, and the code
 * came from an admin who was already signed in — which on a fresh browser meant
 * nobody could get in at all, the owner included, on the day the café installs
 * this. The owner asked twice for it to go. A browser with no device cookie now
 * gets a device of its own the moment the digits are right, silently.
 *
 * What did **not** get softened:
 *
 * - a **revoked or locked** device is still refused. Those are decisions
 *   somebody made about this browser, and handing it a fresh device row would
 *   be a way to walk around them.
 * - the **lockout still counts**. `loginWithPin` resolves the PIN *before* it
 *   mints anything, so an attempt with no cookie is metered against
 *   `(no device, ip)` rather than against a device id that would be new every
 *   time somebody cleared their cookies.
 *
 * The digits are now the only thing between a stranger who can reach the URL
 * and a session, which is the owner's explicit trade and is why the PIN being
 * secret matters more than it did.
 */
import { getCookie, getRequestHeader } from 'h3'
import { pinLoginBody } from '#shared/schemas'
import { useDb } from '../../utils/db'
import { guard, readValidatedJson } from '../../utils/http'
import { DEVICE_COOKIE, clientIp, setDeviceCookie, setSessionCookie } from '../../utils/auth'
import { loginWithPin } from '../../services/auth'
import { deviceForPin } from '../../services/devices'
import { currentVenueId } from '../../utils/venue'

/** "iPhone", "Android", "Tablet" — what the admin's device list shows first. */
function labelFor(userAgent: string | undefined): string {
  const ua = userAgent ?? ''
  if (/iPad|Tablet/i.test(ua)) return 'Tablet'
  if (/iPhone/i.test(ua)) return 'iPhone'
  if (/Android/i.test(ua)) return 'Android telefon'
  if (/Macintosh|Windows|Linux/i.test(ua)) return 'Računar'
  return 'Telefon'
}

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, pinLoginBody)
  const db = useDb()
  const userAgent = getRequestHeader(event, 'user-agent')

  const { result, token, maxAgeS, deviceToken } = guard(() => {
    const device = deviceForPin(db, getCookie(event, DEVICE_COOKIE))
    // With no device there is no venue on the cookie either. One café, one row.
    const venueId = device?.venueId ?? currentVenueId(db)
    return loginWithPin(db, venueId, device, body, {
      ip: clientIp(event),
      userAgent,
      label: labelFor(userAgent),
    })
  })

  if (deviceToken) setDeviceCookie(event, deviceToken)
  setSessionCookie(event, token, maxAgeS)
  return result
})
