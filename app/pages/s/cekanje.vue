<script setup lang="ts">
/**
 * `/s/cekanje` — ŠANK · NA ČEKANJU (S14, PLAN F6 step 3).
 *
 * The bartender's second screen: every storno and gratis somebody has asked for
 * and nobody has answered. One tap decides it, and the tap is only offered while
 * the line is inside `bartender_approve_window_s` — after that the row says *Ide
 * vlasniku*, because a fifteen-minute-old round is the owner's call.
 *
 * Two things this screen deliberately does **not** do:
 *
 * - **It does not poll on its own.** `useChanges()` is the single timer in the
 *   app; the queue is refetched when the feed says an `adjustment` row moved, and
 *   at no other time. A waiter's request therefore appears here within one poll
 *   of him tapping *Zatraži storno*.
 * - **It does not queue a decision.** A bartender's authority is a window
 *   measured at the moment he decides, so a decision sitting in an outbox for an
 *   hour would be an authority he no longer has. With no network the screen says
 *   so and the queue waits.
 *
 * The waiter's own requests are visible to him too — `GET /api/adjustments/pending`
 * is scoped by role, and a waiter's answer contains only his own rows and never
 * a colleague's money (invariant 9).
 */
import { useTimestamp } from '@vueuse/core'
// Explicit, not auto-imported. Nuxt names a component after its folder plus its
// file (`waiter/WaiterSyncChip.vue` → `WaiterSyncChip`, because the file already
// starts with the folder). `adjust/AdjPendingCard.vue` does not, so the
// auto-import would be `<AdjustAdjPendingCard>` — and an unresolved tag in a
// production build renders nothing at all, silently. Importing it by name is one
// line and cannot go quiet on a Saturday night.
import AdjPendingCard from '~/components/adjust/AdjPendingCard.vue'
import type { PendingAdjustment } from '#shared/types'

useHead({ title: 'Na čekanju' })

const me = useMe()
// The bartender queues stock from this screen's nav too, so the flush timers
// live here as well; the chip in the header reads the same store.
useOutbox()
const { pending, loaded, loadError, deciding, load, decide, approveWindowS } = useAdjustments()

/**
 * The owner decides with no window; a bartender's closes fifteen minutes after
 * the lock. Passing it down is what lets a card take its own buttons away as the
 * minutes pass, instead of leaving one that has quietly become a 403.
 */
const windowS = computed(() => (me.user.value?.role === 'admin' ? null : approveWindowS.value))

onMounted(async () => {
  if (await me.requireSession()) await load()
})

// One poll, shared with every other screen. `adjustment` moves on a request and
// on a decision; `full` is the first answer after this screen opened.
useChanges({
  raw: (result) => {
    if (result.full || result.changes.some(c => c.entity === 'adjustment')) void load()
  },
  me: () => me.load(),
}, { intervalMs: 10_000 })

const menuOpen = ref(false)

// One clock for the whole screen: "čeka 4 min" keeps counting between polls.
const now = useTimestamp({ interval: 2000 })

/** The ones he can answer first; the owner's are still worth seeing. */
function answerable(row: PendingAdjustment): boolean {
  if (!row.can_decide) return false
  if (windowS.value === null) return true
  return row.seconds_since_lock + ticketAgeSeconds(row.created_at, now.value) <= windowS.value
}

const mine = computed(() => pending.value.filter(answerable))
const theirs = computed(() => pending.value.filter(row => !answerable(row)))
</script>

<template>
  <div class="flex flex-1 flex-col">
    <header class="flex items-center gap-2.5 border-b border-line py-2.5">
      <h1 class="flex-1 truncate text-xl font-bold">
        Na čekanju
      </h1>
      <WaiterSyncChip />
      <button
        type="button"
        class="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-sm font-bold"
        aria-label="Korisnik"
        @click="menuOpen = true"
      >
        {{ me.user.value?.initials ?? '?' }}
      </button>
    </header>

    <WaiterOutboxBanner />

    <main class="flex flex-1 flex-col gap-3 py-4">
      <p v-if="loadError" class="rounded-xl bg-danger-soft px-3 py-2 text-[15px] text-danger" role="alert">
        {{ loadError }}
      </p>

      <WaiterFailedCard />
      <WaiterUpdatePrompt />

      <AdjPendingCard
        v-for="row in mine"
        :key="row.id"
        :row="row"
        :now="now"
        :window-s="windowS"
        :busy="deciding === row.id"
        @decide="decide"
      />

      <template v-if="theirs.length">
        <h2 class="pt-1 text-[15px] font-semibold text-text-2">
          Čeka vlasnika
        </h2>
        <AdjPendingCard
          v-for="row in theirs"
          :key="row.id"
          :row="row"
          :now="now"
          :window-s="windowS"
          :busy="deciding === row.id"
          @decide="decide"
        />
      </template>

      <p v-if="loaded && pending.length === 0" class="card px-4 py-8 text-center text-text-2">
        Ništa ne čeka odobrenje.
      </p>

      <p class="pt-1 text-center text-sm text-muted">
        Šanker odobrava storno dok je tura mlađa od 15 minuta. Poslije odlučuje vlasnik.
      </p>
    </main>

    <SankerNav active="cekanje" />

    <WaiterAvatarSheet v-if="menuOpen" @close="menuOpen = false" />
  </div>
</template>
