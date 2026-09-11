<script setup lang="ts">
/**
 * *Razgovor* as a dock — the copper button in the corner of every `/admin`
 * screen and the panel it opens in place.
 *
 * **Why it is not a nav row any more.** The owner answers chat while he is
 * looking at a number, not instead of looking at one. A row in the rail made
 * reading one line cost a navigation away from *Puls* and a navigation back;
 * a button in the corner costs a tap. `app/pages/admin/razgovor/index.vue`
 * stays as the full-screen version for a long read at a laptop, and this
 * component deliberately does not render on that route — a floating button over
 * the page that is already the whole thing is noise.
 *
 * **Two channels, so there is no list.** `canSee('admin', kind)` admits exactly
 * *Svi* and *Admini*, and the rows below are built from `chat.channels` — the
 * server's own answer — rather than from a hard-coded pair. *Konobari* is not
 * "hidden here": it never arrives, and a hand-written request for it is a 403
 * (CLAUDE.md, "Konobari is private"). With two rooms a list → thread → back
 * drill would cost two taps to read and two to get out, so they are a segmented
 * switch at the top of the panel with the thread already under it.
 *
 * **One poll.** There is no timer in this file. `useChat` reads on mount, after
 * an own send and when the tab comes back; the 15 s `/api/changes` this
 * dashboard already runs says `chat` moved and `refresh()` re-reads. A dock
 * that opened its own interval would be the second clock the app does not have.
 *
 * **State lives in `useState`, not in a local `ref`.** The dock is mounted on
 * the layout, so an ordinary route change never unmounts it — but this
 * component *is* unmounted on `/admin/razgovor`, where the page owns the
 * conversation instead. Nuxt's per-request state survives that detour, so which
 * channel was open, whether the panel was open and a half-typed reply all come
 * back when he navigates away again.
 */
import { useDebounceFn, useMediaQuery } from '@vueuse/core'
import { canSee, looksLikeMoney, type ChannelKind } from '#shared/chat'
import { CHAT_IMAGE, downscale, IMAGE_ERROR } from '~/utils/image'
import type { ChatMessage } from '#shared/types'

const me = useMe()
const { chat, api, actions, refresh } = useChat({ admin: true })

/** The dashboard's one 15 s poll; a `chat` bump is what makes the dock re-read. */
useAdminChanges({
  onEntity: (entity) => {
    if (entity === 'chat') void refresh()
  },
})

/**
 * The same breakpoint the layout uses, read in script because two things
 * depend on it that CSS cannot say: below 1024 px the panel is a sheet over the
 * whole screen and therefore genuinely **modal**, and above it the panel is a
 * popover beside a page that stays perfectly usable. `aria-modal` on the second
 * one would tell a screen reader the dashboard behind it is inert, which is a
 * lie. The panel is only rendered while open, so there is no SSR value to
 * mismatch.
 */
const narrow = useMediaQuery('(max-width: 1023px)')

const open = useState('sank:chat-dock:open', () => false)
const active = useState<ChannelKind>('sank:chat-dock:channel', () => 'svi')
const draft = useState('sank:chat-dock:draft', () => '')

const fab = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const scroller = ref<HTMLElement | null>(null)
const camera = ref<HTMLInputElement | null>(null)

const sending = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
const moneyOpen = ref(false)
const sheetFor = ref<ChatMessage | null>(null)
const muteFor = ref<ChatMessage | null>(null)
const viewing = ref<string | null>(null)

const channel = computed(() => chat.channel(active.value))
const messages = computed(() => chat.thread(active.value))
const myId = computed(() => me.user.value?.id ?? '')
const unreadTotal = computed(() => chat.totalUnread)

/** 99+ caps, on the button and on either segment. */
function cap(n: number): string {
  return n > 99 ? '99+' : String(n)
}

const pinnedLines = computed(() =>
  (channel.value?.pinned_text ?? '').split('\n').filter(line => line.length > 0))

const segIndex = computed(() =>
  Math.max(0, chat.channels.findIndex(row => row.kind === active.value)))

// -- the draft -------------------------------------------------------------

const saveDraft = useDebounceFn((text: string) => chat.saveDraft(active.value, text), 400)
watch(draft, text => void saveDraft(text))

