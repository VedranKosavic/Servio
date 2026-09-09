/**
 * The alert drainer's ear on the bus (`docs/BACKEND.md` §9).
 *
 * `server/tasks/alerts.ts` (WP8) runs the drainer every minute, which is a fine
 * worst case for a mirror — but a shift closing at 03:10 should not wait 60 s
 * to reach the owner's phone. So this plugin listens on the in-process bus and
 * drains shortly after anything commits.
 *
 * **Debounced, 500 ms.** A close writes a summary, a settlement, a log entry and
 * three `changes` rows within a few milliseconds; without the debounce that is
 * four drains racing each other for the same rows. The timer is `unref`'d so a
 * pending debounce never holds the process open on shutdown.
 *
 * The listener is registered once per venue on the first event, and the drain is
 * `catch`-ed rather than awaited: an unreachable Telegram must never take the
 * café's order screen down with it. `drainAlerts` has already recorded the
 * failure on the row and backed it off.
 */
import { onChange } from '../utils/bus'
import { useDb } from '../utils/db'
import { drainAlerts } from '../services/alerts'
import { currentVenueId } from '../utils/venue'

const DEBOUNCE_MS = 500

export default defineNitroPlugin((nitroApp) => {
  const db = useDb()

  let venueId: string
  try {
    venueId = currentVenueId(db)
  } catch {
    // An empty database (a fresh clone before `npm run db:seed`) has no venue
    // to listen for. The boot must not fail on it.
    return
  }

  let timer: ReturnType<typeof setTimeout> | null = null

  const unsubscribe = onChange(venueId, () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void drainAlerts(db).catch((err: unknown) => {
        console.error('[sank] alert drain failed', err)
      })
    }, DEBOUNCE_MS)
    timer.unref?.()
  })

  // Nitro re-runs plugins when the dev server reloads; without this the
  // listeners pile up and one commit drains ten times.
  nitroApp.hooks.hook('close', () => {
    if (timer) clearTimeout(timer)
    unsubscribe()
  })
})
