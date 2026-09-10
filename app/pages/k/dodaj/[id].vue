<script setup lang="ts">
/**
 * **S3 *Dodaj*** — the menu, three tiles wide, and the fastest screen in the app.
 *
 * Everything here is measured against one number: *two coffees in five taps
 * from the floor plan* (PLAN §10). Tap a table (1), tap *Kafa* twice (2),
 * *Zaključi* (1), *Potvrdi* (1). Nothing on this screen may cost a sixth. That
 * is why a tap on a tile adds with no toast and no confirmation, why the aroma
 * sheet opens on the tile rather than behind a second step, and why the note
 * chips are a long press instead of a row of controls on every tile.
 *
 * The draft lives in the cart store (IndexedDB), never here, so walking to
 * another table and coming back does not lose the taps — and neither does the
 * memory-pressure reload iOS performs after the camera.
 *
 * **Nothing on this screen sends anything.** *Potvrdi* calls
 * `outbox.enqueue(...)`, which writes to IndexedDB and returns at once; the
 * outbox gets it to the server, in order, exactly once, whenever there is a
 * network. What is never sent at all is a price: the tiles show prices so the
 * waiter can read them out, and the body carries product ids and quantities.
 */
import { formatKm } from '#shared/money'
import type { Product } from '#shared/types'
import { matchesQuery, stavke } from '~/components/order/OrderText'
import type { CompReason } from '~/composables/useAdjustments'
// Explicit, not auto-imported: Nuxt would name `adjust/AdjCompSheet.vue`
// `<AdjustAdjCompSheet>`, and an unresolved tag renders nothing at all in a
// production build — silently. The same reason `/s/cekanje` imports
// `AdjPendingCard` by name.
import AdjCompSheet from '~/components/adjust/AdjCompSheet.vue'

const route = useRoute()
const api = useApi()
const me = useMe()
const cart = useCartStore()
const { outbox, enqueue } = useOutbox()
const { lockToast } = useSync()
const wakeLock = useWakeLock()

/**
 * `bez-stola` in the URL is the guests standing at the bar — a tab on no table
 * (PHASE3 §1.11). Everywhere below, `null` means exactly that, and the cart
 * store keys its draft on it the same way.
 */
const LOOSE = 'bez-stola'
const tableId = computed<string | null>(() => {
  const param = String(route.params.id)
  return param === LOOSE ? null : param
})

onMounted(() => {
  void me.requireSession()
})

const { data: boot, refresh: refreshBoot } = useBootstrapData()

const table = computed(() =>
  (tableId.value === null ? null : boot.value?.tables.find(t => t.id === tableId.value) ?? null))
const tableName = computed(() => (tableId.value === null ? 'Bez stola' : table.value?.name ?? 'Sto'))
const zoneLabel = computed(() => {
  if (tableId.value === null) return 'Šank'
  return table.value?.zone === 'basta' ? 'Bašta' : 'Unutra'
})

useHead({ title: () => `Dodaj · ${tableName.value}` })

// The one poll. Nothing on this screen needs the floor plan, but the catalogue
// has to follow a price change made in `/a` mid-evening.
useChanges({
  menu: () => refreshBoot(),
  me: () => me.load(),
}, { intervalMs: 15_000 })

// -- The menu ---------------------------------------------------------------

const FAVOURITES = 'omiljeno'
const RECENT = 'nedavno'
// `?kat=` opens straight on a category — how *Nova lula* on S2 lands on the
// nargila tiles instead of on *Omiljeno*.
const activeTab = ref<string>(route.query.kat ? String(route.query.kat) : FAVOURITES)
const query = ref('')

const products = computed(() => boot.value?.products ?? [])
const categoryById = computed(() => new Map((boot.value?.categories ?? []).map(c => [c.id, c])))

/**
 * *Nedavno* — the dozen things this bar actually sold tonight.
 *
 * *Omiljeno* is the owner's list and it is right most evenings; *Nedavno* is
 * the room's, and on the evening somebody orders eleven Cedevita it is the one
 * that saves the taps. Kept on the phone rather than on the server: it is a
 * convenience, it has to work with no signal, and it is worth no request.
 */
const recentIds = useLocalStorage<string[]>('sank:nedavno', [])
const RECENT_MAX = 12

function remember(productId: string) {
  recentIds.value = [productId, ...recentIds.value.filter(id => id !== productId)]
    .slice(0, RECENT_MAX)
}

const tabs = computed(() => {
  const withProducts = (boot.value?.categories ?? [])
    // A category with nothing in it would be a dead end, so it is left out.
    .filter(category => products.value.some(p => p.category_id === category.id))
    .map(category => ({ id: category.id, name: category.name }))
  return [
    { id: FAVOURITES, name: 'Omiljeno' },
    ...(recentIds.value.length > 0 ? [{ id: RECENT, name: 'Nedavno' }] : []),
    ...withProducts,
  ]
})

