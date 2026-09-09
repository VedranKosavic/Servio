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
// Hydrates the outbox and the drafts off IndexedDB, and owns the flush timers.
const { outbox } = useOutbox()

const states = ref<TableState[]>([])
const shift = ref<ShiftBrief | null>(null)

const { data: boot, refresh: refreshBoot } = useBootstrapData()

// The session is a cookie the server reads, so this check is a request, not a
// localStorage lookup — and it therefore belongs in `onMounted` rather than in
// route middleware, which would also run on the server with no cookie jar.
onMounted(() => {
  void me.requireSession()
})

useChanges({
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

/**
 * The room as **this phone** knows it: what the server says, plus the tables
 * whose rounds are still on the queue.
 *
 * Without this, a waiter who locks a round with no signal watches Sto 12 stay
 * drawn as free — and a table drawn free is a table a colleague will sit
 * somebody at. The overlay tells the truth the phone actually has: the table is
 * his, and this is what is on it. The amount is priced from the catalogue,
 * which is allowed here because it is a number to read, never a number to send;
 * the server prices the round for real when the entry lands.
 */
const priceById = computed(() =>
  new Map((boot.value?.products ?? []).map(p => [p.id, p.price_fen])))

const queuedByTable = computed(() => {
  const totals = new Map<string, number>()
  for (const entry of outbox.entries) {
    if (entry.kind !== 'order') continue
    const payload = entry.payload as {
      table_id?: string | null
      lines?: { product_id: string, qty: number }[]
    }
    if (!payload.table_id) continue
    const sum = (payload.lines ?? []).reduce(
      (n, line) => n + (priceById.value.get(line.product_id) ?? 0) * line.qty, 0,
    )
    totals.set(payload.table_id, (totals.get(payload.table_id) ?? 0) + sum)
  }
  return totals
})

const shownStates = computed<TableState[]>(() => {
  const myId = me.user.value?.id ?? null
  const merged = [...states.value]
  for (const [tableId, fen] of queuedByTable.value) {
    const existing = merged.findIndex(s => s.table_id === tableId)
    if (existing >= 0) {
      // The server already has a tab here; add what it has not seen yet.
      const row = merged[existing]!
      merged[existing] = {
        ...row,
        total_fen: row.total_fen + fen,
        remaining_fen: row.remaining_fen + fen,
      }
      continue
    }
    merged.push({
      table_id: tableId,
      // No server id yet, and the tile only asks whether there is *a* tab.
      tab_id: `local:${tableId}`,
      tab_client_id: null,
      total_fen: fen,
      remaining_fen: fen,
      assigned_to: myId,
      assigned_to_initials: me.user.value?.initials ?? null,
      opened_by_name: me.user.value?.name ?? null,
      opened_at: null,
      last_order_at: null,
      pending_review: false,
      late_sync: false,
      offered_to: null,
    })
  }
  return merged
})

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
          <WaiterSyncChip />

          <button
            type="button"
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-base font-bold text-accent-ink"
            aria-label="Korisnik"
            @click="menuOpen = true"
          >
            {{ me.user.value?.initials ?? '?' }}
          </button>
        </template>
      </WaiterHeader>

      <WaiterOutboxBanner />

      <div class="flex flex-1 flex-col gap-4 py-4">
        <!-- A queued body the server refused. It blocks its own table only. -->
        <WaiterFailedCard />

        <!-- A new build is waiting, and this is a safe moment to take it. -->
        <WaiterUpdatePrompt />
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
          :states="shownStates"
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

    <WaiterAvatarSheet v-if="menuOpen" @close="menuOpen = false" />

    <template #fallback>
      <p class="py-10 text-center text-text-2">
        Učitavanje…
      </p>
    </template>
  </ClientOnly>
</template>
