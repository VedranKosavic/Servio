/**
 * *Storno* and *gratis* — the two ways a line stops being money the guest owes.
 *
 * `line_adjustments` has exactly one transition: `pending → applied|rejected`,
 * once, with the amount held still while the status moves. A trigger enforces
 * that, so nothing here can quietly rewrite what a void was worth after the
 * fact.
 *
 * The rule this file exists to get right is **who may grant one**, and it is a
 * ladder rather than a role check:
 *
 *   1. a waiter may strike his **own** unprepared line inside five minutes on a
 *      tab nobody has paid, up to a per-shift cap — a genuine miskey, and the
 *      bowl has not been lit;
 *   2. a staff drink inside the per-shift allowance authorises itself;
 *   3. an approver's PIN typed on the spot grants it, a bartender's only inside
 *      his window;
 *   4. otherwise it waits, and the amount stays on the requester's expected cash
 *      until somebody decides. "Storno čeka odobrenje — 5,00 KM ostaje u tvom
 *      pazaru dok se ne odobri."
 *
 * Failing rule 1 or 3 is **not an error**. It falls through to pending with the
 * same sheet copy, because a waiter who mistyped a coffee at minute six has done
 * nothing wrong and a refusal would teach him to stop asking.
 *
 * And the money: `refund_kind = 'none'` — the default — writes **no money row at
 * all**. A void changes what the *guest* owes; handing cash back is a separate
 * physical act that needs its own signed row. The previous design credited the
 * requester automatically on every paid void, which let a waiter collect 50 KM,
 * record it honestly, and then have the void hand the 50 KM back to him on paper.
 */
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm'
import { schema } from '../database/client'
import { conflict, forbidden, notFound } from '../utils/errors'
import { newId, nowIso } from '../utils/ids'
import { clampEventAt } from '#shared/dates'
import { RESTOCK_REASONS } from '#shared/schemas'
import type { Settings } from '#shared/settings'
import type {
  AdjustmentResult, CreateAdjustmentBody, DecideAdjustmentBody, PendingAdjustment, RefundKind,
} from '#shared/types'
import type { Actor, Db, Queryable, Tx } from './types'
import {
  bump, getSettings, insertMovement, insertRefund, log, verifyPinMetered, writeSummaryVersion,
} from './contracts'
import { maxSeq } from './changes'
import { emitChange } from '../utils/bus'
import { tabMoney } from './tabs'
import { insertReversal } from './payments'
import { type AttentionItem, requireApprover, userNames } from './shifts'
import { staffDrinkAllowed } from './orders'

type AdjustmentRow = typeof schema.lineAdjustments.$inferSelect

/** §6.4 lists this among `adjustments.ts`'s exports; it is defined with the lock. */
export { staffDrinkAllowed }

// ===========================================================================
// Request
// ===========================================================================

