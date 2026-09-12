/**
 * *Raspored* (PHASE4 §2.7, PLAN F14).
 *
 * Three things carry the design, and each is a rule somebody would otherwise
 * have to remember:
 *
 * **The staff projection is a different query, not a filter.** `getRoster` for a
 * non-admin selects published weeks only, never selects `note`, `updated_by` or
 * `swap_request_id`, and maps a **colleague's** `sick | absent | removed` row to
 * a hole before it becomes an `Assignment` at all. There is no code path in
 * which a waiter's response object held a colleague's sickness and then dropped
 * it — which is what PLAN §8's "Bolovanje vidi samo vlasnik" has to mean in
 * code rather than in a comment.
 *
 * **`start_time` and `end_time` are copied from the template at insert**, like a
 * price at lock. Editing *Večernja* tomorrow does not rewrite anybody's past
 * hours; the grid shows "16–01 (staro 15–00)" for the week that kept the old one.
 *
 * **The roster is the documented exception to append-only** (PLAN §6) — and the
 * history is not lost, it is in `log_entries`: every write below logs inside its
 * own transaction, with before and after.
 */
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { schema } from '../database/client'
import { newId, nowIso } from '../utils/ids'
import { conflict, forbidden, notFound, unprocessable } from '../utils/errors'
import {
  addDays, businessDate, cutoffIso, localTime, plannedHours, shortDateBs, weekdayBs, weekStart,
} from '#shared/dates'
import type {
  Assignment, AssignmentBody, AssignmentPatch, DecideSwapBody, HoursDay, HoursRow,
  LiveRostered, MyRoster, RosterDayView, RosterWeekView, ShiftTemplateBody,
  ShiftTemplatePatch, ShiftTemplateView, SwapBody, SwapRequestView,
} from '#shared/types'
import type { Actor, Db, Queryable, Tx } from './types'
import { bump } from './changes'
import { getSettings } from './contracts'
import { log } from './log'
import { postSystem } from './chat'

type AssignmentRow = typeof schema.rosterAssignments.$inferSelect
type SwapRow = typeof schema.swapRequests.$inferSelect
type TemplateRow = typeof schema.shiftTemplates.$inferSelect

/** *Dodijeli* stays open for a week after the shift — a cover confirmed late. */
const ASSIGN_GRACE_DAYS = 7

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** `GET /api/roster?from=&to=` — whole weeks, from the Monday of `from`. */
export function getRoster(
  q: Queryable, venueId: string, actor: Actor, from: string, to: string,
): RosterWeekView[] {
  const first = weekStart(from)
  const last = weekStart(to)
  const weeks: string[] = []
  for (let day = first; day <= last; day = addDays(day, 7)) weeks.push(day)
  return weeks.map(w => weekView(q, venueId, actor, w))
}

/** `GET /api/me/roster` — my two weeks, the offers awaiting me, my own requests. */
export function getMyRoster(q: Queryable, venueId: string, actor: Actor, now = nowIso()): MyRoster {
  const settings = getSettings(q, venueId)
  const today = businessDate(now, settings.timezone, settings.business_day_start_hour)
  const thisWeek = weekStart(today)

  return {
    this_week: weekView(q, venueId, actor, thisWeek),
    next_week: weekView(q, venueId, actor, addDays(thisWeek, 7)),
    offers: openOffers(q, venueId, actor, today),
    mine: mySwaps(q, venueId, actor),
  }
}

/** `GET /api/roster/swaps?status=` — the owner's *Zamjene* panel. */
export function listSwaps(
  q: Queryable, venueId: string, status?: string,
): SwapRequestView[] {
  const where = [eq(schema.swapRequests.venueId, venueId)]
  if (status) where.push(eq(schema.swapRequests.status, status as SwapRow['status']))

  return q.select().from(schema.swapRequests)
    .where(and(...where))
    .orderBy(desc(schema.swapRequests.createdAt))
    .all()
    .map(row => swapView(q, venueId, row, true))
}

export function listTemplates(q: Queryable, venueId: string, includeInactive = true): ShiftTemplateView[] {
  const where = [eq(schema.shiftTemplates.venueId, venueId)]
  if (!includeInactive) where.push(eq(schema.shiftTemplates.active, 1))

  return q.select().from(schema.shiftTemplates)
    .where(and(...where))
    .orderBy(asc(schema.shiftTemplates.sort), asc(schema.shiftTemplates.name))
    .all()
    .map(toTemplateView)
}

/**
 * Who the plan has on one day — the *Ko radi* card on *Puls*.
 *
 * **Not `weekView`.** That builds seven days, both projections, the swap chips
 * and every template's row, and *Puls* polls; this is one indexed read of one
 * date (`roster_assignments_date_idx`) on a screen that asks every fifteen
 * seconds.
 *
 * **Draft weeks count.** `weekView` hides an unpublished week from staff, and
 * this is an owner-only read on an owner-only route — the owner wrote the plan,
 * so hiding his own draft from him would only make the card lie on a Monday he
 * has not published yet.
 *
 * `swapped` and `removed` rows are dropped: each has been replaced by another
 * row on the same cell, and both being here would print the same shift twice.
 * `sick` and `absent` stay, because a hole in tonight's plan is the single most
 * useful thing this card can say.
 *
 * Ordered by the template's own `sort` and then the person's name, so the
 * morning comes before the evening and the rows do not move between polls.
 */
export function plannedOn(q: Queryable, venueId: string, date: string): LiveRostered[] {
  const rows = q.select({
    userId: schema.rosterAssignments.userId,
    templateId: schema.rosterAssignments.templateId,
    startTime: schema.rosterAssignments.startTime,
    endTime: schema.rosterAssignments.endTime,
    status: schema.rosterAssignments.status,
    name: schema.users.name,
    initials: schema.users.initials,
    templateName: schema.shiftTemplates.name,
    sort: schema.shiftTemplates.sort,
  })
    .from(schema.rosterAssignments)
    .innerJoin(schema.users, eq(schema.users.id, schema.rosterAssignments.userId))
    .innerJoin(
      schema.shiftTemplates,
      eq(schema.shiftTemplates.id, schema.rosterAssignments.templateId),
    )
    .where(and(
      eq(schema.rosterAssignments.venueId, venueId),
      eq(schema.rosterAssignments.workDate, date),
      inArray(schema.rosterAssignments.status, ['planned', 'sick', 'absent']),
    ))
    .orderBy(asc(schema.shiftTemplates.sort), asc(schema.users.name))
    .all()

  return rows.map(row => ({
    user_id: row.userId,
    name: row.name,
    initials: row.initials,
    template_id: row.templateId,
    template_name: row.templateName,
    start_time: row.startTime,
    end_time: row.endTime,
    status: row.status as LiveRostered['status'],
  }))
}

// ---------------------------------------------------------------------------
// The owner's week
// ---------------------------------------------------------------------------

/**
 * *Kopiraj prošlu sedmicu* — the regular people, not the one-off covers.
 *
 * `origin != 'swap'` is the whole rule: a colleague who took one Friday because
 * somebody was ill is not on next week's plan by accident.
 */
