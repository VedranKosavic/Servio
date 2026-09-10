<script setup lang="ts">
/**
 * `/sanker` — NARUDŽBE. The bartender's only working screen.
 *
 * The house rule behind it (PLAN.md §9): "no ticket, no drink". A round appears
 * here the moment a waiter locks it and leaves when it is tapped *Gotovo*.
 * Oldest first — the bar works the queue in the order it arrived, not newest
 * on top. No tables, no prices: this screen is the kitchen pass, not a till.
 *
 * The screen is two blocks and a rule between them: what is waiting, and what is
 * done. The waiting block is titled with its own count, so "how far behind am I"
 * is answered by the heading rather than by counting cards.
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

/** The header's second line: the queue's own size, in words that count. */
const subtitle = computed(() => {
  if (!loaded.value) return undefined
  const n = open.value.length
  if (n === 0) return 'Nema tura u redu'
  if (n === 1) return '1 tura u redu'
  return n < 5 ? `${n} ture u redu` : `${n} tura u redu`
})
</script>

<template>
  <div class="flex flex-1 flex-col">
    <SankerHeader title="Narudžbe" :subtitle="subtitle" @menu="menuOpen = true" />

    <WaiterOutboxBanner />

    <main class="flex flex-1 flex-col gap-4 py-4">
      <p v-if="errorMessage" class="note note-danger" role="alert">
        {{ errorMessage }}
      </p>

      <WaiterFailedCard />
      <WaiterUpdatePrompt />

      <div v-if="open.length" class="flex flex-col gap-4">
        <TicketCard
          v-for="(order, index) in open"
          :key="order.order_id"
          :order="order"
          :now="now"
          :primary="index === 0"
          :busy="busy.has(order.order_id)"
          @done="markDone"
        />
      </div>

      <p v-else-if="loaded" class="empty">
        Nema narudžbi.
        <span>Tiket stiže sam čim konobar zaključa turu.</span>
      </p>

      <TicketDoneList :orders="done" :now="now" />

      <p class="foot">
        Šanker ne vidi stolove ni iznose — samo šta se pravi i za koji sto ide.
      </p>
    </main>

    <SankerNav active="narudzbe" />

    <WaiterAvatarSheet v-if="menuOpen" @close="menuOpen = false" />
  </div>
</template>

<style scoped>
/* The sentence a screen ends with: the rule it works by, said once, quietly. */
.foot {
  margin: 4px 0 0;
  font-size: var(--text-label);
  line-height: 1.45;
  text-align: center;
  color: var(--muted);
}
</style>
