/**
 * `npm run db:dev-pins` — testing phase only. Sets every active person's PIN to
 * `SANK_DEV_PIN` (default 1111) and every admin's password to the same value,
 * in place, on the database file at `DB_PATH` (default data/sank.db). Safe to
 * run while the dev server is up: SQLite in WAL mode lets two processes write.
 * Never run this against a real café's database.
 */
import { isAbsolute, resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { openDatabase } from './client'
import * as schema from './schema'
import { hashSecret } from '../utils/password'

const pin = (process.env.SANK_DEV_PIN ?? '1111').trim()
if (!/^\d{4}$|^\d{6}$/.test(pin)) {
  console.error('[sank] SANK_DEV_PIN must be 4 or 6 digits')
  process.exit(1)
}
const configured = process.env.DB_PATH || 'data/sank.db'
const file = isAbsolute(configured) ? configured : resolve(process.cwd(), configured)
const { db, sqlite } = openDatabase(file)
const now = new Date().toISOString()
const people = db.select({ id: schema.users.id, name: schema.users.name, role: schema.users.role, active: schema.users.active })
  .from(schema.users).all().filter(u => u.active)
for (const u of people) {
  const hash = hashSecret(pin, u.id)
  db.update(schema.users).set({
    pinHash: hash,
    pinLen: pin.length === 6 ? 6 : 4,
    pinSetAt: now,
    pinPepperV: 1,
    ...(u.role === 'admin' ? { passwordHash: hash } : {}),
  }).where(eq(schema.users.id, u.id)).run()
}
console.info(`[sank] ${file}: PIN ${pin} for ${people.map(p => p.name).join(', ')}; admin password ${pin}.`)
sqlite.close()