export function copyWeek(
  db: Db, venueId: string, actor: Actor, week: string, now = nowIso(),
): RosterWeekView {
  const target = weekStart(week)
  const source = addDays(target, -7)

  db.transaction((tx) => {
    ensureWeek(tx, venueId, actor, target, now)

    const existing = tx.select({ id: schema.rosterAssignments.id })
      .from(schema.rosterAssignments)
      .where(and(
        eq(schema.rosterAssignments.venueId, venueId),
        sql`${schema.rosterAssignments.workDate} >= ${target}`,
        sql`${schema.rosterAssignments.workDate} <= ${addDays(target, 6)}`,
      ))
      .get()
    if (existing) throw conflict('WEEK_NOT_EMPTY', `week ${target} already has rows`)

    const rows = tx.select().from(schema.rosterAssignments)
      .where(and(
        eq(schema.rosterAssignments.venueId, venueId),
        sql`${schema.rosterAssignments.workDate} >= ${source}`,
        sql`${schema.rosterAssignments.workDate} <= ${addDays(source, 6)}`,
        ne(schema.rosterAssignments.origin, 'swap'),
        ne(schema.rosterAssignments.status, 'removed'),
      ))
      .all()

    const active = new Set(
      tx.select({ id: schema.users.id }).from(schema.users)
        .where(and(eq(schema.users.venueId, venueId), eq(schema.users.active, 1)))
        .all().map(u => u.id),
    )

    let copied = 0
    for (const row of rows) {
      if (!active.has(row.userId)) continue
      const shifted = addDays(row.workDate, 7)
      tx.insert(schema.rosterAssignments).values({
        id: newId(),
        venueId,
        workDate: shifted,
        templateId: row.templateId,
        userId: row.userId,
        startTime: row.startTime,
        endTime: row.endTime,
        status: 'planned',
        origin: 'copy',
        createdBy: actor.userId,
        createdAt: now,
      }).run()
      copied++
    }

    log(tx, venueId, {
      kind: 'roster_changed',
      body: { week_start: target, what: 'kopirano', rows: copied },
      actorId: actor.userId,
      ref: { type: 'roster_week', id: target },
      at: now,
    })
    bump(tx, venueId, 'roster', target)
  })

  return weekView(db, venueId, actor, target)
}

/** *Objavi raspored* — and the one *Svi* line that tells the building. */
export function publishWeek(
  db: Db, venueId: string, actor: Actor, week: string, now = nowIso(),
): RosterWeekView {
  const target = weekStart(week)

  db.transaction((tx) => {
    const row = ensureWeek(tx, venueId, actor, target, now)
    if (row.publishedAt) throw conflict('ALREADY_PUBLISHED', `week ${target} is already published`)

    tx.update(schema.rosterWeeks)
      .set({ publishedAt: now, publishedBy: actor.userId })
      .where(eq(schema.rosterWeeks.id, row.id))
      .run()

    const span = `${shortDateBs(target)}–${shortDateBs(addDays(target, 6))}`
    postSystem(tx, venueId, 'svi', 'roster_published',
      `Raspored za ${span} je objavljen`,
      { link: { label: 'Raspored →', route: '/konobar/raspored' }, week_start: target }, now)

    log(tx, venueId, {
      kind: 'roster_published',
      body: { week_start: target },
      actorId: actor.userId,
      ref: { type: 'roster_week', id: target },
      at: now,
    })

    bump(tx, venueId, 'roster', target)
    bump(tx, venueId, 'chat')
  })

  return weekView(db, venueId, actor, target)
}

/** `POST /api/roster/assignments` — the avatar picker's two taps. */
export function addAssignment(
  db: Db, venueId: string, actor: Actor, body: AssignmentBody, now = nowIso(),
): Assignment {
  const id = db.transaction((tx) => {
    const settings = getSettings(tx, venueId)
    const today = businessDate(now, settings.timezone, settings.business_day_start_hour)
    if (body.work_date < today) {
      throw conflict('ROSTER_LOCKED', 'a past date cannot gain a shift')
    }

    const template = requireTemplate(tx, venueId, body.template_id)
    const user = tx.select().from(schema.users)
      .where(and(eq(schema.users.venueId, venueId), eq(schema.users.id, body.user_id)))
      .get()
    if (!user) throw notFound('USER_NOT_FOUND', `user ${body.user_id} not found`)
    if (!user.active) throw unprocessable('USER_NOT_ACTIVE', 'that person is deactivated')

    checkDayConstraints(tx, venueId, body.work_date, body.user_id, template, body.force_double === true)
    ensureWeek(tx, venueId, actor, weekStart(body.work_date), now)

    const rowId = newId()
    tx.insert(schema.rosterAssignments).values({
      id: rowId,
      venueId,
      workDate: body.work_date,
      templateId: template.id,
      userId: body.user_id,
      // Snapshotted, like a price at lock.
      startTime: template.startTime,
      endTime: template.endTime,
      status: 'planned',
      origin: 'owner',
      note: body.note ?? null,
      createdBy: actor.userId,
      createdAt: now,
    }).run()

    afterEdit(tx, venueId, actor, body.work_date, 'dodan', { user_id: body.user_id }, now)
    return rowId
  })

  return requireAssignmentView(db, venueId, actor, id)
}

/**
 * `PATCH /api/roster/assignments/:id` — status and note only.
 *
 * After the day, *Nije došao* (`planned → absent`) and back. A past-date patch
 * may never `removed`: an admin cannot retroactively take a person off the night
 * the stock went missing, and that is what `422 PAST_LOCKED` says.
 */
export function patchAssignment(
  db: Db, venueId: string, actor: Actor, id: string, body: AssignmentPatch, now = nowIso(),
): Assignment {
  db.transaction((tx) => {
    const row = requireAssignment(tx, venueId, id)
    const settings = getSettings(tx, venueId)
    const today = businessDate(now, settings.timezone, settings.business_day_start_hour)
    const past = row.workDate < today

    if (body.status !== undefined) {
      if (past && body.status === 'removed') {
        throw unprocessable('PAST_LOCKED', 'a past date cannot be un-staffed')
      }
      if (past && !['planned', 'absent', 'sick'].includes(body.status)) {
        throw unprocessable('PAST_LOCKED', 'a past date allows only planned, absent or sick')
      }

      // An owner editing a cell with a live request cancels it, and the
      // requester's card says so — no silent orphan.
      if (row.status !== body.status) cancelLiveRequest(tx, venueId, actor, row.id, 'vlasnik promijenio ćeliju', now)
    }

    tx.update(schema.rosterAssignments)
      .set({
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.note !== undefined ? { note: body.note } : {}),
        updatedBy: actor.userId,
        updatedAt: now,
      })
      .where(eq(schema.rosterAssignments.id, row.id))
      .run()

    if (body.status === 'absent') {
      log(tx, venueId, {
        kind: 'roster_absent',
        body: { assignment_id: row.id, user_id: row.userId, work_date: row.workDate },
        actorId: actor.userId,
        ref: { type: 'roster_assignment', id: row.id },
        at: now,
      })
      bump(tx, venueId, 'roster', row.id)
    } else {
      afterEdit(tx, venueId, actor, row.workDate, 'izmijenjen', {
        assignment_id: row.id, user_id: row.userId, status: body.status ?? null,
      }, now)
    }
  })

  return requireAssignmentView(db, venueId, actor, id)
}

