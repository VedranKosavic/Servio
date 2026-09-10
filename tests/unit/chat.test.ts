/**
 * *Razgovor* — the access matrix, the ordering, and the two triggers.
 *
 * The first block is the one that has to be right: **"the owner never sees
 * *Konobari*"** is a promise published in *Pravila* (CLAUDE.md), and here it is
 * proved on every door — the channel list, the history read, the send, the pin,
 * the forward, the delete and the image URL — including with a forged channel
 * id, which is the shape a curious person would actually try.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFixture, schema, type Fixture } from '../helpers/db'
import { expectCode, jpegBytes, scratchUploads, type Scratch } from '../helpers/phase4'
import { canSee, CHANNEL_KINDS, looksLikeMoney, visibleChannels } from '#shared/chat'
import type { ChannelKind } from '#shared/chat'
import type { Role } from '#shared/types'
import {
  chatHistory, chatSince, chatSnapshot, deleteMessage, forwardMessage,
  markRead, muteUser, postMessage, postSystem, setPin,
} from '../../server/services/chat'
import { createUpload, readUpload } from '../../server/services/uploads'
import { settle } from '../../server/services/settlements'
import { heartbeat } from '../../server/services/heartbeat'
import { getChanges, maxSeq } from '../../server/services/changes'

let f: Fixture
let scratch: Scratch

beforeEach(() => {
  f = makeFixture()
  scratch = scratchUploads()
})
afterEach(() => {
  f.close()
  scratch.cleanup()
})

const send = (name: string, kind: ChannelKind, body: string) =>
  postMessage(f.db, f.venueId, f.actor(name), kind, {
    client_id: randomUUID(), kind: 'text', body,
  })

const channelId = (kind: ChannelKind) =>
  f.db.select().from(schema.chatChannels).all().find(c => c.kind === kind)!.id

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

describe('canSee — four doors, three rooms', () => {
  /**
   * PLAN F12 (a), now two rows instead of three. The šanker and the konobar
   * were always the same row here; since the collapse to `admin | radnik` they
   * are the same *account*, and the screen a worker picked tonight is a
   * `ScreenMode` on his session that this table never sees. *Konobari* stays
   * private from the owner, which is the row that matters.
   */
  const MATRIX: Record<Role, Record<ChannelKind, boolean>> = {
    admin: { svi: true, konobari: false, admini: true },
    radnik: { svi: true, konobari: true, admini: false },
  }

  it.each(['admin', 'radnik'] as Role[])('%s matches PLAN F12 (a)', (role) => {
    for (const kind of CHANNEL_KINDS) expect([role, kind, canSee(role, kind)])
      .toEqual([role, kind, MATRIX[role][kind]])
  })

  it('a worker is staff whichever screen he is on: Konobari yes, Admini no', () => {
    expect(visibleChannels('radnik')).toEqual(['svi', 'konobari'])
    expect(visibleChannels('admin')).toEqual(['svi', 'admini'])
  })
})

describe('every door asks the same question', () => {
  beforeEach(() => {
    send('Amar', 'konobari', 'šank je prljav')
    send('Amar', 'svi', 'nema leda')
  })

  it('the owner\'s channel list has no Konobari row at all — not an empty one', () => {
    const mine = chatSince(f.db, f.venueId, f.adminActor(), null)
    expect(mine.channels.map(c => c.kind)).toEqual(['svi', 'admini'])
    // And no message from it leaked into the flat list either.
    expect(mine.messages.every(m => m.channel !== 'konobari')).toBe(true)
  })

  it('the owner reading Konobari history is 403, not an empty page', () => {
    expectCode(() => chatHistory(f.db, f.venueId, f.adminActor(), 'konobari', null, 50),
      'CHANNEL_FORBIDDEN')
  })

  it.each(['post', 'pin', 'read'])('the owner is refused on %s in Konobari', (what) => {
    const admin = f.adminActor()
    const attempt = {
      post: () => send('Haris', 'konobari', 'vidim vas'),
      pin: () => setPin(f.db, f.venueId, admin, 'konobari', { text: 'x' }),
      read: () => markRead(f.db, f.venueId, admin, 'konobari', 1),
    }[what]!
    expectCode(attempt, 'CHANNEL_FORBIDDEN')
  })

  /**
   * The forged channel id. `deleteMessage` takes a **message** id and finds the
   * channel from the row, so a body naming another channel cannot help — but
   * the check has to be there, and this is it.
   */
  it('the owner deleting a Konobari message is 403 even with the id in hand', () => {
    const konobari = f.db.select().from(schema.chatMessages).all()
      .find(m => m.channelId === channelId('konobari'))!
    expectCode(() => deleteMessage(f.db, f.venueId, f.adminActor(), konobari.id),
      'CHANNEL_FORBIDDEN')
  })

  it('a staff member sees both rooms he is in and not Admini', () => {
    const mine = chatSince(f.db, f.venueId, f.actor('Amar'), null)
    expect(mine.channels.map(c => c.kind)).toEqual(['svi', 'konobari'])
    expectCode(() => chatHistory(f.db, f.venueId, f.actor('Amar'), 'admini', null, 50),
      'CHANNEL_FORBIDDEN')
  })

  it('a reply may not quote across channels — that is what Proslijedi is for', () => {
    const inKonobari = send('Amar', 'konobari', 'tajna')
    expectCode(() => postMessage(f.db, f.venueId, f.actor('Amar'), 'svi', {
      client_id: randomUUID(), kind: 'text', body: 'evo', reply_to_id: inKonobari.message.id,
    }), 'REPLY_CROSS_CHANNEL')
  })
})

