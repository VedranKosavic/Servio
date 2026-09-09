<script setup lang="ts">
/**
 * Narudžba — the round being built for one table, and the till that closes it.
 *
 * The draft lives in the cart store (IndexedDB), not here, so walking away to
 * another table and coming back does not lose the taps. This screen turns the
 * catalogue into tiles, hands the draft to the **outbox**, and opens the
 * *Naplati* sheet when the guests ask for the bill.
 *
 * Since Phase 3 nothing on this screen posts money itself. *Pošalji šankeru*,
 * *Naplati* and *Nije plaćeno* all `enqueue(...)`, which writes to IndexedDB and
 * returns immediately; `app/stores/outbox.ts` gets it to the server, in order,
 * exactly once, whenever there is a network. A waiter's thumb never waits for a
 * router, and a dead spot behind the fridge costs nothing.
 *
 * Note what is never sent: a price, and — since WP9 — a person. The tiles show
 * prices so the waiter can read them out to the guest, but the body carries
 * product ids and quantities; and who locked the round is the session's
 * business, not the body's (BACKEND §5.7). A phone that could send either could
 * send any price under anybody's name.
 */
import { formatKm } from '#shared/money'
import type { PaymentMethod, Product, TableState } from '#shared/types'

const route = useRoute()
const me = useMe()
const cart = useCartStore()
const { outbox, enqueue } = useOutbox()
const { lockToast } = useSync()

const tableId = computed(() => String(route.params.id))

onMounted(() => {
  void me.requireSession()
})

const { data: boot, refresh: refreshBoot } = useBootstrapData()

const table = computed(() => boot.value?.tables.find(t => t.id === tableId.value) ?? null)
const tableName = computed(() => table.value?.name ?? 'Sto')
const zoneLabel = computed(() => (table.value?.zone === 'basta' ? 'Bašta' : 'Unutra'))

useHead({ title: tableName })

/**
 * The table's open tab. It rides in on the same `/api/changes` answer as
 * everything else, so a colleague adding a round to this table while the sheet
 * is open moves the amount under the *Naplati* button within a poll.
 */
const tabState = ref<TableState | null>(null)
const { refresh: refreshState } = useChanges({
  tables: (state) => {
    tabState.value = state.tables.find(r => r.table_id === tableId.value) ?? null
  },
  menu: () => refreshBoot(),
  me: () => me.load(),
}, { intervalMs: 12_000 })

// -- The menu ---------------------------------------------------------------

/** Not a real category: the shortcut row of the dozen things ordered all night. */
const FAVOURITES = 'omiljeno'
const activeTab = ref<string>(FAVOURITES)

const products = computed(() => boot.value?.products ?? [])

const tabs = computed(() => {
  // Categories with nothing in them would be a dead end, so they are left out.
  const withProducts = (boot.value?.categories ?? [])
    .filter(category => products.value.some(p => p.category_id === category.id))
    .map(category => ({ id: category.id, name: category.name }))
  return [{ id: FAVOURITES, name: 'Omiljeno' }, ...withProducts]
})

const shown = computed(() => (
  activeTab.value === FAVOURITES
    ? products.value.filter(p => p.is_favourite)
    : products.value.filter(p => p.category_id === activeTab.value)
))

// -- The draft --------------------------------------------------------------

const lines = computed(() => cart.linesFor(tableId.value))
const count = computed(() => cart.countFor(tableId.value))

const priceById = computed(() => new Map(products.value.map(p => [p.id, p.price_fen])))
/** The draft's own total, for the button. The server prices the real thing. */
const draftTotal = computed(() => lines.value.reduce(
  (sum, line) => sum + (priceById.value.get(line.product_id) ?? 0) * line.qty,
  0,
))

/** 1 stavka · 2–4 stavke · 5+ stavki — Bosnian counts in three buckets. */
function stavke(n: number): string {
  const ones = n % 10
  const tens = n % 100
  if (ones === 1 && tens !== 11) return `${n} stavka`
  if (ones >= 2 && ones <= 4 && (tens < 12 || tens > 14)) return `${n} stavke`
  return `${n} stavki`
}

/** Money for this table still on the phone. Keeps the card honest (§2.3). */
const queuedHere = computed(() => outbox.pendingForTab(
  tabState.value?.tab_client_id ?? cart.tabClientIdFor(tableId.value),
))
const payQueued = computed(() => queuedHere.value.some(e => e.kind === 'pay'))

