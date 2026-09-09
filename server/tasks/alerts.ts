/**
 * The alert drainer, once a minute.
 *
 * `server/plugins/alerts.ts` already drains 500 ms after anything commits, which
 * is what makes a shift closing at 03:10 reach the owner's phone at 03:10. This
 * task is the floor under that: an alert queued inside quiet hours has
 * `send_after = 10:00` and nothing commits at ten in the morning, so without a
 * timer it would sit in the table until the first waiter locked a round. It also
 * covers a row whose Telegram send failed and was backed off — `drainAlerts`
 * retries on its own schedule and needs somebody to call it.
 *
 * Draining twice at once is harmless: `drainAlerts` marks a row sent inside the
 * same synchronous pass that sends it, and the worst case is a duplicate message
 * on a network timeout, which is why the dedupe key lives on the *queue* side.
 */
import { useDb } from '../utils/db'
import { drainAlerts } from '../services/alerts'
import { tasksDisabled } from '../utils/tasks'

export default defineTask({
  meta: {
    name: 'alerts',
    description: 'Send queued Telegram mirrors that are due',
  },
  async run() {
    if (tasksDisabled()) return { result: 'skipped' as const }

    try {
      await drainAlerts(useDb())
    } catch (err) {
      // An unreachable Telegram must never take the café's order screen down
      // with it. `drainAlerts` has already recorded the failure on the row and
      // backed it off; there is nothing to alert *about* a failure to alert.
      console.error('[sank] alert drain failed', err)
      return { result: 'failed' as const }
    }
    return { result: 'ok' as const }
  },
})
