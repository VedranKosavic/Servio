/**
 * `POST /api/devices/enrol` — a phone joins the venue with a 6-character code.
 *
 * The response carries the venue and the staff list so the lock screen has names
 * to draw immediately, before any session exists.
 */
import { enrolDeviceBody } from '#shared/schemas'
import { useDb } from '../../utils/db'
import { guard, readValidatedJson } from '../../utils/http'
import { clientIp, setDeviceCookie } from '../../utils/auth'
import { enrolDevice } from '../../services/devices'

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, enrolDeviceBody)
  const { result, token } = guard(() => enrolDevice(useDb(), body, { ip: clientIp(event) }))
  setDeviceCookie(event, token)
  return result
})