/**
 * `DELETE /api/roster/assignments/:id` — a hard delete, and only while the week
 * is a draft. After publish a cell is `removed`, never gone: the phones have
 * already seen it.
 */
export function removeAssignment(
  db: Db, venueId: string, actor: Actor, id: string, now = nowIso(),
): void {
  db.transaction((tx) => {
    const row = requireAssignment(tx, venueId, id)
    const settings = getSettings(tx, venueId)
    const today = businessDate(now, settings.timezone, settings.business_day_start_hour)
    if (row.workDate < today) throw conflict('ROSTER_LOCKED', 'a past date cannot be edited')

    const week = tx.select().from(schema.rosterWeeks)
      .where(and(
        eq(schema.rosterWeeks.venueId, venueId),
        eq(schema.rosterWeeks.weekStart, weekStart(row.workDate)),
      ))
      .get()

    cancelLiveRequest(tx, venueId, actor, row.id, 'vlasnik promijenio ćeliju', now)

    if (week?.publishedAt) {
      tx.update(schema.rosterAssignments)
        .set({ status: 'removed', updatedBy: actor.userId, updatedAt: now })
        .where(eq(schema.rosterAssignments.id, row.id))
        .run()
    } else {
      // The trigger allows this; the *service* is where "only while unpublished"
      // lives, because a trigger cannot see the week.
      tx.delete(schema.rosterAssignments).where(eq(schema.rosterAssignments.id, row.id)).run()
    }

    afterEdit(tx, venueId, actor, row.workDate, 'uklonjen', {
      assignment_id: row.id, user_id: row.userId,
    }, now)
  })
}

// ---------------------------------------------------------------------------
// Swaps
// ---------------------------------------------------------------------------

/**
 * *Traži zamjenu*, on the requester's **own** row only.
 *
 * `reason='bolest'` sets the assignment `sick` in the same transaction — the one
 * way sickness enters the roster — and raises `roster_sick` for the owner. The
 * *Konobari* line is **identical for both reasons**, because a distinct key
 * would itself be the reason.
 */
export function requestSwap(
  db: Db, venueId: string, actor: Actor, body: SwapBody, now = nowIso(),
): SwapRequestView {
  const id = db.transaction((tx) => {
    const row = requireAssignment(tx, venueId, body.assignment_id)
    if (row.userId !== actor.userId && actor.role !== 'admin') {
      throw forbidden('NOT_YOUR_ROW', 'a swap is asked for on your own shift')
    }
    if (row.status !== 'planned' && row.status !== 'sick') {
      throw conflict('ALREADY_DECIDED', 'that shift is no longer yours to hand over')
    }

    const settings = getSettings(tx, venueId)
    const today = businessDate(now, settings.timezone, settings.business_day_start_hour)
    if (row.workDate < today) throw conflict('ROSTER_LOCKED', 'that shift is in the past')

    const live = tx.select({ id: schema.swapRequests.id }).from(schema.swapRequests)
      .where(and(
        eq(schema.swapRequests.venueId, venueId),
        eq(schema.swapRequests.assignmentId, row.id),
        eq(schema.swapRequests.status, 'pending'),
      ))
      .get()
    if (live) throw conflict('SWAP_EXISTS', 'that shift already has a live request')

    if (body.to_user_id === row.userId) {
      throw unprocessable('SAME_PERSON', 'you cannot hand a shift to yourself')
    }

    const requestId = newId()
    tx.insert(schema.swapRequests).values({
      id: requestId,
      venueId,
      assignmentId: row.id,
      fromUserId: row.userId,
      toUserId: body.to_user_id ?? null,
      reason: body.reason,
      note: body.note ?? null,
      status: 'pending',
      createdAt: now,
    }).run()

    if (body.reason === 'bolest') {
      tx.update(schema.rosterAssignments)
        .set({ status: 'sick', swapRequestId: requestId, updatedBy: actor.userId, updatedAt: now })
        .where(eq(schema.rosterAssignments.id, row.id))
        .run()
      // An attention row for the owner. The reason is on `/admin` *Zamjene* and in
      // *Dnevnik*, never in chat.
      log(tx, venueId, {
        kind: 'roster_sick',
        body: { assignment_id: row.id, user_id: row.userId, work_date: row.workDate },
        actorId: actor.userId,
        ref: { type: 'roster_assignment', id: row.id },
        at: now,
      })
    } else {
      tx.update(schema.rosterAssignments)
        .set({ swapRequestId: requestId, updatedBy: actor.userId, updatedAt: now })
        .where(eq(schema.rosterAssignments.id, row.id))
        .run()
    }

    const template = requireTemplate(tx, venueId, row.templateId)
    const who = nameOf(tx, row.userId)
    // Identical for `zamjena` and `bolest`. There is no word here that says why.
    postSystem(tx, venueId, 'konobari', 'swap_requested',
      `${who} traži zamjenu · ${weekdayBs(row.workDate)} ${shortDateBs(row.workDate)}`
      + ` ${template.name} ${hhmm(row.startTime)}–${hhmm(row.endTime)}`,
      { link: { label: 'Raspored →', route: '/konobar/raspored' }, swap_request_id: requestId }, now)

    log(tx, venueId, {
      kind: 'swap_requested',
      body: {
        swap_request_id: requestId, assignment_id: row.id, user_id: row.userId,
        to_user_id: body.to_user_id ?? null, reason: body.reason, work_date: row.workDate,
      },
      actorId: actor.userId,
      ref: { type: 'swap_request', id: requestId },
      at: now,
    })

    bump(tx, venueId, 'roster', row.id)
    bump(tx, venueId, 'chat')
    return requestId
  })

  return requireSwapView(db, venueId, actor, id)
}

/**
 * *Preuzimam* · *Odbij* · *Povuci* · *Dodijeli* — one transaction each.
 *
 * The accept is the one that matters: the giver's row → `swapped`, a new taker
 * row `planned / origin='swap'`, the request → `accepted`, the resolving log
 * entry, and one *Svi* line — **atomically**. A forced error mid-way leaves zero
 * rows and zero entries, which is what `db.transaction` is for.
 *
 * A `sick` giver row **stays `sick`**: *Sati* counts the sick day and the grid
 * keeps the struck-through chip.
 */