/**
 * What this table owes **according to this phone**: what the server knows plus
 * every round still on the queue, minus every payment still on the queue.
 *
 * The queued part is priced from the catalogue, which is the one place in the
 * app that is allowed to do that — it is a number to read out to a guest, never
 * a number that is sent. The server prices the round for real when the entry
 * lands, and the amber *Cijena promijenjena* card (WP3) is what covers the rare
 * case where the two differ.
 *
 * Without this a waiter who locked a round with no signal could not take cash
 * for it: the *Naplati* card is drawn from the server's tab, and offline there
 * is no server tab yet.
 */
const queuedOrdersFen = computed(() => queuedHere.value
  .filter(e => e.kind === 'order')
  .reduce((sum, entry) => {
    const payload = entry.payload as { lines?: { product_id: string, qty: number }[] }
    return sum + (payload.lines ?? []).reduce(
      (n, line) => n + (priceById.value.get(line.product_id) ?? 0) * line.qty,
      0,
    )
  }, 0))

const queuedPaidFen = computed(() => queuedHere.value
  .filter(e => e.kind === 'pay')
  .reduce((sum, entry) => sum + (entry.amount_fen ?? 0), 0))

/** The total under the *Naplati* button, server truth and phone truth together. */
const localTotalFen = computed(() =>
  (tabState.value?.total_fen ?? 0) + queuedOrdersFen.value)
const localRemainingFen = computed(() => Math.max(
  0,
  (tabState.value?.remaining_fen ?? 0) + queuedOrdersFen.value - queuedPaidFen.value,
))

/** Is there anything to charge for — from either side? */
const hasTab = computed(() => !!tabState.value?.tab_id || queuedHere.value.length > 0)

const sheetProduct = ref<Product | null>(null)

function onTile(product: Product) {
  // A nargila cannot be added blind: the aromas decide what leaves the shelf.
  if (product.kind === 'shisha') sheetProduct.value = product
  else cart.add(tableId.value, product.id)
}

function addShisha(flavourIds: string[]) {
  if (sheetProduct.value) cart.add(tableId.value, sheetProduct.value.id, flavourIds)
  sheetProduct.value = null
}

// -- Sending ----------------------------------------------------------------

const sending = ref(false)
const sendError = ref<string | null>(null)
const toast = ref<string | null>(null)

// A timer that outlives the screen would navigate a waiter who already left.
let leaveTimer: ReturnType<typeof setTimeout> | null = null
function leaveSoon(delayMs = 2000) {
  leaveTimer = setTimeout(() => navigateTo('/k'), delayMs)
}
onBeforeUnmount(() => {
  if (leaveTimer) clearTimeout(leaveTimer)
})

/**
 * Which tab this table's money belongs to.
 *
 * The server's own id wins whenever the poll has one — that is a tab everybody
 * agrees about. Otherwise it is the id this phone minted when the table was
 * first opened, which is the whole point: a round locked with no signal has to
 * be able to name the tab it opens, so that the payment queued behind it can
 * name the same one.
 */
function tabClientId(): string {
  return tabState.value?.tab_client_id ?? cart.ensureTabClientId(tableId.value)
}

async function send() {
  const draft = cart.draftFor(tableId.value)
  if (!draft || count.value === 0 || sending.value) return

  sending.value = true
  sendError.value = null
  try {
    await enqueue({
      kind: 'order',
      // The same uuid on every retry: the server answers a replay with the
      // round it already wrote instead of charging the guest twice.
      client_id: draft.client_id,
      tab_client_id: tabClientId(),
      label: tableName.value,
      payload: {
        client_id: draft.client_id,
        table_id: tableId.value,
        tab_client_id: tabClientId(),
        // When it happened in the *world*. A round queued in a cellar and sent
        // twenty minutes later is priced and shifted by this, not by the
        // moment the request finally arrived.
        client_created_at: new Date().toISOString(),
        // The line ids were minted when the tiles were tapped, so a void queued
        // offline can name a line the server has not seen yet (BACKEND §6.1).
        lines: draft.lines.map(line => ({
          id: line.id,
          product_id: line.product_id,
          qty: line.qty,
          ...(line.flavour_ids?.length ? { flavour_ids: line.flavour_ids } : {}),
          ...(line.note ? { note: line.note } : {}),
        })),
      },
    })
    cart.clear(tableId.value)
    toast.value = lockToast(tableName.value)
    leaveSoon()
  } catch (err) {
    // Enqueueing barely fails — only storage can refuse. The draft is
    // deliberately left alone either way: retrying is the whole plan.
    sendError.value = apiErrorText(err, 'Nema veze — pokušaj ponovo')
    void me.handleAuthError(err)
  } finally {
    sending.value = false
  }
}

