/**
 * The venue-wide change sequence (`docs/BACKEND.md` §4.1).
 *
 * One Node process, no Redis, no WebSockets: sync in Korak 2 is a phone asking
 * "anything new since 812?" every 15 s. The `changes` table is that cursor — one
 * row per mutating transaction, `seq` a global AUTOINCREMENT, monotonic per
 * venue because every read filters by `venue_id`.
 *
 * Two properties carry the whole design:
 *
 *   **`bump` runs inside the caller's transaction.** Its argument is a `Tx`, not
 *   a `Db`, so the type system refuses a call made outside one. A round that
 *   fails a stock check rolls back its `changes` row with everything else, and a
 *   phone is never told about a round that does not exist.
 *
 *   **The rows are keys, never data.** `getChanges` answers *which entities
 *   moved*, then re-reads each snapshot from the ledgers in the same request. So
 *   a stale phone replaying an old response cannot paint an old floor plan over
 *   a newer one; all it can do is advance the largest `seq` it has seen.
 */
import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm'
import { schema } from '../database/client'
import { nowIso } from '../utils/ids'
import type { Actor, ChangeEntity } from '#shared/types'
import type {
  ChangeRow, ChangesResult, CountBrief, PendingCounts, ShiftSnapshot,
} from '#shared/types'
import type { Db, Queryable, Tx } from './types'
import { getTablesState } from './tabs'
import { getPrep } from './prep'
import { getStock } from './stock'
import { shiftBrief } from './shifts'
import { getMe } from './auth'
import { chatSnapshot, myReadTag } from './chat'
import { rulesVersion } from './rules'
import { getSettings } from './contracts'

/**
 * One `changes` row, returning its `seq`.
 *
 * Called **inside** every mutating transaction, after the business rows. A
 * mutating transaction without a `bump` is a bug and
 * `tests/unit/changes-coverage.test.ts` is what proves it: one fixture call per
 * non-GET route, asserting `maxSeq` grew.
 *
 * The caller emits on the bus *after* `db.transaction()` returns — see
 * `server/utils/bus.ts` for why never before.
 */
export function bump(tx: Tx, venueId: string, entity: ChangeEntity, entityId?: string): number {
  const row = tx.insert(schema.changes)
    .values({ venueId, entity, entityId: entityId ?? null, createdAt: nowIso() })
    .returning({ seq: schema.changes.seq })
    .get()
  return row.seq
}

/** The venue's cursor right now. 0 on a freshly seeded database. */
export function maxSeq(db: Queryable, venueId: string): number {
  const row = db.select({ max: sql<number | null>`max(${schema.changes.seq})` })
    .from(schema.changes)
    .where(eq(schema.changes.venueId, venueId))
    .get()
  return row?.max ?? 0
}

/** The oldest cursor still in the table. A `since` below it has fallen behind the prune. */
export function minSeq(db: Queryable, venueId: string): number {
  const row = db.select({ min: sql<number | null>`min(${schema.changes.seq})` })
    .from(schema.changes)
    .where(eq(schema.changes.venueId, venueId))
    .get()
  return row?.min ?? 0
}

/**
 * The ETag tag for a role-and-user-sensitive read (§4.2).
 *
 * `maxSeq` alone is not enough and the reason is the shared bar tablet: one
 * browser profile that Emir, then Haris, then Amar all sign into.
 * `assigned_to_initials` renders a colleague's tile differently from your own,
 * `shift.my_settled` is literally the actor's own number, and `pending` is
 * withheld from waiters entirely. Two people at the same `maxSeq` must therefore
 * get two different tags, or the second one is served the first one's numbers
 * out of his own browser cache with the server never being asked.
 */
export function changeTag(db: Queryable, venueId: string, actor: Actor): string {
  // Phase 4 appends the requester's own `MAX(last_read_seq)`. Without it a phone
  // that has just marked a channel read would 304 its way to a stale badge:
  // `maxSeq` did not move, the role and user did not move, and the one thing
  // that did is not in the tag (PHASE4 §2.11). One indexed lookup.
  return `${maxSeq(db, venueId)}-${actor.role}-${actor.userId.slice(0, 8)}-r${myReadTag(db, venueId, actor)}`
}

/**
 * `GET /api/changes?since=` — the one call the waiter and bartender screens make.
 *
 * `since = 0`, or a `since` the nightly prune has passed, answers `full: true`
 * and every snapshot: a phone that has been off for a week gets a clean slate
 * rather than a partial repaint over stale state.
 */
