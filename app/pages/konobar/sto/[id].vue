<script setup lang="ts">
/**
 * **S2 *Sto N*** — everything that has happened at one table, and the two
 * things that can happen next.
 *
 * It is the screen a waiter comes back to all night, so it answers the three
 * questions he arrives with, in order: what did they order, what do they owe,
 * and what do I do now. The rounds are collapsed to their headers ("Tura 2 ·
 * 21:05 · Amar") because after the third round the list is longer than the
 * phone; the bar at the bottom is *+ Dodaj* beside either *Zaključi* or
 * *Naplati*, never both.
 *
 * **Nothing here posts money directly.** *Potvrdi*, *Naplati* and *Nije
 * plaćeno* all `enqueue(...)` — one send path, IndexedDB first, the server when
 * there is one. *Premjesti sto* and *Predaj sto kolegi* are the exceptions and
 * they are online-only by design (PLAN F5): a move has to be checked against
 * the one-open-tab-per-table index, and a handover the colleague has not seen
 * is not a handover.
 *
 * **What this screen knows is the sum of two truths**: the tab the server
 * describes, and what is still sitting in this phone's outbox. A waiter who
 * locked a round in a dead spot must be able to take cash for it, so the amount
 * under *Naplati* counts the queued rounds too — priced from the catalogue,
 * which is a number to read out and never a number that is sent.
 */
import { formatKm } from '#shared/money'
import type {
  PaymentMethod, Product, TabDetail, TabLine, TabOrder, TableState, User, VenueTable,
} from '#shared/types'
import { stavke } from '~/components/order/OrderText'
import type { AdjustmentOutcome, CompReason } from '~/composables/useAdjustments'
// Explicit, not auto-imported. Nuxt names a component after its folder plus its
// file, so `adjust/AdjVoidSheet.vue` would be `<AdjustAdjVoidSheet>` — and an
// unresolved tag renders nothing at all in a production build, silently.
import AdjCompSheet from '~/components/adjust/AdjCompSheet.vue'
import AdjLineState from '~/components/adjust/AdjLineState.vue'
import AdjVoidSheet from '~/components/adjust/AdjVoidSheet.vue'

const route = useRoute()
const api = useApi()
const me = useMe()
const cart = useCartStore()
const { queuedFor } = useAdjustments()
const { outbox, enqueue } = useOutbox()
const { lockToast, state: syncState } = useSync()

/** `bez-stola` in the URL is a tab on no table at all (PHASE3 §1.11). */
const LOOSE = 'bez-stola'
const routeId = computed(() => String(route.params.id))
const tableId = computed<string | null>(() => (routeId.value === LOOSE ? null : routeId.value))

onMounted(() => {
  void me.requireSession()
})

const { data: boot, refresh: refreshBoot } = useBootstrapData()

const table = computed(() =>
  (tableId.value === null ? null : boot.value?.tables.find(t => t.id === tableId.value) ?? null))
const tableName = computed(() => (tableId.value === null ? 'Bez stola' : table.value?.name ?? 'Sto'))

useHead({ title: tableName })

// -- What the server knows --------------------------------------------------

const tabState = ref<TableState | null>(null)
const looseTabs = ref<TableState[]>([])
const busyTableIds = ref<string[]>([])

/**
 * Which loose tab is *this* screen's.
 *
 * A table identifies its tab; the bar does not, so the phone falls back to the
 * id it minted itself, and only then to a table-less tab it is already holding.
 * One *Bez stola* draft per phone is the deliberate limit — the cart store keys
 * on the table, and "the guests at the bar" is one party at a time from where
 * one waiter stands.
 */
function pickLooseTab(rows: TableState[]): TableState | null {
  const mine = cart.tabClientIdFor(null)
  return rows.find(r => mine !== null && r.tab_client_id === mine)
    ?? rows.find(r => r.assigned_to === me.user.value?.id)
    ?? null
}

const { refresh: refreshState } = useChanges({
  tables: (state) => {
    looseTabs.value = state.loose_tabs
    tabState.value = tableId.value === null
      ? pickLooseTab(state.loose_tabs)
      : state.tables.find(r => r.table_id === tableId.value) ?? null
    busyTableIds.value = state.tables.filter(r => r.tab_id !== null).map(r => r.table_id!)
  },
  menu: () => refreshBoot(),
  me: () => me.load(),
}, { intervalMs: 12_000 })

/**
 * The rounds themselves. `/api/changes` carries the tab's *total*, not its
 * lines, so the one screen that shows lines asks for them — on open, and again
 * whenever the poll says the tab moved.
 */
