/**
 * *Završi smjenu* — the blind per-waiter cash settlement.
 *
 * The waiter counts what is in his pocket and types it in. Only then does the
 * server say what it expected. `declared_fen` and `expected_at_declare_fen` are
 * written on the same row in the same statement, which is the whole design: what
 * a person said before he was told is a fact you can still read in March.
 *
 * **Blindness is a nudge, not a control.** `/api/me/shift` withholds the summary
 * until a settlement exists — but `/api/me/shift/lines` returns per-line prices,
 * so anybody who can add knows his number. The evidence is the recorded pair,
 * not the strip. Nothing downstream may lean on the strip as if it were a
 * control; if a future feature needs a real one, it needs a different mechanism.
 *
 * There is **one** settle route and no second "late" one. A settlement that
 * arrives after the shift has already closed is the same insert with `late = 1`,
 * a `settlement_late` entry and a new summary version (PLAN F10 step 7,
 * *Naknadna predaja*). One code path, one unique index, no chain of corrections.
 */
import { and, desc, eq } from 'drizzle-orm'
import { schema } from '../database/client'
import { SankError, conflict, forbidden, notFound } from '../utils/errors'
import { newId, nowIso } from '../utils/ids'
import type {
  SettleResult, Settlement, StaleDevice, UserSummary,
} from '#shared/types'
import type { Actor, Db, Queryable } from './types'
import {
  assertNoPendingOutbox, bump, getSettings, joinShift, log, verifyPinMetered,
} from './contracts'
import { expectedCash, toleranceFen, withinTolerance } from './cash'
import { type AttentionItem, requireApprover, requireShift, userNames } from './shifts'
import { summarizeUser, writeSummaryVersion } from './summaries'

/**
 * Has this person already handed his envelope in for this shift?
 *
 * A lock or a payment after this point is not refused — refusing loses the sale
 * entirely, and the guest has already been served — it is accepted, stamped
 * `post_settle = 1`, added to his expected cash and flagged (§6.1 step 5, §6.3).
 * "Live" is one row per person per shift; corrections are Korak 3.
 */
export function hasLiveSettlement(
  q: Queryable, venueId: string, shiftId: string, userId: string,
): boolean {
  const row = q.select({ id: schema.waiterSettlements.id })
    .from(schema.waiterSettlements)
    .where(and(
      eq(schema.waiterSettlements.venueId, venueId),
      eq(schema.waiterSettlements.shiftId, shiftId),
      eq(schema.waiterSettlements.userId, userId),
    ))
    .get()
  return Boolean(row)
}

/** The stored rows with their two names joined. Newest first. */
export function listSettlements(
  q: Queryable, venueId: string, shiftId?: string, userId?: string,
): Settlement[] {
  const names = userNames(q, venueId)
  return q.select().from(schema.waiterSettlements)
    .where(and(
      eq(schema.waiterSettlements.venueId, venueId),
      ...(shiftId ? [eq(schema.waiterSettlements.shiftId, shiftId)] : []),
      ...(userId ? [eq(schema.waiterSettlements.userId, userId)] : []),
    ))
    .orderBy(desc(schema.waiterSettlements.createdAt))
    .all()
    .map(row => ({
      id: row.id,
      shift_id: row.shiftId,
      user_id: row.userId,
      user_name: names.get(row.userId) ?? '—',
      declared_fen: row.declaredFen,
      expected_at_declare_fen: row.expectedAtDeclareFen,
      diff_fen: row.declaredFen - row.expectedAtDeclareFen,
      accepted_by: row.acceptedBy,
      accepted_by_name: row.acceptedBy ? names.get(row.acceptedBy) ?? null : null,
      accepted_at: row.acceptedAt,
      self_sealed: row.selfSealed === 1,
      late: row.late === 1,
      created_at: row.createdAt,
    }))
}

/**
 * `POST /api/shifts/:id/settle`.
 *
 * The receiver's PIN, when there is one, is verified **before** the transaction
 * opens: a wrong PIN must leave an `auth_attempts` row, and a row written inside
 * a transaction that then throws is rolled back with it (§2).
 */
