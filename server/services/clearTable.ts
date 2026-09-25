/**
 * *Očisti sto* — giving the table back.
 *
 * Taking the money and freeing the table used to be one act, and for a café
 * where people pay on the way out that is right. It is wrong for a shisha
 * lounge: a bowl is an hour and a half, the bill is often settled long before
 * the guests stand up, and a shift walking in at three needs to tell a table
 * that is empty from one that has been paid and not yet wiped down. So they are
 * two acts — `status = 'paid'` is the money, `cleared_at` is the table — and
 * this is the second one.
 *
 * **It is deliberately not a payment and takes none.** A tab that still owes
 * money can be cleared: the guests walked out, and *Nije plaćeno* is the
 * sentence for that. What this refuses is clearing a tab twice, because the
 * second clear would overwrite who gave the table back and when.
 *
 * **Two doors, one act.** `clearTab` is the old one, by the server's tab id,
 * for a phone that is online. `clearTabQueued` is the one the outbox posts to
 * (docs/OFFLINE.md §4.4): it names the tab the way a phone with no signal can,
 * it is safe to send twice, and it dates the clear by when it happened.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { schema } from '../database/client'
import { conflict, notFound } from '../utils/errors'
import { nowIso } from '../utils/ids'
import type { ClearTabBody } from '#shared/types'
import type { Actor, Db, Tx } from './types'
import { bump } from './changes'
import { eventTime, getSettings } from './contracts'
import { log } from './log'

type TabRow = typeof schema.tabs.$inferSelect

export interface ClearedTab {
  tab_id: string
  table_id: string | null
  cleared_at: string
  /**
   * Nothing was written: this very clear had already landed (a replay), or
   * somebody else had given the table back first. Either way the table is
   * where the phone wanted it, so the outbox treats it as the success it is.
   */
  already_applied?: boolean
}

export function clearTab(
  db: Db, venueId: string, actor: Actor, tabId: string, now = nowIso(),
): ClearedTab {
  return db.transaction((tx) => {
    const tab = tx.select().from(schema.tabs)
      .where(and(eq(schema.tabs.venueId, venueId), eq(schema.tabs.id, tabId)))
      .get()
    if (!tab) throw notFound('TAB_NOT_FOUND', `tab ${tabId} not found`)
    if (tab.clearedAt) {
      throw conflict('TAB_ALREADY_CLEARED', `tab ${tabId} was already cleared`)
    }

    writeClear(tx, venueId, actor, tab, now, null, now)
    return { tab_id: tab.id, table_id: tab.tableId, cleared_at: now }
  })
}

/**
 * *Očisti sto* from the outbox.
 *
 * **Idempotent the way every phone-born write is.** `client_id` is stored on the
 * tab as `cleared_client_id` (unique per venue), so a retry after a lost answer
 * finds its own clear and answers 200 with it. A tab somebody else cleared
 * first answers 200 too: two waiters giving back the same table is one table
 * given back, and a 409 here would put a red card on a phone for a table that
 * is exactly as empty as it wanted.
 *
 * **Found the way a payment is found** — the phone's own `tab_client_id` first,
 * then the server's `tab_id`. The queue is sequential, so a clear queued behind
 * the round that opened the tab reaches the server after that round has made
 * the tab exist.
 *
 * **Dated by when it happened.** `cleared_at` is the phone's clock, corrected
 * and clamped (`eventTime`), because it is compared with the next round on the
 * same table: a clear stamped with its arrival would be newer than a round the
 * next guests ordered before the phone found a signal.
 */
export function clearTabQueued(
  db: Db, venueId: string, actor: Actor, body: ClearTabBody, now = nowIso(),
): ClearedTab {
  return db.transaction((tx) => {
    const replay = tx.select().from(schema.tabs)
      .where(and(eq(schema.tabs.venueId, venueId), eq(schema.tabs.clearedClientId, body.client_id)))
      .get()
    if (replay) {
      return {
        tab_id: replay.id, table_id: replay.tableId, cleared_at: replay.clearedAt!, already_applied: true,
      }
    }

    const tab = findTab(tx, venueId, body)
    if (!tab) throw notFound('TAB_NOT_FOUND', 'no tab by that tab_client_id or tab_id')
    if (tab.clearedAt) {
      return { tab_id: tab.id, table_id: tab.tableId, cleared_at: tab.clearedAt, already_applied: true }
    }

    const settings = getSettings(tx, venueId)
    const clearedAt = eventTime(tx, actor.deviceId, body.client_created_at, now, settings.max_sync_lag_h)
    writeClear(tx, venueId, actor, tab, clearedAt, body.client_id, now)
    return { tab_id: tab.id, table_id: tab.tableId, cleared_at: clearedAt }
  })
}

/** By the phone's own id first, then by the server's — the payment's rule. */
function findTab(tx: Tx, venueId: string, body: ClearTabBody): TabRow | undefined {
  if (body.tab_client_id) {
    const byClient = tx.select().from(schema.tabs)
      .where(and(eq(schema.tabs.venueId, venueId), eq(schema.tabs.clientId, body.tab_client_id)))
      .get()
    if (byClient) return byClient
  }
  if (!body.tab_id) return undefined
  return tx.select().from(schema.tabs)
    .where(and(eq(schema.tabs.venueId, venueId), eq(schema.tabs.id, body.tab_id)))
    .get()
}

/**
 * The write both doors share: the stamp, the log line and the bump.
 *
 * The log line carries the arrival time (`now`) like every other entry, so the
 * *Dnevnik* stays in the order things reached the server; `cleared_at` on the
 * tab is the one that says when the table was really given back.
 */
function writeClear(
  tx: Tx, venueId: string, actor: Actor, tab: TabRow,
  clearedAt: string, clientId: string | null, now: string,
): void {
  tx.update(schema.tabs)
    .set({ clearedAt, clearedBy: actor.userId, clearedClientId: clientId })
    .where(and(eq(schema.tabs.id, tab.id), isNull(schema.tabs.clearedAt)))
    .run()

  log(tx, venueId, {
    kind: 'table_cleared',
    body: { tab_id: tab.id, table_id: tab.tableId, status: tab.status },
    actorId: actor.userId,
    deviceId: actor.deviceId,
    ref: { type: 'tab', id: tab.id },
    shiftId: tab.shiftId,
    at: now,
  })

  // The tile goes back to being an empty square on every phone in the room.
  bump(tx, venueId, 'table', tab.tableId ?? tab.id)
}