export function requestAdjustment(
  db: Db, venueId: string, actor: Actor, body: CreateAdjustmentBody,
): AdjustmentResult {
  const settings = getSettings(db, venueId)

  /**
   * The PIN is checked **before** the transaction opens, on `db` and not on
   * `tx`. `verifyPinMetered` writes an `auth_attempts` row whether the PIN was
   * right or wrong, and a row written inside a transaction that then throws is
   * rolled back with it — which would leave a lockout counter that never counts
   * the attempts that matter (§2).
   */
  const approver = body.approver_user_id
    ? requireApproverUser(db, venueId, actor, body.approver_user_id, settings)
    : null
  if (approver && body.pin) {
    verifyPinMetered(db, venueId, approver.id, actor.deviceId, body.pin, {
      ip: '', kind: 'approve',
    })
  }

  const result = db.transaction((tx) => {
    const existing = tx.select().from(schema.lineAdjustments)
      .where(and(
        eq(schema.lineAdjustments.venueId, venueId),
        eq(schema.lineAdjustments.clientId, body.client_id),
      ))
      .get()
    if (existing) return adjustmentResult(tx, venueId, actor, existing, true)

    const line = tx.select().from(schema.orderLines)
      .where(and(
        eq(schema.orderLines.venueId, venueId),
        eq(schema.orderLines.id, body.order_line_id),
      ))
      .get()
    if (!line) throw notFound('LINE_NOT_FOUND', `line ${body.order_line_id} not found`)

    const order = tx.select().from(schema.orders)
      .where(eq(schema.orders.id, line.orderId))
      .get()!
    const tab = tx.select().from(schema.tabs).where(eq(schema.tabs.id, order.tabId)).get()!
    if (tab.status === 'voided') throw conflict('TAB_VOIDED', `tab ${tab.id} is voided`)

    const live = tx.select({ id: schema.lineAdjustments.id }).from(schema.lineAdjustments)
      .where(and(
        eq(schema.lineAdjustments.venueId, venueId),
        eq(schema.lineAdjustments.orderLineId, line.id),
        inArray(schema.lineAdjustments.status, ['pending', 'applied']),
      ))
      .get()
    if (live) throw conflict('LINE_ALREADY_ADJUSTED', `line ${line.id} already has an adjustment`)

    const at = nowIso()
    const secondsSinceLock = secondsSinceLockFor(tx, settings, actor, body, order.createdAt, at)
    const wasPaid = tabWasPaid(tx, venueId, tab, order.clientId)

    // Whole-line voids in v1: the body sends no qty and no amount, and both are
    // read from the line here. A comped line is worth nothing, so voiding it
    // moves nothing.
    const qty = line.qty
    const amountFen = line.chargedFen
    const restock = body.kind === 'void'
      && (RESTOCK_REASONS as readonly string[]).includes(body.reason)
      ? 1
      : 0

    const id = newId()
    const decision = decideOnRequest(
      tx, venueId, actor, settings, {
        kind: body.kind, reason: body.reason, lockedBy: order.lockedBy,
        preparedAt: order.preparedAt, tabStatus: tab.status, wasPaid,
        secondsSinceLock, amountFen, shiftId: order.shiftId!, approver,
      },
    )

    tx.insert(schema.lineAdjustments).values({
      id,
      venueId,
      orderLineId: line.id,
      tabId: tab.id,
      clientId: body.client_id,
      kind: body.kind,
      reason: body.reason,
      note: body.note ?? null,
      qty,
      amountFen,
      restock,
      requestedBy: actor.userId,
      deviceId: actor.deviceId,
      secondsSinceLock,
      wasPaid: wasPaid ? 1 : 0,
      status: decision.status,
      auto: decision.auto ? 1 : 0,
      approvedBy: decision.approvedBy,
      decidedOnDeviceId: decision.status === 'applied' ? actor.deviceId : null,
      foreignDevice: decision.foreignDevice ? 1 : 0,
      decidedAt: decision.status === 'applied' ? at : null,
      decidedInShiftId: decision.status === 'applied' ? order.shiftId : null,
      refundKind: 'none',
      createdAt: at,
    }).run()

    const row = tx.select().from(schema.lineAdjustments)
      .where(eq(schema.lineAdjustments.id, id)).get()!

    if (decision.capped) {
      log(tx, venueId, {
        kind: 'self_void_capped',
        body: {
          user_id: actor.userId,
          count: decision.capped.count,
          max: decision.capped.max,
          fen: amountFen,
        },
        actorId: actor.userId,
        deviceId: actor.deviceId,
        ref: { type: 'line_adjustment', id },
        shiftId: order.shiftId,
        at,
      })
    }

    if (decision.status === 'applied') {
      applyAdjustment(tx, venueId, row, at)
      logDecision(tx, venueId, actor, row, line.nameSnapshot, tab.tableId, order.shiftId, at, null)
    } else {
      log(tx, venueId, {
        kind: body.kind === 'void' ? 'void_requested' : 'comp_requested',
        body: {
          adjustment_id: id,
          tab_id: tab.id,
          table_id: tab.tableId,
          user_id: actor.userId,
          line: line.nameSnapshot,
          amount_fen: amountFen,
          ...(body.kind === 'comp' ? { reason: body.reason } : {}),
        },
        actorId: actor.userId,
        deviceId: actor.deviceId,
        ref: { type: 'line_adjustment', id },
        shiftId: order.shiftId,
        at,
      })
    }

    bump(tx, venueId, 'adjustment', id)
    bump(tx, venueId, 'table', tab.id)
    if (decision.status === 'applied' && restock === 1) bump(tx, venueId, 'stock')

    return adjustmentResult(tx, venueId, actor, row, false)
  })

  emitChange(venueId, {
    seq: maxSeq(db, venueId), entity: 'adjustment', entityId: result.adjustment.id,
  })
  return result
}