export function decideSwap(
  db: Db, venueId: string, actor: Actor, id: string,
  what: 'accept' | 'decline' | 'cancel' | 'assign',
  body: DecideSwapBody = {}, now = nowIso(),
): SwapRequestView {
  db.transaction((tx) => {
    const request = tx.select().from(schema.swapRequests)
      .where(and(eq(schema.swapRequests.venueId, venueId), eq(schema.swapRequests.id, id)))
      .get()
    if (!request) throw notFound('SWAP_NOT_FOUND', `swap request ${id} not found`)
    if (request.status !== 'pending') {
      throw conflict('ALREADY_DECIDED', `swap request ${id} is already ${request.status}`)
    }

    const giver = requireAssignment(tx, venueId, request.assignmentId)
    const settings = getSettings(tx, venueId)
    const today = businessDate(now, settings.timezone, settings.business_day_start_hour)

    if (what === 'cancel') {
      if (request.fromUserId !== actor.userId && actor.role !== 'admin') {
        throw forbidden('NOT_YOUR_SWAP', 'only the requester withdraws his own request')
      }
      closeRequest(tx, request.id, 'cancelled', actor.userId, now)
      // A withdrawn sickness returns the row to `planned`.
      tx.update(schema.rosterAssignments)
        .set({
          status: giver.status === 'sick' ? 'planned' : giver.status,
          swapRequestId: null,
          updatedBy: actor.userId,
          updatedAt: now,
        })
        .where(eq(schema.rosterAssignments.id, giver.id))
        .run()

      log(tx, venueId, {
        kind: 'swap_cancelled',
        body: { swap_request_id: request.id, assignment_id: giver.id, user_id: request.fromUserId },
        actorId: actor.userId,
        ref: { type: 'swap_request', id: request.id },
        at: now,
      })
      bump(tx, venueId, 'roster', giver.id)
      return
    }

    if (what === 'decline') {
      if (request.toUserId && request.toUserId !== actor.userId && actor.role !== 'admin') {
        throw forbidden('NOT_YOUR_SWAP', 'that offer was named at somebody else')
      }
      closeRequest(tx, request.id, 'declined', actor.userId, now)
      tx.update(schema.rosterAssignments)
        .set({ swapRequestId: null, updatedBy: actor.userId, updatedAt: now })
        .where(eq(schema.rosterAssignments.id, giver.id))
        .run()

      log(tx, venueId, {
        kind: 'swap_declined',
        body: { swap_request_id: request.id, assignment_id: giver.id, user_id: actor.userId },
        actorId: actor.userId,
        ref: { type: 'swap_request', id: request.id },
        at: now,
      })
      bump(tx, venueId, 'roster', giver.id)
      return
    }

    // -- accept and assign -------------------------------------------------
    const takerId = what === 'assign'
      ? (body.to_user_id ?? request.toUserId)
      : actor.userId
    if (!takerId) throw unprocessable('INVALID_TARGET', 'assign needs a taker')

    if (what === 'assign') {
      if (actor.role !== 'admin') throw forbidden('OWNER_REQUIRED', 'only an admin assigns a cover')
      // The owner's *Dodijeli* reaches a week back — "dodijeljeno naknadno".
      if (giver.workDate < addDays(today, -ASSIGN_GRACE_DAYS)) {
        throw conflict('ROSTER_LOCKED', 'that shift is more than a week old')
      }
    } else {
      // A named offer accepted by anybody else is not a race, it is the wrong
      // person taking somebody's shift.
      if (request.toUserId && request.toUserId !== actor.userId) {
        throw forbidden('NOT_YOUR_SWAP', 'that offer was named at somebody else')
      }
      // A same-day accept is always allowed, also after `start_time`: the point
      // of the feature is the evening it is needed.
      if (giver.workDate < today) throw conflict('ROSTER_LOCKED', 'that shift is in the past')
    }
    if (takerId === request.fromUserId) {
      throw unprocessable('SAME_PERSON', 'the giver cannot be the taker')
    }

    const template = requireTemplate(tx, venueId, giver.templateId)
    checkDayConstraints(tx, venueId, giver.workDate, takerId, template, body.force_double === true)

    tx.update(schema.rosterAssignments)
      .set({
        // A `sick` giver row stays `sick`; a `planned` one becomes `swapped`.
        status: giver.status === 'sick' ? 'sick' : 'swapped',
        updatedBy: actor.userId,
        updatedAt: now,
      })
      .where(eq(schema.rosterAssignments.id, giver.id))
      .run()

    const lateNote = what === 'assign' && giver.workDate < today
      ? 'dodijeljeno naknadno'
      : (giver.workDate === today && startedAlready(giver, now, settings.timezone)
          ? 'potvrđeno nakon početka'
          : null)

    const takerRowId = newId()
    tx.insert(schema.rosterAssignments).values({
      id: takerRowId,
      venueId,
      workDate: giver.workDate,
      templateId: giver.templateId,
      userId: takerId,
      startTime: giver.startTime,
      endTime: giver.endTime,
      status: 'planned',
      origin: 'swap',
      swapRequestId: request.id,
      note: lateNote,
      createdBy: actor.userId,
      createdAt: now,
    }).run()

    closeRequest(tx, request.id, 'accepted', takerId, now)

    const requestEntry = tx.select({ id: schema.logEntries.id }).from(schema.logEntries)
      .where(and(
        eq(schema.logEntries.venueId, venueId),
        eq(schema.logEntries.kind, 'swap_requested'),
        eq(schema.logEntries.refType, 'swap_request'),
        eq(schema.logEntries.refId, request.id),
      ))
      .get()

    log(tx, venueId, {
      kind: what === 'assign' ? 'swap_assigned' : 'swap_accepted',
      body: {
        swap_request_id: request.id,
        assignment_id: takerRowId,
        from_user_id: request.fromUserId,
        to_user_id: takerId,
        work_date: giver.workDate,
      },
      actorId: actor.userId,
      ref: { type: 'swap_request', id: request.id },
      resolvesId: requestEntry?.id ?? null,
      at: now,
    })

    /**
     * The *Svi* line, identical whether the reason was `zamjena` or `bolest`.
     * There is no separate key for a sickness cover, because a distinct key
     * would itself be the reason (PHASE4 §2.5).
     */
    postSystem(tx, venueId, 'svi', 'swap_accepted',
      `Zamjena · ${weekdayBs(giver.workDate)} ${shortDateBs(giver.workDate)} ${template.name}`
      + ` — ${nameOf(tx, takerId)} umjesto ${genitiveBs(nameOf(tx, request.fromUserId))}`,
      { link: { label: 'Raspored →', route: '/konobar/raspored' }, work_date: giver.workDate }, now)

    bump(tx, venueId, 'roster', giver.id)
    bump(tx, venueId, 'chat')
  })

  return requireSwapView(db, venueId, actor, id)
}

/**
 * The hook `services/admin.ts` calls when a person is deactivated: his future
 * `planned` rows become `removed` and his live requests are cancelled. A plan
 * that still names somebody who no longer works here is a plan nobody trusts.
 */
