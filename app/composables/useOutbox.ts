/**
 * Wires the outbox store to the browser: what triggers a flush, and where the
 * flush actually posts.
 *
 * The store itself knows nothing about `window` or `fetch` — it takes a
 * transport and answers questions about a queue, which is what makes it
 * testable in a plain Node process. Everything that is genuinely *browser* is
 * here: the `online` event, the tab coming back into view, the 10 s tick, and
 * the one-time `navigator.storage.persist()` request.
 *
 * Call it once per screen that can queue anything (`/konobar`, `/sanker`).
 * Calling it twice is harmless — the store is a singleton and the listeners are
 * torn down with the component that opened them.
 */
import { useDocumentVisibility, useEventListener, useIntervalFn, useLocalStorage } from '@vueuse/core'
import { useOutboxStore, type EnqueueInput } from '~/stores/outbox'

/** Every 10 s while the document is visible (§2.2). */
const FLUSH_TICK_MS = 10_000

export function useOutbox() {
  const outbox = useOutboxStore()
  const cart = useCartStore()
  const api = useApi()
  const me = useMe()

  /**
   * *Trajno spremanje*. A browser may throw a site's storage away when the
   * phone runs low on space; `navigator.storage.persist()` asks it not to, and
   * the answer is a plain boolean the waiter can see on *Moja smjena*. Asked
   * once, after a session exists — before that there is nothing worth keeping.
   */
  const persisted = useState<boolean | null>('sank:storage-persisted', () => null)

  outbox.configure({
    send: async (kind, payload) => {
      const result = await api.sendQueued<{ already_applied?: boolean }>(kind, payload)
      return result ?? {}
    },
    errorText: err => apiErrorText(err, 'Nema veze — čuvamo narudžbu'),
  })

  async function requestPersistence(): Promise<void> {
    if (persisted.value !== null) return
    if (!import.meta.client || !navigator.storage?.persist) return
    try {
      persisted.value = (await navigator.storage.persisted())
        || (await navigator.storage.persist())
    } catch {
      persisted.value = false
    }
  }

  /** Enqueue, and try to send it in the same breath if the network is there. */
  async function enqueue(input: EnqueueInput) {
    const entry = await outbox.enqueue(input)
    void outbox.flush()
    return entry
  }

  /**
   * Who the drafts belong to when the server cannot be asked.
   *
   * A cold start with no signal has no `/api/me` to answer "who is holding this
   * phone", and drafts are keyed by user id — so without this, a waiter who
   * reloads behind the fridge finds an empty screen where his round was.
   *
   * It is remembered **only** across a network failure, never across a logout:
   * `logout()` leaves `status` at `anon`, which clears it. That is the whole
   * difference between "the wifi blinked" and "somebody re-locked the shared
   * tablet", and it is the difference between keeping Amar's round for Amar and
   * handing it to Lejla. Nothing here decides identity for the *server* — every
   * request still carries the session cookie and the server still decides.
   */
  const lastUser = useLocalStorage<string | null>('sank:zadnji-korisnik', null)

  function bindDraftOwner(): void {
    const id = me.user.value?.id ?? null
    if (id) {
      lastUser.value = id
      cart.bind(id)
      return
    }
    // Logged out, or the phone was revoked. Both are answers: forget who it
    // was, and show nobody's draft.
    if (me.status.value === 'anon' || me.status.value === 'nodevice') {
      lastUser.value = null
      cart.bind(null)
      return
    }
    // `offline`, or `unknown` because `/api/me` has not answered yet. Neither is
    // an answer, so the last person we knew about stands until one arrives —
    // this watcher runs again the moment it does.
    cart.bind(lastUser.value)
  }

  onMounted(async () => {
    await Promise.all([outbox.hydrate(), cart.hydrate()])
    bindDraftOwner()
    void requestPersistence()
    void outbox.flush()
  })

  // The person on a shared tablet changed, or the session finally answered.
  // Drafts are keyed by user id, so re-binding is all it takes for the other
  // one's round to stop being visible.
  watch([() => me.user.value?.id ?? null, me.status], () => {
    bindDraftOwner()
    if (me.user.value?.id) void requestPersistence()
  })

  // The network came back. This is the event that empties a night's queue.
  useEventListener('online', () => { void outbox.flushNow() })
  useEventListener('offline', () => { outbox.online = false })

  const visibility = useDocumentVisibility()
  watch(visibility, (state) => {
    if (state === 'visible') void outbox.flushNow()
  })

  const tick = useIntervalFn(() => {
    if (document.visibilityState === 'visible') void outbox.flush()
  }, FLUSH_TICK_MS, { immediate: false })

  onMounted(() => tick.resume())
  onBeforeUnmount(() => tick.pause())

  return { outbox, enqueue, persisted, requestPersistence }
}
