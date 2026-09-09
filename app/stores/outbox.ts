/**
 * The outbox — every piece of money or stock this phone owes the server.
 *
 * A café has one wifi router, a fridge between it and the terrace, and eight
 * hours of Saturday night. Before this store, `Pošalji šankeru` called
 * `POST /api/orders` and hoped; a dead spot lost the round, or worse, sent it
 * twice. Now nothing on `/k` or `/s` posts money directly. A screen calls
 * `enqueue(kind, body)`, gets the local truth back immediately, and this store
 * takes on the job of getting it to the server — eventually, in order, exactly
 * once.
 *
 * Three ideas hold it together, and none of them is Vue:
 *
 * **Idempotency.** Every entry carries the `client_id` its body already has: a
 * uuid this phone minted. If the request landed but the *answer* got lost, the
 * retry carries the same id, and the server recognises the replay and answers
 * with the row it already wrote (`already_applied: true`) instead of charging
 * the guest twice. That property is what makes retrying safe, and it is why
 * this store can be as dumb as it is.
 *
 * **IndexedDB, not localStorage.** `idb-keyval` is a thin wrapper over
 * IndexedDB, the browser's real database. It matters for two reasons: it
 * survives the memory-pressure reload iOS does when a phone comes back from the
 * camera, and it is not capped at 5 MB. `localStorage` is neither.
 *
 * **One at a time, oldest first.** Never `Promise.all`. A payment must not
 * overtake the round it pays for — the payment names a tab the order creates.
 *
 * The one thing this store is *not*: a cache of the room. Reads never come
 * through here. `useChanges()` is still the only poll, and it runs the flush
 * first, so a phone that just emptied a table sees it empty.
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval'

/** What a queued entry does when it reaches the server. */
export type OutboxKind = 'order' | 'pay' | 'unpaid' | 'adjust' | 'waste'

export interface OutboxEntry {
  /** The row's idempotency key — the same uuid the body carries. */
  client_id: string
  kind: OutboxKind
  /**
   * What a failure blocks. A 4xx on a round for Sto 7 must stop that table's
   * payment from going out behind it, and must stop nothing on Sto 12.
   */
  tab_client_id?: string
  /** The exact body, already valid; it is posted unchanged, however late. */
  payload: unknown
  /** When it happened in the *world* — the phone's clock, not the server's. */
  client_created_at: string
  attempts: number
  last_error: string | null
  status: 'queued' | 'failed'
  /** For the failed card: "Sto 7 · Tura 2". Display only, never sent. */
  label?: string
  /** For the failed card, on a payment. Display only, never sent. */
  amount_fen?: number
}

/** What a screen hands over. The store fills in the bookkeeping. */
export interface EnqueueInput {
  kind: OutboxKind
  client_id: string
  payload: unknown
  tab_client_id?: string
  client_created_at?: string
  label?: string
  amount_fen?: number
}

/** What the store needs from the outside world to do its job. */
export interface OutboxTransport {
  /** POST the body. Resolves on 2xx, throws an `ApiSideError` otherwise. */
  send: (kind: OutboxKind, payload: unknown) => Promise<{ already_applied?: boolean }>
  /** The Bosnian sentence for a failure. */
  errorText: (err: unknown) => string
}

const STORAGE_KEY = 'sank:outbox'

/** Back-off after a network failure: 10 s, then 20, 40, capped at 60 (§2.2). */
const BACKOFF_MIN_MS = 10_000
const BACKOFF_MAX_MS = 60_000

/** An entry older than this puts the banner under the header (§2.3). */
export const STALE_MS = 5 * 60_000

/**
 * The 401s that must **not** burn a round.
 *
 * §2.2 says a 4xx marks an entry failed, and it is right about every 4xx that
 * describes the *body*. These describe the session instead: a shared tablet
 * that re-locked, an expired cookie, a revoked phone. The body is still
 * perfectly good and the person just has to log back in, so these leave the
 * entry queued and stop the run — the alternative is a waiter losing four
 * rounds because the tablet locked in his apron.
 */
const AUTH_CODES = new Set([
  'NO_SESSION', 'SESSION_REVOKED', 'DEVICE_MISMATCH', 'DEVICE_REVOKED', 'NO_DEVICE',
])

function nowIso(): string {
  return new Date().toISOString()
}

/** IndexedDB exists in a browser and nowhere else — a server render has none. */
function canPersist(): boolean {
  return typeof indexedDB !== 'undefined'
}