export function onUserDeactivated(
  tx: Tx, venueId: string, actor: Actor, userId: string, now = nowIso(),
): void {
  const settings = getSettings(tx, venueId)
  const today = businessDate(now, settings.timezone, settings.business_day_start_hour)

  const future = tx.select().from(schema.rosterAssignments)
    .where(and(
      eq(schema.rosterAssignments.venueId, venueId),
      eq(schema.rosterAssignments.userId, userId),
      eq(schema.rosterAssignments.status, 'planned'),
      sql`${schema.rosterAssignments.workDate} >= ${today}`,
    ))
    .all()

  for (const row of future) {
    cancelLiveRequest(tx, venueId, actor, row.id, 'deaktiviran', now)
    tx.update(schema.rosterAssignments)
      .set({ status: 'removed', note: 'deaktiviran', updatedBy: actor.userId, updatedAt: now })
      .where(eq(schema.rosterAssignments.id, row.id))
      .run()
  }

  const mine = tx.select().from(schema.swapRequests)
    .where(and(
      eq(schema.swapRequests.venueId, venueId),
      eq(schema.swapRequests.fromUserId, userId),
      eq(schema.swapRequests.status, 'pending'),
    ))
    .all()
  for (const request of mine) closeRequest(tx, request.id, 'cancelled', actor.userId, now)

  if (future.length > 0 || mine.length > 0) bump(tx, venueId, 'roster', userId)
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export function createTemplate(
  db: Db, venueId: string, actor: Actor, body: ShiftTemplateBody, now = nowIso(),
): ShiftTemplateView {
  const id = newId()
  db.transaction((tx) => {
    const clash = tx.select({ id: schema.shiftTemplates.id }).from(schema.shiftTemplates)
      .where(and(
        eq(schema.shiftTemplates.venueId, venueId),
        eq(schema.shiftTemplates.name, body.name),
      ))
      .get()
    if (clash) throw conflict('TEMPLATE_EXISTS', `a template named ${body.name} already exists`)

    tx.insert(schema.shiftTemplates).values({
      id,
      venueId,
      name: body.name,
      startTime: body.start_time,
      endTime: body.end_time,
      sort: body.sort ?? 0,
      active: 1,
      createdAt: now,
    }).run()

    log(tx, venueId, {
      kind: 'template_changed',
      body: { template_id: id, what: 'dodan', name: body.name },
      actorId: actor.userId,
      ref: { type: 'shift_template', id },
      at: now,
    })
    bump(tx, venueId, 'roster', id)
  })

  return toTemplateView(requireTemplate(db, venueId, id))
}

export function updateTemplate(
  db: Db, venueId: string, actor: Actor, id: string, patch: ShiftTemplatePatch, now = nowIso(),
): ShiftTemplateView {
  db.transaction((tx) => {
    const row = requireTemplate(tx, venueId, id)
    tx.update(schema.shiftTemplates)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.start_time !== undefined ? { startTime: patch.start_time } : {}),
        ...(patch.end_time !== undefined ? { endTime: patch.end_time } : {}),
        ...(patch.sort !== undefined ? { sort: patch.sort } : {}),
        ...(patch.active !== undefined ? { active: patch.active ? 1 : 0 } : {}),
      })
      .where(eq(schema.shiftTemplates.id, row.id))
      .run()

    log(tx, venueId, {
      kind: 'template_changed',
      body: { template_id: row.id, what: 'promijenjen', name: patch.name ?? row.name },
      actorId: actor.userId,
      ref: { type: 'shift_template', id: row.id },
      at: now,
    })
    bump(tx, venueId, 'roster', row.id)
  })

  return toTemplateView(requireTemplate(db, venueId, id))
}

// ---------------------------------------------------------------------------
// *Sati*
// ---------------------------------------------------------------------------

/**
 * `GET /api/roster/hours?month=` — planned against worked, per person.
 *
 * `shift_members` is aggregated **first**, by `(user_id, business_date)`, because
 * one date can carry two `shifts` rows after an early close and joining before
 * the group-by would count that night twice.
 *
 * Every member row with no assignment behind it becomes an `unplanned` day — the
 * person who *was* there and is not on the plan — and every `planned` row with
 * no member row carries `no_shift_row`. Both are printed on the page, and so is
 * the sentence that makes the whole table fair: **the first action is not the
 * arrival**. "prva tura 16:40 (+40 min)" is evidence for a conversation, never a
 * flag (PLAN §8).
 */
export function rosterHours(
  q: Queryable, venueId: string, month: string, userId?: string,
): HoursRow[] {
  const settings = getSettings(q, venueId)
  const from = `${month}-01`
  const to = lastDayOf(month)
  const grace = settings.roster_late_grace_min

  const assignments = q.select().from(schema.rosterAssignments)
    .where(and(
      eq(schema.rosterAssignments.venueId, venueId),
      sql`${schema.rosterAssignments.workDate} >= ${from}`,
      sql`${schema.rosterAssignments.workDate} <= ${to}`,
      ...(userId ? [eq(schema.rosterAssignments.userId, userId)] : []),
    ))
    .all()

  const worked = q.select({
    userId: schema.shiftMembers.userId,
    businessDate: schema.shifts.businessDate,
    joinedAt: sql<string>`min(${schema.shiftMembers.joinedAt})`,
    leftAt: sql<string | null>`max(${schema.shiftMembers.leftAt})`,
    auto: sql<number>`max(case when ${schema.shiftMembers.leftAtSource} = 'auto' then 1 else 0 end)`,
  })
    .from(schema.shiftMembers)
    .innerJoin(schema.shifts, eq(schema.shifts.id, schema.shiftMembers.shiftId))
    .where(and(
      eq(schema.shiftMembers.venueId, venueId),
      sql`${schema.shifts.businessDate} >= ${from}`,
      sql`${schema.shifts.businessDate} <= ${to}`,
      ...(userId ? [eq(schema.shiftMembers.userId, userId)] : []),
    ))
    .groupBy(schema.shiftMembers.userId, schema.shifts.businessDate)
    .all()

  const users = new Map(
    q.select({ id: schema.users.id, name: schema.users.name }).from(schema.users)
      .where(eq(schema.users.venueId, venueId)).all().map(u => [u.id, u.name] as const),
  )
  const templates = new Map(
    q.select().from(schema.shiftTemplates)
      .where(eq(schema.shiftTemplates.venueId, venueId)).all().map(t => [t.id, t] as const),
  )

  const byUser = new Map<string, HoursRow>()
  const row = (id: string): HoursRow => {
    let existing = byUser.get(id)
    if (!existing) {
      existing = {
        user_id: id,
        user_name: users.get(id) ?? 'Sistem',
        planned_shifts: 0, planned_h: 0, worked_h: 0, late_min: 0, early_leave_min: 0,
        sick_days: 0, absent_days: 0, swaps_given: 0, swaps_taken: 0,
        no_shift_rows: 0, unplanned_rows: 0, days: [],
      }
      byUser.set(id, existing)
    }
    return existing
  }

  const matched = new Set<string>()

  for (const a of assignments) {
    const target = row(a.userId)
    const key = `${a.userId}|${a.workDate}`
    const member = worked.find(w => w.userId === a.userId && w.businessDate === a.workDate)
    if (member) matched.add(key)

    if (a.status === 'swapped') { target.swaps_given++; continue }
    if (a.status === 'removed') continue
    if (a.origin === 'swap') target.swaps_taken++
    if (a.status === 'sick') { target.sick_days++; continue }
    if (a.status === 'absent') { target.absent_days++; continue }

    const planned = plannedHours(a.startTime, a.endTime)
    target.planned_shifts++
    target.planned_h = round2(target.planned_h + planned)

    const day = dayRow(a, planned, member, settings.timezone, grace, templates.get(a.templateId))
    target.days.push(day)
    target.worked_h = round2(target.worked_h + day.worked_h)
    target.late_min += day.late_min
    target.early_leave_min += day.early_leave_min
    if (day.no_shift_row) target.no_shift_rows++
  }

  // The person who was there and is not on the plan.
  for (const w of worked) {
    if (matched.has(`${w.userId}|${w.businessDate}`)) continue
    const target = row(w.userId)
    target.unplanned_rows++
    target.days.push({
      business_date: w.businessDate,
      template_name: null,
      start_time: null,
      end_time: null,
      status: 'unplanned',
      planned_h: 0,
      first_action: w.joinedAt,
      left_at: w.leftAt,
      left_auto: w.auto === 1,
      worked_h: workedHours(w.joinedAt, w.leftAt),
      late_min: 0,
      early_leave_min: 0,
      no_shift_row: false,
    })
    target.worked_h = round2(target.worked_h + workedHours(w.joinedAt, w.leftAt))
  }

  for (const r of byUser.values()) {
    r.days.sort((a, b) => (a.business_date < b.business_date ? -1 : 1))
  }
  return [...byUser.values()].sort((a, b) => a.user_name.localeCompare(b.user_name, 'bs'))
}

