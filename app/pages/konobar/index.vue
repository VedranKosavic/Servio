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
import { formatAmount, formatKm } from '#shared/money'
import type {
  PaymentMethod, ShiftBrief, TabDetail, TabLine, TabOrder, TableState, User, VenueTable, Zone,
} from '#shared/types'
import type { AdjustmentOutcome } from '~/composables/useAdjustments'
// Explicit, not auto-imported: Nuxt names a component after its path from the
// components root, so `adjust/AdjVoidSheet.vue` would be `<AdjustAdjVoidSheet>`
// — and an unresolved tag renders nothing at all in a production build,
// silently.
import AdjVoidSheet from '~/components/adjust/AdjVoidSheet.vue'
import { stavke } from '~/components/order/OrderText'

useHead({ title: 'Stolovi' })

const api = useApi()
const me = useMe()
const route = useRoute()
// Hydrates the outbox and the drafts off IndexedDB, and owns the flush timers.
const { outbox, enqueue } = useOutbox()
// *Premjesti* and *Predaj kolegi* are the two things on this screen that need
// the server there and then, so the sheet says so rather than failing on tap.
const { state: syncState } = useSync()
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
    // A sheet that is open is looking at one of these tables. The poll only
    // fires when something actually moved, so this is one request while a
    // waiter is reading one table — and without it a round a colleague locked
    // would be missing from a list he is about to take money against.
    if (sheetFor.value) void loadSheetDetail()
  },
  menu: () => refreshBoot(),
  me: () => me.load(),
}, { intervalMs: 12_000 })

// Which zone the waiter was last looking at. Remembered per phone: a waiter who
// works the terrace should not tap "Bašta" every time he opens the app.
const zone = useLocalStorage<Zone>('sank:zona', 'unutra')

const menuOpen = ref(false)
// One timer, in `useToast`: there is no way to set a message without also
// starting the clock that takes it away.
const { toast, say } = useToast()

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
  // `formatAmount` and not `formatKm`, because `toCell()` in `FloorPlan` formats
  // a live tab the same way and for the same reason: the currency on every tile
  // is noise, and a draft reading "4,50 KM" beside a locked "6,00" put two money
  // formats in one grid.
  return formatAmount(fen)
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
    say(`Nacrt odbačen · ${draftName(tableId)}`)
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
    say(`Naplaćeno · ${formatKm(row.remaining_fen)}`)
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
  // A table with no tab has no bowl on it; the long press simply opens it,
  // which is now the sheet or the menu exactly as an ordinary tap would be.
  if (!tabId || tabId.startsWith('local:')) {
    openTable(tableId)
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
    say(`Žar · ${target.name}`)
    await refreshState()
  } catch (err) {
    zarError.value = apiErrorText(err)
  } finally {
    zarBusy.value = false
  }
}

// -- One table, over the plan ------------------------------------------------

/**
 * *Sto 4* as a sheet, not as a page.
 *
 * The owner asked for it in one sentence — *"lets not lead waiter to its own
 * page, lets keep him always on the main screen"* — and the reason it is right
 * is the walk: a waiter crossing the room looks at four tables in a row, and
 * four page loads with four back-taps between them is a worse machine than one
 * sheet he drops and opens again.
 *
 * The sheet carries the evening: what is owed, what was ordered, another round,
 * the money. Everything that is *not* an ordinary evening — moving a tab,
 * handing it over, a storno, žar, showing the guest his bill — still lives on
 * `/konobar/sto/<id>`, one tap further in, because each of those is a decision
 * with a PIN, a reason or a countdown on it.
 */
const sheetFor = ref<{ tableId: string, name: string } | null>(null)
const sheetDetail = ref<TabDetail | null>(null)
const sheetLoading = ref(false)
const sheetError = ref<string | null>(null)

/** The floor's own row for the table the sheet is about. */
const sheetState = computed(() => (sheetFor.value
  ? shownStates.value.find(s => s.table_id === sheetFor.value!.tableId) ?? null
  : null))

/**
 * What the guests owe **on this phone** — the server's figure plus anything the
 * outbox is still holding. Shared with the table's own page through
 * `useTabMoney`, so the two screens can never quote a guest different numbers.
 */
