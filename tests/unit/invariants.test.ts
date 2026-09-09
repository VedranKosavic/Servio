/**
 * The four identities that no single work package could prove on its own.
 *
 * Every other test file in `tests/unit` belongs to one package and checks that
 * package's own arithmetic. These four cross the seams: each one is a number the
 * owner reads on **two different screens**, computed by **two different services
 * written on two different branches**, and the only way either can be wrong is
 * for the two to disagree. That is precisely the bug nobody reports, because
 * each screen is internally consistent and neither looks wrong on its own — the
 * owner just quietly stops trusting the app.
 *
 *   1. `Σ by_category.fen === Σ by_user.promet_fen === promet_fen` — WP2's
 *      summary against itself, on the row that was actually written.
 *   2. `venueExpected === drawerExpected + Σ waiterExpected` — WP2's
 *      reconciliation, which is the whole close.
 *   3. `owner/live.expected_cash_fen === expectedCash().venue_expected_fen` —
 *      WP7's *Puls* against WP2's ledger fold.
 *   4. `Σ kategorije.prodaja === Σ shift_summaries.promet_fen` over one period —
 *      WP4's report against WP2's written rows.
 *
 * All four run against **one seeded night**, built through the real services
 * (locks, a comp, a void, payments, a float, a close) rather than through the
 * row-writing fixture helpers, because the point is the services agreeing.
 *
 * The last section holds the two structural invariants that likewise have no
 * single owner. The rest of the machine-checkable contract lives with its
 * package and is not repeated here: `ROUTE_ROLES` against `server/api/**` in
 * `route-roles.test.ts`, "every mutation bumps or is exempt" in
 * `changes-coverage.test.ts`, the ✔ column against `ALERT_RULE_KEYS` in
 * `alerts.test.ts`, `PIN_BEARING_ROUTES` against the Zod bodies in
 * `pin-routes.test.ts`, `TRIGGER_NAMES` against `sqlite_master` in
 * `schema.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { createOrder } from '../../server/services/orders'
import { createPayment } from '../../server/services/payments'
import { requestAdjustment, decideAdjustment } from '../../server/services/adjustments'
import { tabMoney } from '../../server/services/tabs'
import { closeShift } from '../../server/services/shifts'
import { acknowledgeFloat, expectedCash, moveFloat } from '../../server/services/cash'
import { latestSummary } from '../../server/services/summaries'
import { getLive } from '../../server/services/owner'
import { categoriesReport, monthBounds, periodBounds } from '../../server/services/reports'
import { businessDate } from '#shared/dates'
import { TRIGGER_NAMES } from '#shared/constants'
import { makeFixture, schema, type Fixture } from '../helpers/db'

let f: Fixture

beforeEach(() => { f = makeFixture() })
afterEach(() => { f.close() })

/** Haris's seeded dev PIN — `closeShift` runs the real `verifyPinMetered`. */
const HARIS_PIN = '123456'

interface Night {
  shiftId: string
  countedFen: number
}

/**
 * One night, through the services.
 *
 * Two waiters, five rounds, a comp and a void the bartender approved, a float
 * out of the drawer, and every tab paid — because a tab left open is a 409
 * `OPEN_TABS` and the close is what writes the summary row these identities read.
 */
