/**
 * The outbox, on a table rather than in a café.
 *
 * These run in plain Node with no browser: the store takes its transport as an
 * argument and falls back to holding the queue in memory when there is no
 * IndexedDB, which is exactly what makes the flush rules testable at all. What
 * is checked here is every promise `docs/PHASE3.md` §2.2 makes:
 *
 *   - oldest first, one request at a time, never in parallel
 *   - any 2xx removes the entry; `already_applied` is the same success
 *   - a 5xx / timeout / no network leaves it queued and backs off
 *   - a 4xx marks it failed and blocks its own tab — and nobody else's
 *   - *Odbaci* removes it and writes nothing; *Popravi* puts it back
 *   - a session error never burns a round
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useOutboxStore, type OutboxKind } from '../../app/stores/outbox'

/** The shape `useApi` throws, reduced to what the store actually reads. */
class FakeApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code)
  }
}

interface Attempt { kind: OutboxKind, payload: unknown }

/**
 * A transport that records what it was asked to send and answers from a script.
 * `scripted` maps a client_id to what should happen the *next* time it is sent.
 */
function fakeTransport() {
  const sent: Attempt[] = []
  const answers = new Map<string, (Error | { already_applied?: boolean })[]>()
  /** How many requests are in flight right now. Must never exceed one. */
  let concurrent = 0
  let maxConcurrent = 0

  const transport = {
    send: async (kind: OutboxKind, payload: unknown) => {
      concurrent += 1
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      try {
        // A real POST is not instant; the await is what would let a parallel
        // flush interleave, which is precisely what `maxConcurrent` catches.
        await Promise.resolve()
        sent.push({ kind, payload })
        const id = (payload as { client_id: string }).client_id
        const queue = answers.get(id)
        const next = queue?.shift()
        if (next instanceof Error) throw next
        return next ?? {}
      } finally {
        concurrent -= 1
      }
    },
    errorText: (err: unknown) => (err as Error)?.message ?? 'greška',
  }

  return {
    transport,
    sent,
    get maxConcurrent() { return maxConcurrent },
    /** Queue up answers for one client_id, in order. */
    answer(id: string, ...results: (Error | { already_applied?: boolean })[]) {
      answers.set(id, results)
    },
  }
}

function body(clientId: string, extra: Record<string, unknown> = {}) {
  return { client_id: clientId, ...extra }
}

