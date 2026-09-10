<script setup lang="ts">
/**
 * **S16 *Kanal*** — one room: the pin bar, the thread, the composer.
 *
 * Four behaviours that are the whole difference between a chat that is usable in
 * an apron and one that is not:
 *
 * **Auto-scroll only if the view was already at the bottom.** Somebody reading
 * three screens up must not be yanked down by a colleague's "nema leda". When
 * he is not at the bottom and something arrives, a *Nova poruka ↓* pill appears
 * instead, and one tap takes him there.
 *
 * **The draft survives everything.** It is written to IndexedDB on every
 * keystroke (debounced), so leaving mid-sentence for S3 and coming back restores
 * the exact line — and so does a reload, and so does the memory-pressure kill
 * iOS does when the camera comes back.
 *
 * **The page scrolls, not a box inside it.** The header is `sticky top-0` and
 * the composer is `sticky bottom-0`, which means the browser's own scrolling and
 * the browser's own keyboard handling do the work. A fixed-height scroller
 * inside a phone viewport is where chat layouts go wrong.
 *
 * **Nothing here is a timer.** `useChat` reads on mount, after a send and when
 * the screen comes back; the badge rides the 15 s `/api/changes` every screen
 * already runs.
 */
import { useDebounceFn } from '@vueuse/core'
import { CHANNEL_NAMES, isChannelKind, looksLikeMoney, type ChannelKind } from '#shared/chat'
import { IMAGE_ERROR, CHAT_IMAGE, downscale } from '~/utils/image'
import type { ChatMessage } from '#shared/types'

const props = defineProps<{
  /** Where the back arrow lands: `/k/razgovor` or `/s/razgovor`. */
  backTo: string
}>()

const route = useRoute()
const me = useMe()
const { chat, actions, online, refresh } = useChat()

const kind = computed<ChannelKind>(() => {
  const raw = String(route.params.kind ?? 'svi')
  return isChannelKind(raw) ? raw : 'svi'
})

const channel = computed(() => chat.channel(kind.value))
const messages = computed(() => chat.thread(kind.value))
const waiting = computed(() => chat.pendingFor(kind.value))
const myId = computed(() => me.user.value?.id ?? '')
const myRole = computed(() => me.user.value?.role ?? 'waiter')
const deleteWindowS = computed(() => me.settings.value?.chat_delete_own_s ?? 900)

useHead({ title: computed(() => CHANNEL_NAMES[kind.value]) })

/** The mute sentence, in the composer's place. "Vlasnik te utišao do 10:00". */
const mutedText = computed(() => {
  const until = chat.mutedUntil
  if (!until || Date.parse(until) <= Date.now()) return null
  return `Vlasnik te utišao do ${localTimeOf(until)}`
})

function localTimeOf(iso: string): string {
  return new Intl.DateTimeFormat('bs-BA', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Sarajevo',
  }).format(new Date(iso))
}

// -- the draft --------------------------------------------------------------

const draft = ref('')
const saveDraft = useDebounceFn((text: string) => chat.saveDraft(kind.value, text), 400)
watch(draft, text => void saveDraft(text))

// -- scrolling --------------------------------------------------------------

const atBottom = ref(true)
const newBelow = ref(false)

function measure() {
  const gap = document.documentElement.scrollHeight - window.scrollY - window.innerHeight
  atBottom.value = gap < 80
  if (atBottom.value) newBelow.value = false
}

async function toBottom() {
  await nextTick()
  window.scrollTo({ top: document.documentElement.scrollHeight })
  newBelow.value = false
  atBottom.value = true
}

// The list grew. Follow it only if the reader was already at the end.
watch(() => messages.value.length, async (next, previous) => {
  if (next <= previous) return
  if (atBottom.value) await toBottom()
  else newBelow.value = true
})

// -- reading ----------------------------------------------------------------

/** The badge clears when the newest message is actually on screen. */
watch([() => messages.value.length, atBottom], () => {
  if (!atBottom.value) return
  const last = messages.value[messages.value.length - 1]
  if (last) chat.markRead(kind.value, last.seq)
}, { immediate: true })

onMounted(async () => {
  // The session is a cookie the server reads, so this is a request rather than
  // a lookup — and it is what makes `myId` real, which is what puts a person's
  // own bubbles on the right. It also arms the shared-tablet re-lock.
  void me.requireSession()
  window.addEventListener('scroll', measure, { passive: true })
  // The stored draft only fills an **empty** field. IndexedDB answers a tick or
  // two after the composer is already on screen and focusable, and a waiter who
  // started typing in that gap must not watch his first words disappear.
  const stored = await chat.loadDraft(kind.value)
  if (!draft.value) draft.value = stored
  await chat.rememberChannel(kind.value)
  await toBottom()
})