function seedNight(): Night {
  // The seed is cash-only. Card is turned on here on purpose: a card payment is
  // promet the owner reads on *Smjena* and money that must **not** appear in
  // `expectedCash`, so identity 2 is only really tested when one exists.
  f.settingsWith({ payment_methods: ['cash', 'card'] })

  const shiftId = f.openShift({ members: ['Amar', 'Lejla', 'Emir'] })
  // Without an opening count the close is `NO_OPEN_COUNT`.
  f.submitCount('Emir', ['Kafa (mljevena)'], { phase: 'open' })

  // The drawer hands Amar his change float. It moves `drawer_expected` down and
  // Amar's expectation up by the same 50 KM — identity 2 is what says so.
  //
  // A `float_out` is written `pending` and moves nothing until the person who
  // received it says he has it (§6.5): the drawer must not be able to lighten
  // itself by asserting that somebody took money. So the acknowledgement is part
  // of the fixture, not an afterthought — without it the float is invisible on
  // both sides and the identity would hold trivially.
  const float = moveFloat(f.db, f.venueId, f.adminActor(), shiftId, {
    type: 'float_out', user_id: f.userId('Amar'), amount_fen: 5_000,
  })
  acknowledgeFloat(f.db, f.venueId, f.actor('Amar'), float.id)

  const lock = (who: string, table: string, product: string, qty: number, flavours?: string[]) =>
    createOrder(f.db, f.venueId, f.actor(who), {
      client_id: randomUUID(),
      table_id: f.tableId(table),
      lines: [{
        id: randomUUID(),
        product_id: f.productId(product),
        qty,
        ...(flavours ? { flavour_ids: flavours.map(f.stockItemId) } : {}),
      }],
    } as Parameters<typeof createOrder>[3])

  const pay = (who: string, tabId: string, method: 'cash' | 'card') =>
    createPayment(f.db, f.venueId, f.actor(who), {
      client_id: randomUUID(),
      tab_id: tabId,
      method,
      amount_fen: tabMoney(f.db, f.venueId, tabId).remaining_fen,
      tip_fen: 0,
      covers_order_client_ids: [],
    })

  const a1 = lock('Amar', 'Sto 7', 'Kafa', 2)
  const a2 = lock('Amar', 'Sto 8', 'Coca-Cola', 3)
  // A bowl needs its aromas, and it is the one line whose cost comes off the
  // shelf in grams rather than in pieces — worth having in the fixture, because
  // *Kategorije* prices *utrošak* off exactly that.
  const l1 = lock('Lejla', 'Sto 9', 'Nargila', 1, ['Al Fakher · Jabuka', 'Al Fakher · Menta'])
  const l2 = lock('Lejla', 'Sto 10', 'Red Bull', 2)
  const l3 = lock('Lejla', 'Sto 11', 'Čaj', 1)

  // *Na račun kuće* on one of Lejla's rounds, and a void on one of Amar's.
  // Both go through the bartender, so both are `applied` and both move promet.
  const comp = requestAdjustment(f.db, f.venueId, f.actor('Lejla'), {
    client_id: randomUUID(),
    order_line_id: lineOf(l3.order_id),
    kind: 'comp',
    reason: 'gost_ceka',
  })
  if (comp.adjustment.status === 'pending') {
    decideAdjustment(f.db, f.venueId, f.adminActor(), comp.adjustment.id, { outcome: 'applied' })
  }

  const strike = requestAdjustment(f.db, f.venueId, f.actor('Amar'), {
    client_id: randomUUID(),
    order_line_id: lineOf(a2.order_id),
    kind: 'void',
    reason: 'wrong_entry',
  })
  if (strike.adjustment.status === 'pending') {
    decideAdjustment(f.db, f.venueId, f.adminActor(), strike.adjustment.id, { outcome: 'applied' })
  }

  pay('Amar', a1.tab_id, 'cash')
  pay('Amar', a2.tab_id, 'cash')
  pay('Lejla', l1.tab_id, 'card')
  pay('Lejla', l2.tab_id, 'cash')
  pay('Lejla', l3.tab_id, 'cash')

  // Count exactly what the ledger expects, so the close is inside tolerance and
  // `diff_fen` is 0 — these identities are about agreement, not about a variance.
  const countedFen = expectedCash(f.db, f.venueId, shiftId).venue_expected_fen
  return { shiftId, countedFen }
}

function close(night: Night): void {
  closeShift(f.db, f.venueId, f.adminActor(), night.shiftId, {
    cash_counted_fen: night.countedFen,
    closing_note: 'sve u redu',
    pin: HARIS_PIN,
  })
}

