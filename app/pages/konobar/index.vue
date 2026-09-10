<script setup lang="ts">
/**
 * **S1 *Stolovi*** — the waiter's home screen: the room from above, one circle
 * per table.
 *
 * There is exactly one timer behind it. `useChanges` asks the server *anything
 * new since 812?* every 12 s and the floor plan, the shift strip and the menu
 * version all arrive in that one answer — so the plan and the strip can never
 * disagree, because they were read inside one request (BACKEND §4.1). The
 * layout itself comes from `bootstrap` (which table sits at which col/row) and
 * is refetched only when `menu_version` moves.
 *
 * Four things Phase 3 added, and each of them is a thing a waiter can only find
 * out here:
 *
 *   - **+ Bez stola** — guests at the bar are a tab on no table (§1.11). They
 *     are cards above the plan, because the plan draws tables and there is no
 *     circle for the bar.
 *   - **A long press on a table with a live nargila is *Žar*** (F4). Two taps,
 *     and the button twin is the inline chip on the shisha line inside S2.
 *   - **Drafts pulse.** A round tapped fifteen minutes ago and never locked is
 *     money nobody has recorded, so it says so and offers the two ways out.
 *   - **The red *kasno* card** — a round that reached the server after its
 *     table was already paid. Only the person who carried the phone knows
 *     whether he took the money for it.
 */
import { formatKm } from '#shared/money'
import type { ShiftBrief, TabDetail, TableState, Zone } from '#shared/types'
import { stavke } from '~/components/order/OrderText'

useHead({ title: 'Stolovi' })

const api = useApi()
const me = useMe()
// Hydrates the outbox and the drafts off IndexedDB, and owns the flush timers.
const { outbox, enqueue } = useOutbox()
const cart = useCartStore()

const states = ref<TableState[]>([])
const looseTabs = ref<TableState[]>([])
const shift = ref<ShiftBrief | null>(null)

const { data: boot, pending: bootPending, refresh: refreshBoot } = useBootstrapData()

// The session is a cookie the server reads, so this check is a request, not a
// localStorage lookup — and it therefore belongs in `onMounted` rather than in
// route middleware, which would also run on the server with no cookie jar.
onMounted(() => {
  void me.requireSession()
})

const { refresh: refreshState } = useChanges({
  tables: (state) => {
    states.value = state.tables
    looseTabs.value = state.loose_tabs
    shift.value = state.shift
    // The catalogue's own recovery. `useAsyncData` runs once and never retries,
    // so a first client fetch that failed with no cached copy behind it would
    // leave the floor plan empty for the rest of the shift. The poll has just
    // reached the server, so the menu is one request away.
    if (!boot.value && !bootPending.value) void refreshBoot()
  },
  menu: () => refreshBoot(),
  me: () => me.load(),
}, { intervalMs: 12_000 })

// Which zone the waiter was last looking at. Remembered per phone: a waiter who
// works the terrace should not tap "Bašta" every time he opens the app.
const zone = useLocalStorage<Zone>('sank:zona', 'unutra')

const menuOpen = ref(false)
const toast = ref<string | null>(null)

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
    await refreshState()
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

// -- Nacrti -----------------------------------------------------------------

/**
 * The unlocked rounds sitting on this phone.
 *
 * They are drawn dashed on the plan and counted in the header, because an
 * unlocked draft is the one thing in the whole app that no ledger anywhere
 * knows about: the guest has been served and nothing has been recorded. A shift
 * cannot close while one exists (F10 step 1), so the card below offers the two
 * ways out and nothing else.
 */
const myDrafts = computed(() => cart.myDrafts)

const draftTables = computed(() => myDrafts.value
  .map(d => d.table_id)
  .filter((id): id is string => id !== null))

function draftLabel(tableId: string): string {
  const draft = myDrafts.value.find(d => d.table_id === tableId)
  if (!draft) return 'nacrt'
  const fen = draft.lines.reduce(
    (sum, line) => sum + (priceById.value.get(line.product_id) ?? 0) * line.qty, 0)
  return formatKm(fen)
}

