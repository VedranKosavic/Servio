/**
 * `GET /api/auth/users` — the venue's live staff, for the screens that name
 * people: *Otpis*'s approver list, *Raspored*'s team column, the adjustments
 * composable.
 *
 * **It is behind a session now** (`any` in `ROUTE_ROLES`). It used to be
 * `public`, because the lock screen drew faces and needed the names before
 * anybody had logged in. The lock screen is a pad and draws nothing, and what
 * was left was a body — every person's name, initials, **role** and PIN length —
 * readable by anyone holding an enrolled phone, which told a thief exactly which
 * of the three PINs opens the dashboard. All three callers already read it after
 * a login, so nothing on a screen changed.
 *
 * It still carries no email, no hash, and — since PHASE3 §1.8 — `last_login_at`
 * **for this device only**: who signs in at this bar is visible to anybody
 * standing at it; who signs in across the café would not be.
 */
import { useDb } from '../../utils/db'
import { guard } from '../../utils/http'
import { listLoginUsers } from '../../services/auth'

// The session settles both arguments now: `tenant.ts` put the venue and the
// actor on the context, and the actor carries the device his session is on —
// `null` for an admin on a laptop, which is a laptop with no `last_login_at`
// to report rather than an error.
export default defineEventHandler(event => guard(
  () => listLoginUsers(useDb(), event.context.venueId, event.context.actor.deviceId),
))