// ---------------------------------------------------------------------------
// The pieces
// ---------------------------------------------------------------------------

function dayRow(
  a: AssignmentRow, planned: number,
  member: { joinedAt: string, leftAt: string | null, auto: number } | undefined,
  tz: string, grace: number, template: TemplateRow | undefined,
): HoursDay {
  const first = member?.joinedAt ?? null
  const left = member?.leftAt ?? null

  const startMin = toMinutes(a.startTime)
  const endMin = toMinutes(a.endTime) <= startMin ? toMinutes(a.endTime) + 1440 : toMinutes(a.endTime)

  const firstMin = first ? wrapped(toMinutes(localTime(first, tz)), startMin) : null
  const leftMin = left ? wrapped(toMinutes(localTime(left, tz)), startMin) : null

  const lateRaw = firstMin === null ? 0 : Math.max(0, Math.round(firstMin - startMin))
  const earlyRaw = leftMin === null ? 0 : Math.max(0, Math.round(endMin - leftMin))

  return {
    business_date: a.workDate,
    template_name: template?.name ?? null,
    start_time: a.startTime,
    end_time: a.endTime,
    status: a.status,
    planned_h: planned,
    first_action: first,
    left_at: left,
    left_auto: member?.auto === 1,
    worked_h: workedHours(first, left),
    // Only above the grace, and the raw number when it is: the page prints
    // "prva tura 16:40 (+40 min)" and lets a person answer it.
    late_min: lateRaw > grace ? lateRaw : 0,
    early_leave_min: earlyRaw > grace ? earlyRaw : 0,
    no_shift_row: member === undefined,
  }
}

/** A wall clock reading that landed after midnight belongs to the shift before it. */
function wrapped(minutes: number, startMin: number): number {
  return minutes < startMin - 720 ? minutes + 1440 : minutes
}

function toMinutes(hhmmValue: string): number {
  const [h, m] = hhmmValue.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

function hhmm(value: string): string {
  return value.slice(0, 5)
}

function workedHours(from: string | null, to: string | null): number {
  if (!from || !to) return 0
  return round2(Math.max(0, (Date.parse(to) - Date.parse(from)) / 3_600_000))
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function lastDayOf(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y!, m!, 0))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function startedAlready(a: AssignmentRow, now: string, tz: string): boolean {
  return toMinutes(localTime(now, tz)) >= toMinutes(a.startTime)
}

/**
 * The three constraints, in one helper shared by `addAssignment` and the swap
 * taker — so a swap cannot create a shape the owner's grid refuses.
 */
function checkDayConstraints(
  tx: Tx, venueId: string, workDate: string, userId: string,
  template: TemplateRow, forceDouble: boolean,
): void {
  const sameDay = tx.select().from(schema.rosterAssignments)
    .where(and(
      eq(schema.rosterAssignments.venueId, venueId),
      eq(schema.rosterAssignments.workDate, workDate),
      eq(schema.rosterAssignments.userId, userId),
      inArray(schema.rosterAssignments.status, ['planned', 'sick', 'absent']),
    ))
    .all()

  for (const other of sameDay) {
    if (other.templateId === template.id) {
      // The partial unique index would refuse this anyway; saying so in Bosnian
      // beats a raw SQLITE_CONSTRAINT on the owner's laptop.
      throw conflict('DOUBLE_SHIFT', 'that person is already in this cell')
    }
    if (overlaps(other.startTime, other.endTime, template.startTime, template.endTime)) {
      // No override, ever: one person cannot be in two places at once.
      throw conflict('OVERLAP', 'that person already works an overlapping shift that day')
    }
  }

  if (sameDay.length > 0 && !forceDouble) {
    throw conflict('DOUBLE_SHIFT', 'a second shift on one day')
  }
}

/** Nominal wall-clock overlap, with `end <= start` meaning "ends next day". */
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const span = (s: string, e: string): [number, number] => {
    const from = toMinutes(s)
    const to = toMinutes(e)
    return [from, to <= from ? to + 1440 : to]
  }
  const [a1, a2] = span(aStart, aEnd)
  const [b1, b2] = span(bStart, bEnd)
  // Compare the second interval against the first and against its next-day copy,
  // so 23:00–07:00 and 06:00–14:00 still meet.
  return (a1 < b2 && b1 < a2)
    || (a1 + 1440 < b2 && b1 < a2 + 1440)
    || (a1 < b2 + 1440 && b1 + 1440 < a2)
}

function ensureWeek(
  tx: Tx, venueId: string, actor: Actor, week: string, now: string,
): typeof schema.rosterWeeks.$inferSelect {
  const existing = tx.select().from(schema.rosterWeeks)
    .where(and(eq(schema.rosterWeeks.venueId, venueId), eq(schema.rosterWeeks.weekStart, week)))
    .get()
  if (existing) return existing

  tx.insert(schema.rosterWeeks).values({
    id: newId(),
    venueId,
    weekStart: week,
    createdBy: actor.userId,
    createdAt: now,
  }).onConflictDoNothing().run()

  return tx.select().from(schema.rosterWeeks)
    .where(and(eq(schema.rosterWeeks.venueId, venueId), eq(schema.rosterWeeks.weekStart, week)))
    .get()!
}

