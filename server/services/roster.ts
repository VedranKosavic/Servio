/**
 * *Raspored* — one weekly pattern, and the shift templates it is drawn on.
 *
 * The owner's rule (2026-09-15): "Ne trebaju nam datumi za raspored, samo nam
 * treba da dodamo po danima maksimalno 2 osobe po smjeni i taj raspored ostaje
 * zauvijek." So there are no dates, no weeks, no drafts and nothing to publish:
 *
 * - a **cell** is a weekday (ISO, Monday = 1 … Sunday = 7) × an active shift
 *   template, and holds **at most `MAX_PER_SHIFT` people**;
 * - an edit is one row in `roster_pattern` added or hard-deleted, and it applies
 *   to every week from the moment it commits;
 * - a deactivated person leaves the plan (his rows are deleted with him); a
 *   deactivated template only stops showing, so switching it back on brings its
 *   people back.
 *
 * **The cap is a count, not a constraint.** SQLite cannot say "at most two rows
 * per cell", so `addToPattern` counts inside its transaction. better-sqlite3 runs
 * a transaction start to finish before the next request is read, so two owners
 * tapping `+` on the last seat at once cannot both win.
 *
 * **Every write logs and bumps.** `roster_changed` goes into `log_entries` in the
 * same transaction — that is the history of a table that forgets on DELETE — and
 * `bump('roster')` moves every screen's poll.
 */
import { and, asc, eq, sql } from 'drizzle-orm'
import { schema } from '../database/client'
import { newId, nowIso } from '../utils/ids'
import { conflict, notFound, unprocessable } from '../utils/errors'
import { businessDate, cutoffIso, isoWeekday } from '#shared/dates'
import type {
  LiveRostered, PatternBody, PatternEntry, RosterPatternView,
  ShiftTemplateBody, ShiftTemplatePatch, ShiftTemplateView,
} from '#shared/types'
import type { Actor, Db, Queryable, Tx } from './types'
import { bump } from './changes'
import { getSettings } from './contracts'
import { log } from './log'
import { postSystem } from './chat'

type TemplateRow = typeof schema.shiftTemplates.$inferSelect

/** "maksimalno 2 osobe po smjeni". */
export const MAX_PER_SHIFT = 2

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

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
 * The whole week — `GET /api/roster/pattern` for the owner and `GET /api/me/roster`
 * for staff, the same answer for both.
 *
 * Rows for an inactive person or template are simply not selected: the join is
 * where "deactivating stops showing" lives.
 */
export function getPattern(q: Queryable, venueId: string): RosterPatternView {
  return {
    templates: listTemplates(q, venueId, false),
    entries: activeRows(q, venueId).map(toEntry),
    max_per_shift: MAX_PER_SHIFT,
  }
}

/**
 * Who the plan has on one **business date** — `rostered` on *Puls*.
 *
 * The date is only asked which weekday it is. Pass `businessDate(now)`, never a
 * calendar date: at 02:00 on Saturday the café is still working Friday, and
 * Friday's people are the ones the owner expects behind the bar.
 *
 * Ordered by the template's own `sort` and then the person's name, so the
 * morning comes before the evening and the rows do not move between polls.
 */
export function plannedOn(q: Queryable, venueId: string, date: string): LiveRostered[] {
  const weekday = isoWeekday(date)
  return activeRows(q, venueId, weekday).map(r => ({
    user_id: r.userId,
    name: r.userName,
    initials: r.initials,
    template_id: r.templateId,
    template_name: r.templateName,
    start_time: r.startTime,
    end_time: r.endTime,
  }))
}

// ---------------------------------------------------------------------------
// The owner's edits
// ---------------------------------------------------------------------------

/**
 * `POST /api/roster/pattern` — one person into one cell, saved for good.
 *
 * Refusals, in the order a tap meets them: the template or the person is gone
 * (404) or switched off (422), the person is already in this cell
 * (`409 ALREADY_IN_SHIFT`), or the cell already has two (`409 SHIFT_FULL`).
 * The same person on two templates of one weekday is allowed — the owner may
 * mean a double shift, and the picker tags the name so he sees it.
 */
