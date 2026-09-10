/**
 * *Raspored* (PHASE4 §2.7) — the constraints, the swap, and the two rules that
 * make the whole feature fair.
 *
 * The two are worth naming, because everything else is bookkeeping around them:
 *
 *   **A colleague's sickness is a hole.** A waiter's response object never held
 *   it — the staff read is a different query. If that ever becomes a filter, the
 *   `sick`/`absent` cases below fail.
 *
 *   **"Prva akcija nije dolazak."** `late_min` is evidence for a conversation
 *   and never a flag, so the number is the raw minutes and the grace only
 *   decides whether it is printed at all (PLAN §8).
 */
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFixture, schema, type Fixture } from '../helpers/db'
import { expectCode } from '../helpers/phase4'
import { addDays, businessDate, plannedHours, weekStart } from '#shared/dates'
import {
  addAssignment, copyWeek, decideSwap, getMyRoster, getRoster, listSwaps,
  genitiveBs, overlaps, patchAssignment, projectForStaff, publishWeek, removeAssignment,
  requestSwap, rosterHours, updateTemplate,
} from '../../server/services/roster'
import { updateUser } from '../../server/services/admin'
import { ROUTE_ROLES } from '#shared/routeRoles'

let f: Fixture

beforeEach(() => { f = makeFixture() })
afterEach(() => { f.close() })

const today = () => businessDate(f.clock.now())
/**
 * Next week's Monday. Every date inside it is in the future, which is what
 * `ROSTER_LOCKED` requires — *this* week's Monday is usually already behind us.
 */
const futureWeek = () => weekStart(addDays(today(), 7))

/**
 * A row dated in the past, written straight through SQL.
 *
 * There is no service call that can produce one: `addAssignment` refuses a past
 * date and `roster_assignments_frozen_cols` refuses moving `work_date`
 * afterwards — which is the pair of rules under test, so the fixture has to go
 * around both rather than through either.
 */
function planPast(name: string, date: string, templateName = 'Večernja'): string {
  const t = template(templateName)
  const id = crypto.randomUUID()
  f.sqlite.exec(
    `INSERT INTO roster_assignments (id, venue_id, work_date, template_id, user_id,`
    + ` start_time, end_time, status, origin, created_by, created_at)`
    + ` VALUES ('${id}', '${f.venueId}', '${date}', '${t.id}', '${f.userId(name)}',`
    + ` '${t.startTime}', '${t.endTime}', 'planned', 'owner', '${f.userId('Haris')}',`
    + ` '${f.clock.now()}')`,
  )
  return id
}
const template = (name: string) =>
  f.db.select().from(schema.shiftTemplates).all().find(t => t.name === name)!

function plan(name: string, opts: { date?: string, template?: string, force?: boolean } = {}) {
  return addAssignment(f.db, f.venueId, f.adminActor(), {
    work_date: opts.date ?? today(),
    template_id: template(opts.template ?? 'Večernja').id,
    user_id: f.userId(name),
    ...(opts.force ? { force_double: true } : {}),
  }, f.clock.now())
}

const rowOf = (id: string) =>
  f.db.select().from(schema.rosterAssignments)
    .where(eq(schema.rosterAssignments.id, id)).get()!

// ---------------------------------------------------------------------------
// The cell constraints
// ---------------------------------------------------------------------------

describe('the same person twice in one cell', () => {
  it('is refused — DOUBLE_SHIFT on the same template, not a second row', () => {
    plan('Amar')
    expectCode(() => plan('Amar'), 'DOUBLE_SHIFT')
    expect(f.db.select().from(schema.rosterAssignments).all()).toHaveLength(1)
  })

  it('is also refused by the database, whatever the service does', () => {
    const first = plan('Amar')
    const row = rowOf(first.id)
    f.expectRefused(
      `INSERT INTO roster_assignments (id, venue_id, work_date, template_id, user_id,`
      + ` start_time, end_time, status, origin, created_by, created_at)`
      + ` VALUES ('dup', '${f.venueId}', '${row.workDate}', '${row.templateId}', '${row.userId}',`
      + ` '16:00', '01:00', 'planned', 'owner', '${row.createdBy}', '${row.createdAt}')`,
      /UNIQUE constraint failed/,
    )
  })
})

