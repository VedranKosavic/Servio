<script setup lang="ts">
/**
 * One message in the dark thread: a bubble, a system line, or a placeholder
 * where somebody removed something.
 *
 * Three rules the layout depends on:
 *
 * **A removed message keeps its slot.** The bubble becomes "Poruku uklonio Haris
 * · 22:41" — who and when, never the text. The text is still in the database as
 * moderation evidence and it never comes back to a screen.
 *
 * **An image reserves its space before it loads.** `width`/`height` on the `<img>`
 * give the browser the aspect ratio up front, so the thread does not jump under
 * a thumb when a photo two screens up finally arrives.
 *
 * **A system line is not a person.** Centred, grey, never a badge, and its
 * optional link is one 48 px secondary button — a shortcut to a screen, never an
 * action of its own. Chat does not call a roster route.
 */
import { localTime } from '#shared/dates'
import type { ChatMessage } from '#shared/types'

const props = defineProps<{
  message: ChatMessage
  /** Is this the person holding the phone? Own bubbles sit on the right. */
  mine: boolean
  /** Queued on this phone and not yet confirmed by the server. */
  waiting?: boolean
  /** A local `blob:` URL for a photo that has not left the phone yet. */
  localSrc?: string
}>()

const emit = defineEmits<{
  open: [message: ChatMessage]
  /** The photo, plus the message it belongs to — the viewer needs both. */
  image: [payload: { message: ChatMessage, src: string }]
  link: [route: string]
}>()

const at = computed(() => localTime(props.message.at))
const link = computed(() => props.message.system_payload?.link ?? null)

/** The removed-bubble sentence: an image says *sliku*, a text says *poruku*. */
const removedText = computed(() => {
  const who = props.message.deleted_by_name ?? 'Uklonjeno'
  const what = props.message.kind === 'image' ? 'Sliku uklonio' : 'Poruku uklonio'
  return `${what} ${who} · ${at.value}`
})

const src = computed(() => props.localSrc ?? props.message.image?.url ?? null)
</script>

<template>
  <!-- A system line: centred, grey, and never a badge. -->
  <div v-if="message.kind === 'system'" class="flex flex-col items-center gap-2 py-1">
    <p class="max-w-[85%] text-center text-sm text-text-2">
      {{ message.body }}
    </p>
    <button
      v-if="link"
      type="button"
      class="btn btn-ghost min-h-12 text-base"
      @click="emit('link', link.route)"
    >
      {{ link.label }}
    </button>
  </div>

  <div v-else class="flex" :class="mine ? 'justify-end' : 'justify-start'">
    <div class="flex max-w-[85%] flex-col gap-1">
      <span v-if="!mine && message.author_name" class="px-1 text-sm text-text-2">
        {{ message.author_name }}
      </span>

      <button
        type="button"
        class="flex flex-col gap-1.5 rounded-2xl border px-3 py-2 text-left"
        :class="mine ? 'border-accent bg-surface-2 text-text' : 'border-line bg-surface text-text'"
        @click="emit('open', message)"
      >
        <template v-if="message.deleted_at">
          <span class="italic text-muted">{{ removedText }}</span>
        </template>

        <template v-else>
          <!-- The quoted first line of what this answers. Never the whole message. -->
          <span
            v-if="message.reply_preview"
            class="block border-l-2 border-accent pl-2 text-sm text-text-2"
          >
            {{ message.reply_preview }}
          </span>

          <template v-if="message.kind === 'image'">
            <span
              v-if="message.image && message.image.expired"
              class="flex h-24 w-[320px] max-w-full items-center justify-center rounded-xl bg-surface-2 text-text-2"
            >
              Slika istekla
            </span>
            <img
              v-else-if="src"
              :src="src"
              :width="(message.image && message.image.width) || 320"
              :height="(message.image && message.image.height) || 240"
              alt="Slika"
              class="h-auto w-[320px] max-w-full rounded-xl bg-surface-2"
              @click.stop="emit('image', { message, src })"
            >
          </template>

          <span v-if="message.body" class="whitespace-pre-wrap break-words">
            {{ message.body }}
          </span>
        </template>

        <span class="num flex items-center gap-1 self-end text-xs text-muted">
          <template v-if="waiting">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
            čeka slanje
          </template>
          <template v-else>{{ at }}</template>
        </span>
      </button>
    </div>
  </div>
</template>
