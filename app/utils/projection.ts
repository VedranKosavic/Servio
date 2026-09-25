/**
 * The room **as this phone knows it** — the last thing the server said, with
 * this phone's unsent actions laid on top (docs/OFFLINE.md §3 rule 1, §5.2).
 *
 * **What a projection is, in Vue words.** A `computed` whose inputs are two
 * lists: the floor the server last described (`tables_state`, which may be an
 * hour old when the café has no internet) and the outbox, in the order the
 * waiter did things. It never edits either list; it walks the queue from the
 * oldest entry to the newest and works out what each table looks like *now*.
 * The same walk runs again whenever either list changes, so there is nothing to
 * keep in sync by hand — and when the queue finally reaches the server, the
 * next poll describes the same room and the walk has nothing left to add.
 *
 * **Why one function and not three.** Until this file the floor folded queued
 * rounds into the tiles, the bar folded them into its card, and the sheet's
 * `useTabMoney` added them **again** on top of a row that already had them — so
 * a table with one queued 3,00 KM Cola asked the guest for 6,00 KM, the payment
 * went out for 6,00, and the server refused it on sync (`422 OVERPAY`). Now the
 * tile, the card and the sheet all read one answer and cannot disagree.
 *
 * What each kind of entry does, per table, in queue order:
 *
 *   `order`   adds its lines to the table's current tab — or opens a new one,
 *             when the table is free or its tab is already paid (the server
 *             clears a paid tab the moment the next round lands on its table);
 *   `pay`     takes its amount off; at zero the tab is *paid* — the checkmark;
 *   `unpaid`  the guests are gone — *Rashod*, *Policija* and the rest — and
 *             the table is free;
 *   `clear`   *Očisti sto*: the table is free. A tab that still owed money
 *             becomes a stranded card, exactly as the server will make it.
 *
 * Nothing here is sent anywhere. Prices come from the menu on the phone and
 * are for reading only; the server prices every round itself when it lands.
 */
import type { TabDetail, TabLine, TableState, TabOrder } from '#shared/types'
import type { OutboxEntry } from '../stores/outbox'

/** The person holding the phone — whose a tab opened on this phone is. */
export interface ProjectionMe {
  id: string
  name: string
  initials: string
}

export interface ProjectionInput {
  /**
   * `tables_state.tables`: **one row per table**, as the server last said. A
   * free table's row has `tab_id: null` — it is a table with no tab, not a tab.
   */
  tables: TableState[]
  /** `tables_state.loose_tabs`: the parties at the bar. */
  loose: TableState[]
  /** `tables_state.stranded_tabs`: off the table, still owing. */
  stranded: TableState[]
  /** The outbox, oldest first — failed entries included, they are still owed. */
  entries: readonly OutboxEntry[]
  priceOf: (productId: string) => number
  me: ProjectionMe | null
}

/** One tab as the phone knows it: the row to draw, and what the queue holds for it. */
export interface ProjectedTab {
  row: TableState
  /** The server has this tab. False while it exists only in this phone's queue. */
  onServer: boolean
  /** This tab's rounds still waiting in the queue, oldest first. */
  queuedOrders: OutboxEntry[]
  queuedOrdersFen: number
  queuedPayFen: number
}

export interface ProjectedRoom {
  /** What the plan draws: every table with a live tab, queue included. */
  tables: TableState[]
  /** The parties at the bar, each one a card. */
  loose: TableState[]
  /** Tabs off the table that still owe money — the server's, and the ones this phone just cleared. */
  stranded: TableState[]
  /** The table's current tab, for its sheet. */
  tabOfTable: (tableId: string) => ProjectedTab | null
  /** A bar party's tab, by the `tab_id` its card carries (`local:…` while it is only queued). */
  tabOfLoose: (tabId: string) => ProjectedTab | null
}

interface OrderPayload {
  table_id?: string | null
  tab_client_id?: string
  client_created_at?: string
  lines?: {
    id: string
    product_id: string
    qty: number
    flavour_ids?: string[]
    note?: string
    comp_reason?: string
  }[]
}

interface TabRefPayload {
  tab_id?: string
  tab_client_id?: string
}

/** A tab being walked: the row plus what the walk has added to it. */
type Working = ProjectedTab

/** What a queued round comes to, priced from the menu on this phone. */
export function orderFen(entry: OutboxEntry, priceOf: (productId: string) => number): number {
  const payload = entry.payload as OrderPayload
  return (payload.lines ?? []).reduce((sum, line) => sum + priceOf(line.product_id) * line.qty, 0)
}

/**
 * Which table an entry is about: `undefined` when it is about no table this
 * walk can place (a storno, a waste line), `null` for the bar.
 *
 * Entries queued before `table_id` rode on every entry (25.09.2026) carry it
 * only inside a round's payload; a payment or a mark from then is placed by its
 * tab's client id instead, through the map the walk builds as it goes.
 */