const shown = computed<Product[]>(() => {
  // A search is its own view: it looks at the whole menu, not at the open tab.
  if (query.value.trim() !== '') {
    return products.value.filter(p => matchesQuery(p, query.value))
  }
  if (activeTab.value === FAVOURITES) return products.value.filter(p => p.is_favourite)
  if (activeTab.value === RECENT) {
    const byId = new Map(products.value.map(p => [p.id, p]))
    return recentIds.value.map(id => byId.get(id)).filter((p): p is Product => p !== undefined)
  }
  return products.value.filter(p => p.category_id === activeTab.value)
})

// -- The draft --------------------------------------------------------------

const lines = computed(() => cart.linesFor(tableId.value))
const count = computed(() => cart.countFor(tableId.value))

const priceById = computed(() => new Map(products.value.map(p => [p.id, p.price_fen])))
/** The draft's own total, for the strip. The server prices the real thing. */
const draftTotal = computed(() => lines.value.reduce(
  (sum, line) => sum + (priceById.value.get(line.product_id) ?? 0) * line.qty,
  0,
))

// Keep the screen awake only while there is a round on it, and only on this
// screen and the aroma sheet (PLAN §10). An empty picker dims like any page.
watch(count, n => wakeLock.hold(n > 0), { immediate: true })
onBeforeUnmount(() => wakeLock.hold(false))

const shishaProduct = ref<Product | null>(null)
/** The product whose long press is open, and the line being re-noted, if any. */
const noteFor = ref<{ product: Product, lineId: string | null } | null>(null)
/** The same pair, once *Na račun kuće* has been chosen on it (F7). */
const compFor = ref<{ product: Product, lineId: string | null } | null>(null)

function chipsFor(product: Product): string[] {
  return categoryById.value.get(product.category_id)?.note_chips ?? []
}

function onTile(product: Product) {
  // A nargila cannot be added blind: the aromas decide what leaves the shelf.
  if (product.kind === 'shisha') {
    shishaProduct.value = product
    return
  }
  // *Ostalo* is a price with no name until somebody writes one, so its tap goes
  // straight to the text that becomes the line's note.
  if (product.system_key === 'ostalo') {
    noteFor.value = { product, lineId: null }
    return
  }
  cart.add(tableId.value, product.id)
  remember(product.id)
}

function addShisha(flavourIds: string[], note: string | null) {
  const product = shishaProduct.value
  if (product) {
    cart.add(tableId.value, product.id, flavourIds, note ?? undefined)
    remember(product.id)
  }
  shishaProduct.value = null
}

function saveNote(note: string | null) {
  const open = noteFor.value
  noteFor.value = null
  if (!open) return

  if (open.lineId === null) {
    // A long press on a tile: this is a new line, with its note already on it.
    cart.add(tableId.value, open.product.id, undefined, note ?? undefined)
    remember(open.product.id)
    return
  }

  // Re-noting an existing draft line: take one off and put it back with the new
  // note. The cart store's `add` merges by product **and** note, so this is how
  // "one kafa, one kafa bez šećera" stays two lines.
  const line = lines.value.find(l => l.id === open.lineId)
  if (!line) return
  const qty = line.qty
  for (let i = 0; i < qty; i++) cart.removeOne(tableId.value, line.product_id)
  for (let i = 0; i < qty; i++) {
    cart.add(tableId.value, line.product_id, line.flavour_ids, note ?? undefined)
  }
}

// -- Na račun kuće ----------------------------------------------------------

/**
 * How many staff drinks this person has already had tonight, from
 * `GET /api/me/shift`'s `counts.gratis` (PHASE3 §1.5). Read once, when the sheet
 * is first opened, and never blocking: `null` makes the sheet render the
 * published cap without tonight's score, which is still worth more than nothing.
 */
const staffUsed = ref<number | null>(null)

async function loadStaffUsed(): Promise<void> {
  try {
    staffUsed.value = (await api.getMyShift()).counts.gratis.used
  } catch {
    // No signal. The rule is still on screen; only the score is missing.
  }
}

/** *Na račun kuće* on the note sheet: swap one sheet for the other. */
function openComp() {
  const open = noteFor.value
  noteFor.value = null
  if (!open) return
  compFor.value = open
  void loadStaffUsed()
}

/** What the sheet is deciding about — a line on the draft, or the tile's product. */
const compLine = computed(() => {
  const open = compFor.value
  if (!open) return null
  const line = open.lineId ? lineFor(open.lineId) : null
  const qty = line?.qty ?? 1
  return {
    id: line?.id ?? open.product.id,
    name: open.product.name,
    qty,
    amount_fen: (priceById.value.get(open.product.id) ?? open.product.price_fen) * qty,
  }
})

