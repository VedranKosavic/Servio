/**
 * `log_entries` — the one activity record (`docs/BACKEND.md` §6.9, §8).
 *
 * CLAUDE.md is explicit: Šank has **one** who-did-what table, not an audit log
 * beside a Dnevnik beside an `order_events`. Every entry is written by `log()`
 * **inside the same transaction as the event it describes**, which is the whole
 * point of taking a `Tx` rather than a `Db`: a void that fails its stock check
 * rolls back its own entry, so the Dnevnik can never claim something the ledger
 * does not show. Locks and payments are deliberately not entries — they *are*
 * the ledger.
 *
 * The vocabulary is frozen in `shared/logTemplates.ts` (WP0) and `kind` is
 * typed, so calling `log()` with a kind nobody defined is a typecheck error
 * rather than a shift close that fails at 03:10 in the morning.
 */
import { and, asc, desc, eq, gt, inArray, lt, notInArray, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { schema } from '../database/client'
import { SankError, notFound } from '../utils/errors'
import { newId, nowIso } from '../utils/ids'
import { businessDate, localTime } from '#shared/dates'
import { formatKm } from '#shared/money'
import { LOG, isQuiet } from '#shared/logTemplates'
import type { LogNames } from '#shared/logTemplates'
import type { LogKind } from '#shared/types'
import type { LogEntry, LogEntryDetail, LogListResult, LogQuery } from '#shared/types'
import type { Db, Queryable, Tx } from './types'
import { bump } from './changes'
import { getSettings } from './contracts'
import { queueAlert } from './alerts'

/** How many entries the Dnevnik asks for when nobody says. §7 caps it at 100. */
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

export interface LogInput {
  kind: LogKind
  body: unknown
  actorId?: string | null
  deviceId?: string | null
  /** The **object** the entry is about — and the alert's dedupe key (see below). */
  ref?: { type: string, id: string }
  shiftId?: string | null
  /** The request entry this decision answers. */
  resolvesId?: string | null
  /** Injectable now, so a test can put two entries an hour apart. */
  at?: string
}

/**
 * Write one Dnevnik entry, and queue its Telegram mirror when the kind is
 * marked ✔ in §8.
 *
 * **`ref` must be the object the entry is about, never the entry itself.**
 * `alert_events` dedupes on `(venue_id, rule_key, ref_type, ref_id)` with
 * `INSERT OR IGNORE`, and a fresh log-entry uuid per event is a key that never
 * collides and therefore never dedupes — the mechanism would be decoration.
 * Passing the caller's own `ref` gives it teeth: a void decided twice on the
 * same adjustment queues one `void_after_payment`; a shift closed and then
 * re-summarised queues one `shift_closed` for `('shift', shift_id)`. The
 * fallback to the entry's own id exists only for a kind with no natural object.
 */
export function log(tx: Tx, venueId: string, e: LogInput): string {
  const template = LOG[e.kind] as typeof LOG[LogKind] | undefined
  if (!template) {
    throw new SankError(
      500, 'LOG_TEMPLATE_MISSING', `no log template for kind "${String(e.kind)}"`,
    )
  }

  const at = e.at ?? nowIso()
  const settings = getSettings(tx, venueId)

  // The template's Zod schema is `.loose()`: the documented fields are checked,
  // anything else the caller adds is kept. A body that fails is a bug in the
  // caller, so it throws rather than storing a half-rendered sentence.
  const body = scrub(template.body.parse(e.body)) as Record<string, unknown>
  const titleBs = (template.title as (b: unknown, n: LogNames) => string)(body, names(tx, venueId))

  const id = newId()
  tx.insert(schema.logEntries).values({
    id,
    venueId,
    kind: e.kind,
    titleBs,
    bodyJson: JSON.stringify(body),
    refType: e.ref?.type ?? null,
    refId: e.ref?.id ?? null,
    actorId: e.actorId ?? null,
    deviceId: e.deviceId ?? null,
    shiftId: e.shiftId ?? null,
    businessDate: businessDate(at, settings.timezone, settings.business_day_start_hour),
    resolvesId: e.resolvesId ?? null,
    createdAt: at,
    redactedAt: null,
  }).run()

  bump(tx, venueId, 'log', id)

  const mirror = template.telegram
  if (mirror && (!mirror.when || (mirror.when as (b: unknown, s: typeof settings) => boolean)(body, settings))) {
    queueAlert(tx, venueId, {
      ruleKey: mirror.rule,
      ref: e.ref ?? { type: 'log', id },
      payload: { title_bs: titleBs, log_id: id },
      at,
    })
  }

  return id
}

/**
 * Lazy name lookups.
 *
 * An entry stores `{ user_id }` and the screen shows "Amar" — so renaming a
 * product tomorrow does not rewrite what happened tonight, and an entry costs
 * one insert rather than six joins. Every lookup is memoised per call: a
 * `shift_closed` title naming five waiters queries `users` once.
 */
function names(q: Queryable, venueId: string): LogNames {
  const lookup = (
    table: typeof schema.users | typeof schema.products | typeof schema.tables
      | typeof schema.categories | typeof schema.stockItems,
    fallback: string,
  ) => {
    let cache: Map<string, string> | null = null
    return (id: string | null | undefined): string => {
      if (!id) return fallback
      if (!cache) {
        cache = new Map(
          q.select({ id: table.id, name: table.name })
            .from(table)
            .where(eq(table.venueId, venueId))
            .all()
            .map(r => [r.id, r.name] as const),
        )
      }
      return cache.get(id) ?? fallback
    }
  }

  let deviceCache: Map<string, string> | null = null
  const device = (id: string | null | undefined): string => {
    if (!id) return 'Uređaj'
    // A device id can arrive with the heartbeat's composed dedupe suffix
    // ("<uuid>:2026-09-08"); the label is the same device either way.
    const plain = id.split(':')[0]!
    if (!deviceCache) {
      deviceCache = new Map(
        q.select({ id: schema.devices.id, label: schema.devices.label })
          .from(schema.devices)
          .where(eq(schema.devices.venueId, venueId))
          .all()
          .map(r => [r.id, r.label] as const),
      )
    }
    return deviceCache.get(plain) ?? 'Uređaj'
  }

  return {
    // A null actor is the server itself, and the Dnevnik says so in Bosnian.
    user: lookup(schema.users, 'Sistem'),
    product: lookup(schema.products, 'stavka'),
    table: lookup(schema.tables, 'sto'),
    category: lookup(schema.categories, 'kategorija'),
    stockItem: lookup(schema.stockItems, 'roba'),
    device,
    formatKm,
    localTime: (iso: string) => localTime(iso),
  }
}

/**
 * The last line of defence for §6.9's "never a hash, token, email or chat id".
 *
 * The whitelist is each template's own Zod shape, but the shapes are `.loose()`
 * so a caller spreading a whole row into `body` would carry `pin_hash` straight
 * into the Dnevnik — where it is append-only and only a redaction can remove it.
 * So the key names go through one filter on the way in, recursively.
 */
const SECRET_KEY = /hash|token|password|pepper|secret|email|chat_id/i

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(key)) continue
      out[key] = scrub(v)
    }
    return out
  }
  return value
}