/**
 * A quiet `roster_changed` per edit, and — after publish — **at most one *Svi*
 * line per owner per business day**.
 *
 * A Friday of six fixes is one line. Edits before publish post nothing at all:
 * a draft nobody has seen has nothing to announce.
 */
function afterEdit(
  tx: Tx, venueId: string, actor: Actor, workDate: string,
  what: string, body: Record<string, unknown>, now: string,
): void {
  log(tx, venueId, {
    kind: 'roster_changed',
    body: { work_date: workDate, what, ...body },
    actorId: actor.userId,
    ref: { type: 'roster_week', id: weekStart(workDate) },
    at: now,
  })

  const week = tx.select().from(schema.rosterWeeks)
    .where(and(
      eq(schema.rosterWeeks.venueId, venueId),
      eq(schema.rosterWeeks.weekStart, weekStart(workDate)),
    ))
    .get()

  if (week?.publishedAt) {
    const settings = getSettings(tx, venueId)
    const dayStart = cutoffIso(
      businessDate(now, settings.timezone, settings.business_day_start_hour),
      settings.timezone, settings.business_day_start_hour,
    )
    const already = tx.select({ id: schema.chatMessages.id }).from(schema.chatMessages)
      .where(and(
        eq(schema.chatMessages.venueId, venueId),
        eq(schema.chatMessages.systemKey, 'roster_changed'),
        sql`${schema.chatMessages.createdAt} >= ${dayStart}`,
        sql`json_extract(${schema.chatMessages.systemPayloadJson}, '$.by') = ${actor.userId}`,
      ))
      .get()

    if (!already) {
      postSystem(tx, venueId, 'svi', 'roster_changed', 'Raspored je izmijenjen',
        { link: { label: 'Raspored →', route: '/konobar/raspored' }, by: actor.userId }, now)
      bump(tx, venueId, 'chat')
    }
  }

  bump(tx, venueId, 'roster', workDate)
}

function cancelLiveRequest(
  tx: Tx, venueId: string, actor: Actor, assignmentId: string, note: string, now: string,
): void {
  const live = tx.select().from(schema.swapRequests)
    .where(and(
      eq(schema.swapRequests.venueId, venueId),
      eq(schema.swapRequests.assignmentId, assignmentId),
      eq(schema.swapRequests.status, 'pending'),
    ))
    .get()
  if (!live) return

  closeRequest(tx, live.id, 'cancelled', actor.userId, now)
  log(tx, venueId, {
    kind: 'swap_cancelled',
    body: { swap_request_id: live.id, assignment_id: assignmentId, user_id: live.fromUserId, note },
    actorId: actor.userId,
    ref: { type: 'swap_request', id: live.id },
    at: now,
  })
}

function closeRequest(
  tx: Tx, id: string, status: 'accepted' | 'declined' | 'cancelled', by: string, at: string,
): void {
  tx.update(schema.swapRequests)
    .set({ status, decidedBy: by, decidedAt: at })
    .where(eq(schema.swapRequests.id, id))
    .run()
}

function requireAssignment(q: Queryable, venueId: string, id: string): AssignmentRow {
  const row = q.select().from(schema.rosterAssignments)
    .where(and(eq(schema.rosterAssignments.venueId, venueId), eq(schema.rosterAssignments.id, id)))
    .get()
  if (!row) throw notFound('ASSIGNMENT_NOT_FOUND', `assignment ${id} not found`)
  return row
}

function requireTemplate(q: Queryable, venueId: string, id: string): TemplateRow {
  const row = q.select().from(schema.shiftTemplates)
    .where(and(eq(schema.shiftTemplates.venueId, venueId), eq(schema.shiftTemplates.id, id)))
    .get()
  if (!row) throw notFound('TEMPLATE_NOT_FOUND', `shift template ${id} not found`)
  return row
}

function toTemplateView(row: TemplateRow): ShiftTemplateView {
  return {
    id: row.id,
    name: row.name,
    start_time: row.startTime,
    end_time: row.endTime,
    sort: row.sort,
    active: row.active === 1,
  }
}

function nameOf(q: Queryable, userId: string): string {
  return q.select({ name: schema.users.name }).from(schema.users)
    .where(eq(schema.users.id, userId)).get()?.name ?? 'Sistem'
}

/**
 * "umjesto **Amara**", "umjesto **Dine**" — the genitive of a first name.
 *
 * Bosnian declines names and "Emir umjesto Amar" is not a sentence; PLAN §12
 * writes the line as "Amar umjesto Dine". One rule covers the names a café
 * roster holds: a name ending in *-a* or *-o* takes *-e* (Lejla → Lejle,
 * Dino → Dine), everything else takes *-a* (Amar → Amara, Emir → Emira,
 * Tarik → Tarika, Haris → Harisa).
 *
 * It is a rule and not a dictionary, so it will be wrong for a name it has
 * never met — the classical *Marko → Marka* declines the other way. When the
 * venue hires one, the fix is a small exception table here and one more line in
 * the roster test, not a grammar library: this string appears on exactly one
 * chat line, and a wrong ending there is a slightly odd sentence rather than a
 * bug in the roster. A name too short to decline is returned untouched.
 */
export function genitiveBs(name: string): string {
  if (name.length < 3) return name
  if (name.endsWith('a') || name.endsWith('o')) return `${name.slice(0, -1)}e`
  return `${name}a`
}

/**
 * One week, from the side of whoever asked.
 *
 * The two branches are two queries, not one query and a filter — see the header.
 */
function weekView(
  q: Queryable, venueId: string, actor: Actor, week: string,
): RosterWeekView {
  const isAdmin = actor.role === 'admin'
  const header = q.select().from(schema.rosterWeeks)
    .where(and(eq(schema.rosterWeeks.venueId, venueId), eq(schema.rosterWeeks.weekStart, week)))
    .get()

  const published = header?.publishedAt ?? null
  const templates = listTemplates(q, venueId, isAdmin)

  const days: RosterDayView[] = []
  for (let i = 0; i < 7; i++) days.push({ work_date: addDays(week, i), assignments: [] })

  // A draft week is the owner's alone: staff get the empty shape and S17 says
  // "Raspored za sljedeću sedmicu još nije objavljen."
  if (!isAdmin && !published) {
    return {
      week_start: week,
      published_at: null,
      published_by_name: null,
      days,
      templates,
    }
  }

  const rows = isAdmin ? adminRows(q, venueId, week) : staffRows(q, venueId, week)
  const names = new Map(
    q.select({ id: schema.users.id, name: schema.users.name, initials: schema.users.initials })
      .from(schema.users).where(eq(schema.users.venueId, venueId)).all()
      .map(u => [u.id, u] as const),
  )
  const templateNames = new Map(templates.map(t => [t.id, t.name] as const))
  const pending = livePendingIds(q, venueId)

  for (const row of rows) {
    const day = days.find(d => d.work_date === row.workDate)
    if (!day) continue
    const user = names.get(row.userId)

    const assignment: Assignment = {
      id: row.id,
      work_date: row.workDate,
      template_id: row.templateId,
      template_name: templateNames.get(row.templateId) ?? '—',
      start_time: row.startTime,
      end_time: row.endTime,
      user_id: row.userId,
      user_name: user?.name ?? 'Sistem',
      user_initials: user?.initials ?? '··',
      status: row.status,
      origin: row.origin,
      swap_pending: pending.has(row.id),
    }
    if (isAdmin) {
      assignment.note = row.note
      assignment.updated_by_name = row.updatedBy ? names.get(row.updatedBy)?.name ?? null : null
      assignment.updated_at = row.updatedAt
      assignment.swap_request_id = row.swapRequestId
    }
    day.assignments.push(assignment)
  }

  return {
    week_start: week,
    published_at: published,
    published_by_name: header?.publishedBy ? nameOf(q, header.publishedBy) : null,
    days,
    templates,
  }
}