const sheetMoney = useTabMoney({
  tableId: () => sheetFor.value?.tableId ?? null,
  state: () => sheetState.value,
  priceOf: id => priceById.value.get(id) ?? 0,
})

const sheetDraftFen = computed(() => {
  const id = sheetFor.value?.tableId ?? null
  return cart.linesFor(id).reduce(
    (sum, line) => sum + (priceById.value.get(line.product_id) ?? 0) * line.qty, 0)
})

/**
 * `/konobar?sto=<id>` — the sheet, asked for by the URL.
 *
 * Every other way to a table used to be a route to `/konobar/sto/<id>`: the
 * back arrow out of *Dodaj*, the card at the top of it, the draft cards here,
 * and the landing after a round is locked. Making the tap on the plan open a
 * sheet fixed one of five, and a waiter who added a coffee still ended up on a
 * page of his own — which is exactly what the owner asked not to happen.
 *
 * So the sheet has an address. Everything that used to push the page now comes
 * back to the plan with the table named, and the plan opens it. The query is
 * dropped again as soon as the sheet is closed, so the back button does not
 * walk him through a reopening sheet.
 */
watch([() => route.query.sto, shownStates], () => {
  const tableId = typeof route.query.sto === 'string' ? route.query.sto : null
  if (!tableId || sheetFor.value?.tableId === tableId) return

  // `shownStates` folds the outbox in, so a round locked ten seconds ago on a
  // phone with no signal counts as something — which is the whole point of
  // landing here after a lock.
  const state = shownStates.value.find(s => s.table_id === tableId)
  if (state?.tab_id || draftCount(tableId) > 0) {
    openSheet(tableId)
    return
  }

  // Nothing on it. A waiter who opened the menu at an empty table and backed
  // out wants the plan, not a sheet telling him the table is empty — but only
  // once the floor has actually arrived, or the first paint would drop the
  // query before the poll could answer.
  if (states.value.length > 0) void navigateTo({ path: '/konobar', query: {} }, { replace: true })
}, { immediate: true })

function openSheet(tableId: string) {
  sheetFor.value = { tableId, name: draftName(tableId) }
  sheetError.value = null
  sheetDetail.value = null
  void loadSheetDetail()
}

/**
 * The rounds, read when there is something to read them by.
 *
 * It is a watcher and not a line inside `openSheet` because the id can arrive
 * *after* the sheet does, twice over: landing on `/konobar?sto=<id>` opens it
 * before the first poll has answered, and a round locked offline gives the tab
 * a server id only once the outbox has drained. Either way the sheet is
 * already on screen, and this fills it in when the id turns up.
 */
watch(() => (sheetFor.value ? sheetState.value?.tab_id ?? null : null), () => {
  void loadSheetDetail()
})

async function loadSheetDetail() {
  if (!sheetFor.value) return
  const tabId = sheetState.value?.tab_id
  // A tab that lives only in the outbox has no server id to read, and that is
  // not an error: the sheet shows the draft and the queued chip instead.
  if (!tabId || tabId.startsWith('local:')) return
  if (sheetLoading.value) return

  sheetLoading.value = true
  try {
    sheetDetail.value = await api.getTab(tabId)
    sheetError.value = null
  } catch (err) {
    sheetError.value = apiErrorText(err, 'Nema veze — ture se ne mogu učitati')
  } finally {
    sheetLoading.value = false
  }
}

function closeSheet() {
  sheetFor.value = null
  sheetDetail.value = null
  sheetError.value = null
  // `replace`, so closing a sheet is not a step in the history a back gesture
  // has to walk back through.
  if (route.query.sto) void navigateTo({ path: '/konobar', query: {} }, { replace: true })
}

// -- Naplati, from the sheet -------------------------------------------------

const payOpen = ref(false)

/** The venue's own list, from the session context — the same source S2 reads. */
const paymentMethods = computed<PaymentMethod[]>(() =>
  me.settings.value?.payment_methods ?? ['cash'])