// ===========================================================================
// Decide
// ===========================================================================

export function decideAdjustment(
  db: Db, venueId: string, actor: Actor, adjustmentId: string, body: DecideAdjustmentBody,
): AdjustmentResult {
  const settings = getSettings(db, venueId)
  if (body.pin) {
    verifyPinMetered(db, venueId, actor.userId, actor.deviceId, body.pin, {
      ip: '', kind: 'approve',
    })
  }

  const result = db.transaction((tx) => {
    const adj = tx.select().from(schema.lineAdjustments)
      .where(and(
        eq(schema.lineAdjustments.venueId, venueId),
        eq(schema.lineAdjustments.id, adjustmentId),
      ))
      .get()
    if (!adj) throw notFound('ADJUSTMENT_NOT_FOUND', `adjustment ${adjustmentId} not found`)
    if (adj.status !== 'pending') {
      throw conflict('ALREADY_DECIDED', `adjustment ${adjustmentId} is ${adj.status}`)
    }

    const line = tx.select().from(schema.orderLines)
      .where(eq(schema.orderLines.id, adj.orderLineId)).get()!
    const order = tx.select().from(schema.orders).where(eq(schema.orders.id, line.orderId)).get()!
    const tab = tx.select().from(schema.tabs).where(eq(schema.tabs.id, adj.tabId)).get()!

    const at = nowIso()
    requireDecider(actor, settings, adj, order.createdAt, at)

    const refundKind: RefundKind = body.outcome === 'applied' ? (body.refund ?? 'none') : 'none'
    const restock = body.outcome === 'applied' && adj.kind === 'void'
      ? (body.restock === undefined ? adj.restock : (body.restock ? 1 : 0))
      : 0

    tx.update(schema.lineAdjustments)
      .set({
        status: body.outcome,
        approvedBy: actor.userId,
        decidedOnDeviceId: actor.deviceId,
        // An admin PIN typed on somebody else's phone: allowed, always recorded.
        foreignDevice: actor.deviceId !== null && actor.deviceBoundUserId !== actor.userId ? 1 : 0,
        decidedAt: at,
        decidedInShiftId: order.shiftId,
        restock,
        refundKind,
        // Not `note`: `line_adjustments_update_guard` freezes it alongside the
        // amount, so the requester's sentence cannot be rewritten by whoever
        // answers it. The decider's own note goes into the Dnevnik entry below,
        // which is where a second person's words belong.
      })
      .where(eq(schema.lineAdjustments.id, adjustmentId))
      .run()

    const row = tx.select().from(schema.lineAdjustments)
      .where(eq(schema.lineAdjustments.id, adjustmentId)).get()!

    if (body.outcome === 'applied') applyAdjustment(tx, venueId, row, at)

    logDecision(
      tx, venueId, actor, row, line.nameSnapshot, tab.tableId, order.shiftId, at,
      requestEntryId(tx, venueId, adjustmentId), body.note,
    )

    // A decision on a night that has already been written up gives that night a
    // new version of its numbers rather than a silent edit of the old one.
    if (order.shiftId) {
      const shift = tx.select({ status: schema.shifts.status }).from(schema.shifts)
        .where(eq(schema.shifts.id, order.shiftId)).get()
      if (shift && (shift.status === 'closed' || shift.status === 'reviewed')) {
        writeSummaryVersion(tx, venueId, order.shiftId, 'decision', at)
      }
    }

    bump(tx, venueId, 'adjustment', adjustmentId)
    bump(tx, venueId, 'table', adj.tabId)
    bump(tx, venueId, 'shift', order.shiftId ?? undefined)
    if (restock === 1) bump(tx, venueId, 'stock')

    return adjustmentResult(tx, venueId, actor, row, false)
  })

  emitChange(venueId, { seq: maxSeq(db, venueId), entity: 'adjustment', entityId: adjustmentId })
  return result
}

