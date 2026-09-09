/**
 * **One poll.** The single timer in the whole app (BACKEND §4.1, §4.4).
 *
 * Korak 1 had three: the floor plan asked for tables every 15 s, the bartender
 * asked for tickets every 5 s, *Stanje šanka* asked for stock every 15 s. Three
 * timers on one café wifi is three times the battery and three chances to show
 * two screens that disagree with each other.
 *
 * Now every screen asks the same question — *anything new since 812?* — and the
 * server answers with which entities moved plus the snapshot of each one, in the
 * same response. The floor plan, the ticket queue, the stock list and the shift
 * strip all arrive together and can never be out of step, because they were read
 * inside one request.
 *
 * Three properties worth knowing before touching this file:
 *
 * - **The cursor only ever goes forward.** `seq` is the largest sequence in the
 *   answer, and a reply that arrives out of order can at worst repaint what we
 *   already have. A stale snapshot can never overwrite a newer one.
 * - **`since = 0` is the first paint.** It answers `full: true` with every
 *   snapshot attached, so a screen needs no separate boot read.
 * - **A quiet minute is free.** The URL does not change while nothing happens,
 *   so the browser revalidates with `If-None-Match` and the server answers 304
 *   with no body (see the `etag` note in `useApi.ts`).
 */
import { useDocumentVisibility, useIntervalFn } from '@vueuse/core'
import { useOutboxStore } from '~/stores/outbox'
import type {
  ChangesResult, MeContext, PendingCounts, Prep, StockItem, TablesStateResponse,
} from '#shared/types'

export interface ChangeHandlers {
  /** The floor plan and the shift strip, in one envelope. */
  tables?: (state: TablesStateResponse) => void
  /** The bartender's queue. */
  prep?: (prep: Prep) => void
  /** *Stanje šanka* — the whole list; there is no partial mode. */
  stock?: (items: StockItem[]) => void
  /** The four queues. Admins and bartenders only; a waiter never gets these. */
  pending?: (counts: PendingCounts) => void
  /** The catalogue changed: refetch `/api/bootstrap`, and only then. */
  menu?: () => void
  /** A `user` or `device` row moved: the fresh session envelope (a role or a revoke). */
  me?: (me: MeContext) => void
  /**
   * The whole answer, for screens that key their refetches off entities.
   *
   * `/a` reads this one: an owner page has no fixed snapshot in the feed, it
   * has a read of its own that goes stale when a particular entity moves, so it
   * wants `changes[]` rather than any single attached object. See
   * `useAdminChanges.ts`.
   */
  raw?: (result: ChangesResult) => void
}

export interface ChangesOptions {
  /** 5 s at the bar, 10–15 s on a phone in an apron (§4.4). */
  intervalMs?: number
  /** The 60 s device check-in. Off on screens with no session. */
  heartbeat?: boolean
}

/** What the phone calls itself to the server. Bumped when the app is deployed. */
const APP_VERSION = '0.9.0'
const HEARTBEAT_MS = 60_000

