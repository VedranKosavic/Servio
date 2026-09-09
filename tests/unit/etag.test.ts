/**
 * ETag (`docs/BACKEND.md` §4.2).
 *
 * The test that matters most is the last one: the shared bar tablet. One
 * browser profile, three people through it in a night — so the validator must
 * carry *who is asking*, or the second person is served the first person's
 * numbers out of his own cache and the server is never asked.
 */
import { randomUUID } from 'node:crypto'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent, type H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFixture, type Fixture } from '../helpers/db'
import { withEtag } from '../../server/utils/etag'
import { changeTag, getChanges } from '../../server/services/changes'
import { getTablesState, tablesStateTag } from '../../server/services/tabs'
import { prepTag } from '../../server/services/prep'
import { bootstrapTag } from '../../server/services/bootstrap'
import { createOrder } from '../../server/services/orders'

let f: Fixture

beforeEach(() => { f = makeFixture() })
afterEach(() => { f.close() })

function makeEvent(ifNoneMatch?: string): H3Event {
  const req = new IncomingMessage(new Socket())
  req.method = 'GET'
  req.url = '/api/changes?since=0'
  if (ifNoneMatch) req.headers['if-none-match'] = ifNoneMatch
  return createEvent(req, new ServerResponse(req))
}

function lockOne(waiter = 'Amar', table = 'Sto 7') {
  return createOrder(f.db, f.venueId, f.actor(waiter), {
    client_id: randomUUID(),
    table_id: f.tableId(table),
    lines: [{ id: randomUUID(), product_id: f.productId('Kafa'), qty: 1 }],
  })
}

describe('withEtag', () => {
  it('stamps the tag and the cache headers on a fresh request', () => {
    const event = makeEvent()
    const body = withEtag(event, '7-admin-abcd1234', () => ({ ok: true }))

    expect(body).toEqual({ ok: true })
    expect(event.node.res.getHeader('ETag')).toBe('W/"7-admin-abcd1234"')
    // `no-cache`, never `no-store`: `no-store` would leave the browser with no
    // stored copy and therefore no validator, and the whole 304 path below
    // would be dead code.
    expect(event.node.res.getHeader('Cache-Control')).toBe('private, no-cache')
    expect(event.node.res.getHeader('Vary')).toBe('Cookie')
  })

  it('a matching If-None-Match is a 304 with no body and no work', () => {
    const produce = vi.fn(() => ({ ok: true }))
    const event = makeEvent('W/"7-admin-abcd1234"')

    const body = withEtag(event, '7-admin-abcd1234', produce)

    expect(body).toBeUndefined()
    expect(event.node.res.statusCode).toBe(304)
    // Not "the body was discarded" — the snapshot query never ran at all.
    expect(produce).not.toHaveBeenCalled()
  })

  it('compares weakly, so a stripped W/ prefix still matches', () => {
    const event = makeEvent('"7-admin-abcd1234"')
    expect(withEtag(event, '7-admin-abcd1234', () => ({ ok: true }))).toBeUndefined()
    expect(event.node.res.statusCode).toBe(304)
  })

  it('never emits a quote inside the quoted string', () => {
    const event = makeEvent()
    withEtag(event, 'max_at-{"important":true}', () => ({ ok: true }))

    const header = String(event.node.res.getHeader('ETag'))
    // Exactly two quotes: the ones that delimit the tag.
    expect(header.match(/"/g)).toHaveLength(2)
    expect(header).toBe('W/"max_at-{_important_:true}"')
  })

  it('a stale tag returns 200 and the fresh body', () => {
    const event = makeEvent('W/"6-admin-abcd1234"')
    expect(withEtag(event, '7-admin-abcd1234', () => ({ ok: true }))).toEqual({ ok: true })
    expect(event.node.res.statusCode).not.toBe(304)
  })
})

describe('changeTag', () => {
  it('moves when a mutation moves the sequence', () => {
    const before = changeTag(f.db, f.venueId, f.adminActor())
    lockOne()
    expect(changeTag(f.db, f.venueId, f.adminActor())).not.toBe(before)
  })

  it('differs by role AND by user at the same maxSeq', () => {
    lockOne()
    const admin = changeTag(f.db, f.venueId, f.adminActor())
    const amar = changeTag(f.db, f.venueId, f.actor('Amar'))
    const lejla = changeTag(f.db, f.venueId, f.actor('Lejla'))

    expect(admin).not.toBe(amar)
    // Two waiters, same role, same sequence — and still two tags, because
    // `my_open_tabs` and a colleague's tile are different answers.
    expect(amar).not.toBe(lejla)
  })

  it('a waiter presenting the admin tag gets a 200 with a staff-shaped body', () => {
    lockOne()
    f.voidLine('Amar', f.lock('Amar', 'Sto 9', [{ product: 'Kafa' }]).lineIds[0]!)

    const adminTag = changeTag(f.db, f.venueId, f.adminActor())
    const waiter = f.actor('Amar')
    const event = makeEvent(`W/"${adminTag}"`)

    const body = withEtag(event, changeTag(f.db, f.venueId, waiter), () =>
      getChanges(f.db, f.venueId, waiter, 0))

    expect(event.node.res.statusCode).not.toBe(304)
    expect(body).toBeDefined()
    // The queues are the admin's and the bartender's; the waiter's answer has
    // no `pending` key at all, not a zeroed one.
    expect(body?.pending).toBeUndefined()
    expect(body?.log_max_at).toBeUndefined()
  })
})

/**
 * The three heavy reads BACKEND §7 marks "(ETag)" and Phase 1 shipped without
 * one. On `/a` this is what keeps a laptop that has four or five reads open all
 * evening down to a `MAX(seq)` per poll.
 */
describe('the three read tags', () => {
  it('each one moves with the sequence and carries the user', () => {
    const tags = [tablesStateTag, prepTag, bootstrapTag]

    for (const tag of tags) {
      const before = tag(f.db, f.venueId, f.actor('Amar'))
      // Two people at the same sequence must never share a tag: these envelopes
      // carry `my_settled`, `my_open_tabs` and `me`.
      expect(tag(f.db, f.venueId, f.actor('Lejla'))).not.toBe(before)
      expect(tag(f.db, f.venueId, f.adminActor())).not.toBe(before)

      lockOne('Dino', 'Sto 11')
      expect(tag(f.db, f.venueId, f.actor('Amar'))).not.toBe(before)
    }
  })

  it('an unchanged floor plan is a 304 with no query behind it', () => {
    lockOne()
    const actor = f.actor('Amar')
    const tag = tablesStateTag(f.db, f.venueId, actor)

    const produce = vi.fn(() => getTablesState(f.db, f.venueId, actor))
    const body = withEtag(makeEvent(`W/"${tag}"`), tag, produce)

    expect(body).toBeUndefined()
    expect(produce).not.toHaveBeenCalled()
  })
})
