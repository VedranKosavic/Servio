<script setup lang="ts">
/**
 * Stolovi — the waiter's home screen: the room from above, one circle per
 * table, refreshed every 15 s.
 *
 * Everything on it comes from two calls: `bootstrap` for the layout and
 * `tables/state` for who is sitting where. The plan itself is drawn by
 * `FloorPlan` from the tables' col/row, so adding a table is a database insert.
 */
import type { TableState, Zone } from '#shared/types'

useHead({ title: 'Stolovi' })

const api = useApi()
const session = useSessionStore()

// The session lives in localStorage, so this check can only be made in the
// browser — a route middleware would run on the server too, where the session
// is always empty, and would bounce everybody back to the start screen.
onMounted(() => {
  if (!session.isWaiter) navigateTo('/')
})

const { data: boot } = useBootstrapData()

const states = ref<TableState[]>([])
const { ok: synced } = usePolling(async () => {
  states.value = (await api.getTablesState()).tables
})

// Which zone the waiter was last looking at. Remembered per phone: a waiter who
// works the terrace should not tap "Bašta" every time he opens the app.
const zone = useLocalStorage<Zone>('sank:zona', 'unutra')

const menuOpen = ref(false)

function openTable(tableId: string) {
  navigateTo(`/k/sto/${tableId}`)
}

function changeUser() {
  session.clear()
  navigateTo('/')
}
</script>

<template>
  <ClientOnly>
    <div class="flex flex-1 flex-col">
      <WaiterHeader title="Stolovi">
        <template #right>
          <span class="chip" :class="synced ? 'chip-good' : 'chip-danger'">
            <span class="h-2 w-2 shrink-0 rounded-full bg-current" />
            {{ synced ? 'Sinhronizovano' : 'Nema veze' }}
          </span>

          <div class="relative">
            <button
              type="button"
              class="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-base font-bold text-accent-ink"
              aria-label="Korisnik"
              @click="menuOpen = !menuOpen"
            >
              {{ session.state.initials }}
            </button>

            <template v-if="menuOpen">
              <!-- A tap anywhere else closes the menu. -->
              <div class="fixed inset-0 z-30" @click="menuOpen = false" />
              <div class="card absolute right-0 top-full z-40 mt-2 w-56 p-2">
                <button type="button" class="btn w-full" @click="changeUser">
                  Promijeni korisnika
                </button>
              </div>
            </template>
          </div>
        </template>
      </WaiterHeader>

      <div class="flex flex-1 flex-col gap-4 py-4">
        <div class="flex gap-2.5">
          <button
            v-for="option in ([{ id: 'unutra', label: 'Unutra' }, { id: 'basta', label: 'Bašta' }] as const)"
            :key="option.id"
            type="button"
            class="flex h-12 flex-1 items-center justify-center rounded-3xl border-[1.5px] text-[17px] font-semibold"
            :class="zone === option.id ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-transparent text-text-2'"
            @click="zone = option.id"
          >
            {{ option.label }}
          </button>
        </div>

        <FloorPlan
          v-if="boot"
          :tables="boot.tables"
          :zone="zone"
          :states="states"
          :users="boot.users"
          :my-name="session.state.name"
          @select="openTable"
        />
        <p v-else class="py-10 text-center text-text-2">
          Učitavanje…
        </p>

        <p class="text-center text-sm text-text-2">
          Dodirni sto → narudžba
        </p>
      </div>
    </div>

    <template #fallback>
      <p class="py-10 text-center text-text-2">
        Učitavanje…
      </p>
    </template>
  </ClientOnly>
</template>