/**
 * Restore a reply left behind by a reload — never one left behind by closing
 * the panel a second ago, which is still in `draft` and must not be overwritten
 * by the older copy on disk.
 */
async function restoreDraft(kind: ChannelKind) {
  if (draft.value) return
  const stored = await chat.loadDraft(kind)
  if (!draft.value) draft.value = stored
}

// -- opening ---------------------------------------------------------------

/**
 * Open on whatever has something to read; otherwise on the last room used.
 *
 * The fallback chain ends at `chat.channels[0]` rather than at a literal
 * `'svi'` so that the server, and not this file, decides what an admin may open.
 */
function chooseChannel(): ChannelKind {
  const unread = chat.channels.find(row => row.unread > 0)
  if (unread) return unread.kind
  if (chat.channels.some(row => row.kind === active.value)) return active.value
  return chat.channels[0]?.kind ?? active.value
}

/**
 * Switch rooms. `keepDraft` is the money sheet's *Pošalji u Admini*, which
 * moves the line the owner already typed into the other room rather than
 * throwing it away and asking him to type it again.
 */
async function pick(kind: ChannelKind, keepDraft = false) {
  active.value = kind
  if (!keepDraft) {
    // Clear first, then restore only if the field is still empty: IndexedDB
    // answers after the thread is already on screen, and a reply started in
    // that gap must survive.
    draft.value = ''
    const stored = await chat.loadDraft(kind)
    if (!draft.value) draft.value = stored
  }
  await chat.rememberChannel(kind)
  markReadNow()
  toBottom()
}

function markReadNow() {
  const last = messages.value[messages.value.length - 1]
  if (last) chat.markRead(active.value, last.seq)
}

/**
 * The panel opens on the tap and reads the disk afterwards.
 *
 * The order matters: the room he left off in and the reply he half-typed both
 * come out of IndexedDB, and a browser in private mode can leave that promise
 * pending forever. Awaiting it before `open` would turn a button into one that
 * sometimes does nothing at all.
 */
function show() {
  const target = chooseChannel()
  open.value = true
  if (target === active.value) {
    void restoreDraft(target)
    markReadNow()
  }
  else {
    void pick(target)
  }
}

function close() {
  open.value = false
}

function toggle() {
  if (open.value) close()
  else show()
}

/** The panel takes focus on open and hands it back to the button on close. */
watch(open, async (isOpen) => {
  await nextTick()
  if (isOpen) {
    panel.value?.focus()
    toBottom()
  }
  else {
    fab.value?.focus()
  }
})

/**
 * Escape closes the dock — unless something is open *inside* it.
 *
 * The listener is on `document` and not on `window` on purpose. `useSheetDismiss`
 * (the per-message sheet, the mute sheet, the money sheet, the viewer) also
 * listens on `document`, and a listener added later on the same target runs
 * later: this one is registered when the panel opens, so it always fires first,
 * sees the inner sheet still open and steps aside. On `window` it would fire
 * after the sheet had already closed itself and one Escape would shut both.
 */
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (sheetFor.value || muteFor.value || moneyOpen.value || viewing.value) return
  event.preventDefault()
  close()
}

watch(open, (isOpen) => {
  if (isOpen) document.addEventListener('keydown', onKeydown)
  else document.removeEventListener('keydown', onKeydown)
})

onMounted(() => {
  if (open.value) {
    document.addEventListener('keydown', onKeydown)
    toBottom()
  }
  // A fresh load has no channel in memory; the last one used is on disk. It is
  // the same key `/konobar` writes, so a room this role cannot open is refused
  // here rather than sent to the server as a 403.
  void chat.lastChannel().then((kind) => {
    const role = me.user.value?.role
    if (kind && role && canSee(role, kind)) active.value = kind
  })
})

onUnmounted(() => document.removeEventListener('keydown', onKeydown))

// -- the thread ------------------------------------------------------------

