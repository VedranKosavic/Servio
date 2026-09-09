<script setup lang="ts">
/**
 * `/s` — ŠANK · NARUDŽBE. The bartender's only working screen.
 *
 * The house rule behind it (PLAN.md §9): "no ticket, no drink". A round appears
 * here the moment a waiter locks it and leaves when it is tapped *Gotovo*.
 * Oldest first — the bar works the queue in the order it arrived, not newest
 * on top. No tables, no prices: this screen is the kitchen pass, not a till.
 */
import { useTimestamp } from '@vueuse/core'

useHead({ title: 'Narudžbe' })

const me = useMe()
const { open, done, busy, errorMessage, online, loaded, markDone } = usePrepPolling()

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
        Šank · narudžbe
      </h1>
      <span class="chip" :class="online ? 'chip-good' : 'chip-danger'">
        <span class="size-2 rounded-full bg-current" />
        {{ online ? 'Sinhronizovano' : 'Nema veze' }}
      </span>
      <div class="relative">
        <button
          type="button"
          class="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-sm font-bold"
          aria-label="Korisnik"
          @click="menuOpen = !menuOpen"
        >
          {{ me.user.value?.initials ?? '?' }}
        </button>

        <template v-if="menuOpen">
          <div class="fixed inset-0 z-30" @click="menuOpen = false" />
          <div class="card absolute right-0 top-full z-40 mt-2 flex w-60 flex-col gap-2 p-2">
            <p class="px-2 pt-1 text-sm text-text-2">
              {{ me.user.value?.name }}
            </p>
            <NuxtLink to="/k/smjena" class="btn w-full">
              Završi smjenu
            </NuxtLink>
            <button type="button" class="btn btn-ghost w-full" @click="me.logout()">
              Promijeni korisnika
            </button>
          </div>
        </template>
      </div>
    </header>

    <main class="flex flex-1 flex-col gap-3 py-4">
      <p v-if="errorMessage" class="rounded-xl bg-danger-soft px-3 py-2 text-[15px] text-danger">
        {{ errorMessage }}
      </p>

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
  </div>
</template>