describe('overlapping and double shifts', () => {
  it('knows a wrap-around shift overlaps the morning after', () => {
    expect(overlaps('16:00', '01:00', '08:00', '16:00')).toBe(false)
    expect(overlaps('22:00', '06:00', '05:00', '13:00')).toBe(true)
    expect(overlaps('08:00', '16:00', '15:00', '23:00')).toBe(true)
  })

  it('refuses two overlapping templates on one date, with no override', () => {
    updateTemplate(f.db, f.venueId, f.adminActor(), template('Dnevna').id, {
      start_time: '15:00', end_time: '23:00',
    }, f.clock.now())

    plan('Amar', { template: 'Večernja' })
    expectCode(() => plan('Amar', { template: 'Dnevna' }), 'OVERLAP')
    // …and `force_double` does not help: one person cannot be in two places.
    expectCode(() => plan('Amar', { template: 'Dnevna', force: true }), 'OVERLAP')
  })

  it('asks once about a non-overlapping second shift and takes the retry', () => {
    plan('Amar', { template: 'Dnevna' })
    expectCode(() => plan('Amar', { template: 'Večernja' }), 'DOUBLE_SHIFT')

    const forced = plan('Amar', { template: 'Večernja', force: true })
    expect(forced.status).toBe('planned')
    expect(f.db.select().from(schema.rosterAssignments).all()).toHaveLength(2)
  })
})

describe('past dates', () => {
  it('refuses a create and a delete on yesterday', () => {
    const yesterday = addDays(today(), -1)
    expectCode(() => plan('Amar', { date: yesterday }), 'ROSTER_LOCKED')

    const id = planPast('Amar', yesterday)
    expectCode(() => removeAssignment(f.db, f.venueId, f.adminActor(), id, f.clock.now()),
      'ROSTER_LOCKED')
  })

  it('allows Nije došao on yesterday and refuses removed — 422 PAST_LOCKED', () => {
    const yesterday = addDays(today(), -1)
    const row = { id: planPast('Amar', yesterday) }

    const absent = patchAssignment(f.db, f.venueId, f.adminActor(), row.id, {
      status: 'absent',
    }, f.clock.now())
    expect(absent.status).toBe('absent')
    expect(f.db.select().from(schema.logEntries).all().some(e => e.kind === 'roster_absent')).toBe(true)

    // …and back again, because a mistake is a mistake.
    expect(patchAssignment(f.db, f.venueId, f.adminActor(), row.id, {
      status: 'planned',
    }, f.clock.now()).status).toBe('planned')

    expectCode(() => patchAssignment(f.db, f.venueId, f.adminActor(), row.id, {
      status: 'removed',
    }, f.clock.now()), 'PAST_LOCKED')
  })
})

// ---------------------------------------------------------------------------
// Copy, publish and the system line
// ---------------------------------------------------------------------------

