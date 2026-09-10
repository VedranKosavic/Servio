/**
 * *Pravila* (PHASE4 §2.8) — versions, acknowledgements, and the one thing this
 * feature deliberately does **not** do.
 *
 * The last block is that one: nothing on the server refuses an order because a
 * waiter has not read v3. Refusing to record a round the guest is already
 * drinking would put money outside the ledger, which is the single thing this
 * application exists to prevent. The gate is a screen, and the evidence is the
 * `rules_acked` entry with its timestamp.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFixture, schema, type Fixture } from '../helpers/db'
import { expectCode } from '../helpers/phase4'
import { ackRules, latestRules, listRuleVersions, publishRules } from '../../server/services/rules'
import { createOrder } from '../../server/services/orders'
import { getChanges, maxSeq } from '../../server/services/changes'

let f: Fixture

beforeEach(() => { f = makeFixture() })
afterEach(() => { f.close() })

const V1 = '# Pravila\n\nSlike samo šanka, robe i prostora — gosti nikad.'
const V2 = '# Pravila\n\nSlike samo šanka, robe i prostora — gosti nikad.\n\nNovo: tolerancija kase.'

const publish = (md: string) =>
  publishRules(f.db, f.venueId, f.adminActor(), { body_md: md }, f.clock.now())

describe('a venue with nothing published', () => {
  it('asks nobody to acknowledge anything', () => {
    const view = latestRules(f.db, f.venueId, f.actor('Amar'))
    expect(view.version).toBe(0)
    expect(view.body_md).toBe('')
    expect(view.must_ack).toBe(false)
  })

  it('refuses an acknowledgement of nothing', () => {
    expectCode(() => ackRules(f.db, f.venueId, f.actor('Amar'), 1, f.clock.now()),
      'RULES_NOT_PUBLISHED')
  })
})

describe('publishRules', () => {
  it('numbers versions from 1 and never edits one', () => {
    expect(publish(V1).version).toBe(1)
    expect(publish(V2).version).toBe(2)

    const versions = listRuleVersions(f.db, f.venueId)
    expect(versions.map(v => v.version)).toEqual([2, 1])
    expect(versions[1]!.body_md).toBe(V1)
  })

  it('posts one Svi line naming the version, and a Dnevnik entry', () => {
    publish(V1)
    const line = f.db.select().from(schema.chatMessages).all()
      .find(m => m.systemKey === 'rules_published')!
    expect(line.body).toBe('Objavljena su nova Pravila (v1)')
    expect(JSON.parse(line.systemPayloadJson!).link.route).toBe('/konobar/pravila')

    expect(f.db.select().from(schema.logEntries).all()
      .some(e => e.kind === 'rules_published')).toBe(true)
  })

  it('moves rules_version on the change feed so every phone re-evaluates its gate', () => {
    const before = maxSeq(f.db, f.venueId)
    publish(V1)
    const changed = getChanges(f.db, f.venueId, f.actor('Amar'), before)
    expect(changed.rules_version).toBe(1)
  })
})

describe('ackRules', () => {
  it('records who and when, and clears must_ack for that person only', () => {
    publish(V1)
    expect(latestRules(f.db, f.venueId, f.actor('Amar')).must_ack).toBe(true)

    const at = f.clock.now()
    const after = ackRules(f.db, f.venueId, f.actor('Amar'), 1, at)
    expect([after.must_ack, after.my_ack_version, after.my_ack_at]).toEqual([false, 1, at])

    // Nobody else was touched.
    expect(latestRules(f.db, f.venueId, f.actor('Lejla')).must_ack).toBe(true)

    const stored = f.db.select().from(schema.users)
      .where(eq(schema.users.id, f.userId('Amar'))).get()!
    expect([stored.rulesVersion, stored.rulesAckAt]).toEqual([1, at])
  })

  it('brings must_ack back the moment a new version lands', () => {
    publish(V1)
    ackRules(f.db, f.venueId, f.actor('Amar'), 1, f.clock.now())
    publish(V2)
    expect(latestRules(f.db, f.venueId, f.actor('Amar')).must_ack).toBe(true)
  })

  it('refuses an acknowledgement of an old version — 409 RULES_STALE', () => {
    publish(V1)
    publish(V2)
    expectCode(() => ackRules(f.db, f.venueId, f.actor('Amar'), 1, f.clock.now()), 'RULES_STALE')
  })

  it('writes a quiet rules_acked entry with the version in it', () => {
    publish(V1)
    ackRules(f.db, f.venueId, f.actor('Amar'), 1, f.clock.now())

    const entry = f.db.select().from(schema.logEntries).all()
      .find(e => e.kind === 'rules_acked')!
    expect(JSON.parse(entry.bodyJson)).toMatchObject({ user_id: f.userId('Amar'), version: 1 })
  })
})

describe('the owner\'s acknowledgement list', () => {
  it('is on the current version only, and shows an old ack as not yet given', () => {
    publish(V1)
    ackRules(f.db, f.venueId, f.actor('Amar'), 1, f.clock.now())

    const v1 = listRuleVersions(f.db, f.venueId)[0]!
    expect(v1.acks!.find(a => a.user_name === 'Amar')!.at).not.toBeNull()
    expect(v1.acks!.find(a => a.user_name === 'Lejla')!.at).toBeNull()

    publish(V2)
    const versions = listRuleVersions(f.db, f.venueId)
    expect(versions[0]!.acks).toBeDefined()
    expect(versions[1]!.acks).toBeUndefined()
    // Amar is on v1, and the current version is v2: not yet.
    expect(versions[0]!.acks!.find(a => a.user_name === 'Amar')!.at).toBeNull()
  })
})

/**
 * The sentence PHASE4 §2.8 spends a paragraph on, as a test.
 */
describe('the ack gate is a client rule', () => {
  it('does not stop a waiter who has never read the rules from locking a round', () => {
    publish(V2)
    expect(latestRules(f.db, f.venueId, f.actor('Amar')).must_ack).toBe(true)

    const order = createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 7'),
      lines: [{ id: randomUUID(), product_id: f.productId('Kafa'), qty: 1 }],
    })
    expect(order.order_id).toBeTruthy()
  })
})

describe('rules, at the database level', () => {
  it('refuses an UPDATE and a DELETE — a correction is a new version', () => {
    publish(V1)
    const row = f.db.select().from(schema.rules).all()[0]!

    f.expectRefused(`UPDATE rules SET body_md = 'izmijenjeno' WHERE id = '${row.id}'`, /append-only/)
    f.expectRefused(`DELETE FROM rules WHERE id = '${row.id}'`, /append-only/)
  })

  it('refuses a second row with the same version', () => {
    publish(V1)
    const row = f.db.select().from(schema.rules).all()[0]!
    f.expectRefused(
      `INSERT INTO rules (id, venue_id, version, body_md, published_at, published_by)`
      + ` VALUES ('dup', '${f.venueId}', 1, 'x', '${row.publishedAt}', '${row.publishedBy}')`,
      /UNIQUE constraint failed/,
    )
  })
})