/**
 * *Naplati* or *Naplati i očisti* — which of the two the waiter tapped.
 *
 * The money is the same either way; the difference is whether the table comes
 * back afterwards. Held here rather than passed through the pay sheet because
 * the pay sheet is about the note in the guest's hand and has no business
 * knowing what happens to the tile.
 */
const payAndClear = ref(true)
const clearing = ref(false)
const payMode = ref<'main' | 'unpaid'>('main')

// -- Premjesti, Predaj kolegi ------------------------------------------------
// What is left of the three that were behind *Detalji stola*. *Pokaži gostu*
// and *Nije plaćeno* went at the owner's word — see the note in the reply about
// what *Nije plaćeno* was holding up.
const moveOpen = ref(false)
const moveError = ref<string | null>(null)
const moving = ref(false)

/** Only a table with nothing on it can take somebody else's guests. */
const freeTables = computed<VenueTable[]>(() => (boot.value?.tables ?? [])
  .filter(t => t.id !== sheetFor.value?.tableId)
  .filter(t => !shownStates.value.some(s => s.table_id === t.id && s.tab_id)))

const colleagues = computed<User[]>(() => (boot.value?.users ?? [])
  .filter(u => u.id !== me.user.value?.id))

async function moveToTable(targetId: string) {
  const tabId = sheetState.value?.tab_id
  if (!tabId || tabId.startsWith('local:') || moving.value) return
  moving.value = true
  moveError.value = null
  try {
    await api.moveTab(tabId, targetId)
    moveOpen.value = false
    // The draft and the tab id follow the guests to the new table.
    cart.closeTab(sheetFor.value?.tableId ?? null)
    const name = boot.value?.tables.find(t => t.id === targetId)?.name ?? 'sto'
    say(`Premješteno na ${name}`)
    await refreshState()
    // The sheet follows them too, rather than sitting over a table they left.
    openSheet(targetId)
  } catch (err) {
    moveError.value = apiErrorText(err)
  } finally {
    moving.value = false
  }
}

// -- Storno ------------------------------------------------------------------
/**
 * Cancelling a line that has already been locked.
 *
 * It lived on the table page, and when *Detalji stola* went the page stopped
 * being linked from anywhere — which would have left a waiter who rang up the
 * wrong drink with no way to correct it at all. The two sheets it needs open
 * over the plan like everything else now.
 */
const lockedLine = ref<{ line: TabLine, order: TabOrder, label: string } | null>(null)
const stornoFor = ref<{ line: TabLine, order: TabOrder } | null>(null)

function openLine(line: TabLine, round: TabOrder) {
  const index = (sheetDetail.value?.orders ?? []).findIndex(o => o.id === round.id)
  lockedLine.value = { line, order: round, label: `${index + 1}. tura` }
}

function askStorno() {
  const open = lockedLine.value
  lockedLine.value = null
  if (open) stornoFor.value = { line: open.line, order: open.order }
}

async function stornoDone(outcome: AdjustmentOutcome) {
  stornoFor.value = null
  say(outcome.message)
  await refreshState()
  await loadSheetDetail()
}

async function handToColleague(userId: string) {
  const tabId = sheetState.value?.tab_id
  if (!tabId || tabId.startsWith('local:') || moving.value) return
  moving.value = true
  moveError.value = null
  try {
    await api.offerTab(tabId, userId)
    moveOpen.value = false
    say(`Ponuđeno: ${boot.value?.users.find(u => u.id === userId)?.name ?? 'kolegi'}`)
    await refreshState()
  } catch (err) {
    moveError.value = apiErrorText(err)
  } finally {
    moving.value = false
  }
}

const { paying, payError, pay: payTab, markUnpaid: unpaidTab } = useTabPay({
  tableId: () => sheetFor.value?.tableId ?? null,
  tableName: () => sheetFor.value?.name ?? 'Sto',
  tabId: () => {
    const id = sheetState.value?.tab_id ?? null
    return id && !id.startsWith('local:') ? id : null
  },
  remainingFen: () => sheetMoney.remainingFen.value,
  refresh: () => refreshState(),
})

