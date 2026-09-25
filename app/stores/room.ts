/**
 * The room, remembered — what the floor plan needs to come back with no signal.
 *
 * iOS kills a home-screen app it is not showing. On a night the café's line is
 * down, a waiter pockets the phone, takes it out ten minutes later, and the app
 * starts from nothing: before this store the floor plan was then **empty**,
 * because the only copy of the room lived in memory and `/api/changes` cannot be
 * asked (docs/OFFLINE.md §1, §5.1). So two things are kept on the phone's disk:
 *
 *   - **the room** — the last `tables_state` the poll brought, with the time it
 *     came. The floor paints from it at once and says *Stanje od 21:40* while
 *     the chip is red;
 *   - **the rounds** of each tab — the last `GET /api/tabs/:id`, so a table's
 *     sheet still lists what the guests had. Every tab of *mine* is refreshed in
 *     the background whenever the poll says it moved, so the copy is there
 *     before the line goes down, not only for tables opened since.
 *
 * Both are the same data every waiter on the floor already sees. They are
 * dropped on *Odjavi se* and on a revoked phone (`useMe`), and a room from an
 * earlier business day, or older than twelve hours, is not shown at all — a
 * floor plan from yesterday is worse than an empty one.
 *
 * IndexedDB via `idb-keyval`, like the outbox and the drafts, and for the same
 * reasons: it survives the reload iOS does after the camera, and a Vue `ref` is
 * copied to plain JSON before it is written (`plain()` in `stores/outbox.ts`).
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval'
import { businessDate } from '#shared/dates'
import type { TabDetail, TablesStateResponse } from '#shared/types'

export interface StoredRoom {
  state: TablesStateResponse
  /** When the server said it — what *Stanje od* shows. */
  saved_at: string
}

export interface StoredTab {
  detail: TabDetail
  /**
   * The floor row's fingerprint when this copy was taken (`tabSignature`). The
   * background refresh fetches a tab again only when the fingerprint moved.
   */
  sig: string
  saved_at: string
}

const ROOM_KEY = 'sank:room'
const TABS_KEY = 'sank:tabs'

/** A room older than this is not shown: half a day is longer than any shift. */
const ROOM_MAX_AGE_MS = 12 * 60 * 60 * 1000

function canPersist(): boolean {
  return typeof indexedDB !== 'undefined'
}

/** A plain, cloneable copy — IndexedDB refuses a Vue Proxy (see `stores/outbox.ts`). */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * What changes on a floor row when anything on its tab changes: a round, a
 * payment, a storno, the review flag. Equal fingerprints, same rounds.
 */
export function tabSignature(row: {
  total_fen: number
  remaining_fen: number
  last_order_at: string | null
  paid: boolean
  pending_review: boolean
}): string {
  return [row.total_fen, row.remaining_fen, row.last_order_at ?? '', row.paid, row.pending_review].join('|')
}

/** Is a remembered room still worth drawing? */
export function roomIsFresh(savedAt: string, now = new Date().toISOString()): boolean {
  const age = Date.parse(now) - Date.parse(savedAt)
  if (!Number.isFinite(age) || age < 0 || age > ROOM_MAX_AGE_MS) return false
  return businessDate(savedAt) === businessDate(now)
}

export const useRoomStore = defineStore('room', () => {
  const room = ref<StoredRoom | null>(null)
  const tabs = ref<Record<string, StoredTab>>({})
  const hydrated = ref(false)

  /** Read both back off the disk. Safe to call more than once. */
  async function hydrate(): Promise<void> {
    if (hydrated.value) return
    hydrated.value = true
    if (!canPersist()) return
    try {
      const stored = await idbGet<StoredRoom>(ROOM_KEY)
      // Anything the poll wrote while this was reading wins over the disk.
      if (!room.value && stored?.state && stored.saved_at && roomIsFresh(stored.saved_at)) {
        room.value = stored
      }
      const storedTabs = await idbGet<Record<string, StoredTab>>(TABS_KEY)
      if (storedTabs && typeof storedTabs === 'object') tabs.value = { ...storedTabs, ...tabs.value }
    } catch {
      // Unreadable storage is a phone that remembers nothing, not a broken app.
    }
  }

  async function saveRoom(state: TablesStateResponse): Promise<void> {
    room.value = { state: plain(state), saved_at: new Date().toISOString() }
    if (!canPersist()) return
    try {
      await idbSet(ROOM_KEY, plain(room.value))
    } catch {
      // Private mode, or storage full: the room still works for this session.
    }
  }

  function tabFor(tabId: string): StoredTab | null {
    return tabs.value[tabId] ?? null
  }

  async function saveTab(detail: TabDetail, sig: string): Promise<void> {
    tabs.value = {
      ...tabs.value,
      [detail.tab.id]: { detail: plain(detail), sig, saved_at: new Date().toISOString() },
    }
    await persistTabs()
  }

  /** Forget every tab that is no longer anywhere in the room. */
  async function keepOnly(tabIds: Set<string>): Promise<void> {
    const kept = Object.fromEntries(Object.entries(tabs.value).filter(([id]) => tabIds.has(id)))
    if (Object.keys(kept).length === Object.keys(tabs.value).length) return
    tabs.value = kept
    await persistTabs()
  }

  async function persistTabs(): Promise<void> {
    if (!canPersist()) return
    try {
      if (Object.keys(tabs.value).length === 0) await idbDel(TABS_KEY)
      else await idbSet(TABS_KEY, plain(tabs.value))
    } catch {
      // Same as above: remembered for this session only.
    }
  }

  /** *Odjavi se*, or a revoked phone: somebody else may hold it next. */
  async function forget(): Promise<void> {
    room.value = null
    tabs.value = {}
    if (!canPersist()) return
    try {
      await idbDel(ROOM_KEY)
      await idbDel(TABS_KEY)
    } catch {
      // Nothing to forget is not an error.
    }
  }

  return { room, tabs, hydrated, hydrate, saveRoom, tabFor, saveTab, keepOnly, forget }
})
