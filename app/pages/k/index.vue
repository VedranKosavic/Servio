<script setup lang="ts">
/**
 * Stolovi — the waiter's home screen: the room from above, one circle per table.
 *
 * Since WP9 there is exactly one timer behind it. `useChanges` asks the server
 * *anything new since 812?* every 12 s and the floor plan, the shift strip and
 * the menu version all arrive in that one answer — so the plan and the strip can
 * never disagree, because they were read inside one request (BACKEND §4.1).
 *
 * The layout still comes from `bootstrap` (which table sits at which col/row);
 * it is fetched once and refetched only when `menu_version` moves.
 */
import type { ShiftBrief, TableState, Zone } from '#shared/types'

useHead({ title: 'Stolovi' })

const api = useApi()
const me = useMe()

const states = ref<TableState[]>([])
const shift = ref<ShiftBrief | null>(null)

const { data: boot, refresh: refreshBoot } = useBootstrapData()

// The session is a cookie the server reads, so this check is a request, not a
// localStorage lookup — and it therefore belongs in `onMounted` rather than in
// route middleware, which would also run on the server with no cookie jar.
onMounted(() => {
  void me.requireSession()
})

const { ok: synced } = useChanges({
  tables: (state) => {
    states.value = state.tables
    shift.value = state.shift
  },
  menu: () => refreshBoot(),
  me: () => me.load(),
}, { intervalMs: 12_000 })

// Which zone the waiter was last looking at. Remembered per phone: a waiter who
// works the terrace should not tap "Bašta" every time he opens the app.
const zone = useLocalStorage<Zone>('sank:zona', 'unutra')

const menuOpen = ref(false)

/** Tables a colleague has offered me and I have not taken yet (§6.2). */
const offers = computed(() => {
  const myId = me.user.value?.id
  if (!myId) return []
  return states.value
    .filter(s => s.offered_to === myId && s.tab_id)
    .map(s => ({
      state: s,
      name: boot.value?.tables.find(t => t.id === s.table_id)?.name ?? 'Sto',
    }))
})

const accepting = ref<string | null>(null)
const banner = ref<string | null>(null)

async function acceptOffer(tabId: string, tableName: string) {
  if (accepting.value) return
  accepting.value = tabId
  banner.value = null
  try {
    await api.acceptTab(tabId)
    banner.value = `Preuzeo si ${tableName}`
  } catch (err) {
    banner.value = apiErrorText(err)
  } finally {
    accepting.value = null
  }
}

/** My own open tabs — the counter the *Završi smjenu* bar carries (§6.2). */
const myOpenTabs = computed(() => shift.value?.my_open_tabs ?? 0)

function openTable(tableId: string) {
  navigateTo(`/k/sto/${tableId}`)
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
              {{ me.user.value?.initials ?? '?' }}
            </button>

            <template v-if="menuOpen">
              <!-- A tap anywhere else closes the menu. -->
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
        </template>
      </WaiterHeader>

      <div class="flex flex-1 flex-col gap-4 py-4">
        <!-- Someone handed me a table -->
        <div
          v-for="offer in offers"
          :key="offer.state.tab_id!"
          class="card flex items-center gap-3 border-accent p-3"
        >
          <div class="grow">
            <div class="text-sm text-text-2">
              Nudi ti
            </div>
            <div class="text-lg font-semibold">
              {{ offer.name }}
            </div>
          </div>
          <button
            type="button"
            class="btn btn-accent"
            :disabled="accepting === offer.state.tab_id"
            @click="acceptOffer(offer.state.tab_id!, offer.name)"
          >
            Prihvati
          </button>
        </div>

        <p v-if="banner" class="rounded-xl bg-good-soft px-3 py-2 text-center text-[15px] text-good">
          {{ banner }}
        </p>

        <!-- The shift is being closed: envelopes are being collected -->
        <div
          v-if="shift?.closing && !shift.my_settled"
          class="card flex items-center gap-3 border-warn p-3"
        >
          <div class="grow text-[15px]">
            <span class="font-semibold">Smjena se zatvara.</span>
            <span class="text-text-2"> Predaj pazar.</span>
          </div>
          <NuxtLink to="/k/smjena" class="btn btn-accent shrink-0">
            Završi
          </NuxtLink>
        </div>

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
          :my-user-id="me.user.value?.id ?? null"
          @select="openTable"
        />
        <p v-else class="py-10 text-center text-text-2">
          Učitavanje…
        </p>

        <p class="text-center text-sm text-text-2">
          Dodirni sto → narudžba
          <template v-if="myOpenTabs > 0">
            · <span class="num">{{ myOpenTabs }}</span> otvorenih kod tebe
          </template>
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
