/**
 * `POST /api/dev/reset-limits` — forget every rate-limit window.
 *
 * The Playwright suite is nine spec files run back-to-back from one IP against
 * one server. Each file's `beforeAll` spends about five auth calls (an admin
 * login, two enrolments, two PIN logins) and `authLimiter` allows ten per
 * minute keyed on the IP until a device cookie exists — so from the fourth file
 * on, every `beforeAll` dies with `RATE_LIMITED` and the rest of the suite
 * never runs. The leash is right; the harness needs a way to step past it.
 *
 * **Gated exactly like `POST /api/dev/enrol`**: `SANK_DEV_ENROL` must be the
 * string `'1'`, which `/opt/sank/.env` never sets, so on the VPS this route
 * does not exist. A positive opt-in and nothing else — an opt-out ("not in
 * production") fails open, and the failure mode here is a stranger clearing the
 * limiter in front of the PIN door.
 */
import { apiError } from '../../utils/http'
import { resetLimiters } from '../../utils/rate-limit'

export default defineEventHandler(() => {
  if (process.env.SANK_DEV_ENROL !== '1') throw apiError(404, 'NOT_FOUND', 'not found')
  resetLimiters()
  return { ok: true }
})