/**
 * The reason rides on the draft line and the lock decides what it costs — a
 * gratis chosen before the round is sent costs no request at all (F7).
 */
function applyComp(reason: CompReason) {
  const open = compFor.value
  compFor.value = null
  if (!open) return

  if (open.lineId === null) {
    cart.add(tableId.value, open.product.id, undefined, undefined, reason)
    remember(open.product.id)
    return
  }
  cart.setComp(tableId.value, open.lineId, reason)
}

// -- Zaključi ---------------------------------------------------------------

const confirmOpen = ref(false)
const sending = ref(false)
const sendError = ref<string | null>(null)
const toast = ref<string | null>(null)

/**
 * What the tiles said this round comes to, remembered against the round's own
 * `client_id` so S2 can compare it with what the server actually charged and
 * raise the amber *Cijena promijenjena* card (F3 step 3).
 *
 * It is written here rather than read from the lock's response on purpose:
 * since Phase 3 the round goes through the outbox, so the answer may arrive
 * twenty minutes later on a screen nobody is looking at. This survives that,
 * and a reload.
 */
const quoted = useLocalStorage<Record<string, number>>('sank:quoted', {})

// A timer that outlives the screen would drag a waiter who has already walked
// away back to a table he left — so it is held, and cleared on the way out.
let leaveTimer: ReturnType<typeof setTimeout> | null = null
onBeforeUnmount(() => {
  if (leaveTimer) clearTimeout(leaveTimer)
})

function lineFor(id: string) {
  return lines.value.find(l => l.id === id)
}

function addOne(lineId: string) {
  const line = lineFor(lineId)
  if (line) cart.add(tableId.value, line.product_id, line.flavour_ids, line.note)
}

function removeOne(lineId: string) {
  const line = lineFor(lineId)
  if (line) cart.removeOne(tableId.value, line.product_id)
}

function noteLine(lineId: string) {
  const line = lineFor(lineId)
  const product = products.value.find(p => p.id === line?.product_id)
  if (line && product) noteFor.value = { product, lineId }
}