function toBottom() {
  void nextTick(() => {
    const el = scroller.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

function nearBottom(): boolean {
  const el = scroller.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight < 120
}

/**
 * A message that lands while the panel is open clears the badge with it, and
 * scrolls into view when the owner was already at the foot of the thread.
 * *Učitaj starije* prepends, so the newest id is what this watches — a count
 * would jump the view to the bottom every time he read backwards.
 */
const newestId = computed(() => messages.value[messages.value.length - 1]?.id ?? '')

watch(newestId, () => {
  if (!open.value) return
  markReadNow()
  if (nearBottom()) toBottom()
})

// -- writing ---------------------------------------------------------------

async function send() {
  const text = draft.value.trim()
  if (!text || sending.value) return
  // The same guard the phones use, and for the same reason: *Svi* is not where
  // anybody's pazar goes. In *Admini* the question does not arise.
  if (active.value !== 'admini' && looksLikeMoney(text)) {
    moneyOpen.value = true
    return
  }
  await queue(text)
}

async function queue(text: string, moneyAck = false) {
  if (!text) return
  sending.value = true
  try {
    await chat.enqueue({
      channel: active.value,
      kind: 'text',
      body: text,
      ...(moneyAck ? { money_ack: true } : {}),
    })
    draft.value = ''
    await chat.saveDraft(active.value, '')
    toBottom()
  }
  finally {
    sending.value = false
    moneyOpen.value = false
  }
}

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  error.value = null
  try {
    const { blob, width, height } = await downscale(file, CHAT_IMAGE)
    await chat.enqueue({ channel: active.value, kind: 'image', blob, width, height })
    toBottom()
  }
  catch {
    error.value = IMAGE_ERROR
  }
}

async function run(fn: () => Promise<unknown>) {
  busy.value = true
  error.value = null
  try {
    await fn()
    sheetFor.value = null
    muteFor.value = null
    viewing.value = null
    await refresh()
  }
  catch (err) {
    error.value = apiErrorText(err, 'Nije uspjelo — pokušaj ponovo')
  }
  finally {
    busy.value = false
  }
}

/** *Naručeno ✓* — clears the note and posts one line saying who cleared it. */
function clearPin() {
  void run(() => actions.pin(active.value, { cleared: true }))
}

function pinLine(message: ChatMessage) {
  const line = (message.body ?? '').split('\n')[0]?.slice(0, 80) ?? ''
  if (line) void run(() => actions.pin(active.value, { append: line }))
}

/**
 * *Utišaj*, as three plain choices rather than a time picker: a mute is a temper
 * cooling off, not a calendar entry, and *Skini utišavanje* is the way back.
 */
const MUTES: { label: string, hours: number | null }[] = [
  { label: 'Sat vremena', hours: 1 },
  { label: 'Do kraja večeri', hours: 6 },
  { label: 'Do sutra ujutro', hours: 12 },
  { label: 'Skini utišavanje', hours: null },
]

function mute(userId: string, hours: number | null) {
  const until = hours === null ? null : new Date(Date.now() + hours * 3_600_000).toISOString()
  void run(() => api.muteChatUser(userId, until))
}

// -- the sheets ------------------------------------------------------------

/**
 * What the owner can do to one message, and only what the server would allow:
 * *Proslijedi u Admini* out of *Svi*, the pinned note, *Utišaj* on a person,
 * and *Obriši* on anything in these two rooms at any age. A row the server
 * would refuse is simply not drawn.
 */
const messageRows = computed(() => {
  const message = sheetFor.value
  if (!message) return []
  return [
    ...(active.value === 'svi'
      ? [{ id: 'forward', label: 'Proslijedi u Admini', disabled: busy.value }]
      : []),
    ...(message.body
      ? [{ id: 'pin', label: 'Dodaj u "Za naručiti"', disabled: busy.value }]
      : []),
    ...(message.author_id
      ? [{ id: 'mute', label: `Utišaj ${message.author_name ?? ''}`.trim(), disabled: busy.value }]
      : []),
    ...(message.deleted_at
      ? []
      : [{ id: 'remove', label: 'Obriši', disabled: busy.value, danger: true }]),
    { id: 'close', label: 'Zatvori', muted: true },
  ]
})

function onMessagePick(id: string) {
  const message = sheetFor.value
  if (!message) return
  if (id === 'forward') void run(() => actions.forward(message.id, 'admini'))
  else if (id === 'pin') pinLine(message)
  else if (id === 'mute') { muteFor.value = message; sheetFor.value = null }
  else if (id === 'remove') void run(() => actions.remove(message.id))
  else sheetFor.value = null
}

const muteRows = computed(() => [
  ...MUTES.map(option => ({ id: option.label, label: option.label, disabled: busy.value })),
  { id: 'close', label: 'Zatvori', muted: true },
])

function onMutePick(id: string) {
  const message = muteFor.value
  if (!message?.author_id || id === 'close') {
    muteFor.value = null
    return
  }
  const option = MUTES.find(row => row.label === id)
  if (option) mute(message.author_id, option.hours)
}

const moneyRows = computed(() => [
  { id: 'admini', label: 'Pošalji u Admini' },
  { id: 'send', label: 'Ipak pošalji', disabled: sending.value },
  { id: 'close', label: 'Odustani', muted: true },
])

function onMoneyPick(id: string) {
  if (id === 'admini') {
    moneyOpen.value = false
    void pick('admini', true)
  }
  else if (id === 'send') void queue(draft.value.trim(), true)
  else moneyOpen.value = false
}
</script>

<template>
  <!-- The button first in the DOM, so a keyboard reaches it before the panel. -->
  <button
    ref="fab"
    type="button"
    class="d-fab"
    aria-label="Razgovor"
    :aria-expanded="open"
    aria-controls="chat-dock-panel"
    @click="toggle"
  >
    <UiIcon :name="open ? 'x' : 'chat'" :size="24" />
    <span v-if="!open && unreadTotal > 0" class="d-n">{{ cap(unreadTotal) }}</span>
  </button>

  <!-- The phone's scrim. A laptop has none: the panel is a popover beside the
       page, not a dialog over it, and the page behind it stays usable. -->
  <div v-if="open && narrow" class="d-scrim" @click="close" />

  <div
    v-if="open"
    id="chat-dock-panel"
    ref="panel"
    class="d-panel"
    role="dialog"
    aria-label="Razgovor"
    :aria-modal="narrow ? 'true' : undefined"
    tabindex="-1"
  >
    <header class="d-head">
      <strong class="d-title">Razgovor</strong>
      <button type="button" class="d-close" aria-label="Zatvori" @click="close">
        <UiIcon name="x" :size="20" />
      </button>
    </header>

    <!-- Two rooms, so they are a switch and not a list. Each carries its own
         count, because "there is something new" and "it is in the other one"
         are two different facts. -->
    <div
      v-if="chat.channels.length > 0"
      class="d-seg"
      role="group"
      aria-label="Kanal"
      :style="{ '--seg-count': chat.channels.length, '--seg-index': segIndex }"
    >
      <span class="d-seg-thumb" aria-hidden="true" />
      <button
        v-for="row in chat.channels"
        :key="row.id"
        type="button"
        class="d-seg-item"
        :class="{ on: row.kind === active }"
        :aria-pressed="row.kind === active"
        @click="pick(row.kind)"
      >
        <span>{{ row.name }}</span>
        <span v-if="row.unread > 0" class="d-seg-n">{{ cap(row.unread) }}</span>
      </button>
    </div>

    <p v-if="error" class="d-error">{{ error }}</p>

    <!-- *Za naručiti*: the note the whole venue writes and the owner clears. -->
    <div v-if="pinnedLines.length > 0" class="d-pin">
      <span class="d-pin-tag">Za naručiti</span>
      <ul>
        <li v-for="(line, i) in pinnedLines" :key="i">{{ line }}</li>
      </ul>
      <button type="button" class="d-pin-done" :disabled="busy" @click="clearPin">
        Naručeno ✓
      </button>
    </div>

    <div ref="scroller" class="d-scroll">
      <button
        v-if="chat.olderAvailable[active]"
        type="button"
        class="d-older"
        @click="chat.loadOlder(active)"
      >
        Učitaj starije
      </button>

      <ChatAdminThread
        :messages="messages"
        :my-id="myId"
        @open="sheetFor = $event"
        @image="viewing = $event"
      />

      <p v-if="chat.loaded && messages.length === 0" class="d-empty">Još nema poruka.</p>
    </div>

    <div class="d-composer">
      <textarea
        v-model="draft"
        rows="2"
        class="d-input"
        placeholder="Poruka"
        aria-label="Poruka"
      />
      <div class="d-composer-btns">
        <!-- *Slikaj* only, and only in *Svi*: a screenshot of the dashboard
             lives in a gallery, and a camera photo of a screen is a deliberate
             act. -->
        <button
          v-if="active === 'svi'"
          type="button"
          class="d-btn"
          @click="camera?.click()"
        >
          Slikaj
        </button>
        <span class="d-grow" />
        <button
          type="button"
          class="d-btn d-btn-accent"
          :disabled="!draft.trim() || sending"
          @click="send"
        >
          Pošalji
        </button>
      </div>
      <input ref="camera" type="file" accept="image/*" capture="environment" class="d-file" @change="onFile">
    </div>
  </div>

  <ChatAdminSheet
    v-if="sheetFor"
    label="Poruka"
    :options="messageRows"
    @pick="onMessagePick"
    @close="sheetFor = null"
  />

  <ChatAdminSheet
    v-if="muteFor"
    label="Utišaj"
    :title="`Utišaj ${muteFor.author_name ?? ''}`.trim()"
    :options="muteRows"
    @pick="onMutePick"
    @close="muteFor = null"
  />

  <ChatAdminSheet
    v-if="moneyOpen"
    label="Iznosi u kanalu"
    title="Iznosi kolega ne idu u Svi — pošalji u Admini?"
    :options="moneyRows"
    @pick="onMoneyPick"
    @close="moneyOpen = false"
  />

  <ChatAdminViewer v-if="viewing" :src="viewing" @close="viewing = null" />
</template>

<style scoped>
/* ---- the button -------------------------------------------------------- */

.d-fab {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 25;
  width: 56px;
  height: 56px;
  border: 0;
  border-radius: var(--radius-chip);
  background: var(--accent);
  color: var(--on-accent);
  box-shadow: var(--shadow-pop);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform var(--dur-tap) var(--ease-standard);
}

.d-fab:active { transform: scale(0.97); }

.d-n {
  position: absolute;
  top: -2px;
  right: -2px;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border-radius: var(--radius-chip);
  border: 2px solid var(--bg);
  background: var(--danger);
  color: var(--on-accent);
  font-size: var(--text-caption);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ---- the panel --------------------------------------------------------- */

.d-panel {
  position: fixed;
  right: 24px;
  /* Clear of the button: 24 of margin, 56 of button, 12 of air. */
  bottom: 92px;
  z-index: 30;
  width: 380px;
  max-width: calc(100vw - 48px);
  height: 560px;
  /* Never taller than the screen it floats on. */
  max-height: calc(100dvh - 116px);
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-panel);
  box-shadow: var(--shadow-pop);
  overflow: hidden;
  animation: d-pop var(--dur-sheet) var(--ease-out-soft);
}

.d-panel:focus { outline: none; }

/* DESIGN §5: a panel arrives sliding 12 % up and fading in, and reduced motion
   collapses `--dur-sheet` to 1 ms so it simply appears. */
@keyframes d-pop {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

.d-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 8px 8px 14px;
  border-bottom: 1px solid var(--line-soft);
}

.d-title {
  flex-grow: 1;
  min-width: 0;
  font-family: var(--font-display);
  font-size: var(--text-section);
  font-weight: 700;
}

.d-close {
  flex-shrink: 0;
  width: var(--tap);
  height: var(--tap);
  border: 0;
  border-radius: var(--radius-field);
  background: transparent;
  color: var(--ink-2);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}

.d-close:hover { background: var(--surface-2); color: var(--ink); }

/* ---- the two rooms ----------------------------------------------------- */

.d-seg {
  flex-shrink: 0;
  position: relative;
  display: grid;
  grid-template-columns: repeat(var(--seg-count), 1fr);
  margin: 10px 12px 0;
  padding: 4px;
  border-radius: var(--radius-chip);
  background: var(--bg-2);
  border: 1px solid var(--line);
}

.d-seg-thumb {
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 4px;
  width: calc((100% - 8px) / var(--seg-count));
  transform: translateX(calc(var(--seg-index) * 100%));
  border-radius: var(--radius-chip);
  background: var(--surface);
  box-shadow: var(--shadow-card);
  transition: transform var(--dur-fast) var(--ease-out-soft);
}

.d-seg-item {
  position: relative;
  z-index: 1;
  min-height: var(--tap);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius-chip);
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: var(--text-body);
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-standard);
}