function draftCount(tableId: string | null): number {
  const draft = myDrafts.value.find(d => d.table_id === tableId)
  return draft?.lines.reduce((n, l) => n + l.qty, 0) ?? 0
}

function draftName(tableId: string | null): string {
  if (tableId === null) return 'Bez stola'
  return boot.value?.tables.find(t => t.id === tableId)?.name ?? 'Sto'
}

/** Older than fifteen minutes. These are the ones that pulse (F2 step 5). */
const staleDrafts = computed(() => cart.staleDrafts)

const discarding = ref<string | null>(null)

async function discardDraft(tableId: string | null) {
  if (discarding.value) return
  const draft = myDrafts.value.find(d => d.table_id === tableId)
  if (!draft) return
  discarding.value = draft.client_id
  try {
    const fen = draft.lines.reduce(
      (sum, line) => sum + (priceById.value.get(line.product_id) ?? 0) * line.qty, 0)
    // A discard leaves a trace or the closing check is a check on nothing — but
    // the entry names a table, and a *Bez stola* draft has none to name, so
    // that one is simply dropped on the phone.
    if (tableId !== null) {
      await api.discardDraft({
        table_id: tableId,
        lines: draft.lines.reduce((n, l) => n + l.qty, 0),
        total_fen: fen,
      })
    }
    cart.clear(tableId)
    toast.value = `Nacrt odbačen · ${draftName(tableId)}`
  } catch (err) {
    banner.value = apiErrorText(err, 'Nema veze — nacrt ostaje na telefonu')
  } finally {
    discarding.value = null
  }
}

// -- Kasno sinhronizovano ---------------------------------------------------

/** Dismissed on this phone, so the card stops asking every fifteen seconds. */
const dismissedLate = useLocalStorage<string[]>('sank:kasno-odbaceno', [])

const lateTabs = computed(() => [...states.value, ...looseTabs.value]
  .filter(t => t.tab_id
    && t.late_sync && t.pending_review
    && t.assigned_to === me.user.value?.id
    && !dismissedLate.value.includes(t.tab_id)))

const lateBusy = ref(false)

async function lateWasPaid(row: TableState) {
  if (!row.tab_id || lateBusy.value) return
  lateBusy.value = true
  try {
    const clientId = crypto.randomUUID()
    await enqueue({
      kind: 'pay',
      client_id: clientId,
      ...(row.tab_client_id ? { tab_client_id: row.tab_client_id } : {}),
      label: draftName(row.table_id),
      amount_fen: row.remaining_fen,
      payload: {
        client_id: clientId,
        tab_id: row.tab_id,
        method: 'cash',
        amount_fen: row.remaining_fen,
        tip_fen: 0,
        covers_order_client_ids: [],
        client_created_at: new Date().toISOString(),
      },
    })
    toast.value = `Naplaćeno · ${formatKm(row.remaining_fen)}`
    await refreshState()
  } catch (err) {
    banner.value = apiErrorText(err)
  } finally {
    lateBusy.value = false
  }
}

function lateWasNotPaid(row: TableState) {
  // Nothing to write: the tab is already `unpaid` with `pending_review` and it
  // is on the owner's *Zahtijeva pažnju* list with this waiter's name on it.
  if (row.tab_id) dismissedLate.value = [...dismissedLate.value, row.tab_id]
}

// -- Žar --------------------------------------------------------------------

const zarFor = ref<{ tableId: string, name: string, tabId: string } | null>(null)
const zarDetail = ref<TabDetail | null>(null)
const zarLoading = ref(false)
const zarBusy = ref(false)
const zarError = ref<string | null>(null)

const zarProduct = computed(() =>
  (boot.value?.products ?? []).find(p => p.system_key === 'zar') ?? null)

/** "21:05" — the café's wall clock, never the browser's zone. */
function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('bs-BA', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Sarajevo',
  })
}

const zarBowls = computed(() => (zarDetail.value?.orders ?? []).flatMap((round, index) =>
  round.lines
    .filter(line => line.flavour_names.length > 0 && line.status !== 'storno')
    .map(line => ({
      ...line,
      round: `Tura ${index + 1} · ${clock(round.at)}`,
    }))))

