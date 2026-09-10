<script setup lang="ts">
/**
 * **S15 *Kanali*** — the channel list, and the screen most people never see.
 *
 * When the only unread messages are in the channel this phone was last reading,
 * it opens straight there: the list is a chooser, and choosing between two rows
 * when one of them is obviously the answer is a tap nobody should have to make.
 * The last channel is remembered in IndexedDB, so it survives a reload.
 *
 * The waiter and the bartender share this component and differ only in where the
 * back arrow goes — `/k` for one, `/s` for the other, the `/s/popis` precedent.
 */
import { localTime } from '#shared/dates'
import type { ChannelKind } from '#shared/chat'

const props = defineProps<{
  /** Where the back arrow lands: the floor plan, or the ticket queue. */
  backTo: string
  /** `/k/razgovor` or `/s/razgovor` — the prefix a channel row navigates to. */
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

    <main class="flex flex-1 flex-col gap-2 py-3">
      <button
        v-for="channel in chat.channels"
        :key="channel.id"
        type="button"
        class="card flex min-h-16 flex-col gap-1 px-4 py-3 text-left active:bg-surface-2"
        @click="open(channel.kind)"
      >
        <div class="flex items-center gap-2">
          <span class="grow text-lg font-semibold">{{ channel.name }}</span>
          <span v-if="channel.preview_at" class="num shrink-0 text-sm text-muted">
            {{ localTime(channel.preview_at) }}
          </span>
          <span
            v-if="channel.unread > 0"
            class="num min-w-6 shrink-0 rounded-full bg-accent px-1.5 text-center text-sm font-bold text-accent-ink"
          >
            {{ badge(channel.unread) }}
          </span>
        </div>

        <span class="truncate text-text-2">
          {{ channel.preview ?? 'Još nema poruka' }}
        </span>

        <!-- The one note that belongs on a list rather than inside a thread. -->
        <span v-if="channel.pinned_text" class="flex items-center gap-2">
          <span class="chip chip-warn shrink-0">Za naručiti</span>
          <span class="truncate text-text-2">{{ channel.pinned_text.split('\n')[0] }}</span>
        </span>
      </button>

      <p v-if="chat.loaded && chat.channels.length === 0" class="card px-4 py-8 text-center text-text-2">
        Nema kanala.
      </p>
    </main>
  </div>
</template>
