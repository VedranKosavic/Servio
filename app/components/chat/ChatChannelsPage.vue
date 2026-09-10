<script setup lang="ts">
/**
 * **S15 *Kanali*** — the channel list, and the screen most people never see.
 *
 * When the only unread messages are in the channel this phone was last reading,
 * it opens straight there: the list is a chooser, and choosing between two rows
 * when one of them is obviously the answer is a tap nobody should have to make.
 * The last channel is remembered in IndexedDB, so it survives a reload.
 *
 * The waiter and the bartender share this component and differ only in where
 * the back arrow goes — `/konobar` for one, `/sanker` for the other, the
 * `/sanker/popis` precedent.
 */
import { localTime } from '#shared/dates'
import type { ChannelKind } from '#shared/chat'

const props = defineProps<{
  /** Where the back arrow lands: the floor plan, or the ticket queue. */
  backTo: string
  /** `/konobar/razgovor` or `/sanker/razgovor` — the prefix a channel row navigates to. */
  base: string
}>()

const me = useMe()
const { chat } = useChat()

onMounted(() => {
  void me.requireSession()
})

/** A badge stops counting at 99: the number stops being information after that. */
function badge(n: number): string {
  return n > 99 ? '99+' : String(n)
}

/**
 * Open the last-read channel when it is the only one with anything new.
 *
 * Once, on the first bootstrap. Coming *back* here from a channel leaves that
 * channel read, so the condition is false and the list stays — no loop, and no
 * screen a back arrow cannot escape.
 */
const jumped = ref(false)

watch(() => chat.loaded, async (ready) => {
  if (!ready || jumped.value) return
  jumped.value = true
  const unread = chat.channels.filter(c => c.unread > 0)
  if (unread.length !== 1) return
  const last = await chat.lastChannel()
  if (last && last === unread[0]!.kind) {
    await navigateTo(`${props.base}/${last}`)
  }
}, { immediate: true })

function open(kind: ChannelKind) {
  void navigateTo(`${props.base}/${kind}`)
}
</script>

<template>
  <div class="flex flex-1 flex-col">
    <WaiterHeader title="Razgovor" :back-to="backTo">
      <template #right>
        <WaiterSyncChip />
      </template>
    </WaiterHeader>

    <main class="flex flex-1 flex-col py-4">
      <!-- Two or three channels are a list, not a stack of cards: one edge, a
           rule between them, and the unread count as the only colour. -->
      <div v-if="chat.channels.length" class="card px-4">
        <button
          v-for="channel in chat.channels"
          :key="channel.id"
          type="button"
          class="row w-full flex-col items-stretch gap-1 py-3"
          @click="open(channel.kind)"
        >
          <span class="flex items-center gap-2">
            <span class="section-title grow truncate">{{ channel.name }}</span>
            <span v-if="channel.preview_at" class="num shrink-0 text-caption tracking-normal text-muted">
              {{ localTime(channel.preview_at) }}
            </span>
            <span
              v-if="channel.unread > 0"
              class="num min-w-6 shrink-0 rounded-chip bg-accent px-1.5 text-center text-label font-bold text-accent-ink"
            >
              {{ badge(channel.unread) }}
            </span>
          </span>

          <span class="truncate text-label text-text-2">
            {{ channel.preview ?? 'Još nema poruka' }}
          </span>

          <!-- The one note that belongs on a list rather than inside a thread. -->
          <span v-if="channel.pinned_text" class="flex items-center gap-2 pt-1">
            <span class="chip chip-warn shrink-0">Za naručiti</span>
            <span class="truncate text-label text-text-2">{{ channel.pinned_text.split('\n')[0] }}</span>
          </span>
        </button>
      </div>

      <p v-else-if="chat.loaded" class="empty">
        Nema kanala.
      </p>
    </main>
  </div>
</template>