.d-seg-item.on { color: var(--ink); }

.d-seg-n {
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: var(--radius-chip);
  background: var(--danger);
  color: var(--on-accent);
  font-size: var(--text-caption);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ---- Za naručiti ------------------------------------------------------- */

.d-error {
  flex-shrink: 0;
  margin: 10px 12px 0;
  color: var(--danger);
  font-size: var(--text-micro);
}

/* The tag and *Naručeno ✓* share the first row; the list runs full width under
   them. A grid rather than a wrapping flex row, so the button never lands on a
   third line when the note is one short word. */
.d-pin {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 6px 8px;
  margin: 10px 12px 0;
  padding: 8px 10px;
  border-radius: var(--radius-field);
  background: var(--warn-soft);
  color: var(--ink);
}

.d-pin-tag {
  grid-area: 1 / 1;
  font-size: var(--text-caption);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.d-pin ul {
  grid-area: 2 / 1 / 3 / 3;
  margin: 0;
  padding-left: 18px;
  /* Thursday's list is long and the messages under it matter more. */
  max-height: 84px;
  overflow-y: auto;
  font-size: var(--text-micro);
}

.d-pin-done {
  grid-area: 1 / 2;
  min-height: var(--tap);
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-field);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  font-size: var(--text-label);
  font-weight: 600;
  cursor: pointer;
}

.d-pin-done:disabled { opacity: 0.45; cursor: default; }

/* ---- the thread -------------------------------------------------------- */

.d-scroll {
  flex-grow: 1;
  min-height: 0;
  overflow-y: auto;
  /* The page behind must not start scrolling when the thread hits its end. */
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}

/* A thread shorter than the panel sits at the **foot** of the scroller, the way
   every chat does: the newest line is the one the eye should land on, and a
   short conversation hanging from the top rail reads as a list instead. */
.d-scroll > :deep(.a-thread) { margin-top: auto; }

.d-older {
  align-self: center;
  flex-shrink: 0;
  min-height: var(--tap);
  padding: 0 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-field);
  background: var(--surface-2);
  color: var(--ink);
  font: inherit;
  font-size: var(--text-label);
  cursor: pointer;
}

