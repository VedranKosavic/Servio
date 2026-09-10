/**
 * *Razgovor* — the thread this phone holds, and the messages it still owes the
 * server.
 *
 * It looks like `stores/outbox.ts` and is deliberately **not** it (PHASE4 §1):
 *
 * **Chat never enters the money outbox.** An unsent "nema leda" is not money. It
 * is never counted in `outbox_len`, never in the heartbeat's `pending`, never in
 * the sync chip, and never in the gate that stops a logout or a settlement — a
 * stuck message must not stand between a waiter and a cash handover. So the
 * pending list lives here, under its own IndexedDB key, and nothing outside this
 * file counts it.
 *
 * **A 4xx drops the entry.** The money outbox parks a refused round on a
 * *Popravi ili odbaci* card because somebody has to decide what happened to the
 * cash. A refused message has no such consequence: it says "Poruka nije poslana"
 * and goes. So does anything older than 24 hours — yesterday's "dolazim za 5"
 * is not worth sending this morning.
 *
 * **Photos are downscaled before they are queued.** `app/utils/image.ts` turns
 * a 4 MB camera file into ~150 KB *first*, and the Blob is what IndexedDB
 * stores. Five is the ceiling: the file input's `capture` writes a temporary
 * file iOS never puts in Photos, so a photo taken on dead wifi exists nowhere
 * else and losing it loses it for good — but a phone holding a hundred of them
 * is a phone with no storage left.
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval'
import type { ChannelKind } from '#shared/chat'
import type {
  ChatChannelView, ChatMessage, ChatPage, ChatSince, PostMessageResult, UploadResult,
} from '#shared/types'

/** One message this phone has written and the server has not confirmed. */
export interface PendingChat {
  /** The idempotency key. A replay answers 200 with the stored row, never 409. */
  client_id: string
  channel: ChannelKind
  kind: 'text' | 'image'
  /** The text, or an image's caption. */
  body?: string
  /** Already downscaled to ~150 KB. IndexedDB stores a Blob as a Blob. */
  blob?: Blob
  /** For the placeholder, so the list does not jump when the photo lands. */
  width?: number
  height?: number
  /** The phone's own clock — when it happened in the world. */
  client_created_at: string
  attempts: number
}

/** What the store needs from the outside world. `/k` and `/a` pass different ones. */
export interface ChatTransport {
  since: (cursor?: number) => Promise<ChatSince>
  history: (channel: ChannelKind, beforeSeq?: number, limit?: number) => Promise<ChatPage>
  post: (channel: ChannelKind, body: {
    client_id: string
    kind: 'text' | 'image'
    body?: string
    upload_id?: string
    reply_to_id?: string
    money_ack?: boolean
    client_created_at?: string
  }) => Promise<PostMessageResult>
  upload: (blob: Blob) => Promise<UploadResult>
  read: (channel: ChannelKind, seq: number) => Promise<unknown>
  /** The Bosnian sentence for a failure. */
  errorText: (err: unknown) => string
}

const PENDING_KEY = 'chat:pending'
const LAST_CHANNEL_KEY = 'chat:last-channel'
const DRAFT_KEY = 'chat_draft'

/** At most five photos may wait for a network at once. */
export const MAX_PENDING_IMAGES = 5
/** A message nobody sent within a day is not sent at all. */
const MAX_AGE_MS = 24 * 60 * 60_000

export const PENDING_FULL =
  'Sačuvaj sliku u galeriju, pošalji kad bude veze'

function nowIso(): string {
  return new Date().toISOString()
}

function canPersist(): boolean {
  return typeof indexedDB !== 'undefined'
}

/**
 * A plain, cloneable copy of one entry.
 *
 * IndexedDB stores a *structured clone*, and the clone algorithm refuses a
 * Proxy — which is what every object inside a Vue `ref` is. The outbox solves
 * this with `JSON.parse(JSON.stringify(…))`; here that would silently throw the
 * photo away, because a Blob does not survive JSON. So the fields are copied by
 * hand and the Blob is carried across untouched (Vue does not proxy a Blob).
 */
