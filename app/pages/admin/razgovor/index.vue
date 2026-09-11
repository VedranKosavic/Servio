<script setup lang="ts">
/**
 * `/admin/razgovor` — *Razgovor*, from the owner's desk.
 *
 * **Two channels, and there is no third.** *Svi* and *Admini* are what `canSee`
 * admits for an `admin`, and the list is built from the server's answer rather
 * than from a hard-coded pair — so *Konobari* is not "hidden here", it never
 * arrives. There is no nav item for it either, and a hand-written request for it
 * is a 403 (CLAUDE.md, "Konobari is private").
 *
 * Two panes above 1024 px, one column below. The phone layout is the same shape
 * as S15/S16 and none of its CSS: `/admin` is light, `/konobar` is dark, and
 * the two never share a rule.
 *
 * What the owner can do here that staff cannot: *Obriši* on anything in these two
 * channels at any age, *Utišaj* on a person, and *Naručeno ✓* on the *Za
 * naručiti* note. What he cannot do: send a photo out of his gallery — *Slikaj*
 * only, because a screenshot of `/admin` lives in a gallery and a camera photo of a
 * screen is a deliberate act.
 *
 * **This page is no longer the only way in.** `ChatDock` — the copper button in
 * the corner of every other `/admin` screen — is the one the owner answers a
 * line from while he is looking at a number, and it is deliberately absent
 * here. This stays as the full-size read at a laptop: the channel list with its
 * previews beside a wide thread, which a 380 px panel cannot show. The three
 * sheets and the image viewer are shared components, so the two never drift.
 */
import { useDebounceFn } from '@vueuse/core'
import { CHANNEL_NAMES, looksLikeMoney, type ChannelKind } from '#shared/chat'
import { localTime } from '#shared/dates'
import { CHAT_IMAGE, downscale, IMAGE_ERROR } from '~/utils/image'
import type { ChatMessage } from '#shared/types'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Razgovor' })

const me = useMe()
const { chat, api, actions, refresh } = useChat({ admin: true })

/** The dashboard's one 15 s poll; a `chat` bump is what makes this screen re-read. */
useAdminChanges({
  onEntity: (entity) => {
    if (entity === 'chat') void refresh()
  },
})

const active = ref<ChannelKind>('svi')
/** On a phone the list and the thread are two screens, not two panes. */
const showThread = ref(false)

const channel = computed(() => chat.channel(active.value))
const messages = computed(() => chat.thread(active.value))
const myId = computed(() => me.user.value?.id ?? '')

const draft = ref('')
const sending = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
const moneyOpen = ref(false)
const sheetFor = ref<ChatMessage | null>(null)
const muteFor = ref<ChatMessage | null>(null)
const viewing = ref<string | null>(null)
const camera = ref<HTMLInputElement | null>(null)

const saveDraft = useDebounceFn((text: string) => chat.saveDraft(active.value, text), 400)
watch(draft, text => void saveDraft(text))

async function pick(kind: ChannelKind) {
  active.value = kind
  showThread.value = true
  // Clear first, then restore only if the field is still empty: IndexedDB
  // answers after the thread is already on screen, and a reply started in that
  // gap must survive.
  draft.value = ''
  const stored = await chat.loadDraft(kind)
  if (!draft.value) draft.value = stored
  await chat.rememberChannel(kind)
  const last = messages.value[messages.value.length - 1]
  if (last) chat.markRead(kind, last.seq)
}

watch(() => chat.loaded, (ready) => {
  if (ready && chat.channels.length > 0 && !channel.value) {
    active.value = chat.channels[0]!.kind
  }
}, { immediate: true })

// A message that lands while the thread is open clears the badge with it.
watch(() => messages.value.length, () => {
  const last = messages.value[messages.value.length - 1]
  if (last && showThread.value) chat.markRead(active.value, last.seq)
})

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
  } finally {
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
  } catch {
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
  } catch (err) {
    error.value = apiErrorText(err, 'Nije uspjelo — pokušaj ponovo')
  } finally {
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
 * *Utišaj*, as three plain choices rather than a time picker.
 *
 * A mute is a temper cooling off, not a calendar entry: an hour, the rest of the
 * night, or until tomorrow morning covers every real case, and *Skini
 * utišavanje* is the way back.
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

const pinnedLines = computed(() =>
  (channel.value?.pinned_text ?? '').split('\n').filter(line => line.length > 0))

// -- the sheets ------------------------------------------------------------
//
// The rows are data rather than markup because `ChatAdminSheet` draws them —
// the same component `ChatDock` opens, so a long press answers with one object
// here and in the corner of every other `/admin` screen. A row the server
// would refuse is not drawn.

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
  // *Pošalji u Admini* moves the line he already typed into the other room
  // rather than sending it — the send is still his, one tap later.
  if (id === 'admini') { active.value = 'admini'; moneyOpen.value = false }
  else if (id === 'send') void queue(draft.value.trim(), true)
  else moneyOpen.value = false
}
</script>