/**
 * What an applied adjustment actually does. Exactly three things, and no
 * guessing about money.
 */
export function applyAdjustment(
  tx: Tx, venueId: string, adj: AdjustmentRow, at: string,
): void {
  const line = tx.select().from(schema.orderLines)
    .where(eq(schema.orderLines.id, adj.orderLineId)).get()!
  const order = tx.select().from(schema.orders).where(eq(schema.orders.id, line.orderId)).get()!

  // 1 — the goods go back on the shelf, one mirror row per component of the
  // sale, with the cost the sale carried so COGS does not drift.
  if (adj.kind === 'void' && adj.restock === 1) {
    const sales = tx.select().from(schema.stockMovements)
      .where(and(
        eq(schema.stockMovements.venueId, venueId),
        eq(schema.stockMovements.type, 'sale'),
        eq(schema.stockMovements.refType, 'order_line'),
        eq(schema.stockMovements.refId, line.id),
      ))
      .all()
    for (const sale of sales) {
      insertMovement(tx, venueId, {
        stockItemId: sale.stockItemId,
        type: 'sale_storno',
        qtyDelta: -sale.qtyDelta,
        unitCostMfen: sale.unitCostMfen,
        refType: 'line_adjustment',
        refId: adj.id,
        userId: adj.approvedBy,
        shiftId: order.shiftId,
        occurredAt: at,
        createdAt: at,
      })
    }
  }

  // 2 — the waiter hands cash back out of his own envelope. His expected drops
  // by the amount, and the negative payment row carries a second name.
  if (adj.refundKind === 'from_waiter') {
    insertReversal(tx, venueId, adj, adj.approvedBy!, at)
  }

  // 3 — the money comes out of the drawer instead.
  if (adj.refundKind === 'from_drawer') {
    const tab = tx.select().from(schema.tabs).where(eq(schema.tabs.id, adj.tabId)).get()!
    const shiftId = order.shiftId!
    const movementId = insertRefund(
      tx, venueId,
      { venueId, userId: adj.approvedBy!, role: 'admin', sessionId: '', sessionKind: 'staff',
        deviceId: null, deviceBoundUserId: null, borrowed: false },
      shiftId,
      { amountFen: adj.amountFen, adjustmentId: adj.id, at },
    )
    log(tx, venueId, {
      kind: 'payment_reversed',
      body: {
        movement_id: movementId,
        tab_id: adj.tabId,
        table_id: tab.tableId,
        amount_fen: adj.amountFen,
        method: 'cash',
        adjustment_id: adj.id,
        refund_kind: 'from_drawer',
      },
      actorId: adj.approvedBy,
      ref: { type: 'cash_movement', id: movementId },
      shiftId,
      at,
    })
  }
}

// ===========================================================================
// Reads
// ===========================================================================

/**
 * The *Na čekanju* queue. An approver sees everything pending; anybody else
 * sees only his own requests and never a colleague's money.
 *
 * With one worker role, `settings.approver_roles` — not the role — is what
 * decides which of the two you are. An owner who takes `radnik` off that list
 * gets a queue that shows every worker his own rows and nothing more.
 */
