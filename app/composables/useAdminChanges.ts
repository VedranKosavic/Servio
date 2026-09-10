/**
 * **One poll on `/admin` too.**
 *
 * The waiter app has exactly one timer (`useChanges`) and the dashboard does not
 * get to open a second one: an owner page that set its own `setInterval` would
 * be a second clock asking the same server the same question, and two panels on
 * one screen could disagree about the same shift.
 *
 * So this wraps `useChanges` instead of replacing it. The difference is what an
 * owner page needs from the answer. A phone wants the *snapshots* — the floor
 * plan, the ticket queue — and the feed attaches them. An owner page wants none
 * of those: it has a read of its own (`/api/owner/live`, `/api/owner/shift/:id`,
 * `/api/owner/stock`) that goes stale when a particular **entity** moves. That
 * is what `onEntity` is: the feed says `stock` moved, and only the *Roba* page
 * refetches, and only the read that went stale.
 *
 * Two settings that differ from a phone's, both deliberate:
 *
 * - **15 s**, the same as the floor plan. A dashboard is read, not acted on in a
 *   hurry; 5 s would be a request every five seconds all evening for numbers
 *   nobody is watching that closely.
 * - **No heartbeat.** The heartbeat is a *device* checking in — its outbox
 *   depth, its clock skew, its app version. A laptop on an email session is not
 *   an enrolled device and has nothing to report.
 */
import type { ChangeEntity, ChangesResult, PendingCounts } from '#shared/types'

export interface AdminChangeHandlers {
  /**
   * An entity moved and this screen may care. Called once per moved entity per
   * poll, so a page can map entity → which of its reads to redo:
   *
   *   Puls    `table` · `adjustment` · `shift`
   *   Smjena  `shift` · `adjustment` · `count`
   *   Roba    `stock` · `count`
   *   Meni    `menu` · `settings`
   *   Dnevnik `log`
   */
  onEntity?: (entity: ChangeEntity) => void
  /** The whole answer, for a screen that wants the cursor or the shift brief. */
  raw?: (result: ChangesResult) => void
}

const EMPTY_PENDING: PendingCounts = {
  adjustments: 0, unpaid: 0, payouts: 0, settlements: 0, counts: 0,
}

/**
 * **There is one timer, not one per caller.**
 *
 * The layout reads the badges and the page reads its entities, so on any given
 * screen `useAdminChanges()` is called twice — and two `useChanges()` calls
 * would be two `setInterval`s asking the server the same question, which is the
 * exact thing the one-poll rule exists to prevent. So the first caller opens the
 * poll and every later one only subscribes to it.
 *
 * The registry hangs off `useNuxtApp()` rather than off a module-level variable:
 * a module variable is shared by every server render, and one visitor's
 * subscribers would leak into the next visitor's page.
 */
interface AdminPoll {
  subscribers: Set<AdminChangeHandlers>
  /** The component that owns the timer, or null when nobody does yet. */
  refresh: (() => Promise<void>) | null
}

function pollRegistry(): AdminPoll {
  const nuxt = useNuxtApp() as unknown as { _sankAdminPoll?: AdminPoll }
  nuxt._sankAdminPoll ??= { subscribers: new Set(), refresh: null }
  return nuxt._sankAdminPoll
}