onUnmounted(() => window.removeEventListener('scroll', measure))

// -- sending ----------------------------------------------------------------

const sending = ref(false)
const moneyOpen = ref(false)
const replyTo = ref<ChatMessage | null>(null)
/** A photo waiting behind the money sheet, because its caption looked like money. */
const heldPhoto = ref<{ blob: Blob, width: number, height: number } | null>(null)
const error = ref<string | null>(null)

const canAdmini = computed(() => myRole.value === 'admin')

async function onSend() {
  const text = draft.value.trim()
  if (text.length === 0 || sending.value) return
  // The guard is a question, never a refusal (PLAN §8).
  if (kind.value !== 'admini' && looksLikeMoney(text)) {
    moneyOpen.value = true
    return
  }
  await queue(text)
}

async function queue(text: string, moneyAck = false) {
  sending.value = true
  try {
    const photo = heldPhoto.value
    await chat.enqueue({
      channel: kind.value,
      kind: photo ? 'image' : 'text',
      ...(text ? { body: text } : {}),
      ...(photo ? { blob: photo.blob, width: photo.width, height: photo.height } : {}),
      ...(moneyAck ? { money_ack: true } : {}),
      ...(replyTo.value ? { reply_to_id: replyTo.value.id } : {}),
    })
    draft.value = ''
    replyTo.value = null
    heldPhoto.value = null
    await chat.saveDraft(kind.value, '')
    await toBottom()
  } finally {
    sending.value = false
    moneyOpen.value = false
  }
}

/**
 * A picked photo is downscaled **before** it is queued: ~150 KB is what goes to
 * IndexedDB and what goes on the wire, and the re-encode drops EXIF with it.
 */
async function onPick(file: File) {
  error.value = null
  try {
    const { blob, width, height } = await downscale(file, CHAT_IMAGE)
    heldPhoto.value = { blob, width, height }
    const caption = draft.value.trim()
    if (kind.value !== 'admini' && caption && looksLikeMoney(caption)) {
      moneyOpen.value = true
      return
    }
    await queue(caption)
  } catch {
    heldPhoto.value = null
    error.value = IMAGE_ERROR
  }
}

// -- one message ------------------------------------------------------------

const sheetFor = ref<ChatMessage | null>(null)
/** The full-screen photo, and the message it came from: its actions are its own. */
const viewing = ref<{ message: ChatMessage, src: string } | null>(null)
const busy = ref(false)

function onOpen(message: ChatMessage) {
  if (message.kind === 'system') return
  sheetFor.value = message
}

async function onPin(message: ChatMessage) {
  const line = (message.body ?? '').split('\n')[0]?.slice(0, 80) ?? ''
  if (!line) return
  await run(() => actions.pin(kind.value, { append: line }))
}

async function onClearPin() {
  await run(() => actions.pin(kind.value, { cleared: true }))
}

async function onForward(to: ChannelKind) {
  const message = sheetFor.value
  if (!message) return
  await run(() => actions.forward(message.id, to))
}

async function onRemove(message: ChatMessage) {
  await run(() => actions.remove(message.id))
}

/** One place for "do it, say what went wrong, then re-read". */
async function run(fn: () => Promise<unknown>) {
  busy.value = true
  error.value = null
  try {
    await fn()
    sheetFor.value = null
    viewing.value = null
    await refresh()
  } catch (err) {
    error.value = apiErrorText(err, 'Nije uspjelo — pokušaj ponovo')
  } finally {
    busy.value = false
  }
}

/** A queued photo has no server URL yet, so the bubble draws the local Blob. */
const localSrc = new Map<string, string>()

function blobUrl(clientId: string, blob?: Blob): string | undefined {
  if (!blob) return undefined
  if (!localSrc.has(clientId)) localSrc.set(clientId, URL.createObjectURL(blob))
  return localSrc.get(clientId)
}

onUnmounted(() => {
  for (const url of localSrc.values()) URL.revokeObjectURL(url)
  localSrc.clear()
})

/** A pending entry, drawn as a real bubble so the thread does not jump later. */
function asMessage(clientId: string, kindOf: 'text' | 'image', body: string | undefined, at: string): ChatMessage {
  return {
    id: `pending:${clientId}`,
    client_id: clientId,
    channel: kind.value,
    seq: Number.MAX_SAFE_INTEGER,
    kind: kindOf,
    body: body ?? null,
    image: null,
    author_id: myId.value,
    author_name: me.user.value?.name ?? null,
    author_initials: me.user.value?.initials ?? null,
    reply_to_id: null,
    reply_preview: null,
    forwarded_from_id: null,
    system_key: null,
    system_payload: null,
    at,
    deleted_at: null,
    deleted_by_name: null,
  }
}
</script>

