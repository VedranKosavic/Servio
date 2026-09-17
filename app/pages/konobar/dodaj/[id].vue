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
import { isPastAvailableUntil } from '#shared/dates'
import type { Product } from '#shared/types'
import { matchesQuery, stavke } from '~/components/order/OrderText'
import type { CompReason } from '~/composables/useAdjustments'
// Explicit, not auto-imported: Nuxt would name `adjust/AdjCompSheet.vue`
// `<AdjustAdjCompSheet>`, and an unresolved tag renders nothing at all in a
// production build — silently. The same reason `/sanker/cekanje` imports
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

/**
 * Where every way out of this screen goes: the floor plan, **with no sheet
 * open** (the owner, 17.09.2026). A table's sheet opens only when the waiter
 * taps an occupied table — not by itself after a round is added.
 */
const backTo = computed(() => '/konobar')

// The one poll. Nothing on this screen needs the floor plan, but the catalogue
// has to follow a price change made in `/admin` mid-evening.
/**
 * **What the shelf cannot serve** (16.09.2026): articles struck through and not
 * tappable, aromas greyed out in the picker. It follows the same 15 s poll as
 * everything else, so a crate booked on *Prijem robe* un-strikes its article on
 * the next tick. `null` until the first answer: nothing is struck through on a
 * guess.
 */
const unavailableProducts = ref<Set<string> | null>(null)

/**
 * *Happy Hour* (the owner, 17.09.2026): an article with `available_until` is
 * struck through from that hour. The clock ticks here, not on the server's
 * poll, so the tile goes off at 09:00 and not up to 15 s later; the lock
 * refuses it too (409 `PRODUCT_TIME_OVER`).
 */
const clockNow = ref(new Date().toISOString())
const clockTimer = import.meta.client ? setInterval(() => { clockNow.value = new Date().toISOString() }, 20_000) : null
onBeforeUnmount(() => { if (clockTimer) clearInterval(clockTimer) })

function isOff(product: Product): boolean {
  return (unavailableProducts.value?.has(product.id) ?? false)
    || isPastAvailableUntil(product.available_until, clockNow.value)
}
const unavailableAromas = ref<Set<string> | null>(null)

