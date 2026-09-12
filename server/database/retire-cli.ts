/**
 * `npm run db:retire` — take *Ugalj (kocke)*, *Šećer* and *Kafa (mljevena)* off
 * the shelf of an existing database, in place.
 *
 * The same shape as `db:roster`: it changes data a migration cannot write
 * sensibly (the articles are matched by name, and a café's spelling is its own),
 * it is safe to run twice, and it prints exactly what it moved so a database
 * whose article names differ shows up as "0 articles" rather than as a silent
 * success. `retire.ts` says what the change costs and why the rows are
 * deactivated rather than deleted.
 *
 * ```
 * DB_PATH=data/sank.db npm run db:retire
 * ```
 */
import { isAbsolute, resolve } from 'node:path'
import { openDatabase } from './client'
import { retireUncountedItems } from './retire'

const configured = process.env.DB_PATH || 'data/sank.db'
const file = isAbsolute(configured) ? configured : resolve(process.cwd(), configured)

const { db, sqlite } = openDatabase(file)

const result = retireUncountedItems(db)

const names = result.deactivated.map(item => item.name).join(', ')
console.info(
  `[sank] ${file}: ${result.deactivated.length} artikal(a) skinuto sa stanja`
  + (names ? ` — ${names}` : '')
  + `; ${result.recipeLinesRemoved} normativ liniju/a obrisano.`,
)
if (result.alreadyInactive.length > 0) {
  console.info(
    `[sank] već neaktivno: ${result.alreadyInactive.map(item => item.name).join(', ')}`,
  )
}
if (result.deactivated.length === 0 && result.alreadyInactive.length === 0) {
  console.info('[sank] nijedan artikal nije prepoznat — provjeri nazive u /admin.')
}

sqlite.close()
