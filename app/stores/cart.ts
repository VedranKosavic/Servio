/**
 * The round a waiter is tapping together, before it is sent to the bar.
 *
 * One draft per table *per person*, so a waiter can start a round on Sto 7,
 * walk to Sto 12, and come back to find his taps still there — and so a shared
 * bar tablet that re-locks does not hand Amar's half-tapped round to Lejla. The
 * key is `draft:{user_id}:{table_id}`.
 *
 * Nothing here knows a price. The tiles show prices from the catalogue and the
 * server prices the order when it lands — this store only holds ids and counts.
 *
 * **Why IndexedDB and not localStorage** (this moved in Phase 3). IndexedDB is
 * the browser's real database; `idb-keyval` is a thin promise wrapper over it.
 * Two reasons the swap was worth it: it survives the memory-pressure reload iOS
 * performs when a phone comes back from the camera, and it is not capped at
 * 5 MB. Reading it is asynchronous, which is why this store hydrates once on
 * boot instead of being backed by a synchronous `useLocalStorage`.
 *
 * Two ids are minted here rather than at send time, and both exist for the same
 * reason — a queued request has to be able to name something the server has
 * never seen:
 *
 *   - **`tab_client_id`**, on the first open of a table with no known open tab.
 *     A payment or a *nije plaćeno* queued offline names the tab by this id.
 *   - **a line's `id`**, the moment the tile is tapped. A queued
 *     `POST /api/adjustments` striking a mistaken line names the line by this.
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval'

export interface CartLine {
  /**
   * Minted when the tile is tapped. This is the `order_lines.id` the server
   * will write, so a storno queued offline can name the line by it.
   */
  id: string
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
  /** A note from the chips or the free-text sheet (WP3 writes it). */
  note?: string
  /**
   * *Na račun kuće*, decided before the round was locked (F7). The server
   * re-decides it: only `staff_drink` under the cap and an admin's `owner_guest`
   * lock at zero, and anything else locks at full price and waits for somebody
   * to approve it. The phone only carries the reason.
   */
  comp_reason?: string
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
  /**
   * The phone's own name for the *tab* this round opens. It goes out with the
   * order, and the server adopts it — which is how a payment queued behind the
   * order can name a tab that does not exist yet.
   */
  tab_client_id: string
  /** NULL is *Bez stola*: the guests at the bar, on nobody's table. */
  table_id: string | null
  user_id: string
  lines: CartLine[]
  created_at: string
}

/** `draft:{user_id}:{table_id}` → the round being built for it. */
type Drafts = Record<string, CartDraft>

/** The same keys → the phone's name for that table's *tab*. See `TABS_KEY`. */
type TabIds = Record<string, string>

const STORAGE_KEY = 'sank:drafts'

/**
 * Why the tab ids live in a map of their own, and not only inside the draft.
 *
 * A draft dies the moment its round is locked. The *tab* does not: the waiter
 * locks a round on Sto 7 with no signal, and two minutes later takes cash for
 * it — and that payment has to name a tab the server still has not seen. So the
 * id minted with the first draft on a table outlives every draft on it, and is
 * forgotten only when the table is settled (`closeTab`) or when the server
 * comes back with a tab id of its own.
 */
const TABS_KEY = 'sank:tab-ids'

/** A draft this old pulses on the floor plan: "Sto 7: nacrt čeka" (F2 step 5). */
export const STALE_DRAFT_MS = 15 * 60_000

/** Two taps on the same nargila mix must land on the same line, in any order. */
function lineKey(productId: string, flavourIds?: string[]): string {
  if (!flavourIds || flavourIds.length === 0) return productId
  return `${productId}|${[...flavourIds].sort().join(',')}`
}

function canPersist(): boolean {
  return typeof indexedDB !== 'undefined'
}