// ---------------------------------------------------------------------------
// The photo that crosses a room boundary
// ---------------------------------------------------------------------------

describe('a Konobari photo, and what a forward does to it', () => {
  function photoInKonobari(): { uploadId: string, messageId: string } {
    const upload = createUpload(
      f.db, f.venueId, f.actor('Amar'), { bytes: jpegBytes(320, 240) }, 'chat',
    )
    const message = postMessage(f.db, f.venueId, f.actor('Amar'), 'konobari', {
      client_id: randomUUID(), kind: 'image', upload_id: upload.id, body: 'ovako izgleda šank',
    })
    return { uploadId: upload.id, messageId: message.message.id }
  }

  it('is 404 for the owner — never 403, which would confirm it exists', () => {
    const { uploadId } = photoInKonobari()
    expect(readUpload(f.db, f.venueId, f.adminActor(), uploadId)).toBeNull()
    // …and 200 for the people in the room.
    expect(readUpload(f.db, f.venueId, f.actor('Emir'), uploadId)).not.toBeNull()
  })

  it('becomes 200 for the owner once somebody forwards it with Prijavi vlasniku', () => {
    const { uploadId, messageId } = photoInKonobari()
    forwardMessage(f.db, f.venueId, f.actor('Emir'), messageId, 'admini')
    expect(readUpload(f.db, f.venueId, f.adminActor(), uploadId)).not.toBeNull()
  })

  it('stays 200 for the owner after the author deletes the original', () => {
    const { uploadId, messageId } = photoInKonobari()
    forwardMessage(f.db, f.venueId, f.actor('Emir'), messageId, 'admini')
    deleteMessage(f.db, f.venueId, f.actor('Amar'), messageId)

    // The forwarded copy keeps the evidence alive, and the file is still there:
    // the reference count runs inside the delete transaction.
    expect(readUpload(f.db, f.venueId, f.adminActor(), uploadId)).not.toBeNull()
    const upload = f.db.select().from(schema.uploads)
      .where(eq(schema.uploads.id, uploadId)).get()!
    expect(upload.deletedAt).toBeNull()
  })

  it('the file goes when the last non-deleted message stops pointing at it', () => {
    const { uploadId, messageId } = photoInKonobari()
    deleteMessage(f.db, f.venueId, f.actor('Amar'), messageId)

    const upload = f.db.select().from(schema.uploads)
      .where(eq(schema.uploads.id, uploadId)).get()!
    expect(upload.deletedAt).not.toBeNull()
    // The **row** is kept: a message still points at the id, and the screen
    // renders "Slika istekla" rather than a broken image.
    expect(upload.path).toBeTruthy()
  })

  it('any member of Konobari may remove an image at any age; text is the author\'s alone', () => {
    const { messageId } = photoInKonobari()
    f.clock.advance(4000) // well past `chat_delete_own_s`
    deleteMessage(f.db, f.venueId, f.actor('Emir'), messageId, f.clock.now())

    const removed = f.db.select().from(schema.chatMessages)
      .where(eq(schema.chatMessages.id, messageId)).get()!
    expect(removed.deletedBy).toBe(f.userId('Emir'))
    // The body survives in the database — moderation evidence — and never on
    // the wire: the bubble says who and when.
    expect(removed.body).toBe('ovako izgleda šank')

    const entries = f.db.select().from(schema.logEntries).all()
    expect(entries.some(e => e.kind === 'chat_image_removed')).toBe(true)

    const text = send('Amar', 'konobari', 'nemoj')
    expectCode(() => deleteMessage(f.db, f.venueId, f.actor('Emir'), text.message.id),
      'DELETE_FORBIDDEN')
  })

  it('hides the body of a deleted message on the wire and names who removed it', () => {
    const sent = send('Amar', 'svi', 'greška')
    deleteMessage(f.db, f.venueId, f.actor('Amar'), sent.message.id)

    const page = chatHistory(f.db, f.venueId, f.actor('Amar'), 'svi', null, 50)
    const bubble = page.messages.find(m => m.id === sent.message.id)!
    expect(bubble.body).toBeNull()
    expect(bubble.deleted_by_name).toBe('Amar')
  })
})