function adminRows(q: Queryable, venueId: string, week: string): AssignmentRow[] {
  return q.select().from(schema.rosterAssignments)
    .where(and(
      eq(schema.rosterAssignments.venueId, venueId),
      sql`${schema.rosterAssignments.workDate} >= ${week}`,
      sql`${schema.rosterAssignments.workDate} <= ${addDays(week, 6)}`,
    ))
    .orderBy(asc(schema.rosterAssignments.workDate))
    .all()
}

/**
 * The staff query. A colleague's `sick | absent | removed` row is not selected
 * at all — the cell is simply empty, which is what a hole means — while the
 * reader's own rows keep their full status.
 */
function staffRows(q: Queryable, venueId: string, week: string): AssignmentRow[] {
  return q.select().from(schema.rosterAssignments)
    .where(and(
      eq(schema.rosterAssignments.venueId, venueId),
      sql`${schema.rosterAssignments.workDate} >= ${week}`,
      sql`${schema.rosterAssignments.workDate} <= ${addDays(week, 6)}`,
      ne(schema.rosterAssignments.status, 'removed'),
      ne(schema.rosterAssignments.status, 'swapped'),
    ))
    .orderBy(asc(schema.rosterAssignments.workDate))
    .all()
}

/**
 * The staff projection, applied to the rows the query did return: a colleague's
 * `sick` or `absent` becomes a hole; my own stays mine. Called by the route so
 * that `weekView` stays one function for both readers.
 */
export function projectForStaff(weeks: RosterWeekView[], userId: string): RosterWeekView[] {
  for (const week of weeks) {
    for (const day of week.days) {
      day.assignments = day.assignments.filter(a =>
        a.user_id === userId || (a.status !== 'sick' && a.status !== 'absent'))
    }
  }
  return weeks
}

function livePendingIds(q: Queryable, venueId: string): Set<string> {
  return new Set(
    q.select({ id: schema.swapRequests.assignmentId }).from(schema.swapRequests)
      .where(and(
        eq(schema.swapRequests.venueId, venueId),
        eq(schema.swapRequests.status, 'pending'),
      ))
      .all().map(r => r.id),
  )
}

function openOffers(
  q: Queryable, venueId: string, actor: Actor, today: string,
): SwapRequestView[] {
  return q.select().from(schema.swapRequests)
    .where(and(
      eq(schema.swapRequests.venueId, venueId),
      eq(schema.swapRequests.status, 'pending'),
      ne(schema.swapRequests.fromUserId, actor.userId),
    ))
    .all()
    .map(row => swapView(q, venueId, row, actor.role === 'admin'))
    .filter(view => view.work_date >= today)
    .filter(view => view.to_user_id === null || view.to_user_id === actor.userId)
}

function mySwaps(q: Queryable, venueId: string, actor: Actor): SwapRequestView[] {
  return q.select().from(schema.swapRequests)
    .where(and(
      eq(schema.swapRequests.venueId, venueId),
      eq(schema.swapRequests.fromUserId, actor.userId),
      eq(schema.swapRequests.status, 'pending'),
    ))
    .all()
    // His own request: he already knows the reason, he typed it.
    .map(row => swapView(q, venueId, row, true))
}

function swapView(
  q: Queryable, venueId: string, row: SwapRow, withReason: boolean,
): SwapRequestView {
  const assignment = q.select().from(schema.rosterAssignments)
    .where(eq(schema.rosterAssignments.id, row.assignmentId))
    .get()!
  const template = q.select().from(schema.shiftTemplates)
    .where(eq(schema.shiftTemplates.id, assignment.templateId))
    .get()

  const view: SwapRequestView = {
    id: row.id,
    assignment_id: row.assignmentId,
    work_date: assignment.workDate,
    template_name: template?.name ?? '—',
    start_time: assignment.startTime,
    end_time: assignment.endTime,
    from_user_id: row.fromUserId,
    from_user_name: nameOf(q, row.fromUserId),
    to_user_id: row.toUserId,
    to_user_name: row.toUserId ? nameOf(q, row.toUserId) : null,
    status: row.status,
    at: row.createdAt,
  }
  // *Zamjene* and the requester's own card are the only places the word "bolest"
  // appears outside *Dnevnik*.
  if (withReason) {
    view.reason = row.reason
    view.note = row.note
    view.decided_by_name = row.decidedBy ? nameOf(q, row.decidedBy) : null
    view.decided_at = row.decidedAt
  }
  return view
}

function requireAssignmentView(
  q: Queryable, venueId: string, actor: Actor, id: string,
): Assignment {
  const row = requireAssignment(q, venueId, id)
  const week = weekView(q, venueId, actor, weekStart(row.workDate))
  const found = week.days.flatMap(d => d.assignments).find(a => a.id === id)
  if (!found) throw notFound('ASSIGNMENT_NOT_FOUND', `assignment ${id} not visible`)
  return found
}

function requireSwapView(
  q: Queryable, venueId: string, actor: Actor, id: string,
): SwapRequestView {
  const row = q.select().from(schema.swapRequests)
    .where(and(eq(schema.swapRequests.venueId, venueId), eq(schema.swapRequests.id, id)))
    .get()
  if (!row) throw notFound('SWAP_NOT_FOUND', `swap request ${id} not found`)
  return swapView(q, venueId, row, actor.role === 'admin' || row.fromUserId === actor.userId)
}

/**
 * The hourly check behind `swap_unfilled` — a *Traži zamjenu* nobody has taken
 * and the shift has arrived. Called by `server/tasks/nightly.ts`; the alert
 * dedupes on the request, so it fires once however many hours it runs.
 */
export function unfilledSwaps(q: Queryable, venueId: string, today: string): SwapRow[] {
  return q.select().from(schema.swapRequests)
    .innerJoin(
      schema.rosterAssignments,
      eq(schema.rosterAssignments.id, schema.swapRequests.assignmentId),
    )
    .where(and(
      eq(schema.swapRequests.venueId, venueId),
      eq(schema.swapRequests.status, 'pending'),
      sql`${schema.rosterAssignments.workDate} <= ${today}`,
    ))
    .all()
    .map(r => r.swap_requests)
}