async function openZar(tableId: string) {
  const state = shownStates.value.find(s => s.table_id === tableId)
  const tabId = state?.tab_id
  // A table with no tab has no bowl on it; the long press simply opens it.
  if (!tabId || tabId.startsWith('local:')) {
    navigateTo(`/konobar/sto/${tableId}`)
    return
  }
  zarFor.value = { tableId, name: draftName(tableId), tabId }
  zarError.value = null
  zarLoading.value = true
  try {
    zarDetail.value = await api.getTab(tabId)
  } catch (err) {
    zarDetail.value = null
    zarError.value = apiErrorText(err, 'Nema veze — otvori sto da dodaš žar')
  } finally {
    zarLoading.value = false
  }
}

/**
 * *Žar* locks on the spot with no *Potvrdi* sheet — the single carve-out from
 * PLAN §10's invariant 2, and it is safe because the product is 0 KM: there is
 * no price to confirm. Two pieces of coal still leave the box and the ledger
 * still says so.
 */
async function addZar(parentLineId: string) {
  const product = zarProduct.value
  const target = zarFor.value
  if (!product || !target || zarBusy.value) return
  zarBusy.value = true
  zarError.value = null
  try {
    const clientId = crypto.randomUUID()
    const tabClientId = cart.ensureTabClientId(target.tableId)
    await enqueue({
      kind: 'order',
      client_id: clientId,
      tab_client_id: tabClientId,
      label: target.name,
      payload: {
        client_id: clientId,
        table_id: target.tableId,
        tab_client_id: tabClientId,
        client_created_at: new Date().toISOString(),
        lines: [{
          id: crypto.randomUUID(),
          product_id: product.id,
          qty: 1,
          parent_line_id: parentLineId,
        }],
      },
    })
    zarFor.value = null
    toast.value = `Žar · ${target.name}`
    await refreshState()
  } catch (err) {
    zarError.value = apiErrorText(err)
  } finally {
    zarBusy.value = false
  }
}

// -- Navigation -------------------------------------------------------------

/**
 * Tapping a table. An empty one goes **straight to the menu**, because that is
 * the only thing a waiter ever does at an empty table, and the tap it saves is
 * the difference between five taps for two coffees and six.
 */
function openTable(tableId: string) {
  const state = shownStates.value.find(s => s.table_id === tableId)
  const hasSomething = !!state?.tab_id || draftCount(tableId) > 0
  navigateTo(hasSomething ? `/konobar/sto/${tableId}` : `/konobar/dodaj/${tableId}`)
}

const myOpenTabs = computed(() => shift.value?.my_open_tabs ?? 0)

