/**
 * `POST /api/auth/admin/login` — the owner's laptop.
 *
 * The one door with no device cookie in front of it, and therefore the one whose
 * failures must be counted: everywhere else an attacker needs a phone that has
 * already been enrolled. A wrong email and a wrong password answer the same 401
 * after the same constant-time work (`docs/BACKEND.md` §5.1).
 */
import { adminLoginBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson } from '../../../utils/http'
import { clientIp, setSessionCookie } from '../../../utils/auth'
import { adminLogin } from '../../../services/auth'

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, adminLoginBody)
  const { result, token, maxAgeS } = guard(() => adminLogin(useDb(), body, {
    ip: clientIp(event),
    userAgent: getRequestHeader(event, 'user-agent'),
  }))
  setSessionCookie(event, token, maxAgeS)
  return result
})