describe('the outbox', () => {
  let fake: ReturnType<typeof fakeTransport>

  beforeEach(() => {
    setActivePinia(createPinia())
    fake = fakeTransport()
    vi.useRealTimers()
  })

  function store() {
    const outbox = useOutboxStore()
    outbox.configure(fake.transport)
    return outbox
  }

  it('hands the caller its answer without waiting for a network', async () => {
    const outbox = store()
    // No transport answer is scripted and nothing is flushed: enqueue alone has
    // to be enough for the screen to say "Sačuvano".
    const entry = await outbox.enqueue({ kind: 'order', client_id: 'a', payload: body('a') })
    expect(entry.status).toBe('queued')
    expect(outbox.pending).toBe(1)
    expect(fake.sent).toHaveLength(0)
  })

  it('refuses to queue the same client_id twice', async () => {
    const outbox = store()
    await outbox.enqueue({ kind: 'order', client_id: 'a', payload: body('a') })
    await outbox.enqueue({ kind: 'order', client_id: 'a', payload: body('a') })
    expect(outbox.pending).toBe(1)
  })

  it('sends oldest first, one at a time, and empties the queue', async () => {
    const outbox = store()
    await outbox.enqueue({ kind: 'order', client_id: 'r1', payload: body('r1'), tab_client_id: 't1' })
    await outbox.enqueue({ kind: 'order', client_id: 'r2', payload: body('r2'), tab_client_id: 't1' })
    await outbox.enqueue({ kind: 'pay', client_id: 'p1', payload: body('p1'), tab_client_id: 't1' })

    await outbox.flush()

    // The payment must not overtake the rounds it pays for.
    expect(fake.sent.map(a => (a.payload as { client_id: string }).client_id))
      .toEqual(['r1', 'r2', 'p1'])
    expect(fake.maxConcurrent).toBe(1)
    expect(outbox.pending).toBe(0)
  })

  it('treats a replay as the same success and only changes the toast', async () => {
    const outbox = store()
    fake.answer('r1', { already_applied: true })
    await outbox.enqueue({ kind: 'order', client_id: 'r1', payload: body('r1') })
    await outbox.flush()

    expect(outbox.pending).toBe(0)
    expect(outbox.lastAlreadyApplied).toBe(true)
  })

  it('keeps an entry queued after a 5xx and counts the attempt', async () => {
    const outbox = store()
    fake.answer('r1', new FakeApiError(503, 'UNKNOWN'))
    await outbox.enqueue({ kind: 'order', client_id: 'r1', payload: body('r1') })
    await outbox.flush()

    expect(outbox.pending).toBe(1)
    expect(outbox.entries[0]!.status).toBe('queued')
    expect(outbox.entries[0]!.attempts).toBe(1)
    expect(outbox.online).toBe(false)
  })

  it('treats a timeout as a network error, not as a failure', async () => {
    const outbox = store()
    // `AbortSignal.timeout` rejects with no HTTP status at all — status 0, the
    // same shape `useApi` gives a request that never reached a server.
    fake.answer('r1', new FakeApiError(0, 'NETWORK'))
    await outbox.enqueue({ kind: 'order', client_id: 'r1', payload: body('r1') })
    await outbox.flush()

    expect(outbox.entries[0]!.status).toBe('queued')
    expect(outbox.online).toBe(false)
  })

  it('stops the run at the first network failure rather than hammering', async () => {
    const outbox = store()
    fake.answer('r1', new FakeApiError(0, 'NETWORK'))
    await outbox.enqueue({ kind: 'order', client_id: 'r1', payload: body('r1') })
    await outbox.enqueue({ kind: 'order', client_id: 'r2', payload: body('r2') })
    await outbox.flush()

    expect(fake.sent).toHaveLength(1)
    expect(outbox.pending).toBe(2)
  })

  it('backs off after a network failure and `flushNow` overrides it', async () => {
    const outbox = store()
    fake.answer('r1', new FakeApiError(0, 'NETWORK'))
    await outbox.enqueue({ kind: 'order', client_id: 'r1', payload: body('r1') })
    await outbox.flush()
    expect(fake.sent).toHaveLength(1)

    // Inside the back-off window an ordinary flush does nothing at all.
    await outbox.flush()
    expect(fake.sent).toHaveLength(1)

    // `online`, `visibilitychange` and a success all go through `flushNow`.
    await outbox.flushNow()
    expect(fake.sent).toHaveLength(2)
    expect(outbox.pending).toBe(0)
  })

  it('marks a 4xx failed and blocks its own tab but not another', async () => {
    const outbox = store()
    fake.answer('r1', new FakeApiError(422, 'TAB_ALREADY_PAID'))
    await outbox.enqueue({ kind: 'order', client_id: 'r1', payload: body('r1'), tab_client_id: 't1' })
    await outbox.enqueue({ kind: 'pay', client_id: 'p1', payload: body('p1'), tab_client_id: 't1' })
    // A different table, and it must keep flushing.
    await outbox.enqueue({ kind: 'order', client_id: 'r9', payload: body('r9'), tab_client_id: 't9' })

    await outbox.flush()

    expect(outbox.entries.find(e => e.client_id === 'r1')?.status).toBe('failed')
    // The payment behind it never left.
    expect(fake.sent.map(a => (a.payload as { client_id: string }).client_id)).toEqual(['r1', 'r9'])
    expect(outbox.entries.map(e => e.client_id)).toEqual(['r1', 'p1'])
    // The network is fine — the server answered. The chip must not go red.
    expect(outbox.online).toBe(true)
  })

  it('keeps the block on later flushes until the waiter answers', async () => {
    const outbox = store()
    fake.answer('r1', new FakeApiError(400, 'BAD_REQUEST'))
    await outbox.enqueue({ kind: 'order', client_id: 'r1', payload: body('r1'), tab_client_id: 't1' })
    await outbox.enqueue({ kind: 'pay', client_id: 'p1', payload: body('p1'), tab_client_id: 't1' })
    await outbox.flush()
    await outbox.flush()

    expect(fake.sent).toHaveLength(1)
    expect(outbox.failed).toHaveLength(1)
  })

  it('*Odbaci* removes the failed entry and releases the tab behind it', async () => {
    const outbox = store()
    fake.answer('r1', new FakeApiError(409, 'TAB_CLOSED'))
    await outbox.enqueue({ kind: 'order', client_id: 'r1', payload: body('r1'), tab_client_id: 't1' })
    await outbox.enqueue({ kind: 'pay', client_id: 'p1', payload: body('p1'), tab_client_id: 't1' })
    await outbox.flush()
    expect(outbox.failed).toHaveLength(1)

    await outbox.discard('r1')
    await outbox.flush()

    expect(outbox.pending).toBe(0)
    expect(fake.sent.map(a => (a.payload as { client_id: string }).client_id)).toEqual(['r1', 'p1'])
  })

  it('*Popravi* puts a failed entry back on the queue', async () => {
    const outbox = store()
    fake.answer('r1', new FakeApiError(400, 'BAD_REQUEST'))
    await outbox.enqueue({ kind: 'order', client_id: 'r1', payload: body('r1') })
    await outbox.flush()
    expect(outbox.failed).toHaveLength(1)

    // The second attempt has no scripted error, so it succeeds.
    await outbox.retry('r1')
    expect(outbox.pending).toBe(0)
  })

  it('never burns a round on an expired session', async () => {
    const outbox = store()
    fake.answer('r1', new FakeApiError(401, 'NO_SESSION'))
    await outbox.enqueue({ kind: 'order', client_id: 'r1', payload: body('r1') })
    await outbox.enqueue({ kind: 'order', client_id: 'r2', payload: body('r2') })
    await outbox.flush()

    // Queued, not failed: the body is perfectly good, somebody just has to log
    // back in. And the run stopped rather than throwing the rest at a 401.
    expect(outbox.entries[0]!.status).toBe('queued')
    expect(outbox.pending).toBe(2)
    expect(fake.sent).toHaveLength(1)
  })

  it('drops an entry on a 409 ALREADY_APPLIED, belt and braces', async () => {
    const outbox = store()
    fake.answer('r1', new FakeApiError(409, 'ALREADY_APPLIED'))
    await outbox.enqueue({ kind: 'order', client_id: 'r1', payload: body('r1') })
    await outbox.flush()
    expect(outbox.pending).toBe(0)
  })

  it('reports the oldest entry, and goes stale after five minutes', async () => {
    const outbox = store()
    const old = new Date(Date.now() - 6 * 60_000).toISOString()
    const fresh = new Date().toISOString()
    await outbox.enqueue({ kind: 'order', client_id: 'new', payload: body('new'), client_created_at: fresh })
    await outbox.enqueue({ kind: 'order', client_id: 'old', payload: body('old'), client_created_at: old })

    expect(outbox.oldestPendingAt).toBe(old)
    expect(outbox.hasStale).toBe(true)
  })

  it('is not stale while everything is a minute old', async () => {
    const outbox = store()
    await outbox.enqueue({ kind: 'order', client_id: 'a', payload: body('a') })
    expect(outbox.hasStale).toBe(false)
  })

  it('names what a table is still waiting on', async () => {
    const outbox = store()
    await outbox.enqueue({ kind: 'order', client_id: 'r1', payload: body('r1'), tab_client_id: 't1' })
    await outbox.enqueue({ kind: 'pay', client_id: 'p1', payload: body('p1'), tab_client_id: 't1' })
    await outbox.enqueue({ kind: 'order', client_id: 'r9', payload: body('r9'), tab_client_id: 't9' })

    expect(outbox.pendingForTab('t1').map(e => e.kind)).toEqual(['order', 'pay'])
    expect(outbox.pendingForTab('t9')).toHaveLength(1)
    expect(outbox.pendingForTab(null)).toHaveLength(0)
  })

  it('marks a flush that sent something, so the heartbeat can follow it', async () => {
    const outbox = store()
    expect(outbox.flushedAt).toBe(0)
    await outbox.enqueue({ kind: 'order', client_id: 'r1', payload: body('r1') })
    await outbox.flush()
    expect(outbox.flushedAt).toBeGreaterThan(0)
  })

  it('posts the body it was handed, unchanged, however late', async () => {
    const outbox = store()
    const payload = body('r1', { table_id: 'sto-7', lines: [{ id: 'l1', product_id: 'p', qty: 2 }] })
    await outbox.enqueue({ kind: 'order', client_id: 'r1', payload })
    await outbox.flush()
    expect(fake.sent[0]).toEqual({ kind: 'order', payload })
  })
})

describe('the sync chip and its sentences', () => {
  it('counts unsent rounds in Bosnian', async () => {
    const { neposlaneText } = await import('../../app/composables/useSync')
    expect(neposlaneText(1)).toBe('1 neposlanu narudžbu')
    expect(neposlaneText(2)).toBe('2 neposlane narudžbe')
    expect(neposlaneText(4)).toBe('4 neposlane narudžbe')
    expect(neposlaneText(5)).toBe('5 neposlanih narudžbi')
    expect(neposlaneText(11)).toBe('11 neposlanih narudžbi')
    expect(neposlaneText(21)).toBe('21 neposlanu narudžbu')
  })
})