/**
 * A plain, cloneable copy of whatever Vue handed us.
 *
 * IndexedDB does not store JavaScript objects, it stores a *structured clone* of
 * them — and the structured clone algorithm refuses a Proxy, which is exactly
 * what every object inside a Vue `ref` is. Writing `entries.value` straight to
 * `idb-keyval` therefore throws `DataCloneError`, and because the write is in a
 * try/catch that failure is silent: the queue looks fine until the phone is
 * reloaded and it turns out nothing was ever saved. (That is not a story; it is
 * what the first offline run of `tests/e2e/wp0-offline.spec.ts` found.)
 *
 * Every entry is a body that is about to be JSON in an HTTP request, so a round
 * trip through JSON is both safe and the cheapest way to get a plain object.
 */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export const useOutboxStore = defineStore('outbox', () => {
  const entries = ref<OutboxEntry[]>([])
  /** Has the queue been read back off the disk yet? */
  const hydrated = ref(false)
  /** Did the last attempt reach the server at all? What paints the chip red. */
  const online = ref(true)
  /** Bumped after every flush that sent something — the heartbeat watches it. */
  const flushedAt = ref(0)
  /** The last answer's replay flag, for the "Već poslano" toast. */
  const lastAlreadyApplied = ref(false)

  let transport: OutboxTransport | null = null
  let flushing = false
  let backoffMs = BACKOFF_MIN_MS
  let retryAt = 0

  // -- what the screens read -------------------------------------------------

  /** Money and stock waiting to go. What the heartbeat reports as `pending`. */
  const pending = computed(() => entries.value.length)
  const failed = computed(() => entries.value.filter(e => e.status === 'failed'))
  const queued = computed(() => entries.value.filter(e => e.status === 'queued'))

  const oldestPendingAt = computed<string | null>(() => (
    entries.value.reduce<string | null>(
      (oldest, e) => (oldest === null || e.client_created_at < oldest ? e.client_created_at : oldest),
      null,
    )
  ))

  /** Something has been waiting longer than five minutes (§2.3's banner). */
  const hasStale = computed(() => {
    const oldest = oldestPendingAt.value
    return oldest !== null && Date.now() - Date.parse(oldest) > STALE_MS
  })

  /** Is this table's money still on the phone? Keeps the table yellow. */
  function pendingForTab(tabClientId: string | null | undefined): OutboxEntry[] {
    if (!tabClientId) return []
    return entries.value.filter(e => e.tab_client_id === tabClientId)
  }

  // -- the disk --------------------------------------------------------------

  async function persist(): Promise<void> {
    if (!canPersist()) return
    try {
      if (entries.value.length === 0) await idbDel(STORAGE_KEY)
      else await idbSet(STORAGE_KEY, plain(entries.value))
    } catch {
      // A phone in private mode, or storage full. The queue still works for
      // this session; losing it on reload is bad but not worth a crash here.
    }
  }

  /** Read the queue back after a reload. Safe to call more than once. */
  async function hydrate(): Promise<void> {
    if (hydrated.value) return
    hydrated.value = true
    if (!canPersist()) return
    try {
      const stored = await idbGet<OutboxEntry[]>(STORAGE_KEY)
      if (Array.isArray(stored) && stored.length > 0) {
        // Anything already on the queue wins over an empty in-memory list; a
        // second tab of the same app must not wipe what the first one holds.
        const known = new Set(entries.value.map(e => e.client_id))
        entries.value = [...stored.filter(e => !known.has(e.client_id)), ...entries.value]
      }
    } catch {
      // Unreadable storage is an empty queue, not a broken app.
    }
  }

  // -- the queue -------------------------------------------------------------

  function configure(next: OutboxTransport): void {
    transport = next
  }

  /**
   * Put a body on the queue and return at once. The caller has its answer the
   * moment this resolves — that is the whole point: a waiter's thumb never
   * waits for a router.
   */
  async function enqueue(input: EnqueueInput): Promise<OutboxEntry> {
    const existing = entries.value.find(e => e.client_id === input.client_id)
    if (existing) return existing

    const entry: OutboxEntry = {
      client_id: input.client_id,
      kind: input.kind,
      payload: input.payload,
      client_created_at: input.client_created_at ?? nowIso(),
      attempts: 0,
      last_error: null,
      status: 'queued',
      ...(input.tab_client_id ? { tab_client_id: input.tab_client_id } : {}),
      ...(input.label ? { label: input.label } : {}),
      ...(input.amount_fen !== undefined ? { amount_fen: input.amount_fen } : {}),
    }
    entries.value = [...entries.value, entry]
    await persist()
    return entry
  }

  function remove(clientId: string): void {
    entries.value = entries.value.filter(e => e.client_id !== clientId)
  }

  /** *Odbaci* on a failed card: the entry goes and nothing is written. */
  async function discard(clientId: string): Promise<void> {
    remove(clientId)
    await persist()
  }

  /** *Popravi* — put a failed entry back in the queue and try it again. */
  async function retry(clientId: string): Promise<void> {
    const entry = entries.value.find(e => e.client_id === clientId)
    if (!entry) return
    entry.status = 'queued'
    entry.last_error = null
    resetBackoff()
    await persist()
    await flush()
  }

  function resetBackoff(): void {
    backoffMs = BACKOFF_MIN_MS
    retryAt = 0
  }

  /** After a network failure, wait before hammering a router that is not there. */
  function scheduleBackoff(): void {
    retryAt = Date.now() + backoffMs
    backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS)
  }

  // -- the flush -------------------------------------------------------------

  /**
   * Send what is queued, oldest first, one request at a time.
   *
   * Sequential and deliberately so: the payment for Sto 7 names a tab that the
   * round in front of it creates on the server. `Promise.all` would race them
   * and lose that race about as often as a café loses its wifi.
   */
  async function flush(): Promise<void> {
    if (flushing || !transport) return
    if (entries.value.length === 0) return
    if (retryAt > Date.now()) return

    flushing = true
    let sent = 0
    /** Tabs held up by a 4xx in front of them. Other tabs keep flushing. */
    const blocked = new Set<string>()

    try {
      for (const entry of [...entries.value]) {
        if (entry.status === 'failed') {
          if (entry.tab_client_id) blocked.add(entry.tab_client_id)
          continue
        }
        if (entry.tab_client_id && blocked.has(entry.tab_client_id)) continue

        try {
          const result = await transport.send(entry.kind, entry.payload)
          // Any 2xx removes the entry. `already_applied` is a replay the server
          // recognised — the same success, and only the toast differs.
          lastAlreadyApplied.value = result?.already_applied === true
          remove(entry.client_id)
          sent += 1
          online.value = true
          resetBackoff()
        } catch (err) {
          const e = err as { status?: number, code?: string }
          const status = e?.status ?? 0

          if (e?.code && AUTH_CODES.has(e.code)) {
            // Not this entry's fault. Leave it queued and stop: whoever is
            // holding the phone has to log back in first.
            entry.last_error = transport.errorText(err)
            break
          }

          // Belt and braces: the server answers a replay 200, never 409, but an
          // older build might. Either way the row exists — drop the entry.
          if (status === 409 && e?.code === 'ALREADY_APPLIED') {
            remove(entry.client_id)
            sent += 1
            online.value = true
            continue
          }

          if (status >= 400 && status < 500) {
            // The server read the body and refused it. Retrying changes
            // nothing, so it waits for a human: *Popravi ili odbaci*.
            entry.status = 'failed'
            entry.last_error = transport.errorText(err)
            entry.attempts += 1
            if (entry.tab_client_id) blocked.add(entry.tab_client_id)
            online.value = true
            continue
          }

          // A 5xx, a timeout or no network at all: still ours to send. A
          // timeout is a network error, not a failure — the request may even
          // have landed, and the replay key is what makes that harmless.
          entry.attempts += 1
          entry.last_error = transport.errorText(err)
          online.value = false
          scheduleBackoff()
          break
        }
      }
    } finally {
      flushing = false
      await persist()
      if (sent > 0) flushedAt.value = Date.now()
    }
  }

  /** The network came back, or the screen did. Try again straight away. */
  async function flushNow(): Promise<void> {
    resetBackoff()
    await flush()
  }

  /** Only for the *Odjavi se* path and for tests: the queue must be empty first. */
  async function clear(): Promise<void> {
    entries.value = []
    resetBackoff()
    await persist()
  }

  return {
    entries,
    hydrated,
    online,
    flushedAt,
    lastAlreadyApplied,
    pending,
    queued,
    failed,
    oldestPendingAt,
    hasStale,
    pendingForTab,
    configure,
    hydrate,
    enqueue,
    discard,
    retry,
    flush,
    flushNow,
    clear,
  }
})