export function settle(
  db: Db, venueId: string, actor: Actor, shiftId: string,
  body: {
    declared_fen: number, outbox_len: number,
    receiver_user_id?: string, receiver_pin?: string, override?: boolean,
  },
): SettleResult {
  const at = nowIso()
  const settings = getSettings(db, venueId)

  let receiver: { id: string, name: string } | null = null
  if (body.receiver_user_id) {
    if (body.receiver_user_id === actor.userId) {
      throw forbidden('OWN_SETTLEMENT', 'you cannot receive your own envelope')
    }
    const row = db.select({
      id: schema.users.id, name: schema.users.name, role: schema.users.role,
    })
      .from(schema.users)
      .where(and(
        eq(schema.users.venueId, venueId),
        eq(schema.users.id, body.receiver_user_id),
        eq(schema.users.active, 1),
      ))
      .get()
    if (!row) throw notFound('USER_NOT_FOUND', `user ${body.receiver_user_id} not found`)
    if (!settings.approver_roles.includes(row.role)) {
      throw forbidden('NOT_APPROVER', 'this role does not take an envelope')
    }
    if (body.receiver_pin) {
      // See `closeShift`: the ip is evidence on the attempt row, not part of the
      // PIN rule, and it is not on the `Actor`.
      verifyPinMetered(db, venueId, row.id, actor.deviceId, body.receiver_pin, {
        ip: '', kind: 'approve', now: at,
      })
    }
    receiver = { id: row.id, name: row.name }
  }

  return db.transaction((tx) => {
    const shift = requireShift(tx, venueId, shiftId)
    if (hasLiveSettlement(tx, venueId, shiftId, actor.userId)) {
      throw conflict('SETTLED', 'you have already settled this shift')
    }

    // The phone's own count first, because it is free and it is the common case:
    // a settle with rounds still queued would be a number that changes a minute
    // later.
    if (body.outbox_len !== 0) {
      throw new SankError(409, 'PENDING_OUTBOX', 'send the queued rounds first', {
        outbox_len: body.outbox_len,
      })
    }
    const staleDevices: StaleDevice[] = assertNoPendingOutbox(tx, venueId, shiftId, {
      actor, override: body.override, userId: actor.userId,
    })

    joinShift(tx, venueId, shiftId, actor.userId, actor.role, at)

    const breakdown = expectedCash(tx, venueId, shiftId, actor.userId, at).waiters[0]!
    const expected = breakdown.expected_fen
    const declared = body.declared_fen
    const diff = declared - expected
    const tolerance = toleranceFen(expected, settings)
    const ok = withinTolerance(diff, expected, settings)

    const summary: UserSummary = summarizeUser(tx, venueId, shiftId, actor.userId, at, {
      declaredFen: declared, expectedFen: expected,
    })

    const late = shift.status === 'closed' || shift.status === 'reviewed'
    const id = newId()
    tx.insert(schema.waiterSettlements).values({
      id,
      venueId,
      shiftId,
      userId: actor.userId,
      declaredFen: declared,
      expectedAtDeclareFen: expected,
      breakdownJson: JSON.stringify(breakdown),
      summaryJson: JSON.stringify(summary),
      acceptedBy: receiver?.id ?? null,
      acceptedAt: receiver ? at : null,
      // Nobody was there to take it: he sealed his own envelope, and the row
      // says so rather than pretending somebody signed for it.
      selfSealed: receiver ? 0 : 1,
      unsentReportedJson: JSON.stringify({
        outbox_len: body.outbox_len,
        devices: staleDevices.map(d => ({
          device_id: d.device_id, pending_count: d.pending_count,
        })),
      }),
      deviceId: actor.deviceId,
      late: late ? 1 : 0,
      createdAt: at,
    }).run()

    log(tx, venueId, {
      kind: 'waiter_finished',
      body: {
        settlement_id: id,
        shift_id: shiftId,
        user_id: actor.userId,
        from: summary.joined_at ?? shift.openedAt,
        to: at,
        promet_fen: summary.promet_fen,
        declared_fen: declared,
        within_tolerance: ok,
      },
      actorId: actor.userId,
      deviceId: actor.deviceId,
      ref: { type: 'waiter_settlement', id },
      shiftId,
    })

    if (receiver) {
      log(tx, venueId, {
        kind: 'settlement_accepted',
        body: {
          settlement_id: id, user_id: actor.userId,
          receiver_id: receiver.id, declared_fen: declared,
        },
        actorId: receiver.id,
        deviceId: actor.deviceId,
        ref: { type: 'waiter_settlement', id },
        shiftId,
      })
    }

    if (late) {
      log(tx, venueId, {
        kind: 'settlement_late',
        body: {
          settlement_id: id, shift_id: shiftId,
          user_id: actor.userId, declared_fen: declared,
        },
        actorId: actor.userId,
        deviceId: actor.deviceId,
        ref: { type: 'waiter_settlement', id },
        shiftId,
      })
      writeSummaryVersion(tx, venueId, shiftId, 'late', at)
    }

    bump(tx, venueId, 'shift', shiftId)

    return {
      settlement_id: id,
      summary,
      expected_fen: expected,
      declared_fen: declared,
      diff_fen: diff,
      within_tolerance: ok,
      tolerance_fen: tolerance,
      breakdown,
      self_sealed: !receiver,
      late,
      stale_devices: staleDevices,
    }
  })
}

