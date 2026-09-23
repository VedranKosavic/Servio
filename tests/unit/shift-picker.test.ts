/**
 * *Koju smjenu radiš?* — the picker (the owner, 23.09.2026).
 *
 * The café runs two shifts a day and they overlap while the crews change, so
 * the clock stopped being able to say whose round a round is. These are the
 * rules that replaced it, and every one of them is the owner's sentence rather
 * than a design decision: a slot is free **per screen**, a worker who signs in
 * again lands back on his own crew, and closing a shift signs out that crew and
 * nobody else.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { makeFixture, schema, type Fixture } from '../helpers/db'

vi.mock('../../server/services/contracts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/services/contracts')>()
  return { ...actual, log: vi.fn(() => 'log-entry'), bump: vi.fn(() => 1), queueAlert: vi.fn() }
})

const { pickShift, shiftChoices, endSessionsOn } = await import('../../server/services/shifts')

let f: Fixture
/** 07:40 Sarajevo — the morning crew is in, the evening one is hours away. */
const MORNING = '2026-09-09T05:40:00.000Z'
/** 14:20 Sarajevo — early, and exactly the arrival the picker is built for. */
const HANDOVER = '2026-09-09T12:20:00.000Z'

beforeEach(() => { f = makeFixture() })
afterEach(() => f.close())

const slot = (name: string, at: string, who = 'Amar', mode: 'konobar' | 'sanker' = 'konobar') => {
  f.session(who, { mode })
  return shiftChoices(f.db, f.venueId, f.actor(who, { mode }), at).choices
    .find(c => c.name === name)!
}

describe('what the chooser offers', () => {
  it('opens the morning and holds the evening back', () => {
    expect(slot('Prva smjena', MORNING)).toMatchObject({ action: 'open', blocked: null })
    expect(slot('Druga smjena', MORNING)).toMatchObject({ action: null, blocked: 'rano' })
  })

  it('offers the evening an hour before it starts, because they come early', () => {
    // *"Nema pravila, druga smjena zna početi ranije."* 14:20 is inside the
    // hour `shift_open_early_min` allows, and this is the whole handover.
    expect(slot('Druga smjena', HANDOVER)).toMatchObject({ action: 'open', blocked: null })
  })

  it('draws a slot that has been closed today as done, not as free', () => {
    const shiftId = f.openShift({ members: ['Amar'], at: MORNING, template: 'Prva smjena' })
    f.db.update(schema.shifts).set({ status: 'closed' })
      .where(eq(schema.shifts.id, shiftId)).run()
    expect(slot('Prva smjena', HANDOVER)).toMatchObject({ action: null, blocked: 'zavrsena' })
  })
})

describe('a seat is per screen', () => {
  it('lets the šanker join the shift the konobar opened', () => {
    f.session('Amar', { mode: 'konobar' })
    pickShift(f.db, f.venueId, f.actor('Amar', { mode: 'konobar' }),
      slot('Prva smjena', MORNING).template_id, MORNING)

    // Tarik walks in five minutes later. *Prva* is running and his seat — the
    // šank — is empty, so it is his; pushing him into the evening would be the
    // bug the owner asked about by name.
    const his = slot('Prva smjena', MORNING, 'Emir', 'sanker')
    expect(his).toMatchObject({ action: 'join', blocked: null })
    expect(his.konobar).toBe('Amar')
    expect(his.sanker).toBeNull()
  })

  it('refuses a second person on the same screen', () => {
    f.session('Amar', { mode: 'konobar' })
    const templateId = slot('Prva smjena', MORNING).template_id
    pickShift(f.db, f.venueId, f.actor('Amar', { mode: 'konobar' }), templateId, MORNING)

    const taken = slot('Prva smjena', MORNING, 'Lejla', 'konobar')
    expect(taken).toMatchObject({ action: null, blocked: 'zauzeta', konobar: 'Amar' })

    f.session('Lejla', { mode: 'konobar' })
    expect(() => pickShift(
      f.db, f.venueId, f.actor('Lejla', { mode: 'konobar' }), templateId, MORNING,
    )).toThrow(/seat/)
  })

  it('gives a worker his own shift back when he signs in again', () => {
    f.session('Amar', { mode: 'konobar' })
    const templateId = slot('Prva smjena', MORNING).template_id
    const { shift_id } = pickShift(
      f.db, f.venueId, f.actor('Amar', { mode: 'konobar' }), templateId, MORNING,
    )

    // His phone died and he PIN'd in again: the seat is still his, so the
    // picker must not read it as taken by somebody else.
    const again = slot('Prva smjena', MORNING, 'Amar', 'konobar')
    expect(again).toMatchObject({ action: 'join', mine: true, shift_id })
  })
})

describe('taking a shift', () => {
  it('opens it on the slot the worker named, not on the clock', () => {
    f.session('Amar', { mode: 'konobar' })
    const choice = slot('Druga smjena', HANDOVER)
    const { shift_id } = pickShift(
      f.db, f.venueId, f.actor('Amar', { mode: 'konobar' }), choice.template_id, HANDOVER,
    )

    const shift = f.db.select().from(schema.shifts).where(eq(schema.shifts.id, shift_id)).get()!
    // 14:20 falls inside *Prva smjena*'s window, and before the picker that is
    // exactly what made *Smjene* draw this night as *Vanredna smjena*.
    expect(shift.templateId).toBe(choice.template_id)
    expect(shift.autoOpened).toBe(0)
  })

  it('writes the shift on the session, so a reload lands on the crew', () => {
    const sessionId = f.session('Amar', { mode: 'konobar' })
    const { shift_id } = pickShift(
      f.db, f.venueId, f.actor('Amar', { mode: 'konobar' }),
      slot('Prva smjena', MORNING).template_id, MORNING,
    )
    const row = f.db.select().from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId)).get()!
    expect(row.shiftId).toBe(shift_id)
  })

  it('puts him on the shift members, which is what pays his hours', () => {
    f.session('Amar', { mode: 'konobar' })
    const { shift_id } = pickShift(
      f.db, f.venueId, f.actor('Amar', { mode: 'konobar' }),
      slot('Prva smjena', MORNING).template_id, MORNING,
    )
    const member = f.db.select().from(schema.shiftMembers)
      .where(and(
        eq(schema.shiftMembers.shiftId, shift_id),
        eq(schema.shiftMembers.userId, f.userId('Amar')),
      ))
      .get()
    expect(member).toBeTruthy()
  })
})

describe('closing a shift signs out its crew', () => {
  it('and leaves the other crew working', () => {
    const prvaSession = f.session('Amar', { mode: 'konobar' })
    const prva = pickShift(f.db, f.venueId, f.actor('Amar', { mode: 'konobar' }),
      slot('Prva smjena', MORNING).template_id, MORNING).shift_id

    const drugaSession = f.session('Lejla', { mode: 'konobar' })
    pickShift(f.db, f.venueId, f.actor('Lejla', { mode: 'konobar' }),
      slot('Druga smjena', HANDOVER, 'Lejla').template_id, HANDOVER)

    f.db.transaction(tx => endSessionsOn(tx, f.venueId, prva, HANDOVER))

    const read = (id: string) => f.db.select().from(schema.sessions)
      .where(eq(schema.sessions.id, id)).get()!
    expect(read(prvaSession).revokedAt).toBe(HANDOVER)
    // The evening is an hour into its own night. Signing it out here would be
    // the handover breaking the thing it exists to fix.
    expect(read(drugaSession).revokedAt).toBeNull()
  })
})