// ---------------------------------------------------------------------------
// Deleting, forwarding, muting, pinning
// ---------------------------------------------------------------------------

describe('deleteMessage', () => {
  it('lets the author delete his own text inside the window and not after', () => {
    const first = send('Amar', 'svi', 'ups')
    deleteMessage(f.db, f.venueId, f.actor('Amar'), first.message.id, f.clock.now())

    const second = send('Amar', 'svi', 'opet')
    f.clock.advance(1000) // chat_delete_own_s is 900
    expectCode(() => deleteMessage(f.db, f.venueId, f.actor('Amar'), second.message.id, f.clock.now()),
      'DELETE_WINDOW')
  })

  it('lets an admin delete anything in Svi at any age, and logs it', () => {
    const sent = send('Amar', 'svi', 'predao 612,50 KM')
    f.clock.advance(90_000)
    deleteMessage(f.db, f.venueId, f.adminActor(), sent.message.id, f.clock.now())

    expect(f.db.select().from(schema.logEntries).all()
      .some(e => e.kind === 'chat_deleted_by_admin')).toBe(true)
  })

  it('refuses a second delete', () => {
    const sent = send('Amar', 'svi', 'ups')
    deleteMessage(f.db, f.venueId, f.actor('Amar'), sent.message.id, f.clock.now())
    expectCode(() => deleteMessage(f.db, f.venueId, f.actor('Amar'), sent.message.id, f.clock.now()),
      'ALREADY_DECIDED')
  })
})

describe('forwardMessage', () => {
  it('carries the ↪ prefix with the author, the room and the time', () => {
    const sent = send('Amar', 'konobari', 'nema leda')
    const forwarded = forwardMessage(f.db, f.venueId, f.actor('Emir'), sent.message.id, 'svi')
    expect(forwarded.message.body).toMatch(/^↪ Amar \(Konobari, \d{2}:\d{2}\): nema leda$/)
    expect(forwarded.message.forwarded_from_id).toBe(sent.message.id)
  })

  it('refuses a forward that is not on the list', () => {
    const sent = send('Amar', 'svi', 'zdravo')
    // Svi → Konobari is not a path anybody has: the room is not a dumping ground.
    expectCode(() => forwardMessage(f.db, f.venueId, f.actor('Amar'), sent.message.id, 'konobari'),
      'FORWARD_FORBIDDEN')
  })
})

describe('muteUser', () => {
  it('refuses a send while the mute is live and lets it through after', () => {
    const until = new Date(Date.parse(f.clock.now()) + 3600_000).toISOString()
    muteUser(f.db, f.venueId, f.adminActor(), f.userId('Amar'), until, f.clock.now())

    expectCode(() => postMessage(f.db, f.venueId, f.actor('Amar'), 'svi', {
      client_id: randomUUID(), kind: 'text', body: 'ipak',
    }, f.clock.now()), 'MUTED')

    f.clock.advance(3700)
    expect(() => postMessage(f.db, f.venueId, f.actor('Amar'), 'svi', {
      client_id: randomUUID(), kind: 'text', body: 'sad mogu',
    }, f.clock.now())).not.toThrow()
  })
})