export function listPending(
  q: Queryable, venueId: string, actor: Actor,
): PendingAdjustment[] {
  const settings = getSettings(q, venueId)
  const rows = q.select().from(schema.lineAdjustments)
    .where(and(
      eq(schema.lineAdjustments.venueId, venueId),
      eq(schema.lineAdjustments.status, 'pending'),
      ...(settings.approver_roles.includes(actor.role) ? [] : [eq(schema.lineAdjustments.requestedBy, actor.userId)]),
    ))
    .orderBy(asc(schema.lineAdjustments.createdAt))
    .all()

  return rows.map(row => adjustmentView(q, venueId, actor, row, settings))
}

export function pendingFor(q: Queryable, venueId: string, _now: string): AttentionItem[] {
  const names = userNames(q, venueId)
  return q.select({ adj: schema.lineAdjustments, line: schema.orderLines.nameSnapshot })
    .from(schema.lineAdjustments)
    .innerJoin(schema.orderLines, eq(schema.orderLines.id, schema.lineAdjustments.orderLineId))
    .where(and(
      eq(schema.lineAdjustments.venueId, venueId),
      eq(schema.lineAdjustments.status, 'pending'),
    ))
    .orderBy(asc(schema.lineAdjustments.createdAt))
    .all()
    .map(({ adj, line }) => ({
      kind: adj.kind === 'void' ? 'void' as const : 'comp' as const,
      ref_type: 'line_adjustment' as const,
      ref_id: adj.id,
      title_bs: `${adj.kind === 'void' ? 'Traži storno' : 'Traži gratis'}`
        + ` · ${names.get(adj.requestedBy) ?? '—'} · ${line}`,
      amount_fen: adj.amountFen,
      at: adj.createdAt,
      actions: ['approve', 'reject'] as ('approve' | 'reject' | 'note')[],
    }))
}

// ===========================================================================
// Internals
// ===========================================================================

interface RequestFacts {
  kind: 'void' | 'comp'
  reason: string
  lockedBy: string
  preparedAt: string | null
  tabStatus: string
  wasPaid: boolean
  secondsSinceLock: number
  amountFen: number
  shiftId: string
  approver: { id: string, role: string } | null
}

interface Decision {
  status: 'pending' | 'applied'
  auto: boolean
  approvedBy: string | null
  foreignDevice: boolean
  capped?: { count: number, max: number }
}

/** The ladder of §6.4, in order. Falling off the bottom is `pending`. */
function decideOnRequest(
  tx: Tx, venueId: string, actor: Actor, settings: Settings, f: RequestFacts,
): Decision {
  const pending: Decision = {
    status: 'pending', auto: false, approvedBy: null, foreignDevice: false,
  }

  // 1 — the self-void. Three conditions beyond "his own line, inside the
  // window": the tab is unpaid, the bartender has not already made the thing,
  // and he is under his caps for the night. A bowl that has been lit cannot go
  // back in the jar, which is exactly what separates a miskey from a sale being
  // quietly unwound.
  if (f.kind === 'void'
    && actor.userId === f.lockedBy
    && !f.wasPaid
    && f.tabStatus === 'open'
    && f.secondsSinceLock <= settings.void_self_window_s
    && f.preparedAt === null) {
    const used = selfVoidsThisShift(tx, venueId, actor.userId, f.shiftId)
    const overCount = used.count >= settings.self_void_max_per_shift
    const overFen = used.fen + f.amountFen > settings.self_void_max_fen
    if (!overCount && !overFen) {
      return { status: 'applied', auto: true, approvedBy: actor.userId, foreignDevice: false }
    }
    return {
      ...pending,
      capped: { count: used.count + 1, max: settings.self_void_max_per_shift },
    }
  }

  // 2 — a staff drink inside the allowance authorises itself.
  if (f.kind === 'comp' && f.reason === 'staff_drink' && actor.userId === f.lockedBy) {
    const product = { staffDrinkAllowed: 1 }
    if (staffDrinkAllowed(tx, venueId, actor.userId, f.shiftId, product, f.amountFen, settings)) {
      return { status: 'applied', auto: true, approvedBy: actor.userId, foreignDevice: false }
    }
  }

  // 3 — an approver's PIN, typed on this phone right now.
  if (f.approver) {
    // `bartender_approve_window_s` keeps its key: the setting is about the
    // person on the šank, which is still what the Bosnian label says, even
    // though the role behind him is now plain `radnik`.
    if (f.approver.role === 'radnik'
      && f.secondsSinceLock > settings.bartender_approve_window_s) {
      // Not an error: it waits for the owner, with the same sheet copy.
      return pending
    }
    return {
      status: 'applied',
      auto: false,
      approvedBy: f.approver.id,
      foreignDevice: actor.deviceBoundUserId !== f.approver.id,
    }
  }

  return pending
}

