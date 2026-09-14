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
 */
import { and, eq, isNull } from 'drizzle-orm'
import { schema } from '../database/client'
import { conflict, notFound } from '../utils/errors'
import { nowIso } from '../utils/ids'
import type { Actor, Db } from './types'
import { bump } from './changes'
import { log } from './log'

export interface ClearedTab {
  tab_id: string
  table_id: string | null
  cleared_at: string
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

    tx.update(schema.tabs)
      .set({ clearedAt: now, clearedBy: actor.userId })
      .where(and(eq(schema.tabs.id, tabId), isNull(schema.tabs.clearedAt)))
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

    return { tab_id: tab.id, table_id: tab.tableId, cleared_at: now }
  })
}