function tableOf(entry: OutboxEntry, tabTable: Map<string, string | null>): string | null | undefined {
  if (entry.table_id !== undefined) return entry.table_id
  const payload = entry.payload as OrderPayload
  if (entry.kind === 'order' && payload && 'table_id' in payload) return payload.table_id ?? null
  if (entry.tab_client_id && tabTable.has(entry.tab_client_id)) return tabTable.get(entry.tab_client_id)
  return undefined
}

/** Is there a tab on this row at all? A free table's row is only a table. */
function hasTab(tab: Working | null): tab is Working {
  return tab !== null && !!tab.row.tab_id
}

function fromRow(row: TableState): Working {
  return {
    row: { ...row },
    onServer: !!row.tab_id && !row.tab_id.startsWith('local:'),
    queuedOrders: [],
    queuedOrdersFen: 0,
    queuedPayFen: 0,
  }
}

/** A tab that exists only on this phone: its first round is still in the queue. */
function localTab(
  tableId: string | null, tabClientId: string | null, at: string, me: ProjectionMe | null,
): Working {
  return {
    row: {
      table_id: tableId,
      // No server id yet. `local:` is the one prefix every screen checks before
      // it asks the server about a tab.
      tab_id: `local:${tableId ?? tabClientId ?? 'bez-stola'}`,
      tab_client_id: tabClientId,
      total_fen: 0,
      remaining_fen: 0,
      assigned_to: me?.id ?? null,
      assigned_to_initials: me?.initials ?? null,
      opened_by_name: me?.name ?? null,
      opened_at: at,
      last_order_at: at,
      pending_review: false,
      paid: false,
      // Null takes the colour of the shift that is running (`FloorPlan`).
      shift_seq: null,
      late_sync: false,
      offered_to: null,
    },
    onServer: false,
    queuedOrders: [],
    queuedOrdersFen: 0,
    queuedPayFen: 0,
  }
}

function addOrder(tab: Working, entry: OutboxEntry, fen: number): void {
  tab.row.total_fen += fen
  tab.row.remaining_fen += fen
  tab.row.paid = false
  tab.row.last_order_at = (entry.payload as OrderPayload).client_created_at ?? entry.client_created_at
  tab.queuedOrders.push(entry)
  tab.queuedOrdersFen += fen
}

function addPayment(tab: Working, amountFen: number): void {
  tab.queuedPayFen += amountFen
  tab.row.remaining_fen = Math.max(0, tab.row.remaining_fen - amountFen)
  if (tab.row.remaining_fen === 0) tab.row.paid = true
}

/** Does this entry name this tab — by the phone's id, or by the server's? */
function names(entry: OutboxEntry, tab: Working): boolean {
  const payload = entry.payload as TabRefPayload
  if (entry.tab_client_id && entry.tab_client_id === tab.row.tab_client_id) return true
  return !!payload?.tab_id && payload.tab_id === tab.row.tab_id
}

