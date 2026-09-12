/**
 * The three articles the café decided to stop counting.
 *
 * *Ugalj (kocke)*, *Šećer* and *Kafa (mljevena)* are consumables nobody weighs
 * against a ledger: the owner's words are that coffee is effectively infinite,
 * unlike a bottle of Coca-Cola, so a *Stanje šanka* row for it is a number that
 * is never right and never acted on. They come off the shelf — and off every
 * normativ, which is the half that matters, because a sale deducting from an
 * article nobody counts is what puts the shelf *u minusu* for no reason.
 *
 * **Deactivated, never deleted.** Every one of the three has `stock_movements`
 * rows behind it (an opening balance, months of sales) and that ledger is
 * append-only: deleting the article would either orphan a foreign key or take a
 * night's history with it. `active = 0` is the whole removal — `GET /api/stock`
 * and the owner's shelf read both list active articles only — and it is
 * reversible from `/admin` the day the café decides to count coal again.
 *
 * **The normativ lines go.** `recipe_lines` is configuration and not a ledger
 * (`triggers.sql` names it as mutable), and a line pointing at a deactivated
 * article is the one shape that would keep the order lock deducting from
 * something the shelf no longer shows. So *Kafa* keeps its price, its tile and
 * its place on the waiter's screen and simply consumes nothing; *Nes* keeps its
 * *Nes* line and *Čaj* its *Čaj (vrećice)* line, because those articles are
 * still counted.
 *
 * **Coal stops being deducted by itself.** `coalStockItem()` in
 * `services/orders.ts` resolves the venue's coal as the *active* `kind='zar'`
 * article, so `coal_pcs` on the nargila product finds nothing and adds no
 * movement. `products.coal_pcs` is deliberately left alone: it is the café's
 * norm ("three pieces per bowl"), it is edited on screens this file has no
 * business rewriting, and the day an active `zar` article exists again the
 * deduction comes back on its own.
 *
 * **What it costs, plainly.** Coal is a real cost in a shisha lounge, and after
 * this it is tracked nowhere: no `stock_movements` row is written for the three
 * pieces a bowl burns, no popis counts the box, and no *nisko* warning says the
 * box is nearly empty. So the *utrošak* for *Nargila* understates by exactly the
 * coal — the tobacco in the report is the whole of it — and the same is true of
 * the sugar in every coffee. The café asked for this and is entitled to it; what
 * it must not be is a surprise at the end of a month.
 *
 * Run by hand against a real database (`npm run db:retire`), and by
 * `seed-cli.ts` and the dev boot plugin right after a fresh seed — `seed.ts`
 * still creates all nineteen articles, and this is the in-place correction, the
 * same shape `db:roster` has for the staff list.
 */
import { eq, inArray } from 'drizzle-orm'
import type { Db } from './client'
import * as schema from './schema'

/**
 * Which articles, by name.
 *
 * Matched on a folded name — lower case, no diacritics, punctuation collapsed —
 * so the café's own spelling ("Secer", "Kafa mljevena", "Ugalj kocke") lands on
 * the same key as the seed's. Coal is matched on `kind = 'zar'` as well, which
 * is how `coalStockItem()` finds it and therefore the name-independent answer
 * to "which article is the coal".
 */
const RETIRED_KEYS: ReadonlySet<string> = new Set([
  'kafa mljevena',
  'secer',
  'ugalj kocke',
  // Added after the owner saw the shelf: coffee, sugar, coal and lemon are the
  // things nobody weighs. *Nes* and *Čaj (vrećice)* stay — they come in jars
  // and boxes somebody does count.
  'limun',
])

/**
 * Fold a name to one comparable key: "Šećer" and "secer" are the same article.
 *
 * `NFD` splits an accented letter into its base letter plus a combining mark
 * and the regex drops the marks, so č → c and ć → c; đ is not a combining pair
 * in Unicode, hence the explicit replace. The same three lines as `fold()` in
 * `services/scan.ts`, kept here rather than imported so a database script does
 * not pull the scan service in behind it.
 */
function key(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export interface RetireResult {
  /** The articles this call switched off, in the order it found them. */
  deactivated: Array<{ id: string, name: string }>
  /** Articles that were already inactive — a second run reports them here. */
  alreadyInactive: Array<{ id: string, name: string }>
  /** How many `recipe_lines` rows pointed at an inactive article and are gone. */
  recipeLinesRemoved: number
}

/**
 * Switch the three articles off in every venue of this database, and drop every
 * normativ line pointing at an inactive article.
 *
 * Idempotent: a second run deactivates nothing, deletes nothing and says so.
 * One transaction, because an article switched off while its normativ line
 * survives is exactly the state this is here to prevent.
 */
export function retireUncountedItems(db: Db): RetireResult {
  return db.transaction((tx) => {
    const items = tx.select({
      id: schema.stockItems.id,
      name: schema.stockItems.name,
      kind: schema.stockItems.kind,
      active: schema.stockItems.active,
    }).from(schema.stockItems).all()

    const wanted = items.filter(item => item.kind === 'zar' || RETIRED_KEYS.has(key(item.name)))

    const deactivated: Array<{ id: string, name: string }> = []
    const alreadyInactive: Array<{ id: string, name: string }> = []

    for (const item of wanted) {
      if (item.active === 0) {
        alreadyInactive.push({ id: item.id, name: item.name })
        continue
      }
      tx.update(schema.stockItems)
        .set({ active: 0 })
        .where(eq(schema.stockItems.id, item.id))
        .run()
      deactivated.push({ id: item.id, name: item.name })
    }

    // Every normativ line pointing at an article that is now inactive — the
    // three of them and any the owner switched off earlier from `/admin`, which
    // is the same bug with a different cause.
    const inactiveIds = tx.select({ id: schema.stockItems.id })
      .from(schema.stockItems)
      .where(eq(schema.stockItems.active, 0))
      .all()
      .map(row => row.id)

    let recipeLinesRemoved = 0
    if (inactiveIds.length > 0) {
      const doomed = tx.select({ id: schema.recipeLines.id })
        .from(schema.recipeLines)
        .where(inArray(schema.recipeLines.stockItemId, inactiveIds))
        .all()
      if (doomed.length > 0) {
        tx.delete(schema.recipeLines)
          .where(inArray(schema.recipeLines.id, doomed.map(row => row.id)))
          .run()
        recipeLinesRemoved = doomed.length
      }
    }

    return { deactivated, alreadyInactive, recipeLinesRemoved }
  })
}

/**
 * Is this article one of the three? Exported for the CLI's dry summary and for
 * the test that pins the match, so the rule is stated once.
 */
export function isUncounted(item: { name: string, kind: string }): boolean {
  return item.kind === 'zar' || RETIRED_KEYS.has(key(item.name))
}