useChanges({
  menu: () => refreshBoot(),
  me: () => me.load(),
  unavailable: (u) => {
    unavailableProducts.value = new Set(u.products)
    unavailableAromas.value = new Set(u.aromas)
  },
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
  // Struck through: the shelf has none. A tile that still took a tap would put
  // a round on the bill the bar cannot pour.
  if (isOff(product)) return
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
    // The *Ostalo* tile: a new line, with its note already on it.
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
// One timer, in `useToast`: there is no way to set a message without also
// starting the clock that takes it away.
const { toast, say } = useToast()

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

/**
 * *Poništi turu* on the confirm sheet: the draft goes, the tab does not.
 *
 * `cart.clear()` is the same call the successful lock makes — it forgets the
 * lines and the round's `client_id` and deliberately keeps the tab's, because
 * the guests are still sitting there and the payment that follows has to be
 * able to name their tab. The sheet asks twice before it gets here.
 */
function cancelDraft() {
  cart.clear(tableId.value)
  confirmOpen.value = false
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
    say(lockToast(tableName.value))
    wakeLock.hold(false)
    // Back to the plan, and nothing opens on it: the table's sheet is for when
    // the waiter taps the table (the owner, 17.09.2026).
    leaveTimer = setTimeout(() => navigateTo(backTo.value), 700)
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
      <WaiterHeader title="Dodaj" :back-to="backTo">
        <template #right>
          <WaiterSyncChip compact />
        </template>
      </WaiterHeader>

      <WaiterOutboxBanner />

      <div class="flex flex-1 flex-col gap-4 py-4">
        <WaiterFailedCard />

        <!--
          Which table this round is for, and one tap back to it.

          It is a row rather than the header's title because the title of this
          screen is *Dodaj* — and because "am I adding to the right table?" is
          the question a waiter asks with his thumb already moving, so it wants
          a 56 px target with a chevron on it, not a 12 px caption.
        -->
        <NuxtLink
          :to="backTo"
          class="card-2 flex min-h-14 items-center gap-3 px-4 py-2"
        >
          <span class="grow truncate text-body font-semibold">{{ tableName }} · {{ zoneLabel }}</span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-muted" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </NuxtLink>

        <!-- The search, and the one chip that has to be true on this screen. -->
        <div class="flex flex-col gap-2">
          <label class="input flex items-center gap-2.5">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" class="shrink-0 text-muted" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              v-model="query"
              type="text"
              inputmode="search"
              placeholder="Traži"
              aria-label="Traži po meniju"
              class="min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-muted"
            >
            <button
              v-if="query"
              type="button"
              class="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-field text-text-2"
              aria-label="Obriši traženje"
              @click="query = ''"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </label>

          <p v-if="outbox.pending > 0" class="flex">
            <span class="chip chip-warn">čeka slanje ({{ outbox.pending }})</span>
          </p>
        </div>

        <!-- The categories. A scroller, bled to the edges so the last one is
             visibly cut off rather than looking like the end of the list — and
             with its scrollbar hidden, because a desktop browser drew a grey
             rule under the pills that read as a stray divider on the screen. -->
        <div v-if="!query" class="no-bar -mx-4 flex gap-2 overflow-x-auto px-4">
          <button
            v-for="item in tabs"
            :key="item.id"
            type="button"
            class="pill h-12 shrink-0"
            :class="activeTab === item.id ? 'pill-on' : ''"
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
            :unavailable="isOff(product)"
            :image-url="product.image_url"
            :off-label="isPastAvailableUntil(product.available_until, clockNow) ? `do ${product.available_until}` : undefined"
            @add="onTile(product)"
            @remove="cart.removeOne(tableId, product.id)"
          />
        </div>
        <p v-else class="py-10 text-center text-text-2">
          Učitavanje…
        </p>

        <p v-if="boot && shown.length === 0" class="empty">
          Ništa ne odgovara traženom.
        </p>

      </div>

      <!--
        The strip: what is on the round, and the one way out of it.

        It used to be two rows and two buttons — *Pregled* beside the running
        total, and *Zaključi* under it — and both opened the same sheet. One of
        them was therefore a button that taught the waiter a second word for a
        thing he already had, and it cost the grid a row of tiles on a phone.
        *Zaključi* opens the review; the review is where *Potvrdi* lives; the
        total rides beside it.
      -->
      <div class="action-bar -mx-4 flex-col gap-2.5 border-t border-line px-4">
        <p v-if="sendError" class="note note-danger" role="alert">
          {{ sendError }}
        </p>

        <div class="flex items-center gap-3">
          <span class="num grow text-label text-text-2">
            <template v-if="count > 0">{{ stavke(count) }} · {{ formatKm(draftTotal) }}</template>
            <template v-else>Nema stavki</template>
          </span>
          <button
            type="button"
            class="btn btn-primary btn-lg shrink-0 px-5"
            :disabled="count === 0 || sending"
            @click="confirmOpen = true"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M5 13l4 4L19 7" />
            </svg>
            Zaključi
          </button>
        </div>
      </div>
    </div>

    <!-- S4: the aromas -->
    <ProductShishaSheet
      v-if="shishaProduct && boot"
      :product="shishaProduct"
      :flavours="boot.flavours"
      :unavailable-ids="unavailableAromas"
      :note-chips="chipsFor(shishaProduct)"
      @close="shishaProduct = null"
      @confirm="addShisha"
    />

    <!-- Note chips and free text: a line's ⋯ in the review, and the *Ostalo* tile -->
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
      @cancel="cancelDraft"
    />

    <div v-if="toast" class="toast" role="status">
      {{ toast }}
    </div>

    <template #fallback>
      <p class="py-10 text-center text-text-2">
        Učitavanje…
      </p>
    </template>
  </ClientOnly>
</template>