export function useAdminChanges(handlers: AdminChangeHandlers = {}) {
  const me = useMe()
  const registry = pollRegistry()

  /**
   * The nav's badges live in `useState`, not in a local `ref`.
   *
   * `useState` is Nuxt's per-request shared store: the layout draws the badge
   * and the page decides its value, and both reach the same object without
   * either importing the other. (It is also why a server render never leaks one
   * visitor's numbers into the next one's page.)
   */
  const pending = useState<PendingCounts>('sank:a:pending', () => ({ ...EMPTY_PENDING }))
  const attention = useState<number>('sank:a:attention', () => 0)
  const logMaxAt = useState<string | null>('sank:a:log-max', () => null)
  const logSeenAt = useState<string | null>('sank:a:log-seen', () => null)
  const online = useState<boolean>('sank:a:ok', () => true)
  const cursor = useState<number>('sank:a:cursor', () => 0)

  /**
   * The red dot on *Dnevnik*.
   *
   * The server stamps `users.log_seen_at` when the Dnevnik page opens, but no
   * envelope hands that column back to the client yet, so the comparison
   * happens here against the newest `log_max_at` this session has seen: the dot
   * appears when the Dnevnik moves while the dashboard is open and clears when
   * the owner reads it. A reload starts it clear — the honest limitation, and
   * the reason `markLogSeen()` below is the only thing that clears it.
   */
  const logUnread = computed(() =>
    !!logMaxAt.value && logMaxAt.value !== logSeenAt.value)

  // Subscribe, and unsubscribe when this component goes away — otherwise a page
  // that has been navigated off keeps refetching a read nobody is looking at.
  registry.subscribers.add(handlers)
  onScopeDispose(() => registry.subscribers.delete(handlers))

  /**
   * The first caller on a screen opens the timer and owns it; when that
   * component is torn down (leaving `/admin` for `/konobar`, say) the slot is
   * freed, so the next visit opens a live poll rather than inheriting a dead
   * one.
   */
  if (!registry.refresh) {
    const poll = useChanges({
      raw: (result) => {
        if (result.pending) pending.value = result.pending
        if (result.log_max_at) {
          // The first answer is the baseline, not an unread badge: a Dnevnik
          // that has entries in it is normal, and the owner has not been told
          // anything new by opening a laptop.
          if (logSeenAt.value === null && logMaxAt.value === null) {
            logSeenAt.value = result.log_max_at
          }
          logMaxAt.value = result.log_max_at
        }
        cursor.value = result.seq

        // `full` lists every entity that has ever moved, which is not news — it
        // is the shape of a first paint, and the screen has just read
        // everything it needs.
        for (const subscriber of registry.subscribers) {
          if (!result.full) {
            for (const row of result.changes) subscriber.onEntity?.(row.entity)
          }
          subscriber.raw?.(result)
        }
      },
      me: (fresh) => {
        // A role change or a revoke. The session envelope arrives in the
        // answer, so there is nothing to go and ask for.
        me.me.value = fresh
        me.status.value = 'ready'
      },
    }, { intervalMs: 15_000, heartbeat: false })

    watch(poll.ok, (value) => { online.value = value }, { immediate: true })
    registry.refresh = poll.refresh
    onScopeDispose(() => { registry.refresh = null })
  }

  /**
   * *Puls*' badge is the length of its own `attention[]`, which only that page
   * reads — the feed carries the queue counts, not the assembled list. So the
   * sum of the queues seeds the badge on every other page, and *Puls* publishes
   * the exact number the moment it has one.
   *
   * The sum has to include every queue the list does, or an owner who lands on
   * *Smjene* is told there is nothing waiting when there is. `counts` is why
   * the badge used to read one short of the list it counts.
   */
  const attentionCount = computed(() => attention.value || (
    pending.value.adjustments + pending.value.unpaid
    + pending.value.payouts + pending.value.settlements + pending.value.counts
  ))

  /** *Puls* calls this after every read and after every decision. */
  function setAttentionCount(n: number) {
    attention.value = n
  }

  /** *Dnevnik* calls this when it opens, beside `POST /api/owner/log/seen`. */
  function markLogSeen() {
    logSeenAt.value = logMaxAt.value
  }

  return {
    /** Did the last poll reach the server? What the "Ažurirano …" line reads. */
    ok: online,
    cursor,
    /** Force a read now — after a decision, rather than waiting out the 15 s. */
    refresh: () => registry.refresh?.() ?? Promise.resolve(),
    pending,
    attentionCount,
    setAttentionCount,
    logUnread,
    markLogSeen,
  }
}