// -- Naplata ----------------------------------------------------------------

const payOpen = ref(false)
const paying = ref(false)
const payError = ref<string | null>(null)

const paymentMethods = computed<PaymentMethod[]>(() =>
  me.settings.value?.payment_methods ?? ['cash'])

async function pay(payment: { method: PaymentMethod, amount_fen: number, received_fen?: number }) {
  if (paying.value) return
  // Offline there is no `tab_id` yet — the tab is still only on this phone. The
  // body may carry either, and the server prefers the phone's own id.
  const tabId = tabState.value?.tab_id ?? null
  const clientTabId = tabClientId()

  paying.value = true
  payError.value = null
  try {
    // The change and what is left are arithmetic the phone can do itself; the
    // server's answer would be identical, and waiting for it to hand back a
    // guest's change is exactly what an outbox exists to stop.
    const change = Math.max(0, (payment.received_fen ?? payment.amount_fen) - payment.amount_fen)
    const remaining = Math.max(0, localRemainingFen.value - payment.amount_fen)

    // One uuid, on the entry *and* in the body — they are the same row's
    // idempotency key, and two different ones would defeat the whole scheme.
    const clientId = crypto.randomUUID()
    await enqueue({
      kind: 'pay',
      // Minted per attempt and reused on every retry: `payments_client_uq` is
      // what turns a retried payment into one row instead of two charges.
      client_id: clientId,
      tab_client_id: clientTabId,
      label: tableName.value,
      amount_fen: payment.amount_fen,
      payload: {
        client_id: clientId,
        ...(tabId ? { tab_id: tabId } : {}),
        tab_client_id: clientTabId,
        method: payment.method,
        amount_fen: payment.amount_fen,
        ...(payment.received_fen !== undefined ? { received_fen: payment.received_fen } : {}),
        tip_fen: 0,
        covers_order_client_ids: [],
        client_created_at: new Date().toISOString(),
      },
    })
    payOpen.value = false
    await refreshState()

    if (remaining > 0) {
      // A part payment: the table stays, and so does the waiter.
      toast.value = `Naplaćeno · ostaje ${formatKm(remaining)}`
      return
    }
    // Settled: the next guests at this table open a tab of their own.
    cart.closeTab(tableId.value)
    toast.value = change > 0
      ? `Naplaćeno · vrati ${formatKm(change)}`
      : `Naplaćeno · ${tableName.value}`
    leaveSoon(change > 0 ? 3500 : 2000)
  } catch (err) {
    payError.value = apiErrorText(err)
    void me.handleAuthError(err)
  } finally {
    paying.value = false
  }
}

async function markUnpaid(reason: 'walked_out' | 'dispute' | 'other') {
  if (paying.value) return
  const clientTabId = tabClientId()

  paying.value = true
  payError.value = null
  try {
    // One uuid, on the entry *and* in the body: the same row's replay key.
    const clientId = crypto.randomUUID()
    await enqueue({
      kind: 'unpaid',
      client_id: clientId,
      // Keyed by the tab's own client id, not by a server id: a guest can walk
      // out while the phone is offline, on a tab the server has never seen.
      tab_client_id: clientTabId,
      label: tableName.value,
      payload: {
        client_id: clientId,
        tab_client_id: clientTabId,
        reason,
        client_created_at: new Date().toISOString(),
      },
    })
    payOpen.value = false
    await refreshState()
    cart.closeTab(tableId.value)
    toast.value = `Označeno: nije plaćeno · ${tableName.value}`
    leaveSoon(2500)
  } catch (err) {
    payError.value = apiErrorText(err)
    void me.handleAuthError(err)
  } finally {
    paying.value = false
  }
}

function openPay() {
  payError.value = null
  payOpen.value = true
}
</script>