<template>
  <div class="a-page">
    <UiPageHead
      eyebrow="Ljudi"
      title="Razgovor"
      sub="Svi i Admini · Konobari je njihov kanal"
    />

    <p v-if="error" class="a-error">{{ error }}</p>

    <div class="a-chat">
      <!-- The channel list. On a phone it is the whole screen until one is picked. -->
      <aside class="a-list" :class="{ hidden: showThread }">
        <button
          v-for="row in chat.channels"
          :key="row.id"
          type="button"
          class="a-ch"
          :class="{ on: row.kind === active }"
          @click="pick(row.kind)"
        >
          <span class="a-ch-top">
            <span class="a-ch-name">{{ row.name }}</span>
            <span v-if="row.preview_at" class="a-ch-at">{{ localTime(row.preview_at) }}</span>
            <span v-if="row.unread > 0" class="a-ch-n">{{ row.unread > 99 ? '99+' : row.unread }}</span>
          </span>
          <span class="a-ch-prev">{{ row.preview ?? 'Još nema poruka' }}</span>
        </button>
      </aside>

      <section class="a-pane" :class="{ hidden: !showThread }">
        <header class="a-pane-head">
          <button type="button" class="a-back" @click="showThread = false">← Kanali</button>
          <strong>{{ channel?.name ?? CHANNEL_NAMES[active] }}</strong>
          <span v-if="channel" class="a-members">
            Članovi {{ channel.members.length }} · {{ channel.members.join(', ') }}
          </span>
        </header>

        <!-- *Za naručiti*: the note the whole venue writes and the owner clears. -->
        <div v-if="pinnedLines.length > 0" class="a-pin">
          <span class="a-pin-tag">Za naručiti</span>
          <ul>
            <li v-for="(line, i) in pinnedLines" :key="i">{{ line }}</li>
          </ul>
          <button type="button" class="a-pin-done" :disabled="busy" @click="clearPin">
            Naručeno ✓
          </button>
        </div>

        <button
          v-if="chat.olderAvailable[active]"
          type="button"
          class="a-older"
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

        <p v-if="chat.loaded && messages.length === 0" class="a-empty">Još nema poruka.</p>

        <div class="a-composer">
          <textarea
            v-model="draft"
            rows="2"
            class="a-input"
            placeholder="Poruka"
            aria-label="Poruka"
          />
          <div class="a-composer-btns">
            <button
              v-if="active === 'svi'"
              type="button"
              class="a-btn"
              @click="camera?.click()"
            >
              Slikaj
            </button>
            <button type="button" class="a-btn a-btn-accent" :disabled="!draft.trim() || sending" @click="send">
              Pošalji
            </button>
          </div>
          <input ref="camera" type="file" accept="image/*" capture="environment" class="a-file" @change="onFile">
        </div>
      </section>
    </div>

    <!-- What the owner can do to one message. The three sheets and the viewer
         are the same components `ChatDock` uses, so the page and the dock
         answer a long press with one object rather than two that drift. -->
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
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 16px; min-width: 0; }


.a-error { margin: 0; color: var(--danger); }

/* Two panes on a laptop, one column on a phone. */
.a-chat { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 16px; min-width: 0; }

@media (max-width: 1023px) {
  .a-chat { grid-template-columns: minmax(0, 1fr); }
  .a-chat .hidden { display: none; }
}

@media (min-width: 1024px) {
  .a-back { display: none; }
}

.a-list { display: flex; flex-direction: column; gap: 8px; min-width: 0; }

.a-ch {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 64px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.a-ch.on { border-color: var(--accent); background: var(--accent-soft); }
.a-ch-top { display: flex; align-items: center; gap: 8px; }
.a-ch-name { font-weight: 600; flex-grow: 1; }
.a-ch-at { font-size: var(--text-caption); color: var(--muted); font-variant-numeric: tabular-nums; }

.a-ch-n {
  min-width: 22px;
  height: 22px;
  border-radius: 11px;
  background: var(--danger);
  color: var(--on-accent);
  font-size: var(--text-caption);
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  font-variant-numeric: tabular-nums;
}

.a-ch-prev { color: var(--muted); font-size: var(--text-micro); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.a-pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--surface);
  padding: 14px;
}

.a-pane-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; }
.a-members { color: var(--muted); font-size: var(--text-micro); }

.a-back {
  border: 0;
  background: transparent;
  color: var(--accent-ink);
  font: inherit;
  cursor: pointer;
  padding: 4px 0;
  min-height: 44px;
}

.a-pin {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--warn-soft);
  color: var(--ink);
}

.a-pin-tag { font-weight: 700; font-size: var(--text-caption); text-transform: uppercase; letter-spacing: 0.04em; }
.a-pin ul { margin: 0; padding-left: 18px; flex-grow: 1; }

.a-pin-done {
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.a-older {
  align-self: center;
  min-height: 40px;
  padding: 0 14px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface-2);
  color: var(--ink);
  font: inherit;
  cursor: pointer;
}

.a-empty { margin: 0; padding: 24px 0; text-align: center; color: var(--muted); }

.a-composer { display: flex; flex-direction: column; gap: 8px; }

.a-input {
  width: 100%;
  resize: vertical;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--field-bg);
  color: var(--ink);
  font: inherit;
}

.a-composer-btns { display: flex; gap: 8px; justify-content: flex-end; }
.a-file { display: none; }

.a-btn {
  min-height: 44px;
  padding: 0 16px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface-2);
  color: var(--ink);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.a-btn-accent { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.a-btn:disabled { opacity: 0.45; cursor: default; }
</style>
