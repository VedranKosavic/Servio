/**
 * Boot: open the database, migrate it, install the triggers — and in dev, seed
 * an empty one so a fresh clone has a venue to look at.
 *
 * A Nitro plugin runs once when the server process starts, before it answers
 * anything. `useDb()` does the work (migrate + applyTriggers); calling it here
 * means a broken migration fails the boot loudly instead of failing the first
 * waiter who taps a table.
 */
import { useDb } from '../utils/db'
import { seedIfEmpty } from '../database/seed'
import { retireUncountedItems } from '../database/retire'

export default defineNitroPlugin(() => {
  const db = useDb()

  if (import.meta.dev) {
    if (seedIfEmpty(db)) {
      // The seed writes all nineteen articles; the café counts sixteen. Run
      // right after a *fresh* seed and never on an existing database, so an
      // article the owner switches back on in `/admin` stays on — see
      // `database/retire.ts`.
      retireUncountedItems(db)
      console.info('[sank] empty database — seeded venue "Lounge"')
    }
  }
})