const detail = ref<TabDetail | null>(null)
const detailError = ref<string | null>(null)

async function loadDetail() {
  const tabId = tabState.value?.tab_id
  if (!tabId) {
    detail.value = null
    return
  }
  try {
    detail.value = await api.getTab(tabId)
    detailError.value = null
  } catch (err) {
    // Offline is the normal case here, and the screen says so rather than
    // showing an empty tab as if the guests had ordered nothing.
    detailError.value = apiErrorText(err, 'Nema veze — ture sa servera nisu učitane')
  }
}

watch(() => [tabState.value?.tab_id, tabState.value?.total_fen, tabState.value?.remaining_fen],
  () => { void loadDetail() },
  { immediate: true })

// -- What this phone still owes the server ----------------------------------

const products = computed<Product[]>(() => boot.value?.products ?? [])
const priceById = computed(() => new Map(products.value.map(p => [p.id, p.price_fen])))
const nameById = computed(() => new Map(products.value.map(p => [p.id, p.name])))
const flavourNameById = computed(() =>
  new Map((boot.value?.flavours ?? []).map(f => [f.id, f.name])))

const tabClientIdHere = computed(() =>
  tabState.value?.tab_client_id ?? cart.tabClientIdFor(tableId.value))

const queuedHere = computed(() => outbox.pendingForTab(tabClientIdHere.value))
const payQueued = computed(() => queuedHere.value.some(e => e.kind === 'pay'))

interface QueuedLine { name: string, qty: number, note: string | null, flavours: string[] }
interface QueuedRound { clientId: string, lines: QueuedLine[], fen: number }

/** The rounds still on the phone, drawn exactly like the locked ones. */
const queuedRounds = computed<QueuedRound[]>(() => queuedHere.value
  .filter(e => e.kind === 'order')
  .map((entry) => {
    const payload = entry.payload as {
      client_id: string
      lines?: { product_id: string, qty: number, note?: string, flavour_ids?: string[] }[]
    }
    const lines = (payload.lines ?? []).map(line => ({
      name: nameById.value.get(line.product_id) ?? 'Stavka',
      qty: line.qty,
      note: line.note ?? null,
      flavours: (line.flavour_ids ?? []).map(id => flavourNameById.value.get(id) ?? '—'),
    }))
    return {
      clientId: payload.client_id,
      lines,
      fen: (payload.lines ?? []).reduce(
        (n, line) => n + (priceById.value.get(line.product_id) ?? 0) * line.qty, 0),
    }
  }))

const queuedOrdersFen = computed(() =>
  queuedRounds.value.reduce((sum, round) => sum + round.fen, 0))
const queuedPaidFen = computed(() => queuedHere.value
  .filter(e => e.kind === 'pay')
  .reduce((sum, entry) => sum + (entry.amount_fen ?? 0), 0))

const localTotalFen = computed(() => (tabState.value?.total_fen ?? 0) + queuedOrdersFen.value)
const localRemainingFen = computed(() => Math.max(
  0,
  (tabState.value?.remaining_fen ?? 0) + queuedOrdersFen.value - queuedPaidFen.value,
))

const hasTab = computed(() => !!tabState.value?.tab_id || queuedHere.value.length > 0)

// -- The draft --------------------------------------------------------------

const lines = computed(() => cart.linesFor(tableId.value))
const count = computed(() => cart.countFor(tableId.value))
const draftTotal = computed(() => lines.value.reduce(
  (sum, line) => sum + (priceById.value.get(line.product_id) ?? 0) * line.qty, 0))

// -- Rounds -----------------------------------------------------------------

const openRounds = ref<Set<string>>(new Set())

function toggleRound(id: string) {
  const next = new Set(openRounds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  openRounds.value = next
}

/** "21:05" — the wall clock the café runs on, never the browser's zone. */
function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('bs-BA', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Sarajevo',
  })
}

function roundLabel(index: number, at: string, who: string): string {
  return `Tura ${index + 1} · ${clock(at)} · ${who}`
}

/** Is this line a bowl that can still take coal? */
function isBowl(line: TabLine): boolean {
  return line.flavour_names.length > 0 && line.status !== 'storno'
}

// -- Zaključi ---------------------------------------------------------------

const confirmOpen = ref(false)
const sending = ref(false)
const sendError = ref<string | null>(null)
const toast = ref<string | null>(null)

let leaveTimer: ReturnType<typeof setTimeout> | null = null
onBeforeUnmount(() => {
  if (leaveTimer) clearTimeout(leaveTimer)
})

