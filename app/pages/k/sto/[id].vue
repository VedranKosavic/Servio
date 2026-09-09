<script setup lang="ts">
/**
 * Narudžba — the round being built for one table, and the till that closes it.
 *
 * The draft lives in the cart store (localStorage), not here, so walking away to
 * another table and coming back does not lose the taps. This screen turns the
 * catalogue into tiles, hands the draft to `POST /api/orders`, and opens the
 * *Naplati* sheet when the guests ask for the bill.
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
const api = useApi()
const me = useMe()
const cart = useCartStore()

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

async function send() {
  const clientId = cart.clientIdFor(tableId.value)
  if (!clientId || count.value === 0 || sending.value) return

  sending.value = true
  sendError.value = null
  try {
    await api.postOrder({
      // The same uuid on every retry: the server answers a replay with the
      // round it already wrote instead of charging the guest twice.
      client_id: clientId,
      table_id: tableId.value,
      // The phone mints the line id too, so a void queued offline can name a
      // line the server has not seen yet (docs/BACKEND.md §6.1).
      lines: lines.value.map(line => ({
        id: crypto.randomUUID(),
        product_id: line.product_id,
        qty: line.qty,
        ...(line.flavour_ids?.length ? { flavour_ids: line.flavour_ids } : {}),
      })),
    })
    cart.clear(tableId.value)
    toast.value = `Poslano · ${tableName.value}`
    leaveSoon()
  } catch (err) {
    // The draft is deliberately left alone: retrying is the whole plan.
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
  const tabId = tabState.value?.tab_id
  if (!tabId || paying.value) return

  paying.value = true
  payError.value = null
  try {
    const result = await api.postPayment({
      // Minted per attempt and reused on every retry: `payments_client_uq` is
      // what turns a retried payment into one row instead of two charges.
      client_id: crypto.randomUUID(),
      tab_id: tabId,
      method: payment.method,
      amount_fen: payment.amount_fen,
      ...(payment.received_fen !== undefined ? { received_fen: payment.received_fen } : {}),
      tip_fen: 0,
      covers_order_client_ids: [],
    })
    payOpen.value = false
    await refreshState()

    if (result.remaining_fen > 0) {
      // A part payment: the table stays, and so does the waiter.
      toast.value = `Naplaćeno · ostaje ${formatKm(result.remaining_fen)}`
      return
    }
    toast.value = result.change_fen > 0
      ? `Naplaćeno · vrati ${formatKm(result.change_fen)}`
      : `Naplaćeno · ${tableName.value}`
    leaveSoon(result.change_fen > 0 ? 3500 : 2000)
  } catch (err) {
    payError.value = apiErrorText(err)
    void me.handleAuthError(err)
  } finally {
    paying.value = false
  }
}

async function markUnpaid(reason: 'walked_out' | 'dispute' | 'other') {
  const tabClientId = tabState.value?.tab_client_id
  if (!tabClientId || paying.value) return

  paying.value = true
  payError.value = null
  try {
    await api.markUnpaid({
      client_id: crypto.randomUUID(),
      // Keyed by the tab's own client id, not by a server id: a guest can walk
      // out while the phone is offline, on a tab the server has never seen.
      tab_client_id: tabClientId,
      reason,
    })
    payOpen.value = false
    await refreshState()
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
          <span class="chip">{{ zoneLabel }}</span>
          <span v-if="tabState?.tab_id" class="num font-semibold">{{ formatKm(tabState.remaining_fen) }}</span>
        </template>
      </WaiterHeader>

      <div class="flex flex-1 flex-col gap-3 py-3">
        <!-- What is already locked on this table -->
        <div v-if="tabState?.tab_id" class="card flex items-center gap-3 p-3">
          <div class="grow">
            <div class="flex items-center gap-2 text-sm text-text-2">
              Zaključene ture
              <span v-if="tabState.pending_review" class="chip chip-warn">naplata čeka</span>
              <span v-if="tabState.late_sync" class="chip chip-warn">kasno</span>
            </div>
            <div class="num text-2xl font-semibold">
              {{ formatKm(tabState.remaining_fen) }}
            </div>
            <div v-if="tabState.remaining_fen !== tabState.total_fen" class="num text-sm text-text-2">
              od {{ formatKm(tabState.total_fen) }}
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
          dodir = +1 · Nargila otvara izbor arome
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
      v-if="payOpen && tabState?.tab_id"
      :table-name="tableName"
      :remaining-fen="tabState.remaining_fen"
      :total-fen="tabState.total_fen"
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