export function useChanges(handlers: ChangeHandlers, options: ChangesOptions = {}) {
  const api = useApi()
  const meState = useMe()
  const outbox = useOutboxStore()
  const intervalMs = options.intervalMs ?? 15_000

  /**
   * The sync cursor, and it starts at 0 **per screen** on purpose.
   *
   * A cursor shared between screens would be a bug rather than an optimisation:
   * the bartender walking from *Stanje šanka* to the ticket queue would arrive
   * with a cursor already past every `prep` bump, the feed would answer "nothing
   * new" — truthfully — and he would look at an empty queue with a green chip.
   * Each screen therefore opens with `since = 0`, which is one `full` answer
   * carrying every snapshot, and goes incremental from there. That is also what
   * §4.4 means by polling "on open".
   */
  const cursor = ref(0)
  /** Did the last attempt reach the server? What the sync chip renders. */
  const ok = ref(true)
  /** The same answer, shared app-wide, so `useSync()` can paint the chip. */
  const pollOk = useState<boolean>('sank:poll-ok', () => true)
  const lastOkAt = ref<number | null>(null)
  const menuVersion = useState<number | null>('sank:menu-version', () => null)

  // One request at a time: a slow network must not queue up five polls.
  let inFlight = false

  function apply(result: ChangesResult) {
    if (result.tables_state) handlers.tables?.(result.tables_state)
    if (result.prep) handlers.prep?.(result.prep)
    if (result.stock) handlers.stock?.(result.stock)
    if (result.pending) handlers.pending?.(result.pending)

    // The catalogue is fetched once at boot and again only when this number
    // moves — never on a timer. On the first answer we simply record it.
    if (typeof result.menu_version === 'number') {
      if (menuVersion.value !== null && result.menu_version !== menuVersion.value) {
        handlers.menu?.()
      }
      menuVersion.value = result.menu_version
    }

    // A `user` or `device` row moving means a role changed or a phone was
    // revoked. The feed attaches the fresh envelope itself (§4.1), so there is
    // nothing to go and ask for — and it is never attached to a `full` answer,
    // where every entity that ever moved is listed.
    if (result.me) handlers.me?.(result.me)

    // Everything, for a screen that decides its own refetches off `changes[]`.
    handlers.raw?.(result)

    // Forward only. An out-of-order reply repaints; it never rewinds.
    if (result.seq > cursor.value) cursor.value = result.seq
  }

  async function refresh(): Promise<void> {
    if (inFlight) return
    inFlight = true
    try {
      // **The flush runs before the poll, always** (PHASE3 §2.2). Reading the
      // room before sending what changed it is how a phone shows a table it
      // already emptied — the answer would arrive describing a world one round
      // out of date, and the waiter would tap *Naplati* on a total that is
      // already wrong. Each queued POST has an 8 s ceiling and the run stops on
      // the first network error, so this can never hold the poll open for long.
      await outbox.flush()
      apply(await api.getChanges(cursor.value))
      ok.value = true
      pollOk.value = true
      lastOkAt.value = Date.now()
    } catch (err) {
      // A revoked device or an expired session ends the screen; anything else
      // just turns the chip red and leaves what is on screen alone. Showing
      // stale tables is honest as long as the chip says the data is not current.
      if (!(await meState.handleAuthError(err))) {
        ok.value = false
        pollOk.value = false
      }
    } finally {
      inFlight = false
    }
  }

  /**
   * The device check-in (§4.3): its own timer, no ETag, and it deliberately
   * bumps nothing — a heartbeat that touched `changes` would invalidate every
   * waiter's ETag once a minute and undo the whole point of the feed.
   *
   * `pending` is the length of this phone's offline outbox, and since Phase 3
   * there is one to count.
   */
  async function beat(): Promise<void> {
    try {
      const oldest = outbox.oldestPendingAt
      const result = await api.heartbeat({
        // The truth, at last: how much money and stock this phone is still
        // holding on to. `POST /api/stock/counts` refuses a count while a
        // device reports a queue, so this number is not decoration — it is the
        // gate that stops a popis being taken against a stale on-hand.
        pending: outbox.pending,
        ...(oldest ? { oldest_pending_at: oldest } : {}),
        client_now: new Date().toISOString(),
        app_version: APP_VERSION,
        standalone: import.meta.client
          && window.matchMedia?.('(display-mode: standalone)').matches === true,
      })
      if (result.revoked) await navigateTo('/')
    } catch (err) {
      await meState.handleAuthError(err)
    }
  }

  const poll = useIntervalFn(refresh, intervalMs, { immediate: false })
  const heart = useIntervalFn(beat, HEARTBEAT_MS, { immediate: false })

  // A phone in an apron pocket polls nothing; coming back to the screen
  // refreshes at once rather than waiting out the interval, because the first
  // thing anybody sees must never be a stale room.
  const visibility = useDocumentVisibility()
  watch(visibility, (state) => {
    if (state === 'visible') {
      void refresh()
      poll.resume()
      if (options.heartbeat !== false) heart.resume()
    } else {
      poll.pause()
      heart.pause()
    }
  })

  onMounted(() => {
    void refresh()
    poll.resume()
    if (options.heartbeat !== false) {
      void beat()
      heart.resume()
    }
  })

  // **A heartbeat after every successful flush** (§2.3), and not only every
  // 60 s. The count screen's `409 PENDING_OUTBOX` names the phone that is
  // holding things up; a bartender who has just watched a waiter reconnect
  // should not have to wait out a minute of stale evidence before *Predaj*
  // works.
  watch(() => outbox.flushedAt, (at) => {
    if (at > 0 && options.heartbeat !== false) void beat()
  })

  return { ok, cursor, lastOkAt, refresh }
}