/** The one line of a one-line round. */
function lineOf(orderId: string): string {
  return f.db.select().from(schema.orderLines)
    .where(eq(schema.orderLines.orderId, orderId)).all()[0]!.id
}

// ===========================================================================
// 1 — the summary reconciles to itself
// ===========================================================================

describe('the written summary adds up three ways', () => {
  /**
   * `promet_fen` is the headline on *Smjena*; `by_user` is the per-person
   * breakdown under it; `by_category` is what *Kategorije* drills into. They are
   * three different folds of the same lines, computed in three different loops,
   * and the owner reads all three on one screen. A disagreement of one fen means
   * one of the loops has a case the others do not.
   *
   * The assertion is on the **written row**, not on the live fold: a summary is
   * serialised to `shift_summaries` at the close and every later screen reads
   * that, so an identity that only holds before serialisation holds nowhere that
   * matters.
   */
  it('Σ by_category.fen === Σ by_user.promet_fen === promet_fen', () => {
    const night = seedNight()
    close(night)

    const summary = latestSummary(f.db, f.venueId, night.shiftId)
    expect(summary, 'the close wrote no summary row').not.toBeNull()

    const byCategory = summary!.by_category.reduce((n, c) => n + c.fen, 0)
    const byUser = summary!.by_user.reduce((n, u) => n + u.promet_fen, 0)

    expect(byCategory).toBe(summary!.promet_fen)
    expect(byUser).toBe(summary!.promet_fen)

    // …and the night was not empty, or all three would be 0 and this would pass
    // without proving anything.
    expect(summary!.promet_fen).toBeGreaterThan(0)
    expect(summary!.by_user.filter(u => u.promet_fen > 0)).toHaveLength(2)
    expect(summary!.by_category.length).toBeGreaterThan(2)
  })

  it('counts the comp and the applied void out of promet, not into it', () => {
    const night = seedNight()
    close(night)
    const summary = latestSummary(f.db, f.venueId, night.shiftId)!

    // The fixture raised exactly one of each; if a future change stops applying
    // them the identity above would still hold — over a night with nothing in it.
    expect(summary.comp_fen).toBeGreaterThan(0)
    expect(summary.void_fen).toBeGreaterThan(0)
  })
})

// ===========================================================================
// 2 — the drawer and the waiters add up to the venue
// ===========================================================================

describe('the cash reconciliation', () => {
  /**
   * This is the close, in one line. `venue_expected_fen` is what the owner
   * counts against; `drawer_expected_fen` is what should be in the till; each
   * waiter's `expected_fen` is what should be in his pocket. If the three do not
   * add up, somebody is accused of a shortfall that is really an accounting
   * error — which is the single worst failure mode this app has.
   */
  it('venueExpected === drawerExpected + Σ waiterExpected, after every event', () => {
    const night = seedNight()

    const ec = expectedCash(f.db, f.venueId, night.shiftId)
    const waiters = ec.waiters.reduce((n, w) => n + w.expected_fen, 0)

    expect(ec.venue_expected_fen).toBe(ec.drawer_expected_fen + waiters)
    expect(ec.waiters.length).toBeGreaterThan(1)

    // The 50 KM float really did move: it left the drawer and landed on Amar.
    const amar = ec.waiters.find(w => w.name === 'Amar')!
    expect(amar.float_out_fen).toBe(5_000)
  })

  it('still holds once the night is closed', () => {
    const night = seedNight()
    close(night)

    const ec = expectedCash(f.db, f.venueId, night.shiftId)
    expect(ec.venue_expected_fen)
      .toBe(ec.drawer_expected_fen + ec.waiters.reduce((n, w) => n + w.expected_fen, 0))
  })
})

// ===========================================================================
// 3 — Puls shows the ledger's number, not its own
// ===========================================================================