<template>
  <ClientOnly>
    <div class="flex flex-1 flex-col">
      <WaiterHeader :title="tableName" back-to="/k">
        <template #right>
          <WaiterSyncChip compact />
          <span v-if="hasTab" class="num font-semibold">{{ formatKm(localRemainingFen) }}</span>
        </template>
      </WaiterHeader>

      <WaiterOutboxBanner />

      <div class="flex flex-1 flex-col gap-3 py-3">
        <!-- A body the server read and refused. Nothing behind it on this table
             goes out until the waiter answers. -->
        <WaiterFailedCard />
        <!-- What is already locked on this table, here and at the bar -->
        <div v-if="hasTab" class="card flex items-center gap-3 p-3">
          <div class="grow">
            <div class="flex flex-wrap items-center gap-2 text-sm text-text-2">
              Zaključene ture
              <span v-if="payQueued" class="chip chip-warn">naplata čeka slanje</span>
              <span v-else-if="queuedOrdersFen > 0" class="chip chip-warn">čeka slanje</span>
              <span v-else-if="tabState?.pending_review" class="chip chip-warn">naplata čeka</span>
              <span v-if="tabState?.late_sync" class="chip chip-warn">kasno</span>
            </div>
            <div class="num text-2xl font-semibold">
              {{ formatKm(localRemainingFen) }}
            </div>
            <div v-if="localRemainingFen !== localTotalFen" class="num text-sm text-text-2">
              od {{ formatKm(localTotalFen) }}
            </div>
          </div>
          <button type="button" class="btn btn-accent" @click="openPay">
            Naplati
          </button>
        </div>

        <!-- Categories -->
        <div class="-mx-4 flex gap-1.5 overflow-x-auto px-4">
          <button
            v-for="item in tabs"
            :key="item.id"
            type="button"
            class="flex h-10 shrink-0 items-center rounded-3xl px-3.5 text-[15px] font-semibold"
            :class="activeTab === item.id ? 'bg-line text-text' : 'bg-surface text-text-2'"
            @click="activeTab = item.id"
          >
            {{ item.name }}
          </button>
        </div>

        <!-- The menu -->
        <div v-if="boot" class="grid grid-cols-3 gap-2.5">
          <ProductTile
            v-for="product in shown"
            :key="product.id"
            :name="product.name"
            :price-fen="product.price_fen"
            :qty="cart.qtyOfProduct(tableId, product.id)"
            :shisha="product.kind === 'shisha'"
            @add="onTile(product)"
            @remove="cart.removeOne(tableId, product.id)"
          />
        </div>
        <p v-else class="py-10 text-center text-text-2">
          Učitavanje…
        </p>

        <p class="text-center text-sm text-text-2">
          {{ zoneLabel }} · dodir = +1 · Nargila otvara izbor arome
        </p>
      </div>

      <!-- Send -->
      <div class="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t border-line bg-bg px-4 pb-5 pt-3">
        <div v-if="sendError" class="flex items-center gap-3 rounded-xl bg-danger-soft px-3 py-2 text-danger">
          <span class="grow text-[15px]">{{ sendError }}</span>
          <button type="button" class="btn btn-ghost" :disabled="sending" @click="send">
            Pokušaj ponovo
          </button>
        </div>

        <button
          type="button"
          class="btn btn-accent h-14 text-lg"
          :disabled="count === 0 || sending"
          @click="send"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 12l16-8-6 16-2-6z" />
          </svg>
          <span v-if="count === 0">Pošalji šankeru</span>
          <span v-else>Pošalji šankeru · <span class="num">{{ stavke(count) }} · {{ formatKm(draftTotal) }}</span></span>
        </button>
        <span class="text-center text-sm text-text-2">
          Šanker odmah dobije tiket · roba se skida sa stanja
        </span>
      </div>
    </div>

    <!-- Aromas for a nargila -->
    <ProductShishaSheet
      v-if="sheetProduct && boot"
      :product="sheetProduct"
      :flavours="boot.flavours"
      @close="sheetProduct = null"
      @confirm="addShisha"
    />

    <!-- Naplati -->
    <WaiterPaySheet
      v-if="payOpen && hasTab"
      :table-name="tableName"
      :remaining-fen="localRemainingFen"
      :total-fen="localTotalFen"
      :methods="paymentMethods"
      :busy="paying"
      :error="payError"
      @close="payOpen = false"
      @pay="pay"
      @unpaid="markUnpaid"
    />

    <!-- Sent / paid -->
    <div
      v-if="toast"
      class="fixed inset-x-0 bottom-28 z-50 mx-auto w-max max-w-[92vw] rounded-xl bg-good-soft px-4 py-3 text-center font-semibold text-good"
    >
      {{ toast }}
    </div>
  </ClientOnly>
</template>
