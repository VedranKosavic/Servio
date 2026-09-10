<script setup lang="ts">
/**
 * `/sanker` — ŠANK · NARUDŽBE. The bartender's only working screen.
 *
 * The house rule behind it (PLAN.md §9): "no ticket, no drink". A round appears
 * here the moment a waiter locks it and leaves when it is tapped *Gotovo*.
 * Oldest first — the bar works the queue in the order it arrived, not newest
 * on top. No tables, no prices: this screen is the kitchen pass, not a till.
 */
import { useTimestamp } from '@vueuse/core'

useHead({ title: 'Narudžbe' })

const me = useMe()
// The bartender queues stock too (otpis, popis), so the flush timers live here
// as well; the chip in the header reads the same store.
useOutbox()
const { open, done, busy, errorMessage, loaded, markDone } = usePrepPolling()

// Who is holding the tablet is the server's answer now, not localStorage's:
// *Gotovo* is recorded against the session, so a screen with no session has
// nobody to record against and belongs back at the lock screen.
onMounted(() => {
  void me.requireSession()
})

const menuOpen = ref(false)

// One clock for the whole screen: "prije 5 s" keeps counting between polls.
const now = useTimestamp({ interval: 2000 })
</script>

<template>
  <div class="flex flex-1 flex-col">
    <header class="flex items-center gap-2.5 border-b border-line py-2.5">
      <h1 class="flex-1 truncate text-xl font-bold">
        {{ APP_NAME }} · narudžbe
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
      <p v-if="errorMessage" class="rounded-xl bg-danger-soft px-3 py-2 text-[15px] text-danger">
        {{ errorMessage }}
      </p>

      <WaiterFailedCard />
      <WaiterUpdatePrompt />

      <TicketCard
        v-for="(order, index) in open"
        :key="order.order_id"
        :order="order"
        :now="now"
        :primary="index === 0"
        :busy="busy.has(order.order_id)"
        @done="markDone"
      />

      <p v-if="loaded && open.length === 0" class="card px-4 py-8 text-center text-text-2">
        Nema narudžbi — čekamo konobare.
      </p>

      <TicketDoneList :orders="done" :now="now" />

      <p class="pt-1 text-center text-sm text-muted">
        Tiket stiže sam čim konobar pošalje narudžbu. Šanker ne vidi stolove ni iznose.
      </p>
    </main>

    <SankerNav active="narudzbe" />

    <WaiterAvatarSheet v-if="menuOpen" @close="menuOpen = false" />
  </div>
</template>
