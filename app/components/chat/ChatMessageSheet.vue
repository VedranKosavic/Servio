<script setup lang="ts">
/**
 * What one message can do: *Odgovori*, *Dodaj u "Za naručiti"*, *Proslijedi u…*,
 * *Prijavi vlasniku*, *Obriši* (or *Ukloni sliku*).
 *
 * It opens on a long press **and** on the ⋯ button, because every gesture in
 * this app has a button twin — a waiter with wet hands and a screen protector
 * should never be the only person who cannot reach an action.
 *
 * The rows drawn here mirror the server's rules rather than replace them
 * (`services/chat.ts`): the author within `chat_delete_own_s`, an admin on
 * anything in *Svi* or *Admini*, and **any** member of *Konobari* on an image at
 * any age — *Ukloni sliku* is the one moderation power staff have over each
 * other, and it exists because a photo is what actually hurts. A row that the
 * server would refuse is simply not drawn.
 */
import { CHANNEL_NAMES, type ChannelKind } from '#shared/chat'
import type { ChatMessage, Role } from '#shared/types'

const props = defineProps<{
  message: ChatMessage
  kind: ChannelKind
  role: Role
  userId: string
  /** `settings.chat_delete_own_s` — how long an author may take his words back. */
  deleteWindowS: number
  busy?: boolean
}>()

const emit = defineEmits<{
  close: []
  reply: [message: ChatMessage]
  pin: [message: ChatMessage]
  forward: [to: ChannelKind]
  remove: [message: ChatMessage]
}>()

const mine = computed(() => props.message.author_id === props.userId)
const ageS = computed(() => (Date.now() - Date.parse(props.message.at)) / 1000)

/** *Ukloni sliku*: any member of *Konobari*, on an image, at any age. */
const imageInKonobari = computed(() =>
  props.kind === 'konobari' && props.message.kind === 'image')

const canDelete = computed(() => {
  if (props.message.deleted_at) return false
  if (imageInKonobari.value) return true
  if (props.role === 'admin' && (props.kind === 'svi' || props.kind === 'admini')) return true
  return mine.value && ageS.value <= props.deleteWindowS
})

const deleteLabel = computed(() =>
  (props.message.kind === 'image' ? 'Ukloni sliku' : 'Obriši'))

/**
 * Where this message may go, mirroring `mayForward` on the server. Staff carry
 * *Konobari* into *Svi* and either into *Admini* (*Prijavi vlasniku*); an admin
 * carries *Svi* into *Admini*.
 */
const targets = computed<ChannelKind[]>(() => {
  if (props.message.deleted_at) return []
  if (props.role === 'admin') return props.kind === 'svi' ? ['admini'] : []
  if (props.kind === 'konobari') return ['svi', 'admini']
  if (props.kind === 'svi') return ['admini']
  return []
})

const canPin = computed(() => !props.message.deleted_at && !!props.message.body)
const canReply = computed(() => !props.message.deleted_at && props.message.kind !== 'system')

const ROW = 'flex min-h-13 items-center rounded-control px-3 py-2.5 text-left text-body active:bg-surface-2'
</script>

<template>
  <div class="fixed inset-0 z-40 bg-black/60" @click="emit('close')" />

  <div
    class="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col gap-1 overflow-y-auto rounded-t-2xl border-t border-line bg-surface p-2 pb-5"
    role="dialog"
    aria-label="Poruka"
  >
    <button v-if="canReply" type="button" :class="ROW" :disabled="busy" @click="emit('reply', message)">
      Odgovori
    </button>

    <button v-if="canPin" type="button" :class="ROW" :disabled="busy" @click="emit('pin', message)">
      Dodaj u "Za naručiti"
    </button>

    <button
      v-for="to in targets"
      :key="to"
      type="button"
      :class="ROW"
      :disabled="busy"
      @click="emit('forward', to)"
    >
      {{ to === 'admini' ? 'Prijavi vlasniku' : `Proslijedi u ${CHANNEL_NAMES[to]}` }}
    </button>

    <button
      v-if="canDelete"
      type="button"
      :class="[ROW, 'text-danger']"
      :disabled="busy"
      @click="emit('remove', message)"
    >
      {{ deleteLabel }}
    </button>

    <button type="button" :class="[ROW, 'text-text-2']" @click="emit('close')">
      Zatvori
    </button>
  </div>
</template>