// ---------------------------------------------------------------------------
// The Dnevnik reads
// ---------------------------------------------------------------------------

/**
 * `GET /api/owner/log` — a keyset cursor on `(created_at, id)`.
 *
 * Keyset, not `OFFSET`: an entry written while the owner is scrolling would
 * shift every page under an offset and he would read one line twice and skip
 * another. A cursor names the last row he actually saw.
 */
export function listLog(db: Queryable, venueId: string, q: LogQuery = {}): LogListResult {
  const limit = Math.min(Math.max(q.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const where: SQL[] = [eq(schema.logEntries.venueId, venueId)]

  if (q.kind) where.push(eq(schema.logEntries.kind, q.kind))
  if (q.actor) where.push(eq(schema.logEntries.actorId, q.actor))
  if (q.from) where.push(sql`${schema.logEntries.businessDate} >= ${q.from}`)
  if (q.to) where.push(sql`${schema.logEntries.businessDate} <= ${q.to}`)
  if (q.after) where.push(gt(schema.logEntries.createdAt, q.after))

  if (q.group) {
    const kinds = (Object.keys(LOG) as LogKind[]).filter(k => LOG[k].group === q.group)
    where.push(kinds.length > 0
      ? inArray(schema.logEntries.kind, kinds)
      : sql`1 = 0`)
  }

  // *Važno*: hide the routine kinds — but never hide a decision, so a
  // `void_decided` stays visible and carries its quiet `void_requested` inline.
  if (q.important) {
    const quiet = (Object.keys(LOG) as LogKind[]).filter(isQuiet)
    if (quiet.length > 0) {
      where.push(or(
        notInArray(schema.logEntries.kind, quiet),
        sql`${schema.logEntries.resolvesId} is not null`,
      )!)
    }
  }

  if (q.before) {
    const [at, id] = splitCursor(q.before)
    where.push(or(
      lt(schema.logEntries.createdAt, at),
      and(eq(schema.logEntries.createdAt, at), lt(schema.logEntries.id, id))!,
    )!)
  }

  // One extra row is the "is there another page" probe, and it is cheaper than
  // a second count query over the same index.
  const rows = db.select().from(schema.logEntries)
    .where(and(...where))
    .orderBy(desc(schema.logEntries.createdAt), desc(schema.logEntries.id))
    .limit(limit + 1)
    .all()

  const page = rows.slice(0, limit)
  const last = page[page.length - 1]

  const resolvedIds = page.map(r => r.resolvesId).filter((v): v is string => Boolean(v))
  const resolved = new Map<string, LogEntry>()
  if (resolvedIds.length > 0) {
    for (const row of db.select().from(schema.logEntries)
      .where(and(
        eq(schema.logEntries.venueId, venueId),
        inArray(schema.logEntries.id, resolvedIds),
      ))
      .all()) {
      resolved.set(row.id, toEntry(row, nameMaps(db, venueId)))
    }
  }

  const maps = nameMaps(db, venueId)
  const entries: LogEntryDetail[] = page.map((row) => {
    const entry: LogEntryDetail = toEntry(row, maps)
    const request = row.resolvesId ? resolved.get(row.resolvesId) : undefined
    if (request) entry.request = request
    return entry
  })

  return {
    entries,
    next_cursor: rows.length > limit && last ? cursor(last.createdAt, last.id) : undefined,
    max_at: maxAt(db, venueId),
  }
}

/** `GET /api/owner/log/:id` — one entry with both ends of a request/decision pair. */
export function getLogEntry(db: Queryable, venueId: string, id: string): LogEntryDetail {
  const row = db.select().from(schema.logEntries)
    .where(and(eq(schema.logEntries.venueId, venueId), eq(schema.logEntries.id, id)))
    .get()
  if (!row) throw notFound('LOG_ENTRY_NOT_FOUND', `log entry ${id} not found`)

  const maps = nameMaps(db, venueId)
  const entry: LogEntryDetail = toEntry(row, maps)

  if (row.resolvesId) {
    const request = db.select().from(schema.logEntries)
      .where(and(
        eq(schema.logEntries.venueId, venueId),
        eq(schema.logEntries.id, row.resolvesId),
      ))
      .get()
    if (request) entry.request = toEntry(request, maps)
  }

  const resolver = db.select().from(schema.logEntries)
    .where(and(eq(schema.logEntries.venueId, venueId), eq(schema.logEntries.resolvesId, row.id)))
    .orderBy(asc(schema.logEntries.createdAt))
    .get()
  if (resolver) entry.resolver = toEntry(resolver, maps)

  return entry
}

/** `POST /api/owner/log/seen` — the Dnevnik badge. */
export function markLogSeen(
  db: Db, venueId: string, userId: string, at = nowIso(),
): { log_seen_at: string } {
  db.transaction((tx) => {
    tx.update(schema.users)
      .set({ logSeenAt: at })
      .where(and(eq(schema.users.venueId, venueId), eq(schema.users.id, userId)))
      .run()
    // `user`, so the owner's other device clears the same badge on its next
    // poll rather than showing a dot for something he has already read. Every
    // mutating transaction bumps something — `changes-coverage.test.ts` is what
    // stops one being forgotten.
    bump(tx, venueId, 'user', userId)
  })
  return { log_seen_at: at }
}

/** The newest entry's timestamp — the ETag source for the Dnevnik, and *Puls*' cursor. */
export function maxAt(db: Queryable, venueId: string): string {
  const row = db.select({ at: schema.logEntries.createdAt })
    .from(schema.logEntries)
    .where(eq(schema.logEntries.venueId, venueId))
    .orderBy(desc(schema.logEntries.createdAt))
    .limit(1)
    .get()
  return row?.at ?? ''
}

/** Has this device already been flagged for `kind` against this ref today? */
export function hasEntryFor(
  q: Queryable, venueId: string, kind: LogKind, ref: { type: string, id: string },
): boolean {
  return q.select({ id: schema.logEntries.id })
    .from(schema.logEntries)
    .where(and(
      eq(schema.logEntries.venueId, venueId),
      eq(schema.logEntries.kind, kind),
      eq(schema.logEntries.refType, ref.type),
      eq(schema.logEntries.refId, ref.id),
    ))
    .get() !== undefined
}

// --- row → wire -------------------------------------------------------------

interface NameMaps {
  users: Map<string, string>
  devices: Map<string, string>
}

function nameMaps(db: Queryable, venueId: string): NameMaps {
  return {
    users: new Map(
      db.select({ id: schema.users.id, name: schema.users.name })
        .from(schema.users).where(eq(schema.users.venueId, venueId)).all()
        .map(r => [r.id, r.name] as const),
    ),
    devices: new Map(
      db.select({ id: schema.devices.id, label: schema.devices.label })
        .from(schema.devices).where(eq(schema.devices.venueId, venueId)).all()
        .map(r => [r.id, r.label] as const),
    ),
  }
}

function toEntry(row: typeof schema.logEntries.$inferSelect, maps: NameMaps): LogEntry {
  const kind = row.kind as LogKind
  return {
    id: row.id,
    kind,
    title_bs: row.titleBs,
    body: parseBody(row.bodyJson),
    ref_type: row.refType,
    ref_id: row.refId,
    actor_id: row.actorId,
    actor_name: row.actorId ? maps.users.get(row.actorId) ?? null : null,
    device_label: row.deviceId ? maps.devices.get(row.deviceId.split(':')[0]!) ?? null : null,
    shift_id: row.shiftId,
    business_date: row.businessDate,
    at: row.createdAt,
    resolves_id: row.resolvesId,
    redacted: row.redactedAt !== null,
    quiet: kind in LOG ? isQuiet(kind) : false,
  }
}

function parseBody(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function cursor(at: string, id: string): string {
  return `${at}|${id}`
}

function splitCursor(value: string): [string, string] {
  const at = value.slice(0, value.lastIndexOf('|'))
  const id = value.slice(value.lastIndexOf('|') + 1)
  return at ? [at, id] : [value, '']
}