export function addToPattern(
  db: Db, venueId: string, actor: Actor, body: PatternBody, now = nowIso(),
): PatternEntry {
  const id = db.transaction((tx) => {
    const template = requireTemplate(tx, venueId, body.template_id)
    if (template.active !== 1) throw unprocessable('TEMPLATE_NOT_ACTIVE', 'that template is switched off')

    const user = tx.select().from(schema.users)
      .where(and(eq(schema.users.venueId, venueId), eq(schema.users.id, body.user_id)))
      .get()
    if (!user) throw notFound('USER_NOT_FOUND', `user ${body.user_id} not found`)
    if (!user.active) throw unprocessable('USER_NOT_ACTIVE', 'that person is deactivated')

    const cell = activeRows(tx, venueId, body.weekday)
      .filter(r => r.templateId === template.id)
    if (cell.some(r => r.userId === user.id)) {
      throw conflict('ALREADY_IN_SHIFT', 'that person is already in this cell')
    }
    if (cell.length >= MAX_PER_SHIFT) {
      throw conflict('SHIFT_FULL', `a cell holds at most ${MAX_PER_SHIFT} people`)
    }

    const rowId = newId()
    tx.insert(schema.rosterPattern).values({
      id: rowId,
      venueId,
      weekday: body.weekday,
      templateId: template.id,
      userId: user.id,
      createdBy: actor.userId,
      createdAt: now,
    }).run()

    afterEdit(tx, venueId, actor, {
      weekday: body.weekday, what: 'dodan', user_id: user.id, template_id: template.id,
    }, rowId, now)
    return rowId
  })

  const entry = activeRows(db, venueId).find(r => r.id === id)
  if (!entry) throw notFound('PATTERN_NOT_FOUND', `pattern row ${id} not visible`)
  return toEntry(entry)
}

/** `DELETE /api/roster/pattern/:id` — a hard delete; the log entry is the record. */
export function removeFromPattern(
  db: Db, venueId: string, actor: Actor, id: string, now = nowIso(),
): void {
  db.transaction((tx) => {
    const row = tx.select().from(schema.rosterPattern)
      .where(and(eq(schema.rosterPattern.venueId, venueId), eq(schema.rosterPattern.id, id)))
      .get()
    if (!row) throw notFound('PATTERN_NOT_FOUND', `pattern row ${id} not found`)

    tx.delete(schema.rosterPattern).where(eq(schema.rosterPattern.id, row.id)).run()

    afterEdit(tx, venueId, actor, {
      weekday: row.weekday, what: 'uklonjen', user_id: row.userId, template_id: row.templateId,
    }, row.id, now)
  })
}

/**
 * The hook `services/admin.ts` calls when a person is deactivated, inside that
 * transaction: he leaves the plan. A plan that still names somebody who no
 * longer works here is a plan nobody trusts — and a returning person is put
 * back on the days the owner wants him, not on the ones he had a year ago.
 */