async function onPay(payment: { method: PaymentMethod, amount_fen: number, received_fen?: number }) {
  const done = await payTab(payment)
  if (!done) return
  payOpen.value = false
  say(done.message)
  // A partial payment keeps the sheet open — there is more to take.
  if (done.remainingFen > 0) return

  // Settled. *Naplati i očisti* gives the table back in the same breath;
  // *Naplati* leaves the guests sitting there behind a checkmark, so the sheet
  // stays open on the table they are still at.
  if (payAndClear.value) await clearCurrentTable()
  else await loadSheetDetail()
}

/**
 * *Očisti sto* — the table given back.
 *
 * Unlike a payment this is **not** queued through the outbox: it needs the
 * server's id for the tab, and a phone with no signal has nothing useful to
 * queue against a tab the server has never seen. It fails loudly instead, and
 * the table stays as it was until it is tapped again.
 */
async function clearCurrentTable() {
  const tabId = sheetState.value?.tab_id
  if (!tabId || tabId.startsWith('local:')) {
    closeSheet()
    return
  }
  clearing.value = true
  try {
    await api.clearTab(tabId)
    await refreshState()
    closeSheet()
  } catch (err) {
    sheetError.value = apiErrorText(err, 'Sto se nije očistio — pokušaj ponovo')
    void me.handleAuthError(err)
  } finally {
    clearing.value = false
  }
}

async function onUnpaid(reason: 'walked_out' | 'dispute' | 'other') {
  if (!await unpaidTab(reason)) return
  payOpen.value = false
  say(`Označeno: nije plaćeno · ${sheetFor.value?.name ?? ''}`)
  closeSheet()
}

// -- Navigation -------------------------------------------------------------

/**
 * Tapping a table. An empty one goes **straight to the menu**, because that is
 * the only thing a waiter ever does at an empty table, and the tap it saves is
 * the difference between five taps for two coffees and six. One with guests at
 * it opens the sheet, over the plan.
 */
function openTable(tableId: string) {
  const state = shownStates.value.find(s => s.table_id === tableId)
  const hasSomething = !!state?.tab_id || draftCount(tableId) > 0
  if (hasSomething) openSheet(tableId)
  else navigateTo(`/konobar/dodaj/${tableId}`)
}

/**
 * Which shift of the business day is running — the colour a draft wears before
 * it is locked and has a shift of its own.
 *
 * Read off the tiles rather than fetched: the floor already carries every live
 * tab's `shift_seq`, and the one that is running is the highest of them. With
 * no tables occupied at all there is nothing to colour yet, and the first
 * locked round answers the question for good.
 */
const currentShiftSeq = computed<number | null>(() => {
  const seqs = shownStates.value.map(s => s.shift_seq).filter((n): n is number => n !== null)
  return seqs.length ? Math.max(...seqs) : null
})

const myOpenTabs = computed(() => shift.value?.my_open_tabs ?? 0)

/**
 * The header's second line. It carries the one fact the screen used to bury in
 * a footnote under the plan: how many tables are still on me. Two words,
 * because it shares the bar with the sync chip and the avatar — under the title
 * *Stolovi* "5 otvorenih" needs no more.
 */
const openTabsLine = computed(() => {
  const n = myOpenTabs.value
  if (n === 0) return null
  return `${n} ${n === 1 ? 'otvoren' : 'otvorenih'}`
})

