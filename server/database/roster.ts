/**
 * `npm run db:roster` — bring an existing database onto the café's roster **in
 * place**, without deleting or reseeding it.
 *
 * `seed()` only runs against an empty database, which is the right rule and
 * also means a database created last month cannot learn about somebody hired
 * this week. This script is the way in: it writes exactly what `roster()`
 * describes, creating the people a database does not have yet and updating the
 * ones it does.
 *
 * Everybody not on the list is **deactivated, never deleted**. `active = 0`
 * takes the row off the pad's candidate list and clears its PIN — a
 * deactivated person holds no number against anybody — while every order,
 * settlement and shift membership keeps pointing at a person who still exists.
 * Deleting them would orphan the history the whole dashboard is built on.
 *
 * It also **backfills the rows a Phase 4 migration could not add**: the three
 * *Razgovor* channels and the two shift templates are seed data, not schema, so
 * a database seeded before Phase 4 has the tables and none of the rows — which
 * is why *Razgovor* opened on an empty list and *Raspored* said "Nema nijednog
 * šablona smjene" on every day of the week.
 *
 * Safe to run while the dev server is up: SQLite in WAL mode lets two processes
 * write. Runs with `.env` loaded (`node --env-file`) so the hash uses the same
 * `PIN_PEPPER` as the server — a different pepper makes every PIN fail.
 *
 * `SANK_DEV_CAST=full` applies the suites' cast instead, which is what a
 * database driving the Playwright suite wants.
 */
import { isAbsolute, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { openDatabase } from './client'
import * as schema from './schema'
import { hashSecret, verifySecret } from '../utils/password'
import { roster } from './seed'
import { CHANNEL_KINDS, CHANNEL_NAMES } from '#shared/chat'

const cast = process.env.SANK_DEV_CAST === 'full' ? 'full' : 'default'
const wanted = roster(cast)

const configured = process.env.DB_PATH || 'data/sank.db'
const file = isAbsolute(configured) ? configured : resolve(process.cwd(), configured)

const { db, sqlite } = openDatabase(file)
const now = new Date().toISOString()

const venue = db.select().from(schema.venues).get()
if (!venue) {
  console.error(`[sank] ${file} has no venue — run \`npm run db:seed\` first.`)
  sqlite.close()
  process.exit(1)
}
const venueId = venue.id

const existing = db.select().from(schema.users).all()
const byId = new Map(existing.map(person => [person.id, person]))
const keep = new Set(wanted.map(person => person.id))

const made: string[] = []
const set: string[] = []
const off: string[] = []

for (const person of wanted) {
  const isAdmin = person.role === 'admin'
  const secrets = {
    pinHash: hashSecret(person.pin, person.id),
    pinLen: person.pin.length === 6 ? (6 as const) : (4 as const),
    pinSetAt: now,
    pinPepperV: 1,
    active: 1 as const,
    role: person.role,
    // Only the one admin with the e-mail door carries either; everybody else
    // has both cleared, so a name that changes role cannot keep a stale login.
    email: isAdmin && person.email ? person.email : null,
    passwordHash: isAdmin && person.password ? hashSecret(person.password, person.id) : null,
  }

  if (byId.has(person.id)) {
    db.update(schema.users).set(secrets).where(eq(schema.users.id, person.id)).run()
    set.push(`${person.name} ${person.pin}`)
  } else {
    db.insert(schema.users).values({
      id: person.id,
      venueId,
      name: person.name,
      initials: person.name.slice(0, 2).toUpperCase(),
      logSeenAt: null,
      createdAt: now,
      ...secrets,
    }).run()
    made.push(`${person.name} ${person.pin}`)
  }
}

for (const person of existing) {
  if (keep.has(person.id)) continue
  if (person.active === 1) off.push(person.name)
  // The PIN goes with the deactivation: `requirePinFree` counts only active
  // people, so a stale hash left behind is a number nobody can use and nobody
  // can be given either.
  db.update(schema.users)
    .set({ active: 0, pinHash: null, pinSetAt: null, email: null, passwordHash: null })
    .where(eq(schema.users.id, person.id))
    .run()
}

// -- Seed rows a migration could not write ----------------------------------

const channels = new Set(db.select().from(schema.chatChannels).all().map(row => row.kind))
const addedChannels: string[] = []
for (const kind of CHANNEL_KINDS) {
  if (channels.has(kind)) continue
  db.insert(schema.chatChannels).values({
    id: randomUUID(), venueId, kind, name: CHANNEL_NAMES[kind], createdAt: now,
  }).run()
  addedChannels.push(CHANNEL_NAMES[kind])
}

const templateCount = db
  .select({ n: sql<number>`count(*)` }).from(schema.shiftTemplates).get()?.n ?? 0
const addedTemplates: string[] = []
if (templateCount === 0) {
  // `end_time <= start_time` means the shift ends the next day, which is what
  // *Večernja* 16:00–01:00 is. Wall clocks the owner wrote on a plan, no
  // timezone maths.
  for (const t of [
    { name: 'Dnevna', start: '08:00', end: '16:00', sort: 1 },
    { name: 'Večernja', start: '16:00', end: '01:00', sort: 2 },
  ]) {
    db.insert(schema.shiftTemplates).values({
      id: randomUUID(), venueId, name: t.name,
      startTime: t.start, endTime: t.end, sort: t.sort, active: 1, createdAt: now,
    }).run()
    addedTemplates.push(t.name)
  }
}

// -- The invariant the pad rests on, checked rather than assumed -------------
// A salted hash cannot be compared to another hash, so this is the same
// brute-force the pad itself does — and the same reason the app enforces
// uniqueness with a check inside the transaction and not with a unique index.
const active = db.select().from(schema.users).all()
  .filter(person => person.active === 1 && person.pinHash)

for (const person of wanted) {
  const matches = active
    .filter(row => verifySecret(person.pin, row.id, row.pinHash!))
    .map(row => row.name)
  if (matches.length !== 1 || matches[0] !== person.name) {
    console.error(`[sank] PIN ${person.pin} resolves to ${matches.join(', ') || 'nobody'}, not ${person.name}`)
    sqlite.close()
    process.exit(1)
  }
}

const lengths = new Set(active.map(person => person.pinLen))
if (lengths.size > 1) {
  console.error(`[sank] mixed PIN lengths on one venue: ${[...lengths].join(', ')}`)
  sqlite.close()
  process.exit(1)
}

console.info(`[sank] ${file}`)
if (made.length) console.info(`[sank] created: ${made.join(', ')}`)
if (set.length) console.info(`[sank] updated: ${set.join(', ')}`)
if (off.length) console.info(`[sank] deactivated (history kept): ${off.join(', ')}`)
if (addedChannels.length) console.info(`[sank] Razgovor channels added: ${addedChannels.join(', ')}`)
if (addedTemplates.length) console.info(`[sank] shift templates added: ${addedTemplates.join(', ')}`)
sqlite.close()