export function getChanges(
  db: Queryable, venueId: string, actor: Actor, since: number,
): ChangesResult {
  const top = maxSeq(db, venueId)
  const oldest = minSeq(db, venueId)

  // `since` below the oldest surviving row means the prune has passed this
  // cursor and we can no longer say what it missed. `oldest > 0` guards the
  // empty table, where nothing has been pruned because nothing has happened.
  const behindPrune = oldest > 0 && since > 0 && since < oldest - 1
  const full = since <= 0 || behindPrune

  const moved: ChangeRow[] = full
    ? []
    : db.select({
        entity: sql<ChangeEntity>`${schema.changes.entity}`,
        seq: sql<number>`max(${schema.changes.seq})`,
      })
      .from(schema.changes)
      .where(and(eq(schema.changes.venueId, venueId), gt(schema.changes.seq, since)))
      .groupBy(schema.changes.entity)
      .all()

  const entities = new Set<ChangeEntity>(full ? ALL_ENTITIES : moved.map(r => r.entity))

  const result: ChangesResult = {
    seq: top,
    full,
    changes: full ? allChangeRows(db, venueId) : moved,
  }

  // Whether the queues ride along is an *approver* question, not a role one:
  // since the collapse to two roles, `settings.approver_roles` is the only
  // thing that says whether this person decides anybody's money.
  const isApprover = getSettings(db, venueId).approver_roles.includes(actor.role)

  if (entities.has('table')) result.tables_state = getTablesState(db, venueId, actor)
  if (entities.has('prep')) result.prep = { seq: top, ...getPrep(db, venueId) }
  if (entities.has('stock')) result.stock = getStock(db, venueId)
  if (entities.has('count')) result.counts = listCountBriefs(db, venueId)
  if (entities.has('shift')) result.shift = shiftSnapshot(db, venueId, actor)
  // The queues are decisions, and somebody who decides nothing has no use for
  // them: §4.1 attaches `pending` for approvers only.
  //
  // All three entities, not just `adjustment`: a payout and a settlement bump
  // `shift` and a popis bumps `count`, so gating on `adjustment` alone left the
  // badge showing whatever the last void had left behind.
  const queuesMoved = entities.has('adjustment') || entities.has('shift') || entities.has('count')
  if (queuesMoved && isApprover) result.pending = pendingCounts(db, venueId)
  if (entities.has('menu') || entities.has('settings')) {
    result.menu_version = menuVersion(db, venueId)
  }
  // The Dnevnik is owner-only (CLAUDE.md), so even the fact that it moved is.
  if (entities.has('log') && actor.role === 'admin') result.log_max_at = logMaxAt(db, venueId)

  /**
   * A session refresh, attached rather than hinted at (§4.1).
   *
   * A `user` or `device` row moving means somebody's role changed or a phone
   * was revoked, and the screen has to know *now*. The feed used to send only
   * the row in `changes[]` and let the client go and ask; it sends the envelope
   * itself instead, one read in the request that already noticed.
   *
   * Not on a `full` answer: there, `changes[]` lists every entity that has ever
   * moved, so one staff edit last Tuesday would attach `me` to every screen's
   * first poll — and a screen opening has just read `/api/me` anyway.
   */
  if (!full && (entities.has('user') || entities.has('device'))) {
    result.me = getMe(db, venueId, actor)
  }

  /**
   * Phase 4 — and this is the whole of "one poll" for chat: the 15 s tick
   * carries the **unread counts**, so S16 never runs a timer of its own. The
   * snapshot is built from `canSee`, so an admin's answer has no *Konobari* row
   * in it at all — not a row with a zero in it.
   *
   * `user` is in the trigger set because a mute is a `users` write and the muted
   * phone has to learn about it.
   */
  if (entities.has('chat') || entities.has('user')) {
    result.chat = chatSnapshot(db, venueId, actor)
  }
  // The roster is a plain refetch: the feed says it moved and the screen asks
  // its own read, because the staff projection is a different query.
  if (entities.has('roster')) result.roster = { max_at: rosterMaxAt(db, venueId) }
  // Moved: the ack gate re-evaluates at the next login.
  if (entities.has('rules')) result.rules_version = rulesVersion(db, venueId)

  return result
}

/** The newest roster change, as the cursor a screen compares against. */
function rosterMaxAt(db: Queryable, venueId: string): string {
  const row = db.select({ at: schema.changes.createdAt })
    .from(schema.changes)
    .where(and(eq(schema.changes.venueId, venueId), eq(schema.changes.entity, 'roster')))
    .orderBy(desc(schema.changes.seq))
    .limit(1)
    .get()
  return row?.at ?? ''
}

/** Every entity the feed can talk about. `full` answers as if all of them moved. */
export const ALL_ENTITIES: ChangeEntity[] = [
  'table', 'prep', 'stock', 'count', 'shift', 'adjustment',
  'menu', 'settings', 'user', 'device', 'log',
  'chat', 'roster', 'rules',
]

/**
 * A `full` answer still reports the per-entity sequences it knows, so the
 * phone's next incremental poll starts from real numbers. On a freshly seeded
 * venue this is empty — nothing has ever been bumped — and `seq: 0` is the
 * honest cursor.
 */
function allChangeRows(db: Queryable, venueId: string): ChangeRow[] {
  return db.select({
    entity: sql<ChangeEntity>`${schema.changes.entity}`,
    seq: sql<number>`max(${schema.changes.seq})`,
  })
    .from(schema.changes)
    .where(eq(schema.changes.venueId, venueId))
    .groupBy(schema.changes.entity)
    .all()
}