describe('GET /api/owner/live', () => {
  /**
   * *Puls* is the first thing the owner opens and `Očekivano u kasi` is the
   * first number on it. WP7 computes the screen and WP2 computes the money;
   * the screen must not have an opinion.
   */
  it('expected_cash_fen is exactly expectedCash().venue_expected_fen', () => {
    const night = seedNight()

    const live = getLive(f.db, f.venueId, f.adminActor())
    const ec = expectedCash(f.db, f.venueId, night.shiftId)

    expect(live.expected_cash_fen).toBe(ec.venue_expected_fen)
    expect(live.expected_cash_fen).toBeGreaterThan(0)
  })

  /**
   * The half-past-four case (§6.10): the shift is closed, the business day has
   * not rolled over yet, and *Puls* must still show the night it just had rather
   * than a screen of zeros. `getLive` falls back to the newest shift on today's
   * business date, and this is the assertion that keeps it doing so.
   */
  it('still reads the closed night before the business day rolls over', () => {
    const night = seedNight()
    close(night)

    const live = getLive(f.db, f.venueId, f.adminActor())
    const ec = expectedCash(f.db, f.venueId, night.shiftId)

    expect(live.shift).toBeNull() // nothing is open any more
    expect(live.expected_cash_fen).toBe(ec.venue_expected_fen)
    expect(live.promet_danas_fen).toBeGreaterThan(0)
  })
})

// ===========================================================================
// 4 — the two reports over the same period
// ===========================================================================

describe('the categories report and the shift summaries', () => {
  /**
   * *Kategorije* sums `charged_fen` less applied voids, grouped by the product's
   * category over a date range. *Smjene* sums the same money per night and
   * stores it in `shift_summaries.promet_fen`. Same takings, two folds, two
   * packages — and the owner compares them by eye, so they had better agree.
   *
   * `reports.test.ts` already asserts this against the **live** fold
   * (`summarizeShift`). This one asserts it against the **written rows**, which
   * is what the *Smjene* list actually renders, and is therefore the version
   * that catches a serialisation bug rather than an arithmetic one.
   */
  it('Σ prodaja over the month === Σ promet_fen of the summaries inside it', () => {
    const night = seedNight()
    close(night)

    const month = businessDate(new Date().toISOString()).slice(0, 7)
    const { fromDay, toDay } = monthBounds(month)
    const { from, to } = periodBounds(f.db, f.venueId, fromDay, toDay)

    const prodaja = categoriesReport(f.db, f.venueId, from, to)
      .rows.reduce((n, r) => n + r.prodaja_fen, 0)

    const promet = f.db.select().from(schema.shiftSummaries)
      .where(eq(schema.shiftSummaries.venueId, f.venueId))
      .all()
      // One night, one close, one version — but sum only the newest per shift,
      // because a late void writes a v2 beside v1 and both rows stay.
      .filter(row => row.version === latestVersion(row.shiftId))
      .reduce((n, row) => n + row.prometFen, 0)

    expect(prodaja).toBe(promet)
    expect(prodaja).toBeGreaterThan(0)
  })
})

function latestVersion(shiftId: string): number {
  return Math.max(...f.db.select().from(schema.shiftSummaries)
    .where(eq(schema.shiftSummaries.shiftId, shiftId))
    .all()
    .map(r => r.version))
}

// ===========================================================================
// The structural invariants with no single owner
// ===========================================================================

const API_DIR = resolve(process.cwd(), 'server/api')
const TASKS_DIR = resolve(process.cwd(), 'server/tasks')