<template>
  <div class="flex flex-1 flex-col">
    <WaiterHeader :title="channel?.name ?? CHANNEL_NAMES[kind]" :back-to="backTo">
      <template #right>
        <WaiterSyncChip />
      </template>
    </WaiterHeader>

    <!-- The room, said out loud: a channel is visible to the people in it. -->
    <p v-if="channel && channel.members.length > 0" class="pt-2 text-sm text-text-2">
      Članovi {{ channel.members.length }} · {{ channel.members.join(', ') }}
    </p>

    <!-- Sticky under the 56 px header: *Za naručiti* is the one line that has to
         be reachable from the bottom of a long thread, which is where a phone
         always opens. -->
    <ChatPinBar
      v-if="channel"
      class="sticky top-14 z-20 mt-2 bg-bg"
      :text="channel.pinned_text"
      :can-clear="myRole === 'admin'"
      :busy="busy"
      @clear="onClearPin"
    />

    <main class="flex flex-1 flex-col gap-2 py-3">
      <button
        v-if="chat.olderAvailable[kind]"
        type="button"
        class="btn btn-ghost min-h-12 self-center px-4 text-base"
        @click="chat.loadOlder(kind)"
      >
        Učitaj starije
      </button>

      <p v-if="!online" class="chip chip-warn self-center">Nema veze</p>

      <ChatBubble
        v-for="message in messages"
        :key="message.id"
        :message="message"
        :mine="message.author_id === myId"
        @open="onOpen"
        @image="viewing = $event"
        @link="navigateTo($event)"
      />

      <!-- What this phone still owes the server, drawn where it will land. -->
      <ChatBubble
        v-for="entry in waiting"
        :key="entry.client_id"
        :message="asMessage(entry.client_id, entry.kind, entry.body, entry.client_created_at)"
        :mine="true"
        :waiting="true"
        :local-src="blobUrl(entry.client_id, entry.blob)"
        @open="() => {}"
        @image="viewing = $event"
      />

      <p
        v-if="chat.loaded && messages.length === 0 && waiting.length === 0"
        class="card px-4 py-8 text-center text-text-2"
      >
        Još nema poruka.
      </p>
    </main>

    <div v-if="replyTo" class="flex items-center gap-2 border-t border-line py-2">
      <span class="chip shrink-0">Odgovor</span>
      <span class="grow truncate text-text-2">{{ replyTo.body }}</span>
      <button
        type="button"
        class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-text-2"
        aria-label="Otkaži odgovor"
        @click="replyTo = null"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>

    <p v-if="error" class="pb-1 text-danger">{{ error }}</p>
    <p v-if="chat.toast" class="pb-1 text-warn" @click="chat.clearToast()">{{ chat.toast }}</p>

    <ChatComposer
      v-model="draft"
      :sending="sending"
      :disabled-reason="mutedText"
      :allow-gallery="myRole !== 'admin'"
      @send="onSend"
      @pick="onPick"
    />

    <button
      v-if="newBelow"
      type="button"
      class="fixed inset-x-0 bottom-24 z-30 mx-auto w-fit rounded-full bg-accent px-4 py-2 font-semibold text-accent-ink"
      @click="toBottom"
    >
      Nova poruka ↓
    </button>

    <ChatMessageSheet
      v-if="sheetFor"
      :message="sheetFor"
      :kind="kind"
      :role="myRole"
      :user-id="myId"
      :delete-window-s="deleteWindowS"
      :busy="busy"
      @close="sheetFor = null"
      @reply="replyTo = $event; sheetFor = null"
      @pin="onPin"
      @forward="onForward"
      @remove="onRemove"
    />

    <ChatMoneySheet
      v-if="moneyOpen"
      :busy="sending"
      :can-admini="canAdmini"
      @close="moneyOpen = false; heldPhoto = null"
      @send="queue(draft.trim(), true)"
      @admini="navigateTo(`${backTo}/admini`)"
    />

    <!-- Tapping a photo opens it full screen; its two actions open the same
         sheet the bubble does, so a picture is never a dead end. -->
    <ChatImageViewer
      v-if="viewing"
      :src="viewing.src"
      :can-forward="!viewing.message.id.startsWith('pending:')"
      :can-remove="!viewing.message.id.startsWith('pending:')"
      @close="viewing = null"
      @forward="sheetFor = viewing!.message; viewing = null"
      @remove="sheetFor = viewing!.message; viewing = null"
    />
  </div>
</template>