function plainEntry(entry: PendingChat): PendingChat {
  return {
    client_id: entry.client_id,
    channel: entry.channel,
    kind: entry.kind,
    ...(entry.body === undefined ? {} : { body: entry.body }),
    ...(entry.blob === undefined ? {} : { blob: entry.blob }),
    ...(entry.width === undefined ? {} : { width: entry.width }),
    ...(entry.height === undefined ? {} : { height: entry.height }),
    client_created_at: entry.client_created_at,
    attempts: entry.attempts,
  }
}

export const useChatStore = defineStore('chat', () => {
  /** Every channel this role may open, as the server described it. */
  const channels = ref<ChatChannelView[]>([])
  /** The thread per channel, oldest first, deduped by id. */
  const threads = ref<Record<string, ChatMessage[]>>({})
  /** Is there older history behind the top of a thread? */
  const olderAvailable = ref<Record<string, boolean>>({})
  /** The `since` cursor. Only ever goes forward. */
  const cursor = ref(0)
  /** `chat_muted_until` for whoever is holding the phone. */
  const mutedUntil = ref<string | null>(null)
  /** Has a bootstrap ever landed? What tells an empty list from an unread one. */
  const loaded = ref(false)
  /** The last failure, as one Bosnian sentence — the screen shows it and clears it. */
  const toast = ref<string | null>(null)

  const pending = ref<PendingChat[]>([])
  const hydrated = ref(false)

  let transport: ChatTransport | null = null
  let flushing = false
  /**
   * Something was queued while a flush was already running.
   *
   * Without this the second entry waits for the *next* trigger — an `online`
   * event, a tab switch — which on a working network never comes, and a photo
   * queued a tenth of a second after a message sits there saying "čeka slanje"
   * with nothing wrong. So a run that was asked again runs again.
   */
  let again = false
  /** The two fields that are not worth persisting: a retry without them is fine. */
  const extras = new Map<string, { money_ack?: boolean, reply_to_id?: string }>()

  const pendingImages = computed(() => pending.value.filter(e => e.kind === 'image').length)

  function pendingFor(channel: ChannelKind): PendingChat[] {
    return pending.value.filter(e => e.channel === channel)
  }

  function channel(kind: ChannelKind): ChatChannelView | undefined {
    return channels.value.find(c => c.kind === kind)
  }

  function thread(kind: ChannelKind): ChatMessage[] {
    return threads.value[kind] ?? []
  }

  const totalUnread = computed(() => channels.value.reduce((n, c) => n + c.unread, 0))

  // -- the disk -------------------------------------------------------------

  async function persist(): Promise<void> {
    if (!canPersist()) return
    try {
      if (pending.value.length === 0) await idbDel(PENDING_KEY)
      else await idbSet(PENDING_KEY, pending.value.map(plainEntry))
    } catch {
      // Private mode, or storage full. The queue still works for this session.
    }
  }

  async function hydrate(): Promise<void> {
    if (hydrated.value) return
    hydrated.value = true
    if (!canPersist()) return
    try {
      const stored = await idbGet<PendingChat[]>(PENDING_KEY)
      if (Array.isArray(stored) && stored.length > 0) {
        const known = new Set(pending.value.map(e => e.client_id))
        pending.value = [...stored.filter(e => !known.has(e.client_id)), ...pending.value]
      }
    } catch {
      // Unreadable storage is an empty queue, not a broken screen.
    }
  }

  /** The draft survives a reload — a half-typed line is worth keeping. */
  async function loadDraft(kind: ChannelKind): Promise<string> {
    if (!canPersist()) return ''
    try {
      return (await idbGet<string>(`${DRAFT_KEY}:${kind}`)) ?? ''
    } catch {
      return ''
    }
  }

  async function saveDraft(kind: ChannelKind, text: string): Promise<void> {
    if (!canPersist()) return
    try {
      if (text.trim().length === 0) await idbDel(`${DRAFT_KEY}:${kind}`)
      else await idbSet(`${DRAFT_KEY}:${kind}`, text)
    } catch {
      // Losing a draft is a small loss; a crash here would be a bigger one.
    }
  }

  /** Which channel this phone was last reading — S15 is usually skipped. */
  async function lastChannel(): Promise<ChannelKind | null> {
    if (!canPersist()) return null
    try {
      return (await idbGet<ChannelKind>(LAST_CHANNEL_KEY)) ?? null
    } catch {
      return null
    }
  }

  async function rememberChannel(kind: ChannelKind): Promise<void> {
    if (!canPersist()) return
    try {
      await idbSet(LAST_CHANNEL_KEY, kind)
    } catch {
      // Then S15 opens instead. No harm done.
    }
  }

  // -- merging what the server said ------------------------------------------

  function merge(messages: ChatMessage[]): void {
    if (messages.length === 0) return
    const next = { ...threads.value }
    for (const message of messages) {
      const list = next[message.channel] ?? []
      const at = list.findIndex(m => m.id === message.id)
      // A message already on screen may have been deleted since; replace it.
      next[message.channel] = at === -1
        ? [...list, message].sort((a, b) => a.seq - b.seq)
        : list.map((m, i) => (i === at ? message : m))
    }
    threads.value = next

    // A confirmed row retires its pending twin: the bubble stops showing a clock
    // and starts showing a time, and the photo is never sent twice.
    const confirmed = new Set(messages.map(m => m.client_id))
    if (pending.value.some(e => confirmed.has(e.client_id))) {
      pending.value = pending.value.filter(e => !confirmed.has(e.client_id))
      void persist()
    }
  }

  function applySince(result: ChatSince): void {
    channels.value = result.channels
    mutedUntil.value = result.muted_until ?? null

    if (result.reset) {
      // More than a thousand behind. Painting a partial thread over a stale one
      // is worse than starting again, and starting again is one request.
      threads.value = {}
      olderAvailable.value = {}
      cursor.value = 0
      loaded.value = false
      return
    }

    merge(result.messages)
    if (result.cursor > cursor.value) cursor.value = result.cursor
    loaded.value = true
  }

  function applyHistory(kind: ChannelKind, page: ChatPage): void {
    merge(page.messages)
    olderAvailable.value = { ...olderAvailable.value, [kind]: page.has_more }
  }

  // -- the wire --------------------------------------------------------------

  function configure(next: ChatTransport): void {
    transport = next
  }

  /**
   * Read the room. `bootstrap()` on mount and after a `reset`; `catchUp()` after
   * an own send and on `visibilitychange`.
   *
   * There is no timer here on purpose (PHASE4 §2.11): the 15 s `/api/changes`
   * carries the badge counts, and that is the whole of "one poll".
   */
  async function bootstrap(): Promise<void> {
    if (!transport) return
    applySince(await transport.since())
  }

  async function catchUp(): Promise<void> {
    if (!transport) return
    const result = await transport.since(cursor.value || undefined)
    applySince(result)
    if (result.reset) await bootstrap()
  }

  async function loadOlder(kind: ChannelKind): Promise<void> {
    if (!transport) return
    const oldest = thread(kind)[0]?.seq
    applyHistory(kind, await transport.history(kind, oldest))
  }

  // -- the pending list ------------------------------------------------------

  /**
   * Queue one message and return at once. The bubble is on screen before the
   * request leaves — that is the point.
   */
  async function enqueue(input: {
    channel: ChannelKind
    kind: 'text' | 'image'
    body?: string
    blob?: Blob
    width?: number
    height?: number
    money_ack?: boolean
    reply_to_id?: string
  }): Promise<PendingChat | null> {
    if (input.kind === 'image' && pendingImages.value >= MAX_PENDING_IMAGES) {
      toast.value = PENDING_FULL
      return null
    }

    const entry: PendingChat = {
      client_id: crypto.randomUUID(),
      channel: input.channel,
      kind: input.kind,
      ...(input.body ? { body: input.body } : {}),
      ...(input.blob ? { blob: input.blob } : {}),
      ...(input.width ? { width: input.width } : {}),
      ...(input.height ? { height: input.height } : {}),
      client_created_at: nowIso(),
      attempts: 0,
    }
    // `money_ack` and `reply_to_id` ride along on the entry so a queued message
    // still tells the server the sheet was shown, or what it was answering.
    const extra = {
      ...(input.money_ack ? { money_ack: true } : {}),
      ...(input.reply_to_id ? { reply_to_id: input.reply_to_id } : {}),
    }
    extras.set(entry.client_id, extra)

    pending.value = [...pending.value, entry]
    await persist()
    await flush()
    return entry
  }

  function drop(clientId: string): void {
    pending.value = pending.value.filter(e => e.client_id !== clientId)
    extras.delete(clientId)
  }

  /**
   * Send what is queued, oldest first, one at a time.
   *
   * An image is two requests — the photo, then the message that points at it —
   * and the second one is what makes the first visible. An upload that lands
   * whose message does not is an orphan, and the hourly collector unlinks it an
   * hour later; that is the designed outcome, not a leak.
   */
  async function flush(): Promise<void> {
    if (!transport || pending.value.length === 0) return
    if (flushing) { again = true; return }
    flushing = true
    let sent = 0

    try {
      for (const entry of [...pending.value]) {
        if (Date.now() - Date.parse(entry.client_created_at) > MAX_AGE_MS) {
          drop(entry.client_id)
          toast.value = 'Poruka nije poslana'
          continue
        }

        try {
          let uploadId: string | undefined
          if (entry.kind === 'image' && entry.blob) {
            uploadId = (await transport.upload(entry.blob)).id
          }
          const extra = extras.get(entry.client_id) ?? {}
          const result = await transport.post(entry.channel, {
            client_id: entry.client_id,
            kind: entry.kind,
            ...(entry.body ? { body: entry.body } : {}),
            ...(uploadId ? { upload_id: uploadId } : {}),
            ...extra,
            client_created_at: entry.client_created_at,
          })
          drop(entry.client_id)
          merge([result.message])
          if (result.cursor > cursor.value) cursor.value = result.cursor
          sent += 1
        } catch (err) {
          const status = (err as { status?: number }).status ?? 0
          if (status >= 400 && status < 500) {
            // The server read it and refused it. Chat is not money: it says so
            // and goes, rather than parking on a *Popravi ili odbaci* card.
            toast.value = transport.errorText(err)
            drop(entry.client_id)
            continue
          }
          // A 5xx, a timeout, or no network at all. Still ours to send.
          entry.attempts += 1
          break
        }
      }
    } finally {
      flushing = false
      await persist()
      if (sent > 0) await catchUp().catch(() => {})
    }

    if (again) {
      again = false
      await flush()
    }
  }

  // -- the badge -------------------------------------------------------------

  /**
   * `POST /api/chat/read`, debounced a second.
   *
   * Debounced because a thumb scrolling a thread crosses twenty messages, and
   * twenty writes of one integer is twenty ETag misses for this phone.
   */
  let readTimer: ReturnType<typeof setTimeout> | null = null

  function markRead(kind: ChannelKind, seq: number): void {
    if (!transport || seq <= 0) return
    if (readTimer) clearTimeout(readTimer)
    readTimer = setTimeout(() => {
      void transport!.read(kind, seq).then(() => {
        const at = channels.value.findIndex(c => c.kind === kind)
        if (at !== -1) {
          const next = [...channels.value]
          next[at] = { ...next[at]!, unread: 0 }
          channels.value = next
        }
      }).catch(() => {
        // A badge that did not clear is a badge that clears on the next poll.
      })
    }, 1000)
  }

  function clearToast(): void {
    toast.value = null
  }

  /** Only for *Odjavi se*: a new person on this tablet starts with a clean thread. */
  async function reset(): Promise<void> {
    channels.value = []
    threads.value = {}
    olderAvailable.value = {}
    cursor.value = 0
    loaded.value = false
    pending.value = []
    extras.clear()
    await persist()
  }

  return {
    channels,
    threads,
    olderAvailable,
    cursor,
    mutedUntil,
    loaded,
    toast,
    pending,
    hydrated,
    pendingImages,
    totalUnread,
    pendingFor,
    channel,
    thread,
    configure,
    hydrate,
    persist,
    loadDraft,
    saveDraft,
    lastChannel,
    rememberChannel,
    bootstrap,
    catchUp,
    loadOlder,
    merge,
    enqueue,
    flush,
    markRead,
    clearToast,
    reset,
  }
})