/** What the tiles quoted, per round, so the price card can compare (F3 step 3). */
const quoted = useLocalStorage<Record<string, number>>('sank:quoted', {})

async function lockDraft() {
  const draft = cart.draftFor(tableId.value)
  if (!draft || count.value === 0 || sending.value) return

  sending.value = true
  sendError.value = null
  const totalAtLock = draftTotal.value
  try {
    const tabClientId = cart.ensureTabClientId(tableId.value)
    await enqueue({
      kind: 'order',
      client_id: draft.client_id,
      tab_client_id: tabClientId,
      label: tableName.value,
      payload: {
        client_id: draft.client_id,
        table_id: tableId.value,
        tab_client_id: tabClientId,
        client_created_at: new Date().toISOString(),
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
    await refreshState()
  } catch (err) {
    sendError.value = apiErrorText(err, 'Nema veze — pokušaj ponovo')
    void me.handleAuthError(err)
  } finally {
    sending.value = false
  }
}

function addOne(lineId: string) {
  const line = lines.value.find(l => l.id === lineId)
  if (line) cart.add(tableId.value, line.product_id, line.flavour_ids, line.note)
}

function removeOne(lineId: string) {
  const line = lines.value.find(l => l.id === lineId)
  if (line) cart.removeOne(tableId.value, line.product_id)
}

// -- Cijena promijenjena ----------------------------------------------------

/**
 * The amber card: what the tiles quoted against what the server charged.
 *
 * The comparison is per round and by the round's own `client_id`, so it holds
 * however long the round sat in the outbox and survives a reload — which the
 * lock's response would not, because since Phase 3 that answer may arrive
 * twenty minutes later on a screen nobody is looking at.
 */
const priceCard = computed(() => {
  for (const round of detail.value?.orders ?? []) {
    const quotedFen = quoted.value[round.client_id]
    if (quotedFen === undefined) continue
    const serverFen = round.lines.reduce((sum, l) => sum + l.charged_fen, 0)
    if (serverFen !== quotedFen) return { clientId: round.client_id, quotedFen, serverFen }
  }
  return null
})

// A price that moved means the phone's catalogue is stale: fetch it again, once.
watch(priceCard, (card) => {
  if (card) void refreshBoot()
})

function dismissPriceCard() {
  const card = priceCard.value
  if (!card) return
  const next = { ...quoted.value }
  delete next[card.clientId]
  quoted.value = next
}

/** Rounds that landed cleanly stop being interesting; forget what they quoted. */
watch(detail, (value) => {
  if (!value) return
  const next = { ...quoted.value }
  let changed = false
  for (const round of value.orders) {
    const quotedFen = next[round.client_id]
    if (quotedFen === undefined) continue
    const serverFen = round.lines.reduce((sum, l) => sum + l.charged_fen, 0)
    if (serverFen === quotedFen) {
      delete next[round.client_id]
      changed = true
    }
  }
  if (changed) quoted.value = next
})

// -- Naplata ----------------------------------------------------------------

const payOpen = ref(false)
const payMode = ref<'main' | 'unpaid'>('main')
const paying = ref(false)
const payError = ref<string | null>(null)

const paymentMethods = computed<PaymentMethod[]>(() =>
  me.settings.value?.payment_methods ?? ['cash'])

async function pay(payment: { method: PaymentMethod, amount_fen: number, received_fen?: number }) {
  if (paying.value) return
  const tabId = tabState.value?.tab_id ?? null
  const clientTabId = cart.ensureTabClientId(tableId.value)

  paying.value = true
  payError.value = null
  try {
    // The change and what is left are arithmetic the phone can do itself; the
    // server's answer would be identical, and waiting for it to hand back a
    // guest's change is exactly what an outbox exists to stop.
    const change = Math.max(0, (payment.received_fen ?? payment.amount_fen) - payment.amount_fen)
    const remaining = Math.max(0, localRemainingFen.value - payment.amount_fen)

    const clientId = crypto.randomUUID()
    await enqueue({
      kind: 'pay',
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
      toast.value = `Naplaćeno · ostaje ${formatKm(remaining)}`
      return
    }
    cart.closeTab(tableId.value)
    toast.value = change > 0
      ? `Naplaćeno · vrati ${formatKm(change)}`
      : `Naplaćeno · ${tableName.value}`
    leaveTimer = setTimeout(() => navigateTo('/konobar'), change > 0 ? 3500 : 2000)
  } catch (err) {
    payError.value = apiErrorText(err)
    void me.handleAuthError(err)
  } finally {
    paying.value = false
  }
}

async function markUnpaid(reason: 'walked_out' | 'dispute' | 'other') {
  if (paying.value) return
  const clientTabId = cart.ensureTabClientId(tableId.value)

  paying.value = true
  payError.value = null
  try {
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
    leaveTimer = setTimeout(() => navigateTo('/konobar'), 2500)
  } catch (err) {
    payError.value = apiErrorText(err)
    void me.handleAuthError(err)
  } finally {
    paying.value = false
  }
}

function openPay(mode: 'main' | 'unpaid' = 'main') {
  payError.value = null
  payMode.value = mode
  payOpen.value = true
  menuOpen.value = false
}

// -- ⋯ ----------------------------------------------------------------------

const menuOpen = ref(false)
const guestOpen = ref(false)
const moveOpen = ref(false)
const moveError = ref<string | null>(null)
const moving = ref(false)

/** Only a table with nobody on it can take a move. */
const freeTables = computed<VenueTable[]>(() => (boot.value?.tables ?? [])
  .filter(t => !busyTableIds.value.includes(t.id) && t.id !== tableId.value))

const colleagues = computed<User[]>(() => (boot.value?.users ?? [])
  .filter(u => u.id !== me.user.value?.id && u.role !== 'admin'))

/** *Premjesti* and *Predaj* both need the network; the sheet says so up front. */
const offlineForOnlineOnly = computed(() => syncState.value === 'offline')

async function moveToTable(targetId: string) {
  const tabId = tabState.value?.tab_id
  if (!tabId || moving.value) return
  moving.value = true
  moveError.value = null
  try {
    await api.moveTab(tabId, targetId)
    moveOpen.value = false
    // The draft and the tab id follow the guests to the new table.
    cart.closeTab(tableId.value)
    const name = boot.value?.tables.find(t => t.id === targetId)?.name ?? 'sto'
    toast.value = `Premješteno na ${name}`
    await refreshState()
    leaveTimer = setTimeout(() => navigateTo(`/konobar/sto/${targetId}`), 900)
  } catch (err) {
    moveError.value = apiErrorText(err)
  } finally {
    moving.value = false
  }
}

async function handToColleague(userId: string) {
  const tabId = tabState.value?.tab_id
  if (!tabId || moving.value) return
  moving.value = true
  moveError.value = null
  try {
    await api.offerTab(tabId, userId)
    moveOpen.value = false
    const name = boot.value?.users.find(u => u.id === userId)?.name ?? 'kolegi'
    toast.value = `Ponuđeno: ${name}`
    await refreshState()
  } catch (err) {
    moveError.value = apiErrorText(err)
  } finally {
    moving.value = false
  }
}

// -- Žar --------------------------------------------------------------------

const zarBusy = ref(false)
const zarError = ref<string | null>(null)

const zarProduct = computed(() => products.value.find(p => p.system_key === 'zar') ?? null)

/**
 * *Žar* is its own round, and it is the **one** lock in the app with no
 * *Potvrdi* sheet (PLAN §10, invariant 2). The carve-out is safe because the
 * product is 0 KM: there is no price to confirm. Two pieces of coal still leave
 * the box and the ledger still says so.
 */
async function addZar(parentLineId: string) {
  const product = zarProduct.value
  if (!product || zarBusy.value) return
  zarBusy.value = true
  zarError.value = null
  try {
    const clientId = crypto.randomUUID()
    const tabClientId = cart.ensureTabClientId(tableId.value)
    await enqueue({
      kind: 'order',
      client_id: clientId,
      tab_client_id: tabClientId,
      label: tableName.value,
      payload: {
        client_id: clientId,
        table_id: tableId.value,
        tab_client_id: tabClientId,
        client_created_at: new Date().toISOString(),
        lines: [{
          id: crypto.randomUUID(),
          product_id: product.id,
          qty: 1,
          // Which bowl this coal is for. The server checks the line is on this
          // same tab, so a stale phone cannot point it at somebody else's.
          parent_line_id: parentLineId,
        }],
      },
    })
    toast.value = lockToast(tableName.value, 'Žar')
    await refreshState()
  } catch (err) {
    zarError.value = apiErrorText(err)
  } finally {
    zarBusy.value = false
  }
}

// -- A locked line, and the storno it can be asked for ----------------------

/** The long-press sheet: the line, and the round it belongs to. */
const lockedLine = ref<{ line: TabLine, order: TabOrder, label: string } | null>(null)

/** *Zatraži storno* on that sheet swaps it for WP1's own (F6). */
const stornoFor = ref<{ line: TabLine, order: TabOrder } | null>(null)

function askStorno() {
  const open = lockedLine.value
  lockedLine.value = null
  if (open) stornoFor.value = { line: open.line, order: open.order }
}

async function stornoDone(outcome: AdjustmentOutcome) {
  stornoFor.value = null
  toast.value = outcome.message
  await refreshState()
  await loadDetail()
}

/**
 * What a struck (or waiting) line should say. `queued` is the one state the
 * server cannot know about: the request is still in this phone's outbox.
 * A rejected storno leaves the line `ok`, so it is money again and draws
 * normally — which is what `AdjLineState` would say anyway.
 */
function adjState(line: TabLine): 'applied' | 'pending' | 'queued' | null {
  if (queuedFor(line.id)) return 'queued'
  if (line.status === 'storno_na_cekanju') return 'pending'
  if (line.status === 'storno' || line.status === 'gratis') return 'applied'
  return null
}

function adjKind(line: TabLine): 'void' | 'comp' {
  return line.status === 'gratis' || line.comp_reason ? 'comp' : 'void'
}

// -- Na račun kuće on a draft line (F7) -------------------------------------

const noteFor = ref<{ product: Product, lineId: string } | null>(null)
const compFor = ref<{ product: Product, lineId: string } | null>(null)
const staffUsed = ref<number | null>(null)

/** The ⋯ on a draft line in the *Potvrdi* sheet. */
function noteLine(lineId: string) {
  const line = lines.value.find(l => l.id === lineId)
  const product = products.value.find(p => p.id === line?.product_id)
  if (line && product) noteFor.value = { product, lineId }
}

function saveNote(note: string | null) {
  const open = noteFor.value
  noteFor.value = null
  if (!open) return
  // The cart merges by product **and** note, so re-noting is take-off-put-back.
  const line = lines.value.find(l => l.id === open.lineId)
  if (!line) return
  const qty = line.qty
  for (let i = 0; i < qty; i++) cart.removeOne(tableId.value, line.product_id)
  for (let i = 0; i < qty; i++) {
    cart.add(tableId.value, line.product_id, line.flavour_ids, note ?? undefined)
  }
}

/**
 * Tonight's staff drinks, from `GET /api/me/shift`'s `counts.gratis` (§1.5).
 * Best effort: `null` renders the published cap without the score.
 */
async function loadStaffUsed(): Promise<void> {
  try {
    staffUsed.value = (await api.getMyShift()).counts.gratis.used
  } catch {
    // No signal. The rule is still on screen; only tonight's count is missing.
  }
}

function openComp() {
  const open = noteFor.value
  noteFor.value = null
  if (!open) return
  compFor.value = open
  void loadStaffUsed()
}

const compLine = computed(() => {
  const open = compFor.value
  if (!open) return null
  const line = lines.value.find(l => l.id === open.lineId)
  const qty = line?.qty ?? 1
  return {
    id: open.lineId,
    name: open.product.name,
    qty,
    amount_fen: (priceById.value.get(open.product.id) ?? open.product.price_fen) * qty,
  }
})

function applyComp(reason: CompReason) {
  const open = compFor.value
  compFor.value = null
  if (open) cart.setComp(tableId.value, open.lineId, reason)
}

// -- Kasno sinhronizovano ---------------------------------------------------

/**
 * The red card of F3 step 5. It is read from the poll rather than from the
 * lock's answer, for the same reason the price card is: the round may have gone
 * out long after the screen that queued it was closed. A tab that came back
 * `late_sync` **and** `pending_review`, on my own line, is a round the server
 * could not put on the tab it named — and only the person who carried the phone
 * knows whether he took the money for it.
 */
const dismissedLate = useLocalStorage<string[]>('sank:kasno-odbaceno', [])

const lateTabs = computed(() => looseTabs.value
  .concat(tabState.value ? [tabState.value] : [])
  .filter(t => t.tab_id
    && t.late_sync && t.pending_review
    && t.assigned_to === me.user.value?.id
    && !dismissedLate.value.includes(t.tab_id)))

async function lateWasPaid(row: TableState) {
  if (!row.tab_id) return
  paying.value = true
  try {
    const clientId = crypto.randomUUID()
    await enqueue({
      kind: 'pay',
      client_id: clientId,
      ...(row.tab_client_id ? { tab_client_id: row.tab_client_id } : {}),
      label: tableName.value,
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
    payError.value = apiErrorText(err)
  } finally {
    paying.value = false
  }
}

function lateWasNotPaid(row: TableState) {
  // Nothing to write: the tab is already `unpaid` with `pending_review`, and
  // the owner decides it from *Zahtijeva pažnju*. This only stops the card
  // asking the same question every fifteen seconds.
  if (row.tab_id) dismissedLate.value = [...dismissedLate.value, row.tab_id]
}
</script>

<template>
  <ClientOnly>
    <div class="flex flex-1 flex-col">
      <WaiterHeader :title="tableName" back-to="/konobar">
        <template #right>
          <WaiterSyncChip compact />
          <button
            type="button"
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface text-text"
            aria-label="Više"
            @click="menuOpen = true"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <path d="M5 12h.01M12 12h.01M19 12h.01" />
            </svg>
          </button>
        </template>
      </WaiterHeader>

      <WaiterOutboxBanner />

      <div class="flex flex-1 flex-col gap-3 py-3">
        <WaiterFailedCard />

        <OrderLateCard
          v-for="row in lateTabs"
          :key="row.tab_id!"
          :table-name="tableName"
          :amount-fen="row.remaining_fen"
          :busy="paying"
          @paid="lateWasPaid(row)"
          @unpaid="lateWasNotPaid(row)"
        />

        <OrderPriceCard
          v-if="priceCard"
          :table-name="tableName"
          :draft-fen="priceCard.quotedFen"
          :server-fen="priceCard.serverFen"
          @close="dismissPriceCard"
        />

        <!-- What is owed -->
        <div v-if="hasTab" class="card flex flex-col gap-1 p-3">
          <div class="flex flex-wrap items-center gap-2 text-sm text-text-2">
            Zaključeno
            <span v-if="payQueued" class="chip chip-warn">naplata čeka slanje</span>
            <span v-else-if="queuedOrdersFen > 0" class="chip chip-warn">čeka slanje</span>
            <span v-else-if="tabState?.pending_review" class="chip chip-warn">naplata čeka</span>
            <span v-if="tabState?.late_sync" class="chip chip-warn">kasno</span>
          </div>
          <div class="num text-3xl font-bold">
            {{ formatKm(localRemainingFen) }}
          </div>
          <div v-if="localRemainingFen !== localTotalFen" class="num text-sm text-text-2">
            od {{ formatKm(localTotalFen) }}
          </div>
        </div>

        <p v-if="detailError" class="rounded-xl bg-warn-soft px-3 py-2 text-[15px] text-warn">
          {{ detailError }}
        </p>

        <!-- The locked rounds, newest last, collapsed to their headers -->
        <div
          v-for="(round, index) in detail?.orders ?? []"
          :key="round.id"
          class="card overflow-hidden"
        >
          <button
            type="button"
            class="flex w-full items-center gap-2 px-3 py-3 text-left"
            @click="toggleRound(round.id)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" class="shrink-0 text-text-2">
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
            <span class="grow text-[15px] font-semibold">
              {{ roundLabel(index, round.at, round.locked_by_name) }}
            </span>
            <span v-if="round.late_sync" class="chip chip-warn">kasno</span>
            <span class="num text-[15px] font-semibold">
              {{ formatKm(round.lines.reduce((sum, l) => sum + l.charged_fen, 0)) }}
            </span>
            <svg
              width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.8" stroke-linecap="round"
              class="shrink-0 text-text-2 transition-transform"
              :class="openRounds.has(round.id) ? 'rotate-180' : ''"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          <ul v-if="openRounds.has(round.id)" class="flex flex-col gap-1 border-t border-line px-3 py-2">
            <li v-for="row in round.lines" :key="row.id" class="flex flex-col gap-1.5 py-1">
              <!-- Struck, waiting, or still on this phone: colour, icon and a
                   sentence, never colour alone (PHASE3 §4). -->
              <AdjLineState
                v-if="adjState(row)"
                :name="row.name_snapshot"
                :qty="row.qty"
                :amount-fen="row.charged_fen"
                :kind="adjKind(row)"
                :state="adjState(row)!"
                :note="row.note"
              />
              <button
                v-else
                type="button"
                class="flex items-baseline gap-2 text-left"
                @click="lockedLine = {
                  line: row,
                  order: round,
                  label: roundLabel(index, round.at, round.locked_by_name),
                }"
              >
                <span class="min-w-0 grow text-[17px]">
                  <span class="num font-semibold">{{ row.qty }}×</span> {{ row.name_snapshot }}
                </span>
                <span class="num shrink-0 text-[17px] font-semibold">{{ formatKm(row.charged_fen) }}</span>
              </button>

              <div class="flex flex-wrap items-center gap-1.5">
                <span v-for="flavour in row.flavour_names" :key="flavour" class="chip">{{ flavour }}</span>
                <span v-if="row.note && !adjState(row)" class="chip chip-warn">{{ row.note }}</span>

                <!-- The button twin of the long press on the floor plan (F4). -->
                <template v-if="isBowl(row)">
                  <button
                    type="button"
                    class="chip min-h-12 border border-line bg-surface-2 px-4 text-[15px] font-semibold text-text"
                    :disabled="zarBusy"
                    @click="addZar(row.id)"
                  >
                    Žar
                  </button>
                  <NuxtLink
                    :to="`/konobar/dodaj/${routeId}?kat=${products.find(p => p.name === row.name_snapshot)?.category_id ?? ''}`"
                    class="chip min-h-12 border border-line bg-surface-2 px-4 text-[15px] font-semibold text-text"
                  >
                    Nova lula
                  </NuxtLink>
                </template>
              </div>
            </li>
          </ul>
        </div>

        <!-- Rounds this phone has locked but not yet sent -->
        <div
          v-for="round in queuedRounds"
          :key="round.clientId"
          class="card border-warn p-3"
        >
          <div class="flex items-center gap-2">
            <span class="chip chip-warn">Tura čeka slanje</span>
            <span class="num grow text-right text-[15px] font-semibold">{{ formatKm(round.fen) }}</span>
          </div>
          <ul class="mt-2 flex flex-col gap-1">
            <li v-for="(row, i) in round.lines" :key="i" class="text-[15px]">
              <span class="num font-semibold">{{ row.qty }}×</span> {{ row.name }}
              <small v-if="row.flavours.length" class="text-text-2">· {{ row.flavours.join(' + ') }}</small>
              <small v-if="row.note" class="text-warn">· {{ row.note }}</small>
            </li>
          </ul>
        </div>

        <!-- The draft: still only on this phone -->
        <div v-if="count > 0" class="card border-dashed border-accent p-3">
          <div class="flex items-center gap-2">
            <span class="chip">Nova tura — nije poslano</span>
            <span class="num grow text-right text-[15px] font-semibold">{{ formatKm(draftTotal) }}</span>
          </div>
          <ul class="mt-2 flex flex-col gap-1.5">
            <li v-for="line in lines" :key="line.id" class="flex items-center gap-2">
              <span class="min-w-0 grow text-[17px]">
                {{ nameById.get(line.product_id) ?? 'Stavka' }}
                <small v-if="line.flavour_ids?.length" class="text-text-2">
                  · {{ line.flavour_ids.map(id => flavourNameById.get(id) ?? '—').join(' + ') }}
                </small>
                <small v-if="line.note" class="text-warn">· {{ line.note }}</small>
                <small v-if="line.comp_reason" class="text-good">· kuća časti</small>
              </span>
              <!-- The ⋯ twin of the long press: napomena, and *Na račun kuće*. -->
              <button
                type="button"
                class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-text-2"
                :aria-label="`Napomena · ${nameById.get(line.product_id) ?? 'stavka'}`"
                @click="noteLine(line.id)"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
                  <path d="M5 12h.01M12 12h.01M19 12h.01" />
                </svg>
              </button>
              <button
                type="button"
                class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-xl font-bold"
                :aria-label="`Skini jedan · ${nameById.get(line.product_id) ?? 'stavka'}`"
                @click="removeOne(line.id)"
              >
                −
              </button>
              <span class="num w-6 text-center text-lg font-bold">{{ line.qty }}</span>
              <button
                type="button"
                class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-xl font-bold"
                :aria-label="`Dodaj jedan · ${nameById.get(line.product_id) ?? 'stavka'}`"
                @click="addOne(line.id)"
              >
                +
              </button>
            </li>
          </ul>
        </div>

        <p v-if="!hasTab && count === 0" class="py-8 text-center text-text-2">
          Ovdje još nema ništa. Dodirni <span class="font-semibold">+ Dodaj</span>.
        </p>
      </div>

      <!-- The bar: + Dodaj beside either Zaključi or Naplati, never both -->
      <div class="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t border-line bg-bg px-4 pb-5 pt-3">
        <div v-if="sendError || zarError" class="rounded-xl bg-danger-soft px-3 py-2 text-[15px] text-danger">
          {{ sendError ?? zarError }}
        </div>

        <div class="flex gap-2">
          <NuxtLink :to="`/konobar/dodaj/${routeId}`" class="btn h-14 flex-1 text-lg">
            + Dodaj
          </NuxtLink>

          <button
            v-if="count > 0"
            type="button"
            class="btn btn-accent h-14 flex-1 text-lg"
            :disabled="sending"
            @click="confirmOpen = true"
          >
            Zaključi · <span class="num">{{ stavke(count) }} · {{ formatKm(draftTotal) }}</span>
          </button>
          <button
            v-else-if="hasTab"
            type="button"
            class="btn btn-accent h-14 flex-1 text-lg"
            @click="openPay('main')"
          >
            Naplati <span class="num">{{ formatKm(localRemainingFen) }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- ⋯ -->
    <div v-if="menuOpen" class="fixed inset-0 z-50">
      <div class="absolute inset-0 bg-black/55" @click="menuOpen = false" />
      <div class="absolute inset-x-0 bottom-0 mx-auto flex w-full max-w-3xl flex-col gap-2 rounded-t-[20px] border-t border-line bg-surface px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3">
        <span class="mx-auto h-1 w-10 shrink-0 rounded-full bg-line" />
        <span class="chip mb-1 self-start bg-line text-text">{{ tableName }}</span>

        <button type="button" class="btn h-14 justify-start text-lg" :disabled="!hasTab" @click="openPay('unpaid')">
          Nije plaćeno
        </button>
        <button
          type="button"
          class="btn h-14 justify-start text-lg"
          :disabled="!tabState?.tab_id"
          @click="moveOpen = true; menuOpen = false"
        >
          Premjesti sto · Predaj sto kolegi
        </button>
        <button
          type="button"
          class="btn h-14 justify-start text-lg"
          :disabled="!detail"
          @click="guestOpen = true; menuOpen = false"
        >
          Pokaži narudžbu
        </button>
        <button type="button" class="btn btn-ghost h-12" @click="menuOpen = false">
          Zatvori
        </button>
      </div>
    </div>

    <OrderConfirmSheet
      v-if="confirmOpen && boot"
      :table-name="tableName"
      :lines="lines"
      :products="boot.products"
      :flavours="boot.flavours"
      :busy="sending"
      :error="sendError"
      @close="confirmOpen = false"
      @confirm="lockDraft"
      @add="addOne"
      @remove="removeOne"
      @note="noteLine"
    />

    <WaiterPaySheet
      v-if="payOpen && hasTab"
      :table-name="tableName"
      :remaining-fen="localRemainingFen"
      :total-fen="localTotalFen"
      :methods="paymentMethods"
      :initial-mode="payMode"
      :busy="paying"
      :error="payError"
      @close="payOpen = false"
      @pay="pay"
      @unpaid="markUnpaid"
    />

    <OrderMoveSheet
      v-if="moveOpen"
      :table-name="tableName"
      :free-tables="freeTables"
      :colleagues="colleagues"
      :offline="offlineForOnlineOnly"
      :busy="moving"
      :error="moveError"
      @close="moveOpen = false"
      @move="moveToTable"
      @hand="handToColleague"
    />

    <OrderLockedLineSheet
      v-if="lockedLine"
      :line="lockedLine.line"
      :round="lockedLine.label"
      @close="lockedLine = null"
      @storno="askStorno"
    />

    <!-- F6: the reason chips, the restock line, the countdown and the PIN -->
    <AdjVoidSheet
      v-if="stornoFor"
      :line="{
        id: stornoFor.line.id,
        name: stornoFor.line.name_snapshot,
        qty: stornoFor.line.qty,
        amount_fen: stornoFor.line.charged_fen,
      }"
      :table-name="tableName"
      :locked-at="stornoFor.order.at"
      :mine="stornoFor.order.locked_by === me.user.value?.id"
      :tab-paid="detail?.tab.status === 'paid'"
      :tab-client-id="tabClientIdHere"
      @close="stornoFor = null"
      @done="stornoDone"
    />

    <!-- The ⋯ on a draft line: napomena… -->
    <OrderNoteSheet
      v-if="noteFor"
      :title="noteFor.product.name"
      :chips="boot?.categories.find(c => c.id === noteFor!.product.category_id)?.note_chips ?? []"
      :initial="lines.find(l => l.id === noteFor!.lineId)?.note ?? null"
      @close="noteFor = null"
      @save="saveNote"
      @comp="openComp"
    />

    <!-- …and F7, the house paying for it. Nothing is sent from here. -->
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

    <OrderGuestView
      v-if="guestOpen && detail"
      :table-name="tableName"
      :tab="detail"
      @close="guestOpen = false"
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
