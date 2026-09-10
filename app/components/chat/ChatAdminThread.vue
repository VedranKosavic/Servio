<script setup lang="ts">
/**
 * The thread, in the light kit — a re-implementation, not a re-skin (PHASE4 §1).
 *
 * `/konobar` is dark and `/admin` is light and the two never share a rule:
 * every colour below is a `--` token from `app/assets/css/admin.css`, and
 * nothing in this file is a Tailwind class from the waiter app. The behaviour
 * is the same behaviour — own on the right, system lines centred, images with
 * their size reserved, a removed bubble that says who and when and never the
 * text.
 */
import { localTime } from '#shared/dates'
import type { ChatMessage } from '#shared/types'

defineProps<{
  messages: ChatMessage[]
  myId: string
}>()

const emit = defineEmits<{
  open: [message: ChatMessage]
  image: [src: string]
}>()
</script>

<template>
  <div class="a-thread">
    <template v-for="message in messages" :key="message.id">
      <p v-if="message.kind === 'system'" class="a-sys">
        {{ message.body }}
      </p>

      <div v-else class="a-row" :class="{ mine: message.author_id === myId }">
        <button
          type="button"
          class="a-bubble"
          :class="{ mine: message.author_id === myId }"
          @click="emit('open', message)"
        >
          <span v-if="message.author_id !== myId && message.author_name" class="a-who">
            {{ message.author_name }}
          </span>

          <span v-if="message.deleted_at" class="a-gone">
            {{ message.kind === 'image' ? 'Sliku uklonio' : 'Poruku uklonio' }}
            {{ message.deleted_by_name ?? '' }} · {{ localTime(message.at) }}
          </span>

          <template v-else>
            <span v-if="message.reply_preview" class="a-quote">{{ message.reply_preview }}</span>

            <span v-if="message.kind === 'image' && message.image && message.image.expired" class="a-expired">
              Slika istekla
            </span>
            <img
              v-else-if="message.kind === 'image' && message.image"
              :src="message.image.url"
              :width="message.image.width || 320"
              :height="message.image.height || 240"
              alt="Slika"
              class="a-photo"
              @click.stop="emit('image', message.image!.url)"
            >

            <span v-if="message.body" class="a-text">{{ message.body }}</span>
          </template>

          <span class="a-at">{{ localTime(message.at) }}</span>
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.a-thread { display: flex; flex-direction: column; gap: 10px; }

.a-sys {
  margin: 4px auto;
  max-width: 80%;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}

.a-row { display: flex; justify-content: flex-start; }
.a-row.mine { justify-content: flex-end; }

.a-bubble {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 78%;
  padding: 8px 12px;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.a-bubble.mine { background: var(--accent-soft); border-color: var(--accent-soft); }

.a-who { font-size: 13px; color: var(--muted); }
.a-gone { font-style: italic; color: var(--muted); }
.a-quote { border-left: 2px solid var(--accent); padding-left: 8px; font-size: 13px; color: var(--ink-2); }
.a-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.a-at { align-self: flex-end; font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }

.a-photo {
  width: 320px;
  max-width: 100%;
  height: auto;
  border-radius: 10px;
  background: var(--surface-2);
  cursor: zoom-in;
}

.a-expired {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 280px;
  max-width: 100%;
  height: 90px;
  border-radius: 10px;
  background: var(--surface-2);
  color: var(--muted);
}
</style>
