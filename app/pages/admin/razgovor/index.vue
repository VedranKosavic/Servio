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

function forwardToAdmini(message: ChatMessage) {
  void run(() => actions.forward(message.id, 'admini'))
}

function remove(message: ChatMessage) {
  void run(() => actions.remove(message.id))
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
</script>

<template>
  <div class="a-page">
    <header class="a-page-head">
      <h1>Razgovor</h1>
      <p class="a-page-sub">Svi i Admini · Konobari je njihov kanal</p>
    </header>

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

    <!-- What the owner can do to one message. -->
    <div v-if="sheetFor" class="a-modal" @click.self="sheetFor = null">
      <div class="a-sheet" role="dialog" aria-label="Poruka">
        <button v-if="active === 'svi'" type="button" class="a-sheet-row" :disabled="busy" @click="forwardToAdmini(sheetFor)">
          Proslijedi u Admini
        </button>
        <button v-if="sheetFor.body" type="button" class="a-sheet-row" :disabled="busy" @click="pinLine(sheetFor)">
          Dodaj u "Za naručiti"
        </button>
        <button
          v-if="sheetFor.author_id"
          type="button"
          class="a-sheet-row"
          :disabled="busy"
          @click="muteFor = sheetFor; sheetFor = null"
        >
          Utišaj {{ sheetFor.author_name }}
        </button>
        <button v-if="!sheetFor.deleted_at" type="button" class="a-sheet-row danger" :disabled="busy" @click="remove(sheetFor)">
          Obriši
        </button>
        <button type="button" class="a-sheet-row muted" @click="sheetFor = null">Zatvori</button>
      </div>
    </div>

    <div v-if="muteFor" class="a-modal" @click.self="muteFor = null">
      <div class="a-sheet" role="dialog" aria-label="Utišaj">
        <p class="a-sheet-title">Utišaj {{ muteFor.author_name }}</p>
        <button
          v-for="option in MUTES"
          :key="option.label"
          type="button"
          class="a-sheet-row"
          :disabled="busy"
          @click="mute(muteFor!.author_id!, option.hours)"
        >
          {{ option.label }}
        </button>
        <button type="button" class="a-sheet-row muted" @click="muteFor = null">Zatvori</button>
      </div>
    </div>

    <div v-if="viewing" class="a-viewer" @click.self="viewing = null">
      <img :src="viewing" alt="Slika">
      <button type="button" class="a-btn" @click="viewing = null">Zatvori</button>
    </div>

    <div v-if="moneyOpen" class="a-modal" @click.self="moneyOpen = false">
      <div class="a-sheet" role="dialog" aria-label="Iznosi u kanalu">
        <p class="a-sheet-title">Iznosi kolega ne idu u Svi — pošalji u Admini?</p>
        <button type="button" class="a-sheet-row" @click="active = 'admini'; moneyOpen = false">
          Pošalji u Admini
        </button>
        <button type="button" class="a-sheet-row" :disabled="sending" @click="queue(draft.trim(), true)">
          Ipak pošalji
        </button>
        <button type="button" class="a-sheet-row muted" @click="moneyOpen = false">Odustani</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.a-page-head { display: flex; flex-direction: column; gap: 2px; }

.a-page-head h1 {
  font-family: var(--font-title);
  font-weight: 700;
  font-size: 28px;
  letter-spacing: -0.015em;
  margin: 0;
  line-height: 1.1;
}

.a-page-sub { margin: 0; color: var(--muted); font-size: 14px; }
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
.a-ch-at { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }

.a-ch-n {
  min-width: 22px;
  height: 22px;
  border-radius: 11px;
  background: var(--danger);
  color: var(--on-accent);
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  font-variant-numeric: tabular-nums;
}

.a-ch-prev { color: var(--muted); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

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
.a-members { color: var(--muted); font-size: 13px; }

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

.a-pin-tag { font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
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

.a-modal {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: var(--scrim);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.a-sheet {
  width: min(420px, 100%);
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  padding-bottom: 24px;
  border-radius: 16px 16px 0 0;
  background: var(--surface);
}

.a-sheet-title { margin: 4px 8px 8px; font-weight: 700; }

.a-sheet-row {
  min-height: 52px;
  padding: 0 12px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 16px;
  text-align: left;
  cursor: pointer;
}

.a-sheet-row:hover { background: var(--surface-2); }
.a-sheet-row.danger { color: var(--danger); }
.a-sheet-row.muted { color: var(--muted); }

.a-viewer {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(0, 0, 0, 0.9);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 16px;
}

.a-viewer img { max-width: 100%; max-height: 80vh; object-fit: contain; touch-action: pinch-zoom; }

@media (min-width: 1024px) {
  .a-sheet { border-radius: 16px; margin-bottom: 10vh; }
  .a-modal { align-items: center; }
}
</style>