/** Source with block and line comments removed — the same helper `tenant.test.ts` uses. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith('.ts')) out.push(full)
  }
  return out
}

describe('no request handler picks its own venue', () => {
  /**
   * **The invariant WP8 exists to install.** `event.context.venueId` is put on
   * the request by `server/middleware/tenant.ts`, out of the session; a handler
   * that calls `currentVenueId(db)` instead is a handler that reads "the only
   * row in `venues`" and would serve the wrong café the day there are two —
   * *and*, more immediately, a handler that works without a session, which is
   * how the Korak 1 escape hatch stayed open as long as it did.
   *
   * One exception, and it is structural rather than a leftover:
   * `POST /api/dev/enrol` mints the first device cookie, so it runs before any
   * session or venue can be known. It 404s unless `SANK_DEV_ENROL=1`, which
   * `/opt/sank/.env` never sets.
   */
  const ALLOWED = [join('dev', 'enrol.post.ts')]

  it('calls currentVenueId from exactly one route file, the dev door', () => {
    const offenders = walk(API_DIR)
      // Comments stripped first: several handlers *explain* in a comment that
      // they no longer call this, and a grep that counted those would make the
      // documentation the thing that fails the build.
      .filter(path => /\bcurrentVenueId\s*\(/.test(code(readFileSync(path, 'utf8'))))
      .map(path => relative(API_DIR, path))
      .sort()

    expect(offenders).toEqual(ALLOWED)
  })

  it('reads the actor or the venue off the context in every other handler', () => {
    // A sanity check on the walker: if it stopped finding files, the assertion
    // above would pass on an empty list.
    const files = walk(API_DIR)
    expect(files.length).toBeGreaterThan(60)

    const usingContext = files.filter(path =>
      /event\.context\.(venueId|actor)/.test(readFileSync(path, 'utf8')))
    expect(usingContext.length).toBeGreaterThan(50)
  })
})

describe('the scheduled tasks', () => {
  /**
   * A task file nobody schedules never runs and nothing says so; a schedule
   * naming a file that does not exist crashes Nitro at boot. The two lists live
   * in different files (`server/tasks/*.ts` and `nuxt.config.ts`), so this is
   * the only place they can be compared.
   */
  const config = readFileSync(resolve(process.cwd(), 'nuxt.config.ts'), 'utf8')

  const onDisk = readdirSync(TASKS_DIR)
    .filter(name => name.endsWith('.ts'))
    .map(name => name.replace(/\.ts$/, ''))
    .sort()

  const scheduled = [...config.matchAll(/'[\d*/, -]+': \[([^\]]+)\]/g)]
    .flatMap(m => [...m[1]!.matchAll(/'([a-z-]+)'/g)].map(x => x[1]!))
    .sort()

  it('are the same set as the files in server/tasks', () => {
    expect(onDisk).toEqual(['backup', 'nightly'])
    expect(scheduled).toEqual(onDisk)
  })

  it('are behind the experimental flag Nitro still requires', () => {
    expect(config).toMatch(/experimental:\s*\{\s*tasks:\s*true\s*\}/)
  })

  it('do nothing while a test suite owns the database', async () => {
    // Every task's first line. Without it, `npm test` would take real backups
    // and prune real rows.
    for (const name of onDisk) {
      const source = readFileSync(join(TASKS_DIR, `${name}.ts`), 'utf8')
      expect(source, `${name} does not check tasksDisabled()`).toMatch(/tasksDisabled\(\)/)
    }
    const { tasksDisabled } = await import('../../server/utils/tasks')
    expect(tasksDisabled()).toBe(true)
  })
})

describe('triggers.sql and TRIGGER_NAMES', () => {
  /**
   * `schema.test.ts` asserts every name in `TRIGGER_NAMES` exists in the
   * database. This is the other direction, which nothing else checks: a trigger
   * added to `triggers.sql` and never registered is a rule that silently
   * disappears the day a table rebuild drops it, because the list that would
   * have noticed does not know it was there.
   */
  it('has nothing installed that nobody declared', () => {
    const installed = f.sqlite
      .prepare("select name from sqlite_master where type = 'trigger' order by name")
      .all()
      .map(row => (row as { name: string }).name)

    const undeclared = installed.filter(name => !(TRIGGER_NAMES as readonly string[]).includes(name))
    expect(undeclared).toEqual([])
    expect(installed.length).toBe(TRIGGER_NAMES.length)
  })
})