describe('setPin — Za naručiti', () => {
  it('appends a line without a keyboard and keeps every version in the thread', () => {
    setPin(f.db, f.venueId, f.actor('Amar'), 'svi', { append: 'led' })
    setPin(f.db, f.venueId, f.actor('Emir'), 'svi', { append: 'limun' })

    const channel = f.db.select().from(schema.chatChannels).all().find(c => c.kind === 'svi')!
    expect(channel.pinnedText).toBe('led\nlimun')

    const system = f.db.select().from(schema.chatMessages).all()
      .filter(m => m.systemKey === 'pin_changed')
    expect(system).toHaveLength(2)
  })

  it('is Naručeno ✓ for an admin and nobody else', () => {
    setPin(f.db, f.venueId, f.actor('Amar'), 'svi', { append: 'led' })
    expectCode(() => setPin(f.db, f.venueId, f.actor('Amar'), 'svi', { cleared: true }),
      'PIN_CLEAR_FORBIDDEN')

    setPin(f.db, f.venueId, f.adminActor(), 'svi', { cleared: true })
    const channel = f.db.select().from(schema.chatChannels).all().find(c => c.kind === 'svi')!
    expect(channel.pinnedText).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The money guard
// ---------------------------------------------------------------------------

describe('looksLikeMoney and the quiet record', () => {
  it.each([
    ['predao 612,50 KM', true],
    ['12.50 KM', true],
    ['manjak je opet', true],
    ['pazar', true],
    ['donesi 3 kafe', false],
    ['sto 12', false],
  ])('%s → %s', (text, expected) => {
    expect(looksLikeMoney(text)).toBe(expected)
  })

  it('never blocks the message, and records that the sheet was shown', () => {
    const sent = postMessage(f.db, f.venueId, f.actor('Amar'), 'svi', {
      client_id: randomUUID(), kind: 'text', body: 'predao 612,50 KM', money_ack: true,
    })
    expect(sent.message.body).toContain('612,50')

    const entry = f.db.select().from(schema.logEntries).all()
      .find(e => e.kind === 'chat_money_warned')!
    expect(entry).toBeDefined()
    expect(JSON.parse(entry.bodyJson).money_ack).toBe(true)
  })

  it('says nothing in Admini — that is where amounts belong', () => {
    postMessage(f.db, f.venueId, f.adminActor(), 'admini', {
      client_id: randomUUID(), kind: 'text', body: 'Amar je predao 612,50 KM',
    })
    expect(f.db.select().from(schema.logEntries).all()
      .some(e => e.kind === 'chat_money_warned')).toBe(false)
  })

  it('postSystem throws on a *_fen payload outside Admini', () => {
    expectCode(() => f.db.transaction(tx =>
      postSystem(tx, f.venueId, 'svi', 'roster_published', 'x', { declared_fen: 61_250 })),
    'SYSTEM_MONEY_LEAK')

    // …and allows it inside, where the owner is the only reader.
    expect(() => f.db.transaction(tx =>
      postSystem(tx, f.venueId, 'admini', 'roster_published', 'x', { declared_fen: 61_250 })))
      .not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Idempotence, ordering and the badges
// ---------------------------------------------------------------------------

describe('idempotence and order', () => {
  it('a send replayed twice is one row, answered 200 with already_applied', () => {
    const clientId = randomUUID()
    const body = { client_id: clientId, kind: 'text' as const, body: 'nema leda' }

    const first = postMessage(f.db, f.venueId, f.actor('Amar'), 'svi', body)
    const second = postMessage(f.db, f.venueId, f.actor('Amar'), 'svi', body)
    const third = postMessage(f.db, f.venueId, f.actor('Amar'), 'svi', body)

    expect(first.already_applied).toBe(false)
    expect(second.already_applied).toBe(true)
    expect(third.already_applied).toBe(true)
    expect(second.message.id).toBe(first.message.id)
    expect(f.db.select().from(schema.chatMessages).all()).toHaveLength(1)
  })

  it('seq is monotonic over 200 inserts across three channels', () => {
    const rooms: Array<[string, ChannelKind]> = [
      ['Amar', 'svi'], ['Emir', 'konobari'], ['Haris', 'admini'],
    ]
    for (let i = 0; i < 200; i++) {
      const [who, kind] = rooms[i % 3]!
      send(who, kind, `poruka ${i}`)
    }

    const seqs = f.db.select().from(schema.chatMessages).all().map(m => m.seq).sort((a, b) => a - b)
    expect(seqs).toHaveLength(200)
    expect(seqs).toEqual(Array.from({ length: 200 }, (_, i) => i + 1))
  })

  it('unread counts people, not system lines, and not yourself', () => {
    send('Emir', 'svi', 'zdravo')
    f.db.transaction(tx => postSystem(tx, f.venueId, 'svi', 'roster_published', 'Raspored'))
    send('Amar', 'svi', 'moje')

    const snapshot = chatSnapshot(f.db, f.venueId, f.actor('Amar'))
    const svi = snapshot.channels.find(c => c.kind === 'svi')!
    expect(svi.unread).toBe(1)

    markRead(f.db, f.venueId, f.actor('Amar'), 'svi', svi.last_seq)
    expect(chatSnapshot(f.db, f.venueId, f.actor('Amar')).total_unread).toBe(0)
  })

  it('the change feed carries the badge counts and no forbidden room', () => {
    const before = maxSeq(f.db, f.venueId)
    send('Amar', 'konobari', 'tajna')

    const forStaff = getChanges(f.db, f.venueId, f.actor('Emir'), before)
    expect(forStaff.chat?.total_unread).toBe(1)

    const forOwner = getChanges(f.db, f.venueId, f.adminActor(), before)
    expect(forOwner.chat?.channels.map(c => c.kind)).toEqual(['svi', 'admini'])
    expect(forOwner.chat?.total_unread).toBe(0)
  })

  it('answers reset when a phone is more than a thousand messages behind', () => {
    // Fake the distance rather than writing 1001 rows: the rule is arithmetic
    // on `MAX(seq) − cursor`. The row is inserted straight through SQL because
    // `chat_messages` is append-only and an UPDATE of `seq` is refused — which
    // is itself the point of the trigger.
    f.sqlite.exec(
      `INSERT INTO chat_messages (id, venue_id, channel_id, client_id, seq, kind, body, created_at)`
      + ` VALUES ('${randomUUID()}', '${f.venueId}', '${channelId('svi')}', '${randomUUID()}',`
      + ` 5000, 'text', 'daleko', '${f.clock.now()}')`,
    )
    const answer = chatSince(f.db, f.venueId, f.actor('Amar'), 10)
    expect(answer.reset).toBe(true)
    expect(answer.messages).toEqual([])
  })
})

/**
 * §1's third standing decision, proved on the server: **chat never enters the
 * money outbox.** A stuck "nema leda" must not stop a cash handover.
 */
describe('chat is not money', () => {
  it('a queued chat message does not stand between a waiter and his settlement', () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    send('Amar', 'svi', 'nema leda')

    const result = settle(f.db, f.venueId, f.actor('Amar'), shiftId, {
      declared_fen: 0, outbox_len: 0,
    })
    expect(result.settlement_id).toBeTruthy()
  })

  it('the heartbeat still reports pending: 0 with a chat message in the room', () => {
    const deviceId = randomUUID()
    f.db.insert(schema.devices).values({
      id: deviceId, venueId: f.venueId, label: 'Amarov telefon',
      tokenHash: randomUUID(), mode: 'personal', enrolledAt: f.clock.now(),
      pendingCount: 0, clockSkewS: 0,
    }).run()

    send('Amar', 'svi', 'nema leda')
    heartbeat(f.db, f.venueId, deviceId, { pending: 0, client_now: f.clock.now() })

    const device = f.db.select().from(schema.devices)
      .where(eq(schema.devices.id, deviceId)).get()!
    expect(device.pendingCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// The triggers
// ---------------------------------------------------------------------------

describe('chat_messages, at the database level', () => {
  it('refuses an UPDATE of the body', () => {
    const sent = send('Amar', 'svi', 'original')
    f.expectRefused(
      `UPDATE chat_messages SET body = 'izmijenjeno' WHERE id = '${sent.message.id}'`,
      /only a first soft delete/,
    )
  })

  it('refuses a DELETE', () => {
    const sent = send('Amar', 'svi', 'original')
    f.expectRefused(
      `DELETE FROM chat_messages WHERE id = '${sent.message.id}'`,
      /append-only/,
    )
  })

  it('refuses a second deleted_at', () => {
    const sent = send('Amar', 'svi', 'original')
    deleteMessage(f.db, f.venueId, f.actor('Amar'), sent.message.id, f.clock.now())
    f.expectRefused(
      `UPDATE chat_messages SET deleted_at = '2026-01-01T00:00:00.000Z' `
      + `WHERE id = '${sent.message.id}'`,
      /only a first soft delete/,
    )
  })

  it('refuses moving a message to another channel', () => {
    const sent = send('Amar', 'konobari', 'tajna')
    f.expectRefused(
      `UPDATE chat_messages SET channel_id = '${channelId('svi')}' WHERE id = '${sent.message.id}'`,
      /frozen column changed|only a first soft delete/,
    )
  })

  it('allows the retention rewrite, and only with the fixed sentence', () => {
    const sent = send('Amar', 'svi', 'original')
    f.expectRefused(
      `UPDATE chat_messages SET redacted_at = '2026-12-01T00:00:00.000Z', body = 'nešto drugo' `
      + `WHERE id = '${sent.message.id}'`,
      /only a first soft delete/,
    )
    expect(() => f.sqlite.exec(
      `UPDATE chat_messages SET redacted_at = '2026-12-01T00:00:00.000Z', `
      + `body = 'Uklonjeno · retencija' WHERE id = '${sent.message.id}'`,
    )).not.toThrow()
  })
})
