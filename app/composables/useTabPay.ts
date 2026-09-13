import { formatKm } from '#shared/money'
import type { PaymentMethod } from '#shared/types'

/**
 * Taking the money for one tab — the one implementation, used from two screens.
 *
 * The table's own page has always had this, and the floor plan's review sheet
 * now needs it too: the owner asked that looking at a table and settling it
 * should not send the waiter to a page of his own. Two copies of the code that
 * turns a guest's cash into a queued payment is not a thing this app should
 * have — a drift between them is a tab that is settled on one screen and still
 * open on the other — so it lives here and both screens call it.
 *
 * **Nothing here talks to the server.** `enqueue()` writes to IndexedDB and
 * returns; the outbox delivers it, in order, exactly once, whenever there is a
 * network. The change and the remainder are arithmetic the phone does itself —
 * the server's answer would be identical, and waiting for a round trip to hand
 * a guest his change is exactly what the outbox exists to stop.
 *
 * The caller keeps what it does afterwards: a toast, a navigation, closing a
 * sheet. Those differ between a full page and a sheet on the floor plan, and
 * pushing them in here would only mean a third argument for each.
 */
export interface TabPayContext {
  /** Null is *Bez stola*: a tab on no table. */
  tableId: () => string | null
  tableName: () => string
  /** The server's id once it has one; null while the tab lives only in the outbox. */
  tabId: () => string | null
  /** What is still owed, the phone's own figure including anything queued. */
  remainingFen: () => number
  /** Re-read the floor after the queue has taken the payment. */
  refresh: () => Promise<void> | void
}

export interface PaidOutcome {
  /** What is left on the tab after this payment. Zero settles it. */
  remainingFen: number
  /** What to hand back, when the guest gave more than he owed. */
  changeFen: number
  /** The line a toast would say — both screens say the same thing. */
  message: string
}

export function useTabPay(ctx: TabPayContext) {
  const cart = useCartStore()
  const me = useMe()
  const { enqueue } = useOutbox()

  const paying = ref(false)
  const payError = ref<string | null>(null)

  /**
   * Queue a payment. Resolves with what happened, or `null` when it could not
   * be queued at all — which barely happens, because only storage can refuse.
   */
  async function pay(payment: {
    method: PaymentMethod
    amount_fen: number
    received_fen?: number
  }): Promise<PaidOutcome | null> {
    if (paying.value) return null
    const tabId = ctx.tabId()
    const clientTabId = cart.ensureTabClientId(ctx.tableId())

    paying.value = true
    payError.value = null
    try {
      const changeFen = Math.max(
        0, (payment.received_fen ?? payment.amount_fen) - payment.amount_fen,
      )
      const remainingFen = Math.max(0, ctx.remainingFen() - payment.amount_fen)

      const clientId = crypto.randomUUID()
      await enqueue({
        kind: 'pay',
        client_id: clientId,
        tab_client_id: clientTabId,
        label: ctx.tableName(),
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
      await ctx.refresh()

      if (remainingFen > 0) {
        return {
          remainingFen,
          changeFen,
          message: `Naplaćeno · ostaje ${formatKm(remainingFen)}`,
        }
      }

      // Settled: the tab's client id is forgotten, because the next guests at
      // this table are a new tab and must not inherit this one's.
      cart.closeTab(ctx.tableId())
      return {
        remainingFen: 0,
        changeFen,
        message: changeFen > 0
          ? `Naplaćeno · vrati ${formatKm(changeFen)}`
          : `Naplaćeno · ${ctx.tableName()}`,
      }
    } catch (err) {
      payError.value = apiErrorText(err)
      void me.handleAuthError(err)
      return null
    } finally {
      paying.value = false
    }
  }

  /**
   * *Nije plaćeno* — the guests left without settling.
   *
   * It is queued exactly like a payment and is **not** a payment: the tab stays
   * owed, the owner decides on it from his own screen, and the reason the
   * waiter picked rides with it. The tab's client id is forgotten all the same
   * — the table is free, and whatever happens to the money happens off it.
   */
  async function markUnpaid(reason: 'walked_out' | 'dispute' | 'other'): Promise<boolean> {
    if (paying.value) return false
    const clientTabId = cart.ensureTabClientId(ctx.tableId())

    paying.value = true
    payError.value = null
    try {
      const clientId = crypto.randomUUID()
      await enqueue({
        kind: 'unpaid',
        client_id: clientId,
        // Keyed by the tab's own client id, not by a server id: a guest can
        // walk out while the phone is offline, on a tab the server has never
        // seen.
        tab_client_id: clientTabId,
        label: ctx.tableName(),
        payload: {
          client_id: clientId,
          tab_client_id: clientTabId,
          reason,
          client_created_at: new Date().toISOString(),
        },
      })
      await ctx.refresh()
      cart.closeTab(ctx.tableId())
      return true
    } catch (err) {
      payError.value = apiErrorText(err)
      void me.handleAuthError(err)
      return false
    } finally {
      paying.value = false
    }
  }

  return { paying, payError, pay, markUnpaid }
}

/**
 * What a tab comes to **on this phone** — the server's figure plus whatever is
 * still sitting in the outbox.
 *
 * A waiter who locks a round with no signal and then settles the table must be
 * shown the money including that round: the server has not seen it, and taking
 * what the server thinks is owed would be short by exactly the drinks he just
 * rang up. So every screen that offers *Naplati* reads the total through here,
 * and the two that do — the table's page and the floor plan's review sheet —
 * cannot disagree about what the guest owes.
 *
 * `priceOf` is passed in because the catalogue lives on the page: a queued
 * round carries product ids and quantities, never prices (the server prices a
 * round when it lands), so the phone reads its own menu to show a number.
 */
export interface TabMoneyContext {
  tableId: () => string | null
  /** The floor's row for this table, or null when it has none yet. */
  state: () => { tab_id?: string | null, tab_client_id?: string | null, total_fen?: number, remaining_fen?: number } | null
  priceOf: (productId: string) => number
}

export function useTabMoney(ctx: TabMoneyContext) {
  const cart = useCartStore()
  const { outbox } = useOutbox()

  const tabClientId = computed(() =>
    ctx.state()?.tab_client_id ?? cart.tabClientIdFor(ctx.tableId()))

  const queued = computed(() => outbox.pendingForTab(tabClientId.value))
  const payQueued = computed(() => queued.value.some(e => e.kind === 'pay'))

  const queuedOrdersFen = computed(() => queued.value
    .filter(e => e.kind === 'order')
    .reduce((sum, entry) => {
      const payload = entry.payload as {
        lines?: { product_id: string, qty: number }[]
      }
      return sum + (payload.lines ?? [])
        .reduce((n, line) => n + ctx.priceOf(line.product_id) * line.qty, 0)
    }, 0))

  const queuedPaidFen = computed(() => queued.value
    .filter(e => e.kind === 'pay')
    .reduce((sum, entry) => sum + (entry.amount_fen ?? 0), 0))

  const totalFen = computed(() => (ctx.state()?.total_fen ?? 0) + queuedOrdersFen.value)

  const remainingFen = computed(() => Math.max(
    0,
    (ctx.state()?.remaining_fen ?? 0) + queuedOrdersFen.value - queuedPaidFen.value,
  ))

  /** There is something here to pay for, even if the server has not heard of it. */
  const hasTab = computed(() => !!ctx.state()?.tab_id || queued.value.length > 0)

  return {
    tabClientId, queued, payQueued, queuedOrdersFen, queuedPaidFen,
    totalFen, remainingFen, hasTab,
  }
}
