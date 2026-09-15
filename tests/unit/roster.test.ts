/**
 * *Raspored* — one weekly pattern, at most two people per shift, no dates.
 *
 * The owner's rule (2026-09-15): "Ne trebaju nam datumi za raspored, samo nam
 * treba da dodamo po danima maksimalno 2 osobe po smjeni i taj raspored ostaje
 * zauvijek." Everything below is a way that rule could quietly stop being true:
 *
 *   - a **third person** in a cell, or the same person twice;
 *   - an edit that does not reach every screen (no `bump`) or leaves no record
 *     (no `roster_changed` entry) — a DELETE forgets, so the log is the history;
 *   - a deactivated person or template still drawn on somebody's phone;
 *   - *Puls* asking the **calendar** day which weekday it is, when at 02:00 on
 *   Saturday the café is still working Friday;
 *   - and 0010's one-time seed from the dated roster it replaced.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFixture, schema, type Fixture } from '../helpers/db'
import { expectCode } from '../helpers/phase4'
import { businessDate, isoWeekday } from '#shared/dates'
import { ROSTER_ERRORS } from '#shared/errors/roster'
import { ROUTE_ROLES } from '#shared/routeRoles'
import { patternBody } from '#shared/schemas'
import {
  MAX_PER_SHIFT, addToPattern, getPattern, plannedOn, removeFromPattern, updateTemplate,
} from '../../server/services/roster'
import { updateUser } from '../../server/services/admin'
import { getLive } from '../../server/services/owner'

let f: Fixture

beforeEach(() => { f = makeFixture() })
afterEach(() => { f.close() })

const PON = 1
const SRI = 3
const PET = 5
const SUB = 6
const NED = 7

const template = (name: string) =>
  f.db.select().from(schema.shiftTemplates).all().find(t => t.name === name)!

function add(name: string, weekday: number, templateName = 'Druga smjena') {
  return addToPattern(f.db, f.venueId, f.adminActor(), {
    weekday, template_id: template(templateName).id, user_id: f.userId(name),
  }, f.clock.now())
}

const rows = () => f.db.select().from(schema.rosterPattern).all()
const rosterBumps = () => f.db.select().from(schema.changes).all().filter(c => c.entity === 'roster').length
const rosterEntries = () => f.db.select().from(schema.logEntries).all().filter(e => e.kind === 'roster_changed')

// ---------------------------------------------------------------------------

describe('the weekday of a business date', () => {
  it('is ISO: Monday is 1 and Sunday is 7', () => {
    expect(isoWeekday('2026-09-14')).toBe(PON)
    expect(isoWeekday('2026-09-18')).toBe(PET)
    expect(isoWeekday('2026-09-20')).toBe(NED)
  })

  it('puts 02:00 on Saturday in Friday, because the café\'s day starts at 06:00', () => {
    // 00:00 UTC is 02:00 in Sarajevo in September.
    const day = businessDate('2026-09-19T00:00:00.000Z')
    expect(day).toBe('2026-09-18')
    expect(isoWeekday(day)).toBe(PET)
  })

  it('refuses a weekday outside 1–7 at the body', () => {
    const body = { template_id: template('Druga smjena').id, user_id: f.userId('Amar') }
    expect(patternBody.safeParse({ ...body, weekday: 0 }).success).toBe(false)
    expect(patternBody.safeParse({ ...body, weekday: 8 }).success).toBe(false)
    expect(patternBody.safeParse({ ...body, weekday: 7 }).success).toBe(true)
  })
})

// ---------------------------------------------------------------------------

describe('adding a person to the pattern', () => {
  it('saves the cell and reads back as weekday × template, with names', () => {
    const amar = add('Amar', PON)
    add('Lejla', PET, 'Prva smjena')

    expect(amar).toMatchObject({
      weekday: PON, template_id: template('Druga smjena').id,
      user_id: f.userId('Amar'), user_name: 'Amar',
    })

    const view = getPattern(f.db, f.venueId)
    expect(view.max_per_shift).toBe(2)
    expect(view.templates.map(t => t.name)).toEqual(['Prva smjena', 'Druga smjena'])
    expect(view.entries.map(e => [e.weekday, e.user_name])).toEqual([[PON, 'Amar'], [PET, 'Lejla']])
  })

  it('refuses a third person with 409 SHIFT_FULL, in Bosnian, and writes nothing', () => {
    expect(MAX_PER_SHIFT).toBe(2)
    add('Amar', PET)
    add('Lejla', PET)

    expectCode(() => add('Dino', PET), 'SHIFT_FULL')
    let thrown: unknown
    try { add('Dino', PET) } catch (err) { thrown = err }
    expect((thrown as { status?: number } | undefined)?.status).toBe(409)
    expect(ROSTER_ERRORS.SHIFT_FULL).toBe('U ovoj smjeni su već dvije osobe.')
    expect(rows()).toHaveLength(2)

    // The cap is per cell: the other shift and the next day still have room.
    add('Dino', PET, 'Prva smjena')
    add('Dino', SUB)
    expect(rows()).toHaveLength(4)
  })

  it('refuses the same person twice in one cell — the service and the database', () => {
    const first = add('Amar', SRI)
    expectCode(() => add('Amar', SRI), 'ALREADY_IN_SHIFT')
    expect(rows()).toHaveLength(1)

    const row = rows()[0]!
    f.expectRefused(
      `INSERT INTO roster_pattern (id, venue_id, weekday, template_id, user_id, created_by, created_at)`
      + ` VALUES ('dup', '${f.venueId}', ${row.weekday}, '${row.templateId}', '${row.userId}',`
      + ` '${row.createdBy}', '${row.createdAt}')`,
      /UNIQUE constraint failed/,
    )
    expect(first.id).toBe(row.id)
  })

  it('allows one person on both shifts of a weekday', () => {
    add('Amar', SRI, 'Prva smjena')
    add('Amar', SRI, 'Druga smjena')
    expect(rows()).toHaveLength(2)
  })

  it('refuses a deactivated person and a switched-off template', () => {
    updateUser(f.db, f.venueId, f.adminActor(), f.userId('Dino'), { active: false }, f.clock.now())
    expectCode(() => add('Dino', PON), 'USER_NOT_ACTIVE')

    updateTemplate(f.db, f.venueId, f.adminActor(), template('Prva smjena').id, { active: false }, f.clock.now())
    expectCode(() => add('Amar', PON, 'Prva smjena'), 'TEMPLATE_NOT_ACTIVE')
    expect(rows()).toHaveLength(0)
  })
})

describe('removing a person', () => {
  it('hard-deletes the row and frees the seat', () => {
    const amar = add('Amar', PET)
    add('Lejla', PET)

    removeFromPattern(f.db, f.venueId, f.adminActor(), amar.id, f.clock.now())
    expect(rows().map(r => r.userId)).toEqual([f.userId('Lejla')])

    add('Dino', PET)
    expect(getPattern(f.db, f.venueId).entries.map(e => e.user_name).sort()).toEqual(['Dino', 'Lejla'])
  })

  it('says PATTERN_NOT_FOUND for a row that is already gone', () => {
    const amar = add('Amar', PET)
    removeFromPattern(f.db, f.venueId, f.adminActor(), amar.id, f.clock.now())
    expectCode(() => removeFromPattern(f.db, f.venueId, f.adminActor(), amar.id, f.clock.now()), 'PATTERN_NOT_FOUND')
  })
})

describe('every edit reaches every screen and leaves a record', () => {
  it('bumps roster and writes roster_changed on add and on remove', () => {
    const bumps = rosterBumps()
    const amar = add('Amar', PET)
    expect(rosterBumps()).toBe(bumps + 1)

    removeFromPattern(f.db, f.venueId, f.adminActor(), amar.id, f.clock.now())
    expect(rosterBumps()).toBe(bumps + 2)

    const entries = rosterEntries()
    expect(entries.map(e => JSON.parse(e.bodyJson).what)).toEqual(['dodan', 'uklonjen'])
    expect(JSON.parse(entries[0]!.bodyJson)).toMatchObject({ weekday: PET, user_id: f.userId('Amar') })
    expect(entries[0]!.titleBs).toContain('pet')
    expect(entries[0]!.titleBs).toContain('Amar')
  })

  it('posts one Svi line per owner per business day, however many edits', () => {
    add('Amar', PON)
    add('Lejla', PON)
    add('Dino', SRI)
    const lines = f.db.select().from(schema.chatMessages).all()
      .filter(m => m.systemKey === 'roster_changed')
    expect(lines).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------

describe('what staff read', () => {
  it('is the same weekly pattern, on a route every worker may call', () => {
    add('Amar', PET)
    expect(ROUTE_ROLES['GET /api/me/roster']).toEqual(expect.arrayContaining(['admin', 'radnik']))
    // The service has no reader argument: there is nothing on a pattern row a
    // colleague may not see.
    expect(getPattern(f.db, f.venueId).entries.map(e => e.user_name)).toEqual(['Amar'])
    expect(readFileSync(join('server', 'api', 'me', 'roster', 'index.get.ts'), 'utf8')).toContain('getPattern')
  })

  it('leaves the edits to the owner and has no dated routes left', () => {
    expect(ROUTE_ROLES['GET /api/roster/pattern']).toEqual(['admin'])
    expect(ROUTE_ROLES['POST /api/roster/pattern']).toEqual(['admin'])
    expect(ROUTE_ROLES['DELETE /api/roster/pattern/:id']).toEqual(['admin'])
    const keys = Object.keys(ROUTE_ROLES)
    for (const gone of ['weeks', 'assignments', 'swaps', 'hours']) {
      expect(keys.filter(k => k.includes('/roster') && k.includes(gone))).toEqual([])
    }
  })
})

describe('deactivating', () => {
  it('takes a person out of the pattern and frees his seats', () => {
    add('Amar', PET)
    add('Dino', PET)
    add('Dino', SUB)
    const bumps = rosterBumps()

    updateUser(f.db, f.venueId, f.adminActor(), f.userId('Dino'), { active: false }, f.clock.now())

    expect(rows().map(r => r.userId)).toEqual([f.userId('Amar')])
    expect(rosterBumps()).toBe(bumps + 1)
    expect(plannedOn(f.db, f.venueId, '2026-09-18').map(r => r.name)).toEqual(['Amar'])
    add('Lejla', PET)
  })

  it('hides a switched-off template and brings its people back with it', () => {
    add('Amar', PET, 'Prva smjena')
    add('Lejla', PET)
    const prva = template('Prva smjena').id

    updateTemplate(f.db, f.venueId, f.adminActor(), prva, { active: false }, f.clock.now())
    const hidden = getPattern(f.db, f.venueId)
    expect(hidden.templates.map(t => t.name)).toEqual(['Druga smjena'])
    expect(hidden.entries.map(e => e.user_name)).toEqual(['Lejla'])
    expect(plannedOn(f.db, f.venueId, '2026-09-18').map(r => r.name)).toEqual(['Lejla'])

    updateTemplate(f.db, f.venueId, f.adminActor(), prva, { active: true }, f.clock.now())
    expect(getPattern(f.db, f.venueId).entries.map(e => e.user_name)).toEqual(['Amar', 'Lejla'])
  })
})

// ---------------------------------------------------------------------------

describe('Puls reads today\'s weekday', () => {
  it('maps a date to its weekday, ordered by shift and then name, with the template\'s hours', () => {
    add('Lejla', PET)
    add('Amar', PET)
    add('Emir', PET, 'Prva smjena')
    add('Tarik', SUB)

    const friday = plannedOn(f.db, f.venueId, '2026-09-18')
    expect(friday.map(r => [r.template_name, r.name])).toEqual([
      ['Prva smjena', 'Emir'], ['Druga smjena', 'Amar'], ['Druga smjena', 'Lejla'],
    ])
    const druga = template('Druga smjena')
    expect(friday[1]).toMatchObject({ start_time: druga.startTime, end_time: druga.endTime })
    // Every Friday, not one date.
    expect(plannedOn(f.db, f.venueId, '2026-10-02').map(r => r.name)).toEqual(['Emir', 'Amar', 'Lejla'])
  })

  it('at 02:00 on Saturday still shows Friday\'s people on the live screen', () => {
    add('Amar', PET)
    add('Tarik', SUB)
    const live = getLive(f.db, f.venueId, f.adminActor(), '2026-09-19T00:00:00.000Z')
    expect(live.rostered.map(r => r.name)).toEqual(['Amar'])

    const morning = getLive(f.db, f.venueId, f.adminActor(), '2026-09-19T08:00:00.000Z')
    expect(morning.rostered.map(r => r.name)).toEqual(['Tarik'])
  })
})

// ---------------------------------------------------------------------------

/**
 * 0010 seeds the pattern once from the dated roster. The hand-written INSERT is
 * the migration's last statement; it is replayed here on a fixture that has the
 * old rows in it, so the rules are asserted rather than trusted.
 */