/**
 * A plain, cloneable copy. IndexedDB stores a *structured clone*, and that
 * algorithm refuses a Proxy — which is what every object inside a Vue `ref` is.
 * See the longer note on the same helper in `app/stores/outbox.ts`.
 */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export const useCartStore = defineStore('cart', () => {
  const drafts = ref<Drafts>({})
  const tabIds = ref<TabIds>({})
  const hydrated = ref(false)
  /**
   * Whose drafts these are. Set by `useOutbox()` from the session envelope, and
   * never guessed: a draft key that fell back to "somebody" would be exactly
   * the shared-tablet bug this store was re-keyed to prevent.
   */
  const userId = ref<string | null>(null)

  function keyFor(tableId: string | null): string {
    return `draft:${userId.value ?? 'anon'}:${tableId ?? 'bez-stola'}`
  }

  async function persist(): Promise<void> {
    if (!canPersist()) return
    try {
      if (Object.keys(drafts.value).length === 0) await idbDel(STORAGE_KEY)
      else await idbSet(STORAGE_KEY, plain(drafts.value))

      if (Object.keys(tabIds.value).length === 0) await idbDel(TABS_KEY)
      else await idbSet(TABS_KEY, plain(tabIds.value))
    } catch {
      // Private mode, or storage disabled. The round survives this session.
    }
  }

  async function hydrate(): Promise<void> {
    if (hydrated.value) return
    hydrated.value = true
    if (!canPersist()) return
    try {
      const stored = await idbGet<Drafts>(STORAGE_KEY)
      if (stored && typeof stored === 'object') drafts.value = { ...stored, ...drafts.value }
      const storedTabs = await idbGet<TabIds>(TABS_KEY)
      if (storedTabs && typeof storedTabs === 'object') tabIds.value = { ...storedTabs, ...tabIds.value }
    } catch {
      // Unreadable storage is no draft, not a broken app.
    }
  }

  /** Who is holding the phone now. Other people's drafts simply stop matching. */
  function bind(id: string | null): void {
    userId.value = id
  }

  // -- reading ---------------------------------------------------------------

  function draftFor(tableId: string | null): CartDraft | null {
    return drafts.value[keyFor(tableId)] ?? null
  }

  function linesFor(tableId: string | null): CartLine[] {
    return draftFor(tableId)?.lines ?? []
  }

  /** The uuid to send with this table's round; null when there is nothing to send. */
  function clientIdFor(tableId: string | null): string | null {
    return draftFor(tableId)?.client_id ?? null
  }

  /** The tab id a payment or a *nije plaćeno* should name, if this phone minted one. */
  function tabClientIdFor(tableId: string | null): string | null {
    return tabIds.value[keyFor(tableId)] ?? null
  }

  /** The same, minting one if the table has never been opened on this phone. */
  function ensureTabClientId(tableId: string | null): string {
    const key = keyFor(tableId)
    const existing = tabIds.value[key]
    if (existing) return existing
    const fresh = crypto.randomUUID()
    tabIds.value = { ...tabIds.value, [key]: fresh }
    void persist()
    return fresh
  }

  /**
   * The table is settled — paid, or marked *nije plaćeno*. Forget its tab id,
   * so the next guests at that table open a tab of their own rather than
   * queueing money onto the last party's.
   */
  function closeTab(tableId: string | null): void {
    const key = keyFor(tableId)
    if (!(key in tabIds.value)) return
    const next = { ...tabIds.value }
    delete next[key]
    tabIds.value = next
    void persist()
  }

  /** How many single items are in the round — "3 stavke" on the send button. */
  function countFor(tableId: string | null): number {
    return linesFor(tableId).reduce((n, line) => n + line.qty, 0)
  }

  /** How many of this product (all aroma mixes together) — the badge on a tile. */
  function qtyOfProduct(tableId: string | null, productId: string): number {
    return linesFor(tableId)
      .filter(line => line.product_id === productId)
      .reduce((n, line) => n + line.qty, 0)
  }

  /** Mine, and older than fifteen minutes. The floor plan pulses these. */
  const staleDrafts = computed<CartDraft[]>(() => {
    const cutoff = Date.now() - STALE_DRAFT_MS
    return Object.values(drafts.value)
      .filter(d => d.user_id === userId.value && d.lines.length > 0)
      .filter(d => Date.parse(d.created_at) < cutoff)
  })

  /** Any draft of mine at all — what blocks *Završi smjenu* before it asks. */
  const myDrafts = computed<CartDraft[]>(() => (
    Object.values(drafts.value).filter(d => d.user_id === userId.value && d.lines.length > 0)
  ))

  // -- writing ---------------------------------------------------------------

  /**
   * The draft for this table, created if it is not there yet. This is where the
   * two client ids are born, and both are born *before* anything is sent.
   */
  function ensureDraft(tableId: string | null): CartDraft {
    const key = keyFor(tableId)
    const existing = drafts.value[key]
    if (existing) return existing
    const fresh: CartDraft = {
      client_id: crypto.randomUUID(),
      tab_client_id: ensureTabClientId(tableId),
      table_id: tableId,
      user_id: userId.value ?? 'anon',
      lines: [],
      created_at: new Date().toISOString(),
    }
    drafts.value = { ...drafts.value, [key]: fresh }
    return fresh
  }

  function add(
    tableId: string | null, productId: string, flavourIds?: string[], note?: string,
    compReason?: string,
  ): void {
    const draft = ensureDraft(tableId)
    const key = lineKey(productId, flavourIds)
    // A comped kafa and a paid kafa are two lines, the same way a noted one is:
    // merging them would charge for a drink the house said it was giving away.
    const existing = draft.lines.find(line => (
      line.key === key && line.note === note && line.comp_reason === compReason
    ))
    if (existing) {
      existing.qty += 1
    } else {
      draft.lines.push({
        // Minted on the tap, not on the send — a queued storno has to be able
        // to name this line before the server has ever heard of it.
        id: crypto.randomUUID(),
        key,
        product_id: productId,
        qty: 1,
        ...(flavourIds && flavourIds.length > 0 ? { flavour_ids: [...flavourIds] } : {}),
        ...(note ? { note } : {}),
        ...(compReason ? { comp_reason: compReason } : {}),
      })
    }
    drafts.value = { ...drafts.value, [keyFor(tableId)]: draft }
    void persist()
  }

  /**
   * One tap of the "−" on a tile. A nargila can be on the draft as several
   * mixes; the most recently added one is the one that comes off, which is the
   * one the waiter just tapped by mistake.
   */
  function removeOne(tableId: string | null, productId: string): void {
    const draft = draftFor(tableId)
    if (!draft) return

    for (let i = draft.lines.length - 1; i >= 0; i--) {
      const line = draft.lines[i]!
      if (line.product_id !== productId) continue
      if (line.qty > 1) line.qty -= 1
      else draft.lines.splice(i, 1)
      break
    }

    if (draft.lines.length === 0) clear(tableId)
    else {
      drafts.value = { ...drafts.value, [keyFor(tableId)]: draft }
      void persist()
    }
  }

  /**
   * *Na račun kuće* on a line that is already on the draft (F7). The reason
   * rides on the line and the lock decides what it costs — nothing is sent from
   * here, which is why the common case ("this coffee is on the house") is free.
   */
  function setComp(tableId: string | null, lineId: string, reason: string): void {
    const draft = draftFor(tableId)
    const line = draft?.lines.find(l => l.id === lineId)
    if (!draft || !line) return
    line.comp_reason = reason
    drafts.value = { ...drafts.value, [keyFor(tableId)]: draft }
    void persist()
  }

  /**
   * The round has been sent (or thrown away). The draft goes, and with it its
   * `client_id` — the next round on this table is a new one and gets a new id.
   *
   * The tab id does **not** go: the guests are still sitting there, and the
   * payment that follows has to be able to name their tab. `closeTab()` is what
   * forgets it, and only a settled table calls that.
   */
  function clear(tableId: string | null): void {
    const key = keyFor(tableId)
    const next = { ...drafts.value }
    delete next[key]
    drafts.value = next
    void persist()
  }

  return {
    drafts,
    tabIds,
    hydrated,
    userId,
    staleDrafts,
    myDrafts,
    hydrate,
    bind,
    draftFor,
    linesFor,
    clientIdFor,
    tabClientIdFor,
    ensureTabClientId,
    closeTab,
    countFor,
    qtyOfProduct,
    ensureDraft,
    add,
    setComp,
    removeOne,
    clear,
  }
})