/** *+ Bez stola*: this phone's own table-less tab, or a fresh one. */
function openLoose() {
  navigateTo(draftCount(null) > 0 || looseTabs.value.length > 0
    ? '/konobar/sto/bez-stola'
    : '/konobar/dodaj/bez-stola')
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

        <OrderLateCard
          v-for="row in lateTabs"
          :key="row.tab_id!"
          :table-name="draftName(row.table_id)"
          :amount-fen="row.remaining_fen"
          :busy="lateBusy"
          @paid="lateWasPaid(row)"
          @unpaid="lateWasNotPaid(row)"
        />

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

        <!-- A round tapped and never locked. Nothing anywhere knows about it. -->
        <div
          v-for="draft in staleDrafts"
          :key="draft.client_id"
          class="card flex flex-col gap-2 border-warn p-3"
        >
          <div class="flex items-center gap-2">
            <span class="chip chip-warn">Nacrt čeka</span>
            <span class="grow text-[15px] font-semibold">{{ draftName(draft.table_id) }}</span>
            <span class="num text-[15px]">{{ stavke(draftCount(draft.table_id)) }}</span>
          </div>
          <p class="text-[15px] text-text-2">
            Nije poslano šankeru. Zaključi ga ili odbaci — smjena se ne može
            zatvoriti dok stoji.
          </p>
          <div class="flex gap-2">
            <NuxtLink
              :to="`/konobar/sto/${draft.table_id ?? 'bez-stola'}`"
              class="btn btn-accent h-12 flex-1"
            >
              Zaključi
            </NuxtLink>
            <button
              type="button"
              class="btn h-12 flex-1"
              :disabled="discarding === draft.client_id"
              @click="discardDraft(draft.table_id)"
            >
              Odbaci
            </button>
          </div>
        </div>

        <!-- The shift is being closed: envelopes are being collected -->
        <div
          v-if="shift?.closing && !shift.my_settled"
          class="card flex items-center gap-3 border-warn p-3"
        >
          <div class="grow text-[15px]">
            <span class="font-semibold">Smjena se zatvara.</span>
            <span class="text-text-2"> Predaj pazar.</span>
          </div>
          <NuxtLink to="/konobar/smjena" class="btn btn-accent shrink-0">
            Završi
          </NuxtLink>
        </div>

        <!-- Bez stola: the guests at the bar, on nobody's table -->
        <div v-if="looseTabs.length > 0 || draftCount(null) > 0" class="flex flex-col gap-2">
          <button
            v-for="row in looseTabs"
            :key="row.tab_id!"
            type="button"
            class="card flex items-center gap-3 p-3 text-left"
            :class="row.assigned_to === me.user.value?.id ? 'border-accent' : ''"
            @click="navigateTo('/konobar/sto/bez-stola')"
          >
            <div class="grow">
              <div class="text-sm text-text-2">
                Bez stola
                <span v-if="row.assigned_to !== me.user.value?.id">· {{ row.assigned_to_initials }}</span>
              </div>
              <div class="num text-lg font-semibold">
                {{ formatKm(row.remaining_fen) }}
              </div>
            </div>
            <span v-if="row.pending_review" class="chip chip-warn">čeka</span>
          </button>

          <button
            v-if="draftCount(null) > 0 && looseTabs.length === 0"
            type="button"
            class="card flex items-center gap-3 border-dashed border-accent p-3 text-left"
            @click="navigateTo('/konobar/sto/bez-stola')"
          >
            <div class="grow">
              <div class="text-sm text-text-2">
                Bez stola · nacrt
              </div>
              <div class="num text-lg font-semibold">
                {{ stavke(draftCount(null)) }}
              </div>
            </div>
          </button>
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
          :draft-tables="draftTables"
          :draft-label="draftLabel"
          @select="openTable"
          @long="openZar"
        />
        <p v-else-if="bootPending" class="py-10 text-center text-text-2">
          Učitavanje…
        </p>
        <!-- Honesty (PHASE3 §4): a screen that could not load says so and
             offers the way back, rather than showing *Učitavanje…* for ever. -->
        <div v-else class="flex flex-col items-center gap-3 py-10 text-center">
          <p class="text-text-2">
            Nema veze — meni nije učitan.
          </p>
          <button type="button" class="btn h-12 px-5" @click="refreshBoot()">
            Pokušaj ponovo
          </button>
        </div>

        <!-- pb-20: the floating *+ Bez stola* button sits over this corner. -->
        <p class="pb-20 text-center text-sm text-text-2">
          Dodirni sto → narudžba · dugi dodir → žar
          <template v-if="myOpenTabs > 0">
            · <span class="num">{{ myOpenTabs }}</span> otvorenih kod tebe
          </template>
        </p>
      </div>
    </div>

    <!-- The guests standing at the bar get a tab like anybody else. -->
    <button
      type="button"
      class="btn btn-accent fixed bottom-6 right-4 z-40 h-14 px-5 text-lg shadow-lg"
      @click="openLoose"
    >
      + Bez stola
    </button>

    <OrderZarSheet
      v-if="zarFor"
      :table-name="zarFor.name"
      :bowls="zarBowls"
      :zar-name="zarProduct?.name ?? null"
      :loading="zarLoading"
      :busy="zarBusy"
      :error="zarError"
      @close="zarFor = null"
      @zar="addZar"
    />

    <WaiterAvatarSheet v-if="menuOpen" @close="menuOpen = false" />

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