/**
 * `POST /api/shifts/:id/settlements/:sid/accept` — somebody signs for the
 * envelope afterwards, when nobody was at the bar at the time.
 *
 * `self_sealed` stays 1 on the row: it records that at the moment of counting
 * there was no witness, and accepting later does not make that untrue.
 */
export function acceptSettlement(
  db: Db, venueId: string, actor: Actor, shiftId: string, settlementId: string,
): Settlement {
  const at = nowIso()

  return db.transaction((tx) => {
    const settings = getSettings(tx, venueId)
    requireApprover(settings, actor)

    const row = tx.select().from(schema.waiterSettlements)
      .where(and(
        eq(schema.waiterSettlements.venueId, venueId),
        eq(schema.waiterSettlements.shiftId, shiftId),
        eq(schema.waiterSettlements.id, settlementId),
      ))
      .get()
    if (!row) throw notFound('SETTLEMENT_NOT_FOUND', `settlement ${settlementId} not found`)
    if (row.userId === actor.userId) {
      throw forbidden('OWN_SETTLEMENT', 'you cannot accept your own envelope')
    }
    if (row.acceptedBy) throw conflict('ALREADY_ACCEPTED', 'that envelope is already signed for')

    tx.update(schema.waiterSettlements)
      .set({ acceptedBy: actor.userId, acceptedAt: at })
      .where(eq(schema.waiterSettlements.id, settlementId))
      .run()

    log(tx, venueId, {
      kind: 'settlement_accepted',
      body: {
        settlement_id: settlementId, user_id: row.userId,
        receiver_id: actor.userId, declared_fen: row.declaredFen,
      },
      actorId: actor.userId,
      deviceId: actor.deviceId,
      ref: { type: 'waiter_settlement', id: settlementId },
      shiftId,
    })
    bump(tx, venueId, 'shift', shiftId)

    const updated = listSettlements(tx, venueId, shiftId).find(s => s.id === settlementId)
    return updated!
  })
}

/** Envelopes counted but not signed for — somebody at the bar has to take them. */
export function pendingFor(q: Queryable, venueId: string, _now: string): AttentionItem[] {
  const names = userNames(q, venueId)
  return q.select().from(schema.waiterSettlements)
    .where(and(
      eq(schema.waiterSettlements.venueId, venueId),
      eq(schema.waiterSettlements.selfSealed, 1),
    ))
    .all()
    .filter(row => row.acceptedBy === null)
    .map(row => ({
      kind: 'settlement' as const,
      ref_type: 'waiter_settlement' as const,
      ref_id: row.id,
      title_bs: `Predaja čeka potvrdu · ${names.get(row.userId) ?? '—'}`,
      amount_fen: row.declaredFen,
      at: row.createdAt,
      actions: ['approve'] as ('approve' | 'reject' | 'note')[],
    }))
}
