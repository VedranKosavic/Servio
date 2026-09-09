/**
 * `POST /api/dev/enrol` — one tap and this browser is an enrolled device.
 *
 * Without it, testing any screen on a laptop means minting a code in `/a` first,
 * which means already having an admin session, which means the start screen is
 * never the thing you are testing.
 *
 * **It is gated on a positive opt-in and nothing else.** `SANK_DEV_ENROL` must be
 * exactly `'1'`, and `/opt/sank/.env` does not set it, so on the VPS this route
 * does not exist. The earlier design ("404 when `NODE_ENV === 'production'`")
 * would have handed an enrolled device cookie to the internet, because the
 * systemd unit never sets `NODE_ENV` — the failure mode of an opt-out is that it
 * silently fails open, which is the wrong direction for a route that mints a
 * credential (§5.6).
 */
import { devEnrolBody } from '#shared/schemas'
import { useDb } from '../../utils/db'
import { apiError, guard, readValidatedJson } from '../../utils/http'
import { setDeviceCookie } from '../../utils/auth'
import { currentVenueId } from '../../utils/venue'
import { devEnrol } from '../../services/devices'

export default defineEventHandler(async (event) => {
  if (process.env.SANK_DEV_ENROL !== '1') throw apiError(404, 'NOT_FOUND', 'not found')

  await readValidatedJson(event, devEnrolBody)
  const { result, token } = guard(() => {
    const db = useDb()
    return devEnrol(db, currentVenueId(db))
  })
  setDeviceCookie(event, token)
  return result
})
