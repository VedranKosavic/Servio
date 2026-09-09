<script setup lang="ts">
/**
 * `/stanje` — STANJE ŠANKA. What is actually behind the bar, right now.
 *
 * Every number on this page is `SUM(qty_delta)` over the append-only movement
 * ledger: a sale subtracts inside the same transaction that locks the round, a
 * *prijem robe* adds. Nothing here is a stored balance that somebody could edit.
 *
 * It rides on the same `/api/changes` poll as every other screen — 15 s rather
 * than the bar's 5 s, because stock moves slower than tickets and this screen is
 * read between rounds, not stared at.
 *
 * **Who may book a delivery is a setting, not a guess.** `POST /api/stock/deliveries`
 * is admin-only, plus the bartender when the owner has turned on
 * `bartender_can_receive_goods` (BACKEND §7). So the button is drawn only for
 * somebody the server would actually accept, and everybody else gets the
 * sentence saying why — a button that always answers 403 teaches a bartender to
 * distrust the app.
 */
import { useTimeoutFn } from '@vueuse/core'
import type { StockItem, StockKind } from '#shared/types'

useHead({ title: 'Stanje šanka' })

const api = useApi()
const me = useMe()

const items = ref<StockItem[]>([])
const { ok: online, lastOkAt, refresh } = useChanges({
  stock: (list) => {
    items.value = list
  },
  me: () => me.load(),
}, { intervalMs: 15_000 })

const loaded = computed(() => lastOkAt.value !== null)

onMounted(() => {
  void me.requireSession()
})

/** Admin always; a bartender only when the owner has allowed it. */
const canReceive = computed(() => {
  const role = me.user.value?.role
  if (role === 'admin') return true
  return role === 'bartender' && me.settings.value?.bartender_can_receive_goods === true
})

/** The four kinds, in the order the bar thinks about them. */
const GROUPS: Array<{ kind: StockKind, title: string }> = [
  { kind: 'pice', title: 'Pića' },
  { kind: 'duhan', title: 'Duhan' },
  { kind: 'zar', title: 'Žar' },
  { kind: 'potrosni', title: 'Potrošni' },
]

const groups = computed(() =>
  GROUPS.map(group => ({
    ...group,
    items: items.value.filter(item => item.kind === group.kind),
  })))

/**
 * The last round, rebuilt from the per-item last movements: find the newest
 * sale, then take every item whose last movement is that same sale (one round
 * is written with one `occurred_at` and one label, "Sto 7 · narudžba").
 */
const lastSale = computed<{ table: string, at: string, items: StockItem[] } | null>(() => {
  const sold = items.value.filter(item => item.last_movement?.type === 'sale')
  if (sold.length === 0) return null

  let newest = sold[0]!
  for (const item of sold) {
    // ISO-8601 UTC strings sort like the instants they describe.
    if (item.last_movement!.occurred_at > newest.last_movement!.occurred_at) newest = item
  }

  const { ref_label: label, occurred_at: at } = newest.last_movement!
  const sameRound = sold.filter(item =>
    item.last_movement!.ref_label === label && item.last_movement!.occurred_at === at)

  return { table: label.split(' · ')[0] || label, at, items: sameRound }
})

// -- Prijem robe ------------------------------------------------------------
const sheetOpen = ref(false)
const posting = ref(false)
const sheetError = ref<string | null>(null)

const toast = ref<string | null>(null)
const { start: hideToastLater } = useTimeoutFn(() => { toast.value = null }, 2500, { immediate: false })

async function postDelivery(delivery: {
  supplier_name: string
  invoice_no?: string
  delivered_at?: string
  lines: { stock_item_id: string, packs: number, loose: number, line_cost_fen: number, note?: string }[]
}) {
  if (posting.value) return

  posting.value = true
  sheetError.value = null
  try {
    // The route answers with the posted delivery note, not the stock list, so
    // the screen re-reads itself rather than swapping the array in place.
    await api.postDelivery({
      // Minted once per note: `deliveries_client_uq` is what turns a retried
      // post into one delivery instead of twelve crates booked twice.
      client_id: crypto.randomUUID(),
      ...delivery,
    })
    await refresh()
    sheetOpen.value = false
    toast.value = 'Prijem proknjižen'
    hideToastLater()
  } catch (err) {
    sheetError.value = apiErrorText(err, 'Prijem nije proknjižen.')
    void me.handleAuthError(err)
    void refresh()
  } finally {
    posting.value = false
  }
}
</script>

<template>
  <div class="flex flex-1 flex-col">
    <header class="flex items-center gap-2.5 border-b border-line py-2.5">
      <h1 class="flex-1 truncate text-xl font-bold">
        Stanje šanka
      </h1>
      <span v-if="!online" class="chip chip-danger">
        <span class="size-2 rounded-full bg-current" />
        Nema veze
      </span>
      <button
        v-if="canReceive"
        type="button"
        class="btn btn-accent px-3 text-base"
        @click="sheetOpen = true"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Prijem robe
      </button>
    </header>

    <main class="flex flex-1 flex-col gap-4 py-4">
      <StockLastSale
        v-if="lastSale"
        :table="lastSale.table"
        :at="lastSale.at"
        :items="lastSale.items"
      />

      <StockGroup
        v-for="group in groups"
        :key="group.kind"
        :title="group.title"
        :items="group.items"
      />

      <p v-if="loaded && items.length === 0" class="card px-4 py-8 text-center text-text-2">
        Nema artikala na stanju.
      </p>

      <p class="pt-1 text-center text-sm text-muted">
        Svaka poslana narudžba oduzima od stanja. Prijem robe dodaje.
        <template v-if="!canReceive">
          <br>
          Prijem robe knjiži vlasnik. Ako treba da ga knjiži šanker, vlasnik to
          uključuje u postavkama.
        </template>
      </p>
    </main>

    <SankerNav active="stanje" />

    <StockDeliverySheet
      v-if="sheetOpen"
      :items="items"
      :busy="posting"
      :error="sheetError"
      @close="sheetOpen = false"
      @submit="postDelivery"
    />

    <div
      v-if="toast"
      class="fixed inset-x-0 bottom-24 z-50 mx-auto w-fit rounded-full bg-good-soft px-4 py-2 font-semibold text-good"
    >
      {{ toast }}
    </div>
  </div>
</template>