/**
 * The shift strip, as the whole `ShiftBrief` (§6.5).
 *
 * It used to be four hand-built columns, because `ShiftBrief` had not landed
 * when the feed was written. It has: `closing`, `closer_name`, `my_settled` and
 * `my_open_tabs` are exactly what the strip draws, and they are per-actor —
 * which is why the ETag carries the user (`changeTag`).
 */
function shiftSnapshot(db: Queryable, venueId: string, actor: Actor): ShiftSnapshot | null {
  return shiftBrief(db, venueId, actor)
}

function listCountBriefs(db: Queryable, venueId: string): CountBrief[] {
  return db.select({
    id: schema.stockCounts.id,
    status: schema.stockCounts.status,
    phase: schema.stockCounts.phase,
  })
    .from(schema.stockCounts)
    .where(and(
      eq(schema.stockCounts.venueId, venueId),
      eq(schema.stockCounts.status, 'submitted'),
    ))
    .orderBy(asc(schema.stockCounts.submittedAt))
    .all()
}

/**
 * The queues, as counts.
 *
 * These are `count(*)`s over the ledgers rather than calls into each package's
 * `pendingFor()` — the *decidable list* is `owner.ts`'s job (§6.10) and needs
 * titles, amounts and route pairs; the feed needs only "is there anything", so
 * a badge can appear on a phone that is not the owner's.
 *
 * Every queue `attentionItems()` assembles has to be counted here, or the nav
 * badge on a page that has not read *Puls* is smaller than the list it counts.
 */
export function pendingCounts(db: Queryable, venueId: string): PendingCounts {
  const count = (n: number | null | undefined) => n ?? 0

  const adjustments = db.select({ n: sql<number>`count(*)` })
    .from(schema.lineAdjustments)
    .where(and(
      eq(schema.lineAdjustments.venueId, venueId),
      eq(schema.lineAdjustments.status, 'pending'),
    ))
    .get()?.n

  const unpaid = db.select({ n: sql<number>`count(*)` })
    .from(schema.tabs)
    .where(and(
      eq(schema.tabs.venueId, venueId),
      eq(schema.tabs.status, 'unpaid'),
      eq(schema.tabs.pendingReview, 1),
    ))
    .get()?.n

  // `payout` and `float_out` are both born pending: a cash obligation needs the
  // receiver's acknowledgement (§6.5), so both belong in this badge.
  const payouts = db.select({ n: sql<number>`count(*)` })
    .from(schema.cashMovements)
    .where(and(
      eq(schema.cashMovements.venueId, venueId),
      eq(schema.cashMovements.status, 'pending'),
      inArray(schema.cashMovements.type, ['payout', 'float_out']),
    ))
    .get()?.n

  const settlements = db.select({ n: sql<number>`count(*)` })
    .from(schema.waiterSettlements)
    .where(and(
      eq(schema.waiterSettlements.venueId, venueId),
      sql`${schema.waiterSettlements.acceptedAt} is null`,
    ))
    .get()?.n

  // A submitted popis is a decision too — *Primijeni* on the Smjena page and an
  // `approve` row on *Puls* — so it belongs in the same badge.
  const counts = db.select({ n: sql<number>`count(*)` })
    .from(schema.stockCounts)
    .where(and(
      eq(schema.stockCounts.venueId, venueId),
      eq(schema.stockCounts.status, 'submitted'),
    ))
    .get()?.n

  return {
    adjustments: count(adjustments),
    unpaid: count(unpaid),
    payouts: count(payouts),
    settlements: count(settlements),
    counts: count(counts),
  }
}

/** `MAX(seq)` over `menu` and `settings`: when it moves, refetch `/api/bootstrap`. */
export function menuVersion(db: Queryable, venueId: string): number {
  const row = db.select({ max: sql<number | null>`max(${schema.changes.seq})` })
    .from(schema.changes)
    .where(and(
      eq(schema.changes.venueId, venueId),
      inArray(schema.changes.entity, ['menu', 'settings']),
    ))
    .get()
  return row?.max ?? 0
}

function logMaxAt(db: Queryable, venueId: string): string {
  const row = db.select({ at: schema.logEntries.createdAt })
    .from(schema.logEntries)
    .where(eq(schema.logEntries.venueId, venueId))
    .orderBy(desc(schema.logEntries.createdAt))
    .limit(1)
    .get()
  return row?.at ?? ''
}

/**
 * The prune the nightly task runs (§10) — here rather than in `tasks/nightly.ts`
 * because `changes` is this package's table and the deletion rule belongs beside
 * the insertion rule. WP8 calls it.
 */
export function pruneChanges(db: Db, before: string): number {
  const result = db.delete(schema.changes)
    .where(sql`${schema.changes.createdAt} < ${before}`)
    .run()
  return result.changes
}
