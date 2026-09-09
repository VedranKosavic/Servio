<script setup lang="ts">
/**
 * Narudžba — the round being built for one table.
 *
 * The draft lives in the cart store (localStorage), not here, so walking away
 * to another table and coming back does not lose the taps. This screen only
 * turns the catalog into tiles and, when *Pošalji šankeru* is tapped, hands the
 * draft to `POST /api/orders`.
 *
 * Note what is never sent: a price. The tiles show prices so the waiter can
 * read them out to the guest, but the body carries product ids and quantities
 * and the server does the arithmetic — a phone that could send a price could
 * send any price.
 */
import { formatKm } from '#shared/money'
import type { Product, TableState } from '#shared/types'

const route = useRoute()
const api = useApi()
const session = useSessionStore()
const cart = useCartStore()

const tableId = computed(() => String(route.params.id))

onMounted(() => {
  if (!session.isWaiter) navigateTo('/')
})

const { data: boot } = useBootstrapData()

const table = computed(() => boot.value?.tables.find(t => t.id === tableId.value) ?? null)
const tableName = computed(() => table.value?.name ?? 'Sto')
const zoneLabel = computed(() => (table.value?.zone === 'basta' ? 'Bašta' : 'Unutra'))

useHead({ title: tableName })

// The table's open tab, if a round was already locked on it tonight. Read once
// on open — the floor plan is where this number is kept fresh.
const tabState = ref<TableState | null>(null)
async function loadTabState() {
  try {
    const rows = await api.getTablesState()
    tabState.value = rows.find(r => r.table_id === tableId.value) ?? null
  } catch {
    tabState.value = null
  }
}
onMounted(loadTabState)

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
function leaveSoon() {
  leaveTimer = setTimeout(() => navigateTo('/k'), 2000)
}
onBeforeUnmount(() => {
  if (leaveTimer) clearTimeout(leaveTimer)
})

async function send() {
  const clientId = cart.clientIdFor(tableId.value)
  const userId = session.state.userId
  if (!clientId || !userId || count.value === 0 || sending.value) return

  sending.value = true
  sendError.value = null
  try {
    await api.postOrder({
      // The same uuid on every retry: the server answers a replay with the
      // round it already wrote instead of charging the guest twice.
      client_id: clientId,
      table_id: tableId.value,
      user_id: userId,
      lines: lines.value.map(line => ({
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
    const e = err as { code?: string, message?: string }
    sendError.value = e.code === 'NETWORK'
      ? 'Nema veze — pokušaj ponovo'
      : (e.message ?? 'Nema veze — pokušaj ponovo')
  } finally {
    sending.value = false
  }
}

// -- Naplaćeno --------------------------------------------------------------

const payOpen = ref(false)
const paying = ref(false)
const payError = ref<string | null>(null)

async function pay() {
  const tabId = tabState.value?.tab_id
  const userId = session.state.userId
  if (!tabId || !userId || paying.value) return

  paying.value = true
  payError.value = null
  try {
    await api.payTab(tabId, userId)
    payOpen.value = false
    tabState.value = null
    toast.value = `Naplaćeno · ${tableName.value}`
    leaveSoon()
  } catch (err) {
    const e = err as { message?: string }
    payError.value = e.message ?? 'Nema veze — pokušaj ponovo'
  } finally {
    paying.value = false
  }
}
</script>

<template>
  <ClientOnly>
    <div class="flex flex-1 flex-col">
      <WaiterHeader :title="tableName" back-to="/k">
        <template #right>
          <span class="chip">{{ zoneLabel }}</span>
          <span v-if="tabState?.tab_id" class="num font-semibold">{{ formatKm(tabState.total_fen) }}</span>
        </template>
      </WaiterHeader>

      <div class="flex flex-1 flex-col gap-3 py-3">
        <!-- What is already locked on this table -->
        <div v-if="tabState?.tab_id" class="card flex items-center gap-3 p-3">
          <div class="grow">
            <div class="text-sm text-text-2">
              Zaključene ture
            </div>
            <div class="num text-2xl font-semibold">
              {{ formatKm(tabState.total_fen) }}
            </div>
          </div>
          <button type="button" class="btn btn-ghost" @click="payOpen = true">
            Naplaćeno
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

    <!-- Naplaćeno? -->
    <div v-if="payOpen && tabState?.tab_id" class="fixed inset-0 z-50">
      <div class="absolute inset-0 bg-black/55" @click="payOpen = false" />
      <div class="absolute inset-x-0 bottom-0 mx-auto flex w-full max-w-3xl flex-col gap-3 rounded-t-[20px] border-t border-line bg-surface px-4 pb-6 pt-3">
        <div class="mx-auto h-1 w-10 rounded-sm bg-line" />
        <p class="text-center text-xl font-semibold">
          {{ tableName }} · <span class="num">{{ formatKm(tabState.total_fen) }}</span> · Naplaćeno?
        </p>
        <p v-if="payError" class="text-center text-danger">
          {{ payError }}
        </p>
        <button type="button" class="btn btn-accent h-14 text-lg" :disabled="paying" @click="pay">
          Naplaćeno
        </button>
        <button type="button" class="btn btn-ghost" @click="payOpen = false">
          Otkaži
        </button>
      </div>
    </div>

    <!-- Sent -->
    <div
      v-if="toast"
      class="fixed inset-x-0 bottom-28 z-50 mx-auto w-max rounded-xl bg-good-soft px-4 py-3 font-semibold text-good"
    >
      {{ toast }}
    </div>
  </ClientOnly>
</template>
