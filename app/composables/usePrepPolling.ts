/**
 * The bartender's ticket queue: what is open, what is done, and one tap.
 *
 * The queue arrives inside the one `/api/changes` poll (WP9 — there is no
 * `/api/prep` timer any more), every 5 s because the bar is the one screen
 * somebody is actually staring at. *Gotovo* is optimistic: the card moves the
 * instant it is tapped, because a bartender with two hands full will not wait
 * for a round trip to believe his own tap.
 *
 * Optimism needs a memory, though. Between the tap and the next poll the server
 * still lists that ticket as open, so a poll landing in that gap would make the
 * card blink back into the queue. `justDone` holds those tickets until the
 * server's own `done` list contains them, and then lets go.
 *
 * The body of *Gotovo* is `{}`. It used to carry `user_id`; who tapped it is the
 * session's business now (BACKEND §5.7).
 */
import type { PrepOrder } from '#shared/types'

/** The bar works the queue in arrival order; this is how long the tail is. */
const DONE_LIMIT = 10

export function usePrepPolling(intervalMs = 5000) {
  const api = useApi()
  const me = useMe()

  const serverOpen = ref<PrepOrder[]>([])
  const serverDone = ref<PrepOrder[]>([])
  const justDone = ref(new Map<string, PrepOrder>())
  const busy = ref(new Set<string>())
  const errorMessage = ref<string | null>(null)

  const { ok: online, lastOkAt, refresh } = useChanges({
    prep: (prep) => {
      serverOpen.value = prep.open
      serverDone.value = prep.done
      // The server has caught up with this device: stop pretending.
      for (const order of prep.done) justDone.value.delete(order.order_id)
    },
    me: () => me.load(),
  }, { intervalMs })

  /** False until the first answer — tells "empty queue" from "not asked yet". */
  const loaded = computed(() => lastOkAt.value !== null)

  /** Open tickets, oldest first — minus the ones tapped a moment ago. */
  const open = computed(() =>
    serverOpen.value.filter(order => !justDone.value.has(order.order_id)))

  /** The last ten finished ones, newest first; this device's taps lead. */
  const done = computed(() => {
    const mine = [...justDone.value.values()].reverse()
    const theirs = serverDone.value.filter(order => !justDone.value.has(order.order_id))
    return [...mine, ...theirs].slice(0, DONE_LIMIT)
  })

  async function markDone(order: PrepOrder): Promise<void> {
    if (busy.value.has(order.order_id)) return

    errorMessage.value = null
    busy.value.add(order.order_id)
    justDone.value.set(order.order_id, {
      ...order,
      prepared_at: new Date().toISOString(),
      prepared_by_name: me.user.value?.name ?? null,
    })

    try {
      await api.markPrepared(order.order_id)
    } catch (err) {
      const apiError = err as { code?: string }
      // A colleague got there first — the ticket really is done, so the card
      // stays where the tap put it. Anything else is a genuine failure.
      if (apiError?.code !== 'ORDER_ALREADY_PREPARED') {
        justDone.value.delete(order.order_id)
        errorMessage.value = apiErrorText(err, 'Nije uspjelo. Pokušaj ponovo.')
        void me.handleAuthError(err)
      }
    } finally {
      busy.value.delete(order.order_id)
      await refresh()
    }
  }

  return {
    open,
    done,
    busy,
    errorMessage,
    online,
    loaded,
    refresh,
    markDone,
  }
}