/** The approver named in the body: active, allowed to approve, and not himself. */
function requireApproverUser(
  q: Queryable, venueId: string, actor: Actor, approverId: string, settings: Settings,
): { id: string, role: string } {
  const user = q.select().from(schema.users)
    .where(and(
      eq(schema.users.id, approverId),
      eq(schema.users.venueId, venueId),
      eq(schema.users.active, 1),
    ))
    .get()
  if (!user) throw notFound('USER_NOT_FOUND', `user ${approverId} not found`)
  if (!settings.approver_roles.includes(user.role)) {
    throw forbidden('NOT_APPROVER', 'this role does not approve money')
  }
  if (user.id === actor.userId && actor.role !== 'admin') {
    throw forbidden('SELF_APPROVAL', 'you cannot approve your own request')
  }
  // The owner's PIN is his own phone's to give. Accepting it anywhere else
  // makes every waiter's handset a place to guess six digits at.
  if (user.role === 'admin' && actor.deviceBoundUserId !== user.id) {
    throw forbidden('ADMIN_PIN_FOREIGN_DEVICE', 'the owner types his PIN on his own phone')
  }
  return { id: user.id, role: user.role }
}

/** Who may decide a pending row, and from where. */
function requireDecider(
  actor: Actor, settings: Settings,
  adj: AdjustmentRow, lockedAt: string, at: string,
): void {
  // The hard "a waiter decides nobody's money" rule went with the role that
  // named it. `requireApprover` is now the only gate, which is what §5 always
  // said it should be — the coarse table lets a `radnik` through the door and
  // `settings.approver_roles` decides whether the service serves him.
  requireApprover(settings, actor)

  if (adj.requestedBy === actor.userId && actor.role !== 'admin') {
    throw forbidden('SELF_APPROVAL', 'you cannot decide your own request')
  }

  if (actor.role === 'admin') {
    // An email session on the laptop, or his own bound phone. Anything else is
    // somebody handing the owner's session around the bar.
    if (actor.sessionKind !== 'admin' && actor.deviceBoundUserId !== actor.userId) {
      throw forbidden('ADMIN_FOREIGN_DEVICE', 'decide this from your own phone or the laptop')
    }
    return
  }

  // A bartender's authority is a window, measured at the moment he decides.
  const elapsed = Math.floor((Date.parse(at) - Date.parse(lockedAt)) / 1000)
  if (elapsed > settings.bartender_approve_window_s) {
    throw forbidden('WINDOW_EXPIRED', 'the bartender window has passed — this is the owner\'s')
  }
}

/**
 * How long after the lock the storno was **asked for**, not how long after the
 * lock the request happened to arrive (PHASE3 §1.2).
 *
 * The difference is the whole point of the 300 s window. A waiter strikes a
 * mistaken coffee twenty seconds after locking it while the phone is in a dead
 * spot; the outbox flushes ten minutes later. Measured from *server now* the
 * request is 620 s old and goes to the bartender's queue — the wrong answer for
 * the exact case the window was written for.
 *
 * The claim is treated like every other client timestamp (`shared/dates.ts`):
 *
 *   - the device's own `clock_skew_s`, measured by the heartbeat, is subtracted
 *     first, so a phone that is three minutes fast cannot buy itself three extra
 *     minutes of window;
 *   - it is clamped to `[now − max_sync_lag_h, now]`, so it can be neither in
 *     the future nor older than the venue tolerates;
 *   - and it can never claim to be *before* the lock: a negative age is a wrong
 *     clock, not a storno asked for before the round existed.
 *
 * A body with no claim behaves exactly as it did before: server now.
 *
 * **The raw claim is not stored.** `line_adjustments` has no column for it and
 * WP1 adds no migration this phase (PHASE3 §1: one migration, WP0's). Only the
 * value actually used survives, in `seconds_since_lock` — noted here so the
 * asymmetry with `orders.client_created_at` / `client_created_at_adj` is a known
 * gap rather than a silent one.
 */
