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
useOutbox()
const { lastOkAt, refresh } = useChanges({
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

/** The header's second line: how much shelf there is to read. */
const subtitle = computed(() => {
  if (!loaded.value) return undefined
  return items.value.length === 1 ? '1 artikal' : `${items.value.length} artikala`
})

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

/**
 * The avatar sheet, on the third tab too.
 *
 * *Narudžbe* and *Na čekanju* have always had it; this one did not, so a šanker
 * standing at the shelf had to walk back a tab to reach *Razgovor*, *Brzi popis*
 * or *Odjavi se*. Every tab now opens the same sheet.
 */
const menuOpen = ref(false)

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
    <SankerHeader title="Stanje šanka" :subtitle="subtitle" @menu="menuOpen = true" />

    <main class="flex flex-1 flex-col gap-5 py-4">
      <!--
        *Prijem robe* is the screen's one action and it used to live in the top
        bar, where at 390 px it squeezed the title down to a single letter. It
        sits under the header now, full width, where a thumb reaches it and the
        title is safe.
      -->
      <button
        v-if="canReceive"
        type="button"
        class="btn btn-primary w-full"
        @click="sheetOpen = true"
      >
        <svg
          width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        Prijem robe
      </button>

      <StockLastSale
        v-if="lastSale"
        :table="lastSale.table"
        :at="lastSale.at"
        :items="lastSale.items"
      />

      <div class="flex flex-col gap-5">
        <StockGroup
          v-for="group in groups"
          :key="group.kind"
          :title="group.title"
          :items="group.items"
        />
      </div>

      <p v-if="loaded && items.length === 0" class="empty">
        Nema artikala na stanju.
        <span>Vlasnik dodaje artikle u kontrolnoj ploči.</span>
      </p>

      <p class="foot">
        Svaka zaključana tura oduzima od stanja, prijem robe dodaje. Ništa ovdje
        nije upisano ručno.
        <template v-if="!canReceive">
          <br>
          Prijem robe knjiži vlasnik. Ako treba da ga knjiži šanker, vlasnik to
          uključuje u postavkama.
        </template>
      </p>
    </main>

    <SankerNav active="stanje" />

    <WaiterAvatarSheet v-if="menuOpen" @close="menuOpen = false" />

    <StockDeliverySheet
      v-if="sheetOpen"
      :items="items"
      :busy="posting"
      :error="sheetError"
      @close="sheetOpen = false"
      @submit="postDelivery"
    />

    <div v-if="toast" class="toast toast-good" role="status">
      {{ toast }}
    </div>
  </div>
</template>

<style scoped>
.foot {
  margin: 4px 0 0;
  font-size: var(--text-label);
  line-height: 1.45;
  text-align: center;
  color: var(--muted);
}

/* The one confirmation this screen gives back, in the app's toast with the
   good-tone ink rather than a pill of its own invention. */
.toast-good {
  background: var(--good-soft);
  border-color: transparent;
  color: var(--good);
  font-weight: 600;
}
</style>