async function confirm() {
  const draft = cart.draftFor(tableId.value)
  if (!draft || count.value === 0 || sending.value) return

  sending.value = true
  sendError.value = null
  const totalAtLock = draftTotal.value
  try {
    const tabClientId = cart.ensureTabClientId(tableId.value)
    await enqueue({
      kind: 'order',
      // The same uuid on every retry: the server recognises the replay and
      // answers with the round it already wrote instead of charging twice.
      client_id: draft.client_id,
      tab_client_id: tabClientId,
      label: tableName.value,
      payload: {
        client_id: draft.client_id,
        table_id: tableId.value,
        tab_client_id: tabClientId,
        // When it happened in the *world*. A round queued in a dead spot and
        // sent twenty minutes later is dated by this, not by its arrival.
        client_created_at: new Date().toISOString(),
        // The line ids were minted when the tiles were tapped, so a storno
        // queued offline can name a line the server has not seen yet.
        lines: draft.lines.map(line => ({
          id: line.id,
          product_id: line.product_id,
          qty: line.qty,
          ...(line.flavour_ids?.length ? { flavour_ids: line.flavour_ids } : {}),
          ...(line.note ? { note: line.note } : {}),
          // *Na račun kuće*, decided on the phone. The server re-decides it.
          ...(line.comp_reason ? { comp_reason: line.comp_reason } : {}),
        })),
      },
    })
    quoted.value = { ...quoted.value, [draft.client_id]: totalAtLock }
    cart.clear(tableId.value)
    confirmOpen.value = false
    toast.value = lockToast(tableName.value)
    wakeLock.hold(false)
    // Back to the table, where the round is now a locked *tura* and the bar
    // reads *Naplati*.
    leaveTimer = setTimeout(() => navigateTo(`/k/sto/${route.params.id}`), 700)
  } catch (err) {
    // Enqueueing barely fails — only storage can refuse. The draft is left
    // alone either way: retrying is the whole plan.
    sendError.value = apiErrorText(err, 'Nema veze — pokušaj ponovo')
    void me.handleAuthError(err)
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <ClientOnly>
    <div class="flex flex-1 flex-col">
      <WaiterHeader :title="tableName" :back-to="`/k/sto/${route.params.id}`">
        <template #right>
          <WaiterSyncChip compact />
        </template>
      </WaiterHeader>

      <WaiterOutboxBanner />

      <div class="flex flex-1 flex-col gap-3 py-3">
        <WaiterFailedCard />

        <!-- The pill: which table this round is for, and one tap back to it. -->
        <div class="flex items-center gap-2">
          <NuxtLink :to="`/k/sto/${route.params.id}`" class="chip bg-line px-3 py-1.5 text-[15px] text-text">
            {{ tableName }} · {{ zoneLabel }}
          </NuxtLink>
          <span v-if="outbox.pending > 0" class="chip chip-warn">čeka slanje ({{ outbox.pending }})</span>
        </div>

        <label class="card-2 flex h-12 items-center gap-2 px-3">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" class="shrink-0 text-text-2">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            v-model="query"
            type="text"
            inputmode="search"
            placeholder="Traži"
            class="min-w-0 flex-1 bg-transparent text-[17px] outline-none placeholder:text-muted"
          >
          <button
            v-if="query"
            type="button"
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-text-2"
            aria-label="Obriši traženje"
            @click="query = ''"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </label>

        <div v-if="!query" class="-mx-4 flex gap-1.5 overflow-x-auto px-4">
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

        <div v-if="boot" class="grid grid-cols-3 gap-2.5">
          <ProductTile
            v-for="product in shown"
            :key="product.id"
            :name="product.name"
            :short-name="product.short_name"
            :price-fen="product.price_fen"
            :qty="cart.qtyOfProduct(tableId, product.id)"
            :shisha="product.kind === 'shisha'"
            @add="onTile(product)"
            @remove="cart.removeOne(tableId, product.id)"
            @long="noteFor = { product, lineId: null }"
          />
        </div>
        <p v-else class="py-10 text-center text-text-2">
          Učitavanje…
        </p>

        <p v-if="boot && shown.length === 0" class="py-8 text-center text-text-2">
          Ništa ne odgovara traženom.
        </p>

        <p class="text-center text-sm text-text-2">
          Dodir = +1 · dugi dodir = napomena
        </p>
      </div>

      <!-- The strip: what is on the round, and the two ways out of it. -->
      <div class="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t border-line bg-bg px-4 pb-5 pt-3">
        <div v-if="sendError" class="flex items-center gap-3 rounded-xl bg-danger-soft px-3 py-2 text-danger">
          <span class="grow text-[15px]">{{ sendError }}</span>
        </div>

        <div class="flex items-baseline gap-2">
          <span class="num grow text-[15px] text-text-2">
            <template v-if="count > 0">{{ stavke(count) }} · {{ formatKm(draftTotal) }}</template>
            <template v-else>Nema stavki</template>
          </span>
          <button
            type="button"
            class="btn h-12"
            :disabled="count === 0"
            @click="confirmOpen = true"
          >
            Pregled
          </button>
        </div>

        <button
          type="button"
          class="btn btn-accent h-14 text-lg"
          :disabled="count === 0 || sending"
          @click="confirmOpen = true"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 13l4 4L19 7" />
          </svg>
          <span v-if="count === 0">Zaključi</span>
          <span v-else>Zaključi · <span class="num">{{ stavke(count) }} · {{ formatKm(draftTotal) }}</span></span>
        </button>
      </div>
    </div>

    <!-- S4: the aromas -->
    <ProductShishaSheet
      v-if="shishaProduct && boot"
      :product="shishaProduct"
      :flavours="boot.flavours"
      :note-chips="chipsFor(shishaProduct)"
      @close="shishaProduct = null"
      @confirm="addShisha"
    />

    <!-- The long press: note chips, free text -->
    <OrderNoteSheet
      v-if="noteFor"
      :title="noteFor.product.name"
      :chips="chipsFor(noteFor.product)"
      :initial="noteFor.lineId ? lineFor(noteFor.lineId)?.note ?? null : null"
      :free-text-first="noteFor.product.system_key === 'ostalo'"
      @close="noteFor = null"
      @save="saveNote"
      @comp="openComp"
    />

    <!-- F7: the house pays. Nothing is sent — the reason rides on the line. -->
    <AdjCompSheet
      v-if="compFor && compLine"
      mode="draft"
      :line="compLine"
      :table-name="tableName"
      :staff-drink-allowed="compFor.product.staff_drink_allowed"
      :staff-used="staffUsed"
      @close="compFor = null"
      @draft="applyComp"
    />

    <!-- S5: every line, the total, and one Potvrdi -->
    <OrderConfirmSheet
      v-if="confirmOpen && boot"
      :table-name="tableName"
      :lines="lines"
      :products="boot.products"
      :flavours="boot.flavours"
      :busy="sending"
      :error="sendError"
      @close="confirmOpen = false"
      @confirm="confirm"
      @add="addOne"
      @remove="removeOne"
      @note="noteLine"
    />

    <div
      v-if="toast"
      class="fixed inset-x-0 bottom-28 z-50 mx-auto w-max max-w-[92vw] rounded-xl bg-good-soft px-4 py-3 text-center font-semibold text-good"
    >
      {{ toast }}
    </div>

    <template #fallback>
      <p class="py-10 text-center text-text-2">
        Učitavanje…
      </p>
    </template>
  </ClientOnly>
</template>