function secondsSinceLockFor(
  tx: Tx, settings: Settings, actor: Actor, body: CreateAdjustmentBody,
  lockedAt: string, now: string,
): number {
  const skewS = deviceSkew(tx, actor.deviceId)
  const askedAt = clampEventAt(body.client_created_at, now, settings.max_sync_lag_h, skewS)
  return Math.max(0, Math.floor((Date.parse(askedAt) - Date.parse(lockedAt)) / 1000))
}

/** How far this phone's clock is from the server's, as the heartbeat measured it. */
function deviceSkew(tx: Tx, deviceId: string | null): number {
  if (!deviceId) return 0
  const row = tx.select({ skew: schema.devices.clockSkewS }).from(schema.devices)
    .where(eq(schema.devices.id, deviceId))
    .get()
  return row?.skew ?? 0
}

/** His self-voids so far this shift: how many, and how much. */
function selfVoidsThisShift(
  tx: Tx, venueId: string, userId: string, shiftId: string,
): { count: number, fen: number } {
  const row = tx.select({
    n: count(),
    fen: sql<number>`coalesce(sum(${schema.lineAdjustments.amountFen}), 0)`,
  })
    .from(schema.lineAdjustments)
    .innerJoin(schema.orderLines, eq(schema.orderLines.id, schema.lineAdjustments.orderLineId))
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderLines.orderId))
    .where(and(
      eq(schema.lineAdjustments.venueId, venueId),
      eq(schema.lineAdjustments.kind, 'void'),
      eq(schema.lineAdjustments.auto, 1),
      eq(schema.lineAdjustments.status, 'applied'),
      eq(schema.lineAdjustments.requestedBy, userId),
      eq(schema.orders.shiftId, shiftId),
    ))
    .get()
  return { count: row?.n ?? 0, fen: row?.fen ?? 0 }
}

/**
 * Had the guest already paid for this line? Either the whole tab is settled, or
 * a payment on it names this round — or names nothing, which is how a phone
 * says "this covers the table".
 */
function tabWasPaid(
  tx: Tx, venueId: string, tab: typeof schema.tabs.$inferSelect, orderClientId: string,
): boolean {
  if (tab.status === 'paid') return true
  const payments = tx.select({
    covers: schema.payments.coversJson, amountFen: schema.payments.amountFen,
  })
    .from(schema.payments)
    .where(and(eq(schema.payments.venueId, venueId), eq(schema.payments.tabId, tab.id)))
    .all()
  return payments.some((p) => {
    if (p.amountFen <= 0) return false
    const covers: string[] = JSON.parse(p.covers)
    return covers.length === 0 || covers.includes(orderClientId)
  })
}

/** The `void_requested` entry this decision answers, so the Dnevnik can link them. */
function requestEntryId(q: Queryable, venueId: string, adjustmentId: string): string | null {
  const row = q.select({ id: schema.logEntries.id }).from(schema.logEntries)
    .where(and(
      eq(schema.logEntries.venueId, venueId),
      inArray(schema.logEntries.kind, ['void_requested', 'comp_requested']),
      eq(schema.logEntries.refType, 'line_adjustment'),
      eq(schema.logEntries.refId, adjustmentId),
    ))
    .orderBy(desc(schema.logEntries.createdAt))
    .get()
  return row?.id ?? null
}

