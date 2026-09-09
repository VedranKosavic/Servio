/**
 * `POST /api/auth/logout` — *Promijeni korisnika*.
 *
 * It clears `sank_s` and nothing else: the device stays enrolled, and the
 * person's `shift_members` row stays open. On the shared bar tablet this happens
 * a dozen times a night, and ending somebody's shift every time he hands the
 * tablet over would end his *Moji sati* at 21:40 (§5.1).
 */
import { logoutBody } from '#shared/schemas'
import { useDb } from '../../utils/db'
import { guard, readValidatedJson } from '../../utils/http'
import { clearSessionCookie } from '../../utils/auth'
import { logout } from '../../services/auth'

export default defineEventHandler(async (event) => {
  await readValidatedJson(event, logoutBody)
  const result = guard(() => logout(useDb(), event.context.venueId, event.context.actor))
  clearSessionCookie(event)
  return result
})