export function projectRoom(input: ProjectionInput): ProjectedRoom {
  const { entries, priceOf, me } = input

  // Where each tab client id lives, so an old entry with no `table_id` of its
  // own can still be placed: the server's rows first, then the queued rounds.
  const tabTable = new Map<string, string | null>()
  for (const row of input.tables) if (row.tab_client_id) tabTable.set(row.tab_client_id, row.table_id)
  for (const row of input.loose) if (row.tab_client_id) tabTable.set(row.tab_client_id, null)
  for (const entry of entries) {
    if (entry.kind !== 'order') continue
    const payload = entry.payload as OrderPayload
    const tabId = entry.tab_client_id ?? payload.tab_client_id
    if (tabId) tabTable.set(tabId, entry.table_id !== undefined ? entry.table_id : (payload.table_id ?? null))
  }

  // -- tables ---------------------------------------------------------------

  const current = new Map<string, Working | null>()
  for (const row of input.tables) if (row.table_id) current.set(row.table_id, fromRow(row))

  const stranded: Working[] = input.stranded.map(fromRow)

  // -- the bar: one tab per party, keyed by the tab's client id --------------

  const bar = new Map<string, Working | null>()
  const barOrder: string[] = []
  for (const row of input.loose) {
    const key = row.tab_client_id ?? row.tab_id ?? ''
    bar.set(key, fromRow(row))
    barOrder.push(key)
  }

  for (const entry of entries) {
    // A storno or a waste line moves no table. (A struck line still shows on
    // the sheet as the server last listed it; the next answer strikes it.)
    if (entry.kind === 'adjust' || entry.kind === 'waste') continue
    const table = tableOf(entry, tabTable)

    // A stranded tab is settled from its own card; a payment or a mark that
    // names it is not about any table any more.
    const strandedTab = stranded.find(tab => tab.row.tab_id && names(entry, tab))
    if (strandedTab && (entry.kind === 'pay' || entry.kind === 'unpaid' || entry.kind === 'clear')) {
      if (entry.kind === 'pay') addPayment(strandedTab, entry.amount_fen ?? 0)
      // Settled in full, or marked: the card goes. One splice, at an index the
      // `find` above has just proved is there.
      if (entry.kind !== 'pay' || strandedTab.row.paid) stranded.splice(stranded.indexOf(strandedTab), 1)
      continue
    }

    if (table === undefined) continue

    if (table === null) {
      // The bar. A party is its tab client id; a round with none is this
      // phone's own party, which is how the old outbox queued them.
      const key = entry.tab_client_id ?? (entry.payload as OrderPayload)?.tab_client_id ?? 'bez-stola'
      let tab = bar.get(key) ?? null
      if (!bar.has(key)) barOrder.push(key)
      switch (entry.kind) {
        case 'order': {
          if (!tab) tab = localTab(null, key === 'bez-stola' ? null : key, entry.client_created_at, me)
          addOrder(tab, entry, orderFen(entry, priceOf))
          break
        }
        case 'pay':
          if (tab) {
            addPayment(tab, entry.amount_fen ?? 0)
            // A paid bar tab clears itself on the server (`payments.ts`): the
            // bar has no tile to hold, so it leaves the list.
            if (tab.row.paid) tab = null
          }
          break
        case 'unpaid':
        case 'clear':
          tab = null
          break
      }
      bar.set(key, tab)
      continue
    }

    let tab = current.get(table) ?? null
    // A payment, a mark or a clear acts on the tab it names and on no other.
    // The table it rode in with may hold a different party by now — a
    // stranded card paid from its sheet still carries the table it was once on.
    if (entry.kind !== 'order' && (!tab || !names(entry, tab))) continue
    switch (entry.kind) {
      case 'order': {
        // A free table, or one whose guests have paid: this round opens a new
        // tab. The server does the same — it clears the paid tab at the
        // round's own time and opens a fresh one (`orders.ts`).
        if (!hasTab(tab) || tab.row.paid) {
          const tabId = entry.tab_client_id ?? (entry.payload as OrderPayload).tab_client_id ?? null
          tab = localTab(table, tabId, entry.client_created_at, me)
        }
        addOrder(tab, entry, orderFen(entry, priceOf))
        break
      }
      case 'pay':
        if (tab) addPayment(tab, entry.amount_fen ?? 0)
        break
      case 'unpaid':
        tab = null
        break
      case 'clear':
        // Given back while still owing: off the plan, onto a card of its own.
        if (tab && !tab.row.paid && tab.row.remaining_fen > 0) stranded.push(tab)
        tab = null
        break
    }
    current.set(table, tab)
  }

  const tables = [...current.values()].filter((tab): tab is Working => tab !== null)
  const loose = barOrder
    .filter((key, index) => barOrder.indexOf(key) === index)
    .map(key => bar.get(key) ?? null)
    .filter((tab): tab is Working => tab !== null)

  return {
    tables: tables.map(tab => tab.row),
    loose: loose.map(tab => tab.row),
    stranded: stranded.map(tab => tab.row),
    tabOfTable: (tableId) => {
      const tab = current.get(tableId) ?? null
      return hasTab(tab) ? tab : null
    },
    tabOfLoose: tabId => loose.find(tab => tab.row.tab_id === tabId)
      ?? stranded.find(tab => tab.row.tab_id === tabId) ?? null,
  }
}

// ---------------------------------------------------------------------------
// The rounds on one tab, for its sheet
// ---------------------------------------------------------------------------

export interface RoundNames {
  productName: (productId: string) => string
  flavourName: (stockItemId: string) => string
}

/**
 * The rounds a sheet lists: what the server last said is on the tab, then the
 * rounds still in the queue — each drawn exactly as the server will draw it,
 * so the list does not jump when the queue empties.
 *
 * `detail` is the server's copy — fresh, or the one stored the last time the
 * phone had a signal. It is used only while the tab being walked is that same
 * tab: after a queued *Očisti sto* the table holds a new party, and the last
 * party's rounds are not theirs.
 */
export function projectRounds(
  detail: TabDetail | null,
  tab: ProjectedTab | null,
  names: RoundNames,
  priceOf: (productId: string) => number,
  me: ProjectionMe | null,
): { orders: TabOrder[], queuedIds: Set<string> } {
  const serverRounds = detail && tab?.onServer && detail.tab.id === tab.row.tab_id
    ? detail.orders
    : []

  const queued: TabOrder[] = (tab?.queuedOrders ?? []).map((entry) => {
    const payload = entry.payload as OrderPayload
    const lines: TabLine[] = (payload.lines ?? []).map((line) => {
      const unit = priceOf(line.product_id)
      return {
        id: line.id,
        name_snapshot: names.productName(line.product_id),
        note: line.note ?? null,
        flavour_names: (line.flavour_ids ?? []).map(names.flavourName),
        qty: line.qty,
        unit_price_fen: unit,
        charged_fen: unit * line.qty,
        comp_reason: line.comp_reason ?? null,
        status: 'ok',
        adjustment_id: null,
      }
    })
    return {
      id: entry.client_id,
      client_id: entry.client_id,
      shift_seq: null,
      locked_by: me?.id ?? '',
      locked_by_name: me?.name ?? '',
      at: payload.client_created_at ?? entry.client_created_at,
      late_sync: false,
      lines,
    }
  })

  return {
    orders: [...serverRounds, ...queued],
    queuedIds: new Set(queued.map(round => round.id)),
  }
}