describe('copyWeek and publishWeek', () => {
  it('copies the regular people and not the one-off covers', () => {
    const thisWeek = futureWeek()
    plan('Amar', { date: thisWeek })
    plan('Lejla', { date: thisWeek })
    // A swap cover: `origin='swap'` is exactly what must not be copied.
    f.sqlite.exec(
      `UPDATE roster_assignments SET origin = 'swap' WHERE user_id = '${f.userId('Lejla')}'`,
    )

    copyWeek(f.db, f.venueId, f.adminActor(), addDays(thisWeek, 7), f.clock.now())
    const next = f.db.select().from(schema.rosterAssignments).all()
      .filter(a => a.workDate >= addDays(thisWeek, 7))
    expect(next.map(a => a.userId)).toEqual([f.userId('Amar')])
    expect(next[0]!.origin).toBe('copy')
  })

  it('refuses a copy into a week that already has rows', () => {
    const next = addDays(futureWeek(), 7)
    plan('Amar', { date: next })
    expectCode(() => copyWeek(f.db, f.venueId, f.adminActor(), next, f.clock.now()),
      'WEEK_NOT_EMPTY')
  })

  it('publishes once, posts one Svi line, and refuses a second publish', () => {
    const week = futureWeek()
    plan('Amar', { date: week })
    publishWeek(f.db, f.venueId, f.adminActor(), week, f.clock.now())

    const lines = f.db.select().from(schema.chatMessages).all()
      .filter(m => m.systemKey === 'roster_published')
    expect(lines).toHaveLength(1)
    expect(lines[0]!.body).toMatch(/Raspored za \d{2}\.\d{2}\.–\d{2}\.\d{2}\. je objavljen/)

    expectCode(() => publishWeek(f.db, f.venueId, f.adminActor(), week, f.clock.now()),
      'ALREADY_PUBLISHED')
  })

  it('posts nothing before publish, and at most one line per owner per day after', () => {
    const week = futureWeek()
    plan('Amar', { date: week })
    // Before publish: a draft nobody has seen has nothing to announce.
    expect(f.db.select().from(schema.chatMessages).all()
      .filter(m => m.systemKey === 'roster_changed')).toHaveLength(0)

    publishWeek(f.db, f.venueId, f.adminActor(), week, f.clock.now())
    const quietBefore = f.db.select().from(schema.logEntries).all()
      .filter(e => e.kind === 'roster_changed').length

    const names = ['Lejla', 'Dino', 'Tarik', 'Emir']
    for (const name of names) plan(name, { date: week })
    plan('Amar', { date: week, template: 'Dnevna', force: true })
    plan('Lejla', { date: week, template: 'Dnevna', force: true })

    // Six edits after publish, six quiet entries — the Dnevnik keeps every one.
    const quiet = f.db.select().from(schema.logEntries).all()
      .filter(e => e.kind === 'roster_changed')
    expect(quiet.length - quietBefore).toBe(6)

    const chatLines = f.db.select().from(schema.chatMessages).all()
      .filter(m => m.systemKey === 'roster_changed')
    // A Friday of six fixes is one line.
    expect(chatLines).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Swaps
// ---------------------------------------------------------------------------

describe('requestSwap and decideSwap', () => {
  it('moves the giver to swapped and the taker in, in one transaction', () => {
    const giver = plan('Amar')
    const request = requestSwap(f.db, f.venueId, f.actor('Amar'), {
      assignment_id: giver.id, reason: 'zamjena',
    }, f.clock.now())

    decideSwap(f.db, f.venueId, f.actor('Lejla'), request.id, 'accept', {}, f.clock.now())

    expect(rowOf(giver.id).status).toBe('swapped')
    const taker = f.db.select().from(schema.rosterAssignments).all()
      .find(a => a.userId === f.userId('Lejla'))!
    expect([taker.status, taker.origin, taker.swapRequestId])
      .toEqual(['planned', 'swap', request.id])

    const decided = f.db.select().from(schema.swapRequests).all()[0]!
    expect([decided.status, decided.decidedBy]).toEqual(['accepted', f.userId('Lejla')])
  })

  it('leaves zero rows and zero entries when the transaction fails half-way', () => {
    const giver = plan('Amar')
    const request = requestSwap(f.db, f.venueId, f.actor('Amar'), {
      assignment_id: giver.id, reason: 'zamjena',
    }, f.clock.now())

    const before = {
      assignments: f.db.select().from(schema.rosterAssignments).all().length,
      entries: f.db.select().from(schema.logEntries).all().length,
    }

    // Lejla already works an overlapping shift, so the taker's own constraint
    // check throws **inside** the accept transaction, after the giver's row has
    // been touched. Nothing may survive that.
    updateTemplate(f.db, f.venueId, f.adminActor(), template('Dnevna').id, {
      start_time: '15:00', end_time: '23:00',
    }, f.clock.now())
    addAssignment(f.db, f.venueId, f.adminActor(), {
      work_date: today(), template_id: template('Dnevna').id, user_id: f.userId('Lejla'),
    }, f.clock.now())

    const entriesAfterSetup = f.db.select().from(schema.logEntries).all().length
    expectCode(
      () => decideSwap(f.db, f.venueId, f.actor('Lejla'), request.id, 'accept', {}, f.clock.now()),
      'OVERLAP',
    )

    expect(rowOf(giver.id).status).toBe('planned')
    expect(f.db.select().from(schema.swapRequests).all()[0]!.status).toBe('pending')
    expect(f.db.select().from(schema.rosterAssignments).all().length)
      .toBe(before.assignments + 1) // Lejla's own setup row, and nothing else
    expect(f.db.select().from(schema.logEntries).all().length).toBe(entriesAfterSetup)
  })

  it('refuses a second accept and a stranger taking a named offer', () => {
    const giver = plan('Amar')
    const named = requestSwap(f.db, f.venueId, f.actor('Amar'), {
      assignment_id: giver.id, to_user_id: f.userId('Lejla'), reason: 'zamjena',
    }, f.clock.now())

    expectCode(
      () => decideSwap(f.db, f.venueId, f.actor('Dino'), named.id, 'accept', {}, f.clock.now()),
      'NOT_YOUR_SWAP',
    )

    decideSwap(f.db, f.venueId, f.actor('Lejla'), named.id, 'accept', {}, f.clock.now())
    expectCode(
      () => decideSwap(f.db, f.venueId, f.actor('Dino'), named.id, 'accept', {}, f.clock.now()),
      'ALREADY_DECIDED',
    )
  })

  it('refuses one live request per shift', () => {
    const giver = plan('Amar')
    requestSwap(f.db, f.venueId, f.actor('Amar'), {
      assignment_id: giver.id, reason: 'zamjena',
    }, f.clock.now())
    expectCode(() => requestSwap(f.db, f.venueId, f.actor('Amar'), {
      assignment_id: giver.id, reason: 'zamjena',
    }, f.clock.now()), 'SWAP_EXISTS')
  })

  it('refuses a staff accept on a past shift and lets the owner assign one afterwards', () => {
    const yesterday = addDays(today(), -1)
    const giver = { id: planPast('Amar', yesterday) }
    const request = requestSwapPast(giver.id, 'Amar')

    expectCode(
      () => decideSwap(f.db, f.venueId, f.actor('Lejla'), request.id, 'accept', {}, f.clock.now()),
      'ROSTER_LOCKED',
    )

    // The owner's *Dodijeli* reaches a week back — "dodijeljeno naknadno".
    decideSwap(f.db, f.venueId, f.adminActor(), request.id, 'assign', {
      to_user_id: f.userId('Dino'),
    }, f.clock.now())
    const cover = f.db.select().from(schema.rosterAssignments).all()
      .find(a => a.userId === f.userId('Dino'))!
    expect(cover.note).toBe('dodijeljeno naknadno')
  })

  /**
   * A live request on a past row, written straight through SQL for the same
   * reason `planPast` exists: `requestSwap` refuses a past shift, and the rule
   * under test is what happens to a request that was made *before* the day
   * arrived.
   */
  function requestSwapPast(assignmentId: string, from: string): { id: string } {
    const id = crypto.randomUUID()
    f.sqlite.exec(
      `INSERT INTO swap_requests (id, venue_id, assignment_id, from_user_id, reason,`
      + ` status, created_at) VALUES ('${id}', '${f.venueId}', '${assignmentId}',`
      + ` '${f.userId(from)}', 'zamjena', 'pending', '${f.clock.now()}')`,
    )
    return { id }
  }

  it('cancels the live request when the owner edits the cell', () => {
    const giver = plan('Amar')
    const request = requestSwap(f.db, f.venueId, f.actor('Amar'), {
      assignment_id: giver.id, reason: 'zamjena',
    }, f.clock.now())

    patchAssignment(f.db, f.venueId, f.adminActor(), giver.id, { status: 'removed' }, f.clock.now())

    const after = f.db.select().from(schema.swapRequests).all()[0]!
    expect(after.status).toBe('cancelled')
    const entry = f.db.select().from(schema.logEntries).all()
      .find(e => e.kind === 'swap_cancelled')!
    expect(JSON.parse(entry.bodyJson).note).toBe('vlasnik promijenio ćeliju')
  })
})

/**
 * *Bolovanje*. The word appears on `/admin` *Zamjene* and in *Dnevnik*, and
 * **nowhere else** — the *Svi* line an accepted sick-cover posts is byte for byte
 * the line a plain `zamjena` posts, because a distinct wording would itself be
 * the reason (PLAN §8, PHASE4 §2.5).
 */
describe('bolest', () => {
  function sick() {
    const giver = plan('Amar')
    const request = requestSwap(f.db, f.venueId, f.actor('Amar'), {
      assignment_id: giver.id, reason: 'bolest', note: 'temperatura',
    }, f.clock.now())
    return { giver, request }
  }

  it('marks the row sick in the same transaction and raises the owner\'s alert', () => {
    const { giver } = sick()
    expect(rowOf(giver.id).status).toBe('sick')
    expect(f.db.select().from(schema.alertEvents).all().map(a => a.ruleKey))
      .toContain('roster_sick')
  })

  it('leaves the giver sick after an accept, so Sati still counts the day', () => {
    const { giver, request } = sick()
    decideSwap(f.db, f.venueId, f.actor('Lejla'), request.id, 'accept', {}, f.clock.now())
    expect(rowOf(giver.id).status).toBe('sick')
  })

  it('returns the row to planned when the request is withdrawn', () => {
    const { giver, request } = sick()
    decideSwap(f.db, f.venueId, f.actor('Amar'), request.id, 'cancel', {}, f.clock.now())
    expect(rowOf(giver.id).status).toBe('planned')
  })

  it('declines the giver\'s name, because "umjesto Amar" is not a sentence', () => {
    expect(genitiveBs('Amar')).toBe('Amara')
    expect(genitiveBs('Dino')).toBe('Dine')
    expect(genitiveBs('Lejla')).toBe('Lejle')
    expect(genitiveBs('Emir')).toBe('Emira')
    expect(genitiveBs('Tarik')).toBe('Tarika')
    expect(genitiveBs('Haris')).toBe('Harisa')

    const { request } = sick()
    decideSwap(f.db, f.venueId, f.actor('Lejla'), request.id, 'accept', {}, f.clock.now())
    const line = f.db.select().from(schema.chatMessages).all()
      .find(m => m.systemKey === 'swap_accepted')!
    expect(line.body).toContain('Lejla umjesto Amara')
  })

  it('says neither "bolest" nor "bolovanje" in the resulting Svi line', () => {
    const { request } = sick()
    decideSwap(f.db, f.venueId, f.actor('Lejla'), request.id, 'accept', {}, f.clock.now())

    const lines = f.db.select().from(schema.chatMessages).all()
      .filter(m => m.systemKey === 'swap_requested' || m.systemKey === 'swap_accepted')
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      const text = `${line.body ?? ''} ${line.systemPayloadJson ?? ''}`.toLowerCase()
      expect(text).not.toContain('bolest')
      expect(text).not.toContain('bolovanje')
      expect(text).not.toContain('temperatura')
    }
  })
})

// ---------------------------------------------------------------------------
// The staff projection
// ---------------------------------------------------------------------------

describe('what a waiter is allowed to see', () => {
  it('shows a colleague\'s sick day as a hole and keeps his own', () => {
    const week = futureWeek()
    const lejla = plan('Lejla', { date: week })
    const amar = plan('Amar', { date: week, template: 'Dnevna' })
    publishWeek(f.db, f.venueId, f.adminActor(), week, f.clock.now())

    patchAssignment(f.db, f.venueId, f.adminActor(), lejla.id, { status: 'sick' }, f.clock.now())
    patchAssignment(f.db, f.venueId, f.adminActor(), amar.id, { status: 'sick' }, f.clock.now())

    const forAmar = projectForStaff(
      getRoster(f.db, f.venueId, f.actor('Amar'), week, week), f.userId('Amar'),
    )
    const cells = forAmar[0]!.days.flatMap(d => d.assignments)
    expect(cells.map(c => c.user_name)).toEqual(['Amar'])
    expect(cells[0]!.status).toBe('sick')
    // The owner-only fields are not there to be dropped later: they were never
    // selected.
    expect(cells[0]!.note).toBeUndefined()
    expect(cells[0]!.swap_request_id).toBeUndefined()
  })

  it('shows an unpublished next week as empty', () => {
    const next = addDays(futureWeek(), 7)
    plan('Amar', { date: next })

    const mine = getMyRoster(f.db, f.venueId, f.actor('Amar'), f.clock.now())
    expect(mine.next_week.published_at).toBeNull()
    expect(mine.next_week.days.flatMap(d => d.assignments)).toEqual([])

    // The owner sees his draft, which is the point of a draft.
    const owner = getRoster(f.db, f.venueId, f.adminActor(), next, next)
    expect(owner[0]!.days.flatMap(d => d.assignments)).toHaveLength(1)
  })

  it('gives the owner the reason and a colleague nothing but the shift', () => {
    const giver = plan('Amar')
    requestSwap(f.db, f.venueId, f.actor('Amar'), {
      assignment_id: giver.id, reason: 'bolest', note: 'temperatura',
    }, f.clock.now())

    const forOwner = listSwaps(f.db, f.venueId)
    expect(forOwner[0]!.reason).toBe('bolest')
    expect(forOwner[0]!.note).toBe('temperatura')

    const forLejla = getMyRoster(f.db, f.venueId, f.actor('Lejla'), f.clock.now())
    expect(forLejla.offers).toHaveLength(1)
    expect(forLejla.offers[0]!.reason).toBeUndefined()
    expect(forLejla.offers[0]!.note).toBeUndefined()
  })

  /**
   * "Staff never PATCH a status" is enforced by the **coarse** gate: the three
   * assignment routes are `['admin']` in `ROUTE_ROLES`, so `tenant.ts` 403s a
   * waiter before any handler runs. Asserting that here rather than inside the
   * service is not a shortcut — it is where the rule actually lives.
   *
   * What *is* open to a waiter is `POST /api/roster/swaps`, and that door has
   * its own lock: his own row only.
   */
  it('leaves the roster writes to the owner, and a swap to its own row', () => {
    for (const key of [
      'POST /api/roster/assignments',
      'PATCH /api/roster/assignments/:id',
      'DELETE /api/roster/assignments/:id',
    ]) {
      expect([key, ROUTE_ROLES[key]]).toEqual([key, ['admin']])
    }
    expect(ROUTE_ROLES['POST /api/roster/swaps']).toEqual(['admin', 'waiter', 'bartender'])

    const lejla = plan('Lejla')
    expectCode(() => requestSwap(f.db, f.venueId, f.actor('Amar'), {
      assignment_id: lejla.id, reason: 'zamjena',
    }, f.clock.now()), 'NOT_YOUR_ROW')
  })
})

describe('deactivating a person', () => {
  it('removes his future shifts and cancels his live requests', () => {
    const row = plan('Dino')
    requestSwap(f.db, f.venueId, f.actor('Dino'), {
      assignment_id: row.id, reason: 'zamjena',
    }, f.clock.now())

    updateUser(f.db, f.venueId, f.adminActor(), f.userId('Dino'), { active: false }, f.clock.now())

    expect(rowOf(row.id).status).toBe('removed')
    expect(rowOf(row.id).note).toBe('deaktiviran')
    expect(f.db.select().from(schema.swapRequests).all()[0]!.status).toBe('cancelled')
  })
})

// ---------------------------------------------------------------------------
// Sati
// ---------------------------------------------------------------------------

describe('rosterHours', () => {
  const month = () => today().slice(0, 7)

  /** A `shift_members` row for `name` on `date`, joined at `hhmm` local. */
  function worked(name: string, date: string, hhmm: string, leftHhmm?: string): void {
    const shiftId = f.openShift({ members: [], businessDate: date, at: iso(date, '12:00') })
    f.db.insert(schema.shiftMembers).values({
      id: crypto.randomUUID(), venueId: f.venueId, shiftId,
      userId: f.userId(name), role: 'waiter',
      joinedAt: iso(date, hhmm),
      leftAt: leftHhmm ? iso(date, leftHhmm, true) : null,
      leftAtSource: leftHhmm ? 'manual' : null,
    }).run()
    // One open shift per venue is a database rule; close it so the next date can
    // open its own.
    f.sqlite.exec(`UPDATE shifts SET status = 'closed', closed_at = '${iso(date, '23:59')}',`
      + ` closed_by = '${f.userId('Haris')}', closed_kind = 'normal' WHERE id = '${shiftId}'`)
  }

  /** `YYYY-MM-DD` + a Sarajevo wall clock → the UTC instant. Summer is +2. */
  function iso(date: string, hhmm: string, nextDay = false): string {
    const [h, m] = hhmm.split(':').map(Number)
    const base = Date.parse(`${date}T00:00:00.000Z`) + (nextDay ? 86_400_000 : 0)
    return new Date(base + ((h! - 2) * 60 + m!) * 60_000).toISOString()
  }

  it('counts nominal planned hours with no timezone maths', () => {
    expect(plannedHours('16:00', '01:00')).toBe(9)
    expect(plannedHours('22:00', '06:00')).toBe(8)
    expect(plannedHours('08:00', '16:00')).toBe(8)
  })

  it('reports a late first action above the grace, and the raw minutes', () => {
    const date = today()
    plan('Amar', { date })
    worked('Amar', date, '16:40')

    const rows = rosterHours(f.db, f.venueId, month(), f.userId('Amar'))
    const day = rows[0]!.days.find(d => d.business_date === date)!
    // 40, not 10: the grace decides whether it is printed, not what it says.
    expect(day.late_min).toBe(40)
    expect(rows[0]!.late_min).toBe(40)
  })

  it('says nothing when the first action is inside the grace', () => {
    const date = today()
    plan('Amar', { date })
    worked('Amar', date, '16:20')
    expect(rosterHours(f.db, f.venueId, month(), f.userId('Amar'))[0]!.late_min).toBe(0)
  })

  it('flags a planned row with no shift row, and an unplanned person who was there', () => {
    const date = today()
    plan('Amar', { date })
    worked('Lejla', date, '16:00')

    const rows = rosterHours(f.db, f.venueId, month())
    const amar = rows.find(r => r.user_name === 'Amar')!
    const lejla = rows.find(r => r.user_name === 'Lejla')!

    expect(amar.no_shift_rows).toBe(1)
    expect(lejla.unplanned_rows).toBe(1)
    expect(lejla.days[0]!.status).toBe('unplanned')
  })

  it('does not flag the šanker who submitted a count and locked nothing', () => {
    const date = today()
    plan('Emir', { date })
    worked('Emir', date, '16:00', '01:00')

    const emir = rosterHours(f.db, f.venueId, month(), f.userId('Emir'))[0]!
    expect(emir.late_min).toBe(0)
    expect(emir.early_leave_min).toBe(0)
    expect(emir.no_shift_rows).toBe(0)
    expect(emir.worked_h).toBeGreaterThan(8)
  })

  it('counts a sick day, an absence, and swaps on both sides', () => {
    const date = today()
    const giver = plan('Amar', { date })
    const request = requestSwap(f.db, f.venueId, f.actor('Amar'), {
      assignment_id: giver.id, reason: 'bolest',
    }, f.clock.now())
    decideSwap(f.db, f.venueId, f.actor('Lejla'), request.id, 'accept', {}, f.clock.now())

    const dino = plan('Dino', { date, template: 'Dnevna' })
    patchAssignment(f.db, f.venueId, f.adminActor(), dino.id, { status: 'absent' }, f.clock.now())

    const rows = rosterHours(f.db, f.venueId, month())
    expect(rows.find(r => r.user_name === 'Amar')!.sick_days).toBe(1)
    expect(rows.find(r => r.user_name === 'Lejla')!.swaps_taken).toBe(1)
    expect(rows.find(r => r.user_name === 'Dino')!.absent_days).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// The triggers
// ---------------------------------------------------------------------------

describe('roster_assignments and swap_requests, at the database level', () => {
  it('refuses swapped → planned: a taken shift is history', () => {
    const giver = plan('Amar')
    const request = requestSwap(f.db, f.venueId, f.actor('Amar'), {
      assignment_id: giver.id, reason: 'zamjena',
    }, f.clock.now())
    decideSwap(f.db, f.venueId, f.actor('Lejla'), request.id, 'accept', {}, f.clock.now())

    f.expectRefused(
      `UPDATE roster_assignments SET status = 'planned' WHERE id = '${giver.id}'`,
      /illegal transition/,
    )
  })

  it('refuses moving a cell to another person or another date', () => {
    const row = plan('Amar')
    f.expectRefused(
      `UPDATE roster_assignments SET user_id = '${f.userId('Lejla')}' WHERE id = '${row.id}'`,
      /frozen column changed/,
    )
    f.expectRefused(
      `UPDATE roster_assignments SET work_date = '2030-01-01' WHERE id = '${row.id}'`,
      /frozen column changed/,
    )
  })

  it('refuses accepted → pending and declined → accepted', () => {
    const giver = plan('Amar')
    const request = requestSwap(f.db, f.venueId, f.actor('Amar'), {
      assignment_id: giver.id, reason: 'zamjena',
    }, f.clock.now())
    decideSwap(f.db, f.venueId, f.actor('Lejla'), request.id, 'accept', {}, f.clock.now())

    f.expectRefused(
      `UPDATE swap_requests SET status = 'pending' WHERE id = '${request.id}'`,
      /only pending ->/,
    )

    const second = plan('Dino')
    const declined = requestSwap(f.db, f.venueId, f.actor('Dino'), {
      assignment_id: second.id, reason: 'zamjena',
    }, f.clock.now())
    decideSwap(f.db, f.venueId, f.actor('Tarik'), declined.id, 'decline', {}, f.clock.now())
    f.expectRefused(
      `UPDATE swap_requests SET status = 'accepted' WHERE id = '${declined.id}'`,
      /only pending ->/,
    )
  })

  it('refuses a DELETE of a swap request', () => {
    const giver = plan('Amar')
    const request = requestSwap(f.db, f.venueId, f.actor('Amar'), {
      assignment_id: giver.id, reason: 'zamjena',
    }, f.clock.now())
    f.expectRefused(`DELETE FROM swap_requests WHERE id = '${request.id}'`, /append-only/)
  })

  it('allows a hard delete while the week is a draft, and turns it into removed after publish', () => {
    const week = futureWeek()
    const draft = plan('Amar', { date: week })
    removeAssignment(f.db, f.venueId, f.adminActor(), draft.id, f.clock.now())
    expect(f.db.select().from(schema.rosterAssignments)
      .where(eq(schema.rosterAssignments.id, draft.id)).get()).toBeUndefined()

    const kept = plan('Lejla', { date: week })
    publishWeek(f.db, f.venueId, f.adminActor(), week, f.clock.now())
    removeAssignment(f.db, f.venueId, f.adminActor(), kept.id, f.clock.now())
    expect(rowOf(kept.id).status).toBe('removed')
  })
})

describe('the week header', () => {
  it('is one row per venue per Monday', () => {
    const week = futureWeek()
    plan('Amar', { date: week })
    plan('Lejla', { date: addDays(week, 3) })

    const weeks = f.db.select().from(schema.rosterWeeks)
      .where(and(
        eq(schema.rosterWeeks.venueId, f.venueId),
        eq(schema.rosterWeeks.weekStart, week),
      ))
      .all()
    expect(weeks).toHaveLength(1)
  })
})