export function onUserDeactivated(
  tx: Tx, venueId: string, actor: Actor, userId: string, now = nowIso(),
): void {
  const removed = tx.delete(schema.rosterPattern)
    .where(and(eq(schema.rosterPattern.venueId, venueId), eq(schema.rosterPattern.userId, userId)))
    .run().changes
  if (removed === 0) return

  log(tx, venueId, {
    kind: 'roster_changed',
    body: { what: 'deaktiviran, uklonjen iz rasporeda', user_id: userId },
    actorId: actor.userId,
    ref: { type: 'user', id: userId },
    at: now,
  })
  bump(tx, venueId, 'roster', userId)
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

/**
 * `PATCH /api/admin/shift-templates/:id`. Switching a template off hides its
 * cells and keeps its rows, so switching it back on restores its people.
 */
export function updateTemplate(
  db: Db, venueId: string, actor: Actor, id: string, patch: ShiftTemplatePatch, now = nowIso(),
): ShiftTemplateView {
  db.transaction((tx) => {
    const row = requireTemplate(tx, venueId, id)
    // `shift_templates_name_uq` would refuse a rename onto another template's
    // name anyway; saying so in Bosnian beats a raw SQLITE_CONSTRAINT 500.
    if (patch.name !== undefined && patch.name !== row.name) {
      const clash = tx.select({ id: schema.shiftTemplates.id }).from(schema.shiftTemplates)
        .where(and(
          eq(schema.shiftTemplates.venueId, venueId),
          eq(schema.shiftTemplates.name, patch.name),
          sql`${schema.shiftTemplates.id} <> ${row.id}`,
        ))
        .get()
      if (clash) throw conflict('TEMPLATE_EXISTS', `a template named ${patch.name} already exists`)
    }
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
// The pieces
// ---------------------------------------------------------------------------

interface ActiveRow {
  id: string
  weekday: number
  templateId: string
  templateName: string
  templateSort: number
  startTime: string
  endTime: string
  userId: string
  userName: string
  initials: string
}

/**
 * The pattern rows that count: an active person on an active template, in
 * weekday → template `sort` → name order. Optionally one weekday.
 */
function activeRows(q: Queryable, venueId: string, weekday?: number): ActiveRow[] {
  return q.select({
    id: schema.rosterPattern.id,
    weekday: schema.rosterPattern.weekday,
    templateId: schema.rosterPattern.templateId,
    templateName: schema.shiftTemplates.name,
    templateSort: schema.shiftTemplates.sort,
    startTime: schema.shiftTemplates.startTime,
    endTime: schema.shiftTemplates.endTime,
    userId: schema.rosterPattern.userId,
    userName: schema.users.name,
    initials: schema.users.initials,
  })
    .from(schema.rosterPattern)
    .innerJoin(schema.users, eq(schema.users.id, schema.rosterPattern.userId))
    .innerJoin(schema.shiftTemplates, eq(schema.shiftTemplates.id, schema.rosterPattern.templateId))
    .where(and(
      eq(schema.rosterPattern.venueId, venueId),
      eq(schema.users.active, 1),
      eq(schema.shiftTemplates.active, 1),
      ...(weekday !== undefined ? [eq(schema.rosterPattern.weekday, weekday)] : []),
    ))
    // Byte order on the name, like SQL's default collation: the rows never move
    // between two polls.
    .orderBy(
      asc(schema.rosterPattern.weekday), asc(schema.shiftTemplates.sort),
      asc(schema.shiftTemplates.name), asc(schema.users.name), asc(schema.rosterPattern.createdAt),
    )
    .all()
}

function toEntry(r: ActiveRow): PatternEntry {
  return {
    id: r.id,
    weekday: r.weekday,
    template_id: r.templateId,
    user_id: r.userId,
    user_name: r.userName,
    user_initials: r.initials,
  }
}

/**
 * The log entry, the bump, and **at most one *Svi* line per owner per business
 * day**: "Raspored je izmijenjen". An edit reaches every phone at once, so the
 * room is told — but a Friday of six fixes is one line, not six.
 */
function afterEdit(
  tx: Tx, venueId: string, actor: Actor,
  body: { weekday: number, what: string, user_id: string, template_id: string },
  rowId: string, now: string,
): void {
  log(tx, venueId, {
    kind: 'roster_changed',
    body,
    actorId: actor.userId,
    ref: { type: 'roster_pattern', id: rowId },
    at: now,
  })

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

  // The *Svi* line is a courtesy, never a precondition: a venue whose chat rooms
  // were never seeded (a wiped or hand-built database) must still be able to
  // edit its roster. Without this check `postSystem` throws CHANNEL_NOT_FOUND
  // and the whole edit rolls back.
  const svi = tx.select({ id: schema.chatChannels.id }).from(schema.chatChannels)
    .where(and(eq(schema.chatChannels.venueId, venueId), eq(schema.chatChannels.kind, 'svi')))
    .get()

  if (!already && svi) {
    postSystem(tx, venueId, 'svi', 'roster_changed', 'Raspored je izmijenjen',
      { link: { label: 'Raspored →', route: '/konobar/raspored' }, by: actor.userId }, now)
    bump(tx, venueId, 'chat')
  }

  bump(tx, venueId, 'roster', rowId)
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