/** The two halves of the room, as the segmented control reads them. */
const ZONES = [
  { value: 'unutra', label: 'Unutra' },
  { value: 'basta', label: 'Bašta' },
] as const

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
      <WaiterHeader title="Stolovi" :sub="openTabsLine">
        <template #right>
          <WaiterSyncChip />

          <button
            type="button"
            class="avatar avatar-accent size-12"
            aria-label="Korisnik"
            @click="menuOpen = true"
          >
            {{ me.user.value?.initials ?? '?' }}
          </button>
        </template>
      </WaiterHeader>

      <WaiterOutboxBanner />

      <!-- `pb-20`, the height of the `.action-bar` below: the bar is sticky and
           its gradient paints over whatever the column ends with, which clipped
           the last line of the hint. The column has to end above the bar, not
           under it. -->
      <div class="flex flex-1 flex-col gap-4 pb-20 pt-4">
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
          class="card flex items-center gap-3 border-accent-line p-4"
        >
          <div class="grow">
            <p class="eyebrow">
              Nudi ti sto
            </p>
            <p class="section-title">
              {{ offer.name }}
            </p>
          </div>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="accepting === offer.state.tab_id"
            @click="acceptOffer(offer.state.tab_id!, offer.name)"
          >
            Prihvati
          </button>
        </div>

        <p v-if="banner" class="note note-good text-center">
          {{ banner }}
        </p>

        <!-- A round tapped and never locked. Nothing anywhere knows about it. -->
        <div
          v-for="draft in staleDrafts"
          :key="draft.client_id"
          class="card flex flex-col gap-3 border-warn p-4"
        >
          <div class="flex items-center gap-2">
            <span class="chip chip-warn">Nacrt čeka</span>
            <span class="grow section-title">{{ draftName(draft.table_id) }}</span>
            <span class="num text-label text-text-2">{{ stavke(draftCount(draft.table_id)) }}</span>
          </div>
          <p class="text-label text-text-2">
            Nije poslano šankeru. Zaključi ga ili odbaci — smjena se ne može
            zatvoriti dok stoji.
          </p>
          <div class="flex gap-2">
            <NuxtLink
              :to="draft.table_id
                ? { path: '/konobar', query: { sto: draft.table_id } }
                : '/konobar/sto/bez-stola'"
              class="btn btn-primary flex-1"
            >
              Zaključi
            </NuxtLink>
            <button
              type="button"
              class="btn btn-secondary flex-1"
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
          class="card flex items-center gap-3 border-warn p-4"
        >
          <div class="grow">
            <p class="section-title">
              Smjena se zatvara
            </p>
            <p class="text-label text-text-2">
              Predaj pazar.
            </p>
          </div>
          <NuxtLink to="/konobar/smjena" class="btn btn-primary shrink-0">
            Završi
          </NuxtLink>
        </div>

        <!-- Bez stola: the guests at the bar, on nobody's table -->
        <div v-if="looseTabs.length > 0 || draftCount(null) > 0" class="flex flex-col gap-2">
          <button
            v-for="row in looseTabs"
            :key="row.tab_id!"
            type="button"
            class="card flex items-center gap-3 p-4 text-left"
            :class="row.assigned_to === me.user.value?.id ? 'border-accent-line' : ''"
            @click="navigateTo('/konobar/sto/bez-stola')"
          >
            <div class="grow">
              <p class="eyebrow">
                Bez stola
                <span v-if="row.assigned_to !== me.user.value?.id">· {{ row.assigned_to_initials }}</span>
              </p>
              <p class="metric num mt-1">
                {{ formatKm(row.remaining_fen) }}
              </p>
            </div>
            <span v-if="row.pending_review" class="chip chip-warn">čeka</span>
          </button>

          <button
            v-if="draftCount(null) > 0 && looseTabs.length === 0"
            type="button"
            class="card flex items-center gap-3 border-dashed border-accent-line p-4 text-left"
            @click="navigateTo('/konobar/sto/bez-stola')"
          >
            <div class="grow">
              <p class="eyebrow">
                Bez stola · nacrt
              </p>
              <p class="section-title num mt-1">
                {{ stavke(draftCount(null)) }}
              </p>
            </div>
          </button>
        </div>

        <UiSeg
          block
          label="Zona"
          :options="ZONES"
          :model-value="zone"
          @update:model-value="zone = $event as Zone"
        />

        <FloorPlan
          v-if="boot"
          :tables="boot.tables"
          :zone="zone"
          :states="shownStates"
          :my-user-id="me.user.value?.id ?? null"
          :draft-tables="draftTables"
          :draft-label="draftLabel"
          :current-shift-seq="currentShiftSeq"
          @select="openTable"
          @long="openZar"
        />
        <p v-else-if="bootPending" class="py-10 text-center text-text-2">
          Učitavanje…
        </p>
        <!-- Honesty (PHASE3 §4): a screen that could not load says so and
             offers the way back, rather than showing *Učitavanje…* for ever. -->
        <div v-else class="empty">
          <p>Nema veze — meni nije učitan.</p>
          <button type="button" class="btn btn-secondary mt-2" @click="refreshBoot()">
            Pokušaj ponovo
          </button>
        </div>

        <!-- A sentence, not two arrows. This is the only place in the app that
             used "→" as vocabulary, and the app speaks Bosnian everywhere else. -->
        <p class="text-center text-caption tracking-normal text-muted">
          Dodirni sto za narudžbu, zadrži za žar.
        </p>
      </div>

      <!--
        The guests standing at the bar get a tab like anybody else.

        It is anchored in the system's `.action-bar` rather than floated over
        the room: a button floating free covered a different table at every
        scroll position, and the plan is the one screen where a covered tile is
        a table nobody serves. The bar is right-aligned because tapping a table
        is what this screen is *for* — this is the second action, not the first.
      -->
      <div class="action-bar justify-end">
        <button
          type="button"
          class="btn btn-primary btn-lg shadow-pop"
          @click="openLoose"
        >
          + Bez stola
        </button>
      </div>
    </div>

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

    <!-- One table, over the plan. The sheet the owner asked for in place of a
         page of its own. -->
    <WaiterTableSheet
      v-if="sheetFor && !payOpen"
      :table-name="sheetFor.name"
      :remaining-fen="sheetMoney.remainingFen.value"
      :total-fen="sheetMoney.totalFen.value"
      :detail="sheetDetail"
      :loading="sheetLoading"
      :error="sheetError"
      :pending-review="sheetState?.pending_review ?? false"
      :late-sync="sheetState?.late_sync ?? false"
      :queued-fen="sheetMoney.queuedOrdersFen.value"
      :pay-queued="sheetMoney.payQueued.value"
      :draft-count="draftCount(sheetFor.tableId)"
      :draft-fen="sheetDraftFen"
      :paid="sheetState?.paid ?? false"
      :clearing="clearing"
      :has-tab="sheetMoney.hasTab.value"
      @close="closeSheet"
      @add="navigateTo(`/konobar/dodaj/${sheetFor.tableId}`)"
      @pay="(andClear) => { payAndClear = andClear; payError = null; payOpen = true }"
      @clear="clearCurrentTable"
      @move="moveError = null; moveOpen = true"
      @line="openLine"
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
      v-if="stornoFor && sheetFor"
      :line="{
        id: stornoFor.line.id,
        name: stornoFor.line.name_snapshot,
        qty: stornoFor.line.qty,
        amount_fen: stornoFor.line.charged_fen,
      }"
      :table-name="sheetFor.name"
      :locked-at="stornoFor.order.at"
      :mine="stornoFor.order.locked_by === me.user.value?.id"
      :tab-paid="sheetDetail?.tab.status === 'paid'"
      :tab-client-id="sheetMoney.tabClientId.value"
      @close="stornoFor = null"
      @done="stornoDone"
    />

    <!--
      The three that used to live behind *Detalji stola*, on a page of their
      own — and all three were sheets when you got there. They open over the
      plan now, which is what the table sheet exists for.
    -->
    <OrderMoveSheet
      v-if="moveOpen && sheetFor"
      :table-name="sheetFor.name"
      :free-tables="freeTables"
      :colleagues="colleagues"
      :offline="syncState === 'offline'"
      :busy="moving"
      :error="moveError"
      @close="moveOpen = false"
      @move="moveToTable"
      @hand="handToColleague"
    />

    <WaiterPaySheet
      v-if="payOpen && sheetFor"
      :table-name="sheetFor.name"
      :remaining-fen="sheetMoney.remainingFen.value"
      :total-fen="sheetMoney.totalFen.value"
      :methods="paymentMethods"
      :initial-mode="payMode"
      :busy="paying"
      :error="payError"
      @close="payOpen = false; payMode = 'main'"
      @pay="onPay"
      @unpaid="onUnpaid"
    />

    <WaiterAvatarSheet v-if="menuOpen" @close="menuOpen = false" />

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
