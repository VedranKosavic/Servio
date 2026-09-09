import { defineStore, skipHydrate } from 'pinia'
import { useLocalStorage } from '@vueuse/core'

/**
 * The round a waiter is tapping together, before it is sent to the bar.
 *
 * One draft per table, so a waiter can start a round on Sto 7, walk to Sto 12,
 * and come back to find his taps still there. Everything lives in localStorage:
 * a phone that locks, reloads or crashes must not lose a round the guest has
 * already ordered out loud.
 *
 * Nothing here knows a price. The tiles show prices from the catalog and the
 * server prices the order when it lands — this store only holds ids and counts.
 */

export interface CartLine {
  /**
   * What makes two taps the same line. For an ordinary product it is the
   * product; for a nargila it is the product *plus* the chosen aromas, so
   * "jabuka" and "jabuka + menta" sit on the ticket as two separate bowls.
   */
  key: string
  product_id: string
  qty: number
  /** Only on shisha lines: 1–3 tobacco stock items. */
  flavour_ids?: string[]
}

export interface CartDraft {
  /**
   * Minted once, when the draft is born, and re-sent unchanged on every retry.
   *
   * This is the whole trick behind sending an order over café Wi-Fi: if the
   * request landed but the answer got lost, the retry carries the same id and
   * the server recognises the replay instead of charging the guest twice.
   */
  client_id: string
  lines: CartLine[]
}

/** table id → the round being built for it. */
type Drafts = Record<string, CartDraft>

/** Two taps on the same nargila mix must land on the same line, in any order. */
function lineKey(productId: string, flavourIds?: string[]): string {
  if (!flavourIds || flavourIds.length === 0) return productId
  return `${productId}|${[...flavourIds].sort().join(',')}`
}

export const useCartStore = defineStore('cart', () => {
  const drafts = useLocalStorage<Drafts>('sank:cart', {} as Drafts, { mergeDefaults: true })

  function draftFor(tableId: string): CartDraft | null {
    return drafts.value[tableId] ?? null
  }

  function linesFor(tableId: string): CartLine[] {
    return drafts.value[tableId]?.lines ?? []
  }

  /** The uuid to send with this table's round; null when there is nothing to send. */
  function clientIdFor(tableId: string): string | null {
    return drafts.value[tableId]?.client_id ?? null
  }

  /** How many single items are in the round — "3 stavke" on the send button. */
  function countFor(tableId: string): number {
    return linesFor(tableId).reduce((n, line) => n + line.qty, 0)
  }

  /** How many of this product (all aroma mixes together) — the badge on a tile. */
  function qtyOfProduct(tableId: string, productId: string): number {
    return linesFor(tableId)
      .filter(line => line.product_id === productId)
      .reduce((n, line) => n + line.qty, 0)
  }

  function add(tableId: string, productId: string, flavourIds?: string[]): void {
    const draft = drafts.value[tableId] ?? { client_id: crypto.randomUUID(), lines: [] }
    const key = lineKey(productId, flavourIds)
    const existing = draft.lines.find(line => line.key === key)
    if (existing) {
      existing.qty += 1
    } else {
      draft.lines.push({
        key,
        product_id: productId,
        qty: 1,
        ...(flavourIds && flavourIds.length > 0 ? { flavour_ids: [...flavourIds] } : {}),
      })
    }
    drafts.value = { ...drafts.value, [tableId]: draft }
  }

  /**
   * One tap of the "−" on a tile. A nargila can be on the draft as several
   * mixes; the most recently added one is the one that comes off, which is the
   * one the waiter just tapped by mistake.
   */
  function removeOne(tableId: string, productId: string): void {
    const draft = drafts.value[tableId]
    if (!draft) return

    for (let i = draft.lines.length - 1; i >= 0; i--) {
      const line = draft.lines[i]!
      if (line.product_id !== productId) continue
      if (line.qty > 1) line.qty -= 1
      else draft.lines.splice(i, 1)
      break
    }

    if (draft.lines.length === 0) clear(tableId)
    else drafts.value = { ...drafts.value, [tableId]: draft }
  }

  /**
   * The round has been sent (or thrown away). The draft goes, and with it its
   * `client_id` — the next round on this table is a new one and gets a new id.
   */
  function clear(tableId: string): void {
    const next = { ...drafts.value }
    delete next[tableId]
    drafts.value = next
  }

  return {
    /**
     * `skipHydrate` — without it a reload wipes the round.
     *
     * Nuxt renders the page on the server first, where there is no
     * localStorage, so the server's copy of this store is empty. On the phone
     * Pinia then "hydrates": it copies the server's state over the store it
     * just built. That copy would land in a localStorage-backed ref, which
     * dutifully writes the empty value to disk — and the draft the waiter
     * tapped a minute ago is gone. `skipHydrate` tells Pinia this one ref
     * already knows its own value and must be left alone.
     */
    drafts: skipHydrate(drafts),
    draftFor,
    linesFor,
    clientIdFor,
    countFor,
    qtyOfProduct,
    add,
    removeOne,
    clear,
  }
})