function logDecision(
  tx: Tx, venueId: string, actor: Actor, adj: AdjustmentRow, lineName: string,
  // Nullable since `0003_phase3.sql`: a *Bez stola* tab has no table, and the
  // log template already has `table_id` optional for exactly that shape.
  tableId: string | null, shiftId: string | null, at: string, resolvesId: string | null,
  note?: string,
): void {
  log(tx, venueId, {
    kind: adj.kind === 'void' ? 'void_decided' : 'comp_decided',
    body: {
      adjustment_id: adj.id,
      tab_id: adj.tabId,
      table_id: tableId ?? undefined,
      user_id: adj.requestedBy,
      approver_id: adj.approvedBy ?? undefined,
      line: lineName,
      amount_fen: adj.amountFen,
      outcome: adj.status === 'applied' ? 'applied' : 'rejected',
      ...(note === undefined ? {} : { decided_note: note }),
      ...(adj.kind === 'void'
        ? {
            was_paid: adj.wasPaid === 1,
            foreign_device: adj.foreignDevice === 1,
            restock: adj.restock === 1,
            refund_kind: adj.refundKind,
          }
        : { reason: adj.reason }),
    },
    actorId: actor.userId,
    deviceId: actor.deviceId,
    ref: { type: 'line_adjustment', id: adj.id },
    shiftId,
    resolvesId,
    at,
  })
}

function adjustmentResult(
  q: Queryable, venueId: string, actor: Actor, row: AdjustmentRow, replay: boolean,
): AdjustmentResult {
  const money = tabMoney(q, venueId, row.tabId)
  return {
    adjustment: adjustmentView(q, venueId, actor, row),
    tab_total_fen: money.total_fen,
    tab_remaining_fen: money.remaining_fen,
    applied: row.status === 'applied',
    already_applied: replay,
  }
}

function adjustmentView(
  q: Queryable, venueId: string, actor: Actor, row: AdjustmentRow, settings?: Settings,
): PendingAdjustment {
  const s = settings ?? getSettings(q, venueId)
  const names = userNames(q, venueId)
  const line = q.select({ name: schema.orderLines.nameSnapshot }).from(schema.orderLines)
    .where(eq(schema.orderLines.id, row.orderLineId)).get()
  // LEFT: a storno on a *Bez stola* tab reads *Bez stola* on the queue, not —.
  const table = q.select({ name: sql<string>`coalesce(${schema.tables.name}, 'Bez stola')` })
    .from(schema.tabs)
    .leftJoin(schema.tables, eq(schema.tables.id, schema.tabs.tableId))
    .where(eq(schema.tabs.id, row.tabId))
    .get()

  return {
    id: row.id,
    kind: row.kind,
    reason: row.reason,
    note: row.note,
    qty: row.qty,
    amount_fen: row.amountFen,
    restock: row.restock === 1,
    was_paid: row.wasPaid === 1,
    seconds_since_lock: row.secondsSinceLock,
    status: row.status,
    auto: row.auto === 1,
    refund_kind: row.refundKind,
    order_line_id: row.orderLineId,
    line_name: line?.name ?? '—',
    tab_id: row.tabId,
    table_name: table?.name ?? '—',
    requested_by: row.requestedBy,
    requested_by_name: names.get(row.requestedBy) ?? '—',
    approved_by: row.approvedBy,
    approved_by_name: row.approvedBy ? names.get(row.approvedBy) ?? '—' : null,
    decided_at: row.decidedAt,
    created_at: row.createdAt,
    can_decide: canDecide(q, venueId, actor, row, s),
  }
}

/** Whether *this* person, right now, would get past `requireDecider`. */
function canDecide(
  q: Queryable, venueId: string, actor: Actor, row: AdjustmentRow, settings: Settings,
): boolean {
  if (row.status !== 'pending') return false
  try {
    const order = q.select({ createdAt: schema.orders.createdAt })
      .from(schema.orders)
      .innerJoin(schema.orderLines, eq(schema.orderLines.orderId, schema.orders.id))
      .where(eq(schema.orderLines.id, row.orderLineId))
      .get()
    requireDecider(actor, settings, row, order?.createdAt ?? row.createdAt, nowIso())
    return true
  } catch {
    return false
  }
}