describe('0010 seeds the pattern from the last published week', () => {
  const SEED = readFileSync(
    join('server', 'database', 'migrations', '0010_roster_pattern.sql'), 'utf8',
  ).split('--> statement-breakpoint').at(-1)!

  function week(start: string, published: boolean): void {
    const at = `${start}T09:00:00.000Z`
    f.sqlite.exec(
      `INSERT INTO roster_weeks (id, venue_id, week_start, published_at, published_by, created_by, created_at)`
      + ` VALUES ('${crypto.randomUUID()}', '${f.venueId}', '${start}',`
      + ` ${published ? `'${at}'` : 'NULL'}, ${published ? `'${f.userId('Haris')}'` : 'NULL'},`
      + ` '${f.userId('Haris')}', '${at}')`,
    )
  }

  function row(name: string, date: string, opts: {
    template?: string, origin?: string, status?: string, at?: string
  } = {}): void {
    const t = template(opts.template ?? 'Druga smjena')
    f.sqlite.exec(
      `INSERT INTO roster_assignments (id, venue_id, work_date, template_id, user_id,`
      + ` start_time, end_time, status, origin, created_by, created_at)`
      + ` VALUES ('${crypto.randomUUID()}', '${f.venueId}', '${date}', '${t.id}', '${f.userId(name)}',`
      + ` '${t.startTime}', '${t.endTime}', '${opts.status ?? 'planned'}', '${opts.origin ?? 'owner'}',`
      + ` '${f.userId('Haris')}', '${opts.at ?? `${date}T08:00:00.000Z`}')`,
    )
  }

  it('carries the regular people onto their weekdays, two per cell at most', () => {
    updateUser(f.db, f.venueId, f.adminActor(), f.userId('Dino'), { active: false }, f.clock.now())

    week('2026-08-31', true)
    row('Tarik', '2026-09-01') // an older published week — not the plan in force

    week('2026-09-07', true) // the latest published week
    row('Amar', '2026-09-07') // pon
    row('Lejla', '2026-09-13', { template: 'Prva smjena' }) // ned → 7
    row('Tarik', '2026-09-11', { origin: 'swap' }) // a one-off cover
    row('Emir', '2026-09-11', { status: 'removed' }) // taken off
    row('Dino', '2026-09-12') // deactivated since
    row('Emir', '2026-09-09', { at: '2026-09-01T10:00:00.000Z' }) // sri, first
    row('Lejla', '2026-09-09', { at: '2026-09-01T11:00:00.000Z' }) // sri, second
    row('Tarik', '2026-09-09', { at: '2026-09-01T12:00:00.000Z' }) // sri, third — dropped

    week('2026-09-14', false) // a later draft nobody published
    row('Tarik', '2026-09-17')

    f.sqlite.exec('DELETE FROM roster_pattern')
    f.sqlite.exec(SEED)

    const seeded = getPattern(f.db, f.venueId).entries
      .map(e => [e.weekday, template('Prva smjena').id === e.template_id ? 'Prva' : 'Druga', e.user_name])
    expect(seeded).toEqual([
      [PON, 'Druga', 'Amar'],
      [SRI, 'Druga', 'Emir'],
      [SRI, 'Druga', 'Lejla'],
      [NED, 'Prva', 'Lejla'],
    ])
    // Only the pattern's rows, and ids `routeKey` will turn into `:id`.
    expect(rows()).toHaveLength(4)
    for (const r of rows()) {
      expect(r.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/)
      expect(r.createdBy).toBe(f.userId('Haris'))
    }
  })

  it('leaves the pattern empty for a venue that never published', () => {
    week('2026-09-07', false)
    row('Amar', '2026-09-07')
    f.sqlite.exec('DELETE FROM roster_pattern')
    f.sqlite.exec(SEED)
    expect(rows()).toEqual([])
    expect(f.db.select().from(schema.rosterPattern).where(eq(schema.rosterPattern.venueId, f.venueId)).all())
      .toHaveLength(0)
  })
})