.d-empty {
  margin: auto 0;
  padding: 24px 0;
  text-align: center;
  color: var(--muted);
}

/* ---- the composer ------------------------------------------------------ */

.d-composer {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--line-soft);
}

.d-input {
  width: 100%;
  resize: none;
  min-height: 56px;
  max-height: 120px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-field);
  background: var(--field-bg);
  color: var(--ink);
  font: inherit;
  font-size: var(--text-body);
}

.d-composer-btns { display: flex; align-items: center; gap: 8px; }
.d-grow { flex-grow: 1; }
.d-file { display: none; }

.d-btn {
  min-height: var(--tap);
  padding: 0 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius-field);
  background: var(--surface-2);
  color: var(--ink);
  font: inherit;
  font-size: var(--text-label);
  font-weight: 600;
  cursor: pointer;
  transition: transform var(--dur-tap) var(--ease-standard);
}

.d-btn:active { transform: scale(0.97); }
.d-btn-accent { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.d-btn:disabled { opacity: 0.45; cursor: default; transform: none; }

/* ---- the phone --------------------------------------------------------- */

@media (max-width: 1023px) {
  .d-fab {
    right: 16px;
    /* The tab bar is 60 px tall plus the home indicator (`layouts/admin.vue`),
       so the button starts 12 px above it and never covers a tab. */
    bottom: calc(72px + env(safe-area-inset-bottom));
  }

  .d-scrim {
    position: fixed;
    inset: 0;
    z-index: 29;
    background: var(--scrim);
    animation: d-fade var(--dur-base) var(--ease-standard);
  }

  /* A full-height sheet, over the tab bar and clear of both safe areas. */
  .d-panel {
    inset: 0;
    width: auto;
    height: auto;
    max-width: none;
    max-height: none;
    border: 0;
    border-radius: 0;
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
    animation: d-sheet-in var(--dur-sheet) var(--ease-out-soft);
  }

  .d-seg-item, .d-input { font-size: var(--text-section); }
  .d-btn, .d-older, .d-pin-done { font-size: var(--text-body); }
}

@keyframes d-sheet-in {
  from { opacity: 0; transform: translateY(12%); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes d-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
</style>
