/**
 * *Razgovor*, wired up — the store, the transport it posts through, and the
 * three moments it reads.
 *
 * **There is still one timer, and it is not here** (PHASE4 §2.11). The 15 s
 * `GET /api/changes` carries `chat.total_unread` and the per-channel counts, so
 * the badge moves without this file asking anything. `GET /api/chat/since` is
 * called on mount, after every own send, and when the screen comes back — three
 * events, no interval. A second poll for chat would be a second clock on the
 * same café wifi for a feature nobody stares at.
 *
 * `/k` and `/a` differ only in which api object fills the transport: the waiter
 * app's `useApi()` sets its timeouts for a phone in an apron, and the
 * dashboard's `useAdminApi()` is a laptop's. The screens differ far more, which
 * is why the light kit re-implements them rather than re-skinning the dark ones.
 */
import { useChatStore, type ChatTransport } from '~/stores/chat'
import { useOutboxStore } from '~/stores/outbox'
import type { ChannelKind } from '#shared/chat'
import type { SetPinBody } from '#shared/schemas'

export interface UseChatOptions {
  /** `/a` posts through `useAdminApi()` and has no money outbox to follow. */
  admin?: boolean
}

export function useChat(options: UseChatOptions = {}) {
  const chat = useChatStore()
  const api = options.admin ? useAdminApi() : useApi()

  const transport: ChatTransport = {
    since: cursor => api.getChatSince(cursor),
    history: (channel, beforeSeq, limit) => api.getChatHistory(channel, beforeSeq, limit),
    post: (channel, body) => api.postChatMessage(channel, body),
    upload: blob => api.uploadImage(blob, 'chat'),
    read: (channel, seq) => api.markChatRead(channel, seq),
    errorText: err => apiErrorText(err, 'Poruka nije poslana'),
  }
  chat.configure(transport)

  /** Did the last read reach the server? What paints "Nema veze" on the thread. */
  const online = ref(true)

  async function refresh(): Promise<void> {
    try {
      if (chat.loaded) await chat.catchUp()
      else await chat.bootstrap()
      online.value = true
    } catch {
      online.value = false
    }
  }

  async function start(): Promise<void> {
    await chat.hydrate()
    await refresh()
    // Whatever the last session left queued goes out now, before anybody types.
    await chat.flush()
  }

  onMounted(() => {
    void start()

    // Coming back to the screen, and coming back to a network, are the two
    // moments a thread is most likely to be wrong. Neither is a timer.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void chat.flush()
        void refresh()
      }
    }
    const onOnline = () => {
      void chat.flush()
      void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)

    onUnmounted(() => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    })
  })

  // **After every money flush, too.** The router that just took a round is the
  // router that can take the photo behind it — and the money went first, which
  // is the order this app always uses.
  if (!options.admin) {
    const outbox = useOutboxStore()
    watch(() => outbox.flushedAt, (at) => {
      if (at > 0) void chat.flush()
    })
  }

  /**
   * The three writes that are not a send: the pinned note, a removal and a
   * forward. They go straight to the server rather than through the pending
   * list — none of them is worth queueing on dead wifi, and all three are a
   * button the person is looking at.
   */
  const actions = {
    pin: (channel: ChannelKind, body: SetPinBody) => api.setChatPin(channel, body),
    remove: (id: string) => api.deleteChatMessage(id),
    forward: (id: string, to: ChannelKind) => api.forwardChatMessage(id, to),
  }

  /** *Nova poruka ↓* and the badge both need "what is the newest seq here". */
  function lastSeq(kind: ChannelKind): number {
    const list = chat.thread(kind)
    return list.length > 0 ? list[list.length - 1]!.seq : 0
  }

  return { chat, api, actions, online, refresh, lastSeq }
}
