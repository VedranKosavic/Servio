/**
 * The bartender's ticket queue: what is open, what is done, and one tap.
 *
 * The queue is the server's `GET /api/prep`, polled every 5 s. *Gotovo* is
 * optimistic — the card moves the instant it is tapped, because a bartender
 * with two hands full will not wait for a round trip to believe his own tap.
 *
 * Optimism needs a memory, though. Between the tap and the next poll the server
 * still lists that ticket as open, so a poll landing in that gap would make the
 * card blink back into the queue. `justDone` holds those tickets until the
 * server's own `done` list contains them, and then lets go.
 */
import type { Prep, PrepOrder } from '#shared/types'
import type { ApiSideError } from '~/composables/useApi'

/** The bar works the queue in arrival order; this is how long the tail is. */
const DONE_LIMIT = 10

export function usePrepPolling(intervalMs = 5000) {
  const api = useApi()
  const session = useSessionStore()

  const justDone = ref(new Map<string, PrepOrder>())
  const busy = ref(new Set<string>())
  const errorMessage = ref<string | null>(null)

  const poll = useVisiblePoll<Prep>(() => api.getPrep(), intervalMs, (prep) => {
    // The server has caught up with this device: stop pretending.
    for (const order of prep.done) justDone.value.delete(order.order_id)
  })

  /** Open tickets, oldest first — minus the ones tapped a moment ago. */
  const open = computed(() =>
    (poll.data.value?.open ?? []).filter(order => !justDone.value.has(order.order_id)))

  /** The last ten finished ones, newest first; this device's taps lead. */
  const done = computed(() => {
    const mine = [...justDone.value.values()].reverse()
    const theirs = (poll.data.value?.done ?? []).filter(order => !justDone.value.has(order.order_id))
    return [...mine, ...theirs].slice(0, DONE_LIMIT)
  })

  async function markDone(order: PrepOrder): Promise<void> {
    const userId = session.state.userId
    if (!userId || busy.value.has(order.order_id)) return

    errorMessage.value = null
    busy.value.add(order.order_id)
    justDone.value.set(order.order_id, {
      ...order,
      prepared_at: new Date().toISOString(),
      prepared_by_name: session.state.name,
    })

    try {
      await api.markPrepared(order.order_id, userId)
    } catch (err) {
      const apiError = err as ApiSideError
      // A colleague got there first — the ticket really is done, so the card
      // stays where the tap put it. Anything else is a genuine failure.
      if (apiError?.code !== 'ORDER_ALREADY_PREPARED') {
        justDone.value.delete(order.order_id)
        errorMessage.value = apiError?.message ?? 'Nije uspjelo. Pokušaj ponovo.'
      }
    } finally {
      busy.value.delete(order.order_id)
      await poll.refresh()
    }
  }

  return {
    open,
    done,
    busy,
    errorMessage,
    online: poll.online,
    loaded: poll.loaded,
    refresh: poll.refresh,
    markDone,
  }
}
