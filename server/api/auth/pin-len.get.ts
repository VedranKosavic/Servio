/**
 * `GET /api/auth/pin-len` — how many digits the pad waits for.
 *
 * The login screen is a pad and nothing else, so it has no account in front of
 * it and cannot know how long the PIN it is collecting should be. It has to
 * know: a pad that fires on four digits while somebody's PIN is six would send
 * that person's first four digits as if they were a whole PIN, and if those
 * four happen to be a colleague's PIN it would sign the colleague in.
 * `requirePinFree` keeps every active PIN in a venue the same length precisely
 * so that one number exists, and this is where the pad reads it.
 *
 * It is the *only* thing this route says. The roster moved behind a session in
 * the same change (`GET /api/auth/users` is `any` now): a number of digits
 * names nobody, counts nobody, and is visible to anyone who watches a waiter
 * type. **No device is required**: the pad has to draw itself on a browser the
 * server has never seen — which, since the enrolment wall came down, is the
 * ordinary first visit — and the only thing this answers is how many digits a
 * pad in this venue collects. It is not a secret and it names nobody.
 */
import { getCookie } from 'h3'
import { useDb } from '../../utils/db'
import { guard } from '../../utils/http'
import { DEVICE_COOKIE } from '../../utils/auth'
import { venuePinLen } from '../../services/auth'
import { deviceForPin } from '../../services/devices'
import { currentVenueId } from '../../utils/venue'

export default defineEventHandler(event => guard(() => {
  const db = useDb()
  // The device when there is one, so a second café reads its own number; the
  // only venue when there is not, which is the same route the PIN door takes.
  const device = deviceForPin(db, getCookie(event, DEVICE_COOKIE))
  return { pin_len: venuePinLen(db, device?.venueId ?? currentVenueId(db)) }
}))
