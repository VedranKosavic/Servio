/**
 * The image pipeline (PHASE4 §2.6): five checks, a file on disk, and two
 * collectors.
 *
 * Everything here writes real files into a scratch directory, because the
 * things worth checking are the things a mock would paper over: that the file
 * is created with mode 0600, that the collector actually unlinks it, and that
 * the row survives the file.
 */
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFixture, schema, type Fixture } from '../helpers/db'
import { expectCode, jpegBytes, pngBytes, scratchUploads, type Scratch } from '../helpers/phase4'
import {
  absolutePath, createUpload, expireChatImages, fileMode, gcOrphans, jpegSize, readUpload,
} from '../../server/services/uploads'
import { postMessage } from '../../server/services/chat'
import { discardScan, scanDelivery, setScanModel, stubScanModel } from '../../server/services/scan'

let f: Fixture
let scratch: Scratch

beforeEach(() => {
  f = makeFixture()
  scratch = scratchUploads()
})
afterEach(() => {
  f.close()
  scratch.cleanup()
  setScanModel(null)
})

const chatPhoto = (name = 'Amar', bytes = jpegBytes(1280, 960)) =>
  createUpload(f.db, f.venueId, f.actor(name), { bytes }, 'chat', f.clock.now())

// ---------------------------------------------------------------------------
// The five checks, in order
// ---------------------------------------------------------------------------

describe('createUpload', () => {
  it('refuses PNG bytes wearing a .jpg name — check 1, and nowhere else', () => {
    expectCode(
      () => createUpload(f.db, f.venueId, f.actor('Amar'), {
        bytes: pngBytes(), filename: 'slika.jpg',
      }, 'chat'),
      'NOT_JPEG',
    )
  })

  it('refuses a 1.6 MB chat photo and accepts a 2.4 MB delivery photo', () => {
    expectCode(
      () => createUpload(f.db, f.venueId, f.actor('Amar'), { bytes: jpegBytes(1, 1, 1_600_000) }, 'chat'),
      'IMAGE_TOO_BIG',
    )

    const delivery = createUpload(
      f.db, f.venueId, f.adminActor(), { bytes: jpegBytes(1600, 1200, 2_400_000) }, 'delivery',
    )
    expect(delivery.bytes).toBeGreaterThan(2_000_000)
  })

  it('refuses a delivery photo from a waiter, and from a šanker without the setting', () => {
    expectCode(
      () => createUpload(f.db, f.venueId, f.actor('Amar'), { bytes: jpegBytes() }, 'delivery'),
      'KIND_FORBIDDEN',
    )

    // The dev seed turns `bartender_can_receive_goods` on, which is what the
    // existing `/s` delivery screen needs — so the šanker is allowed here.
    expect(() => createUpload(
      f.db, f.venueId, f.actor('Emir'), { bytes: jpegBytes() }, 'delivery',
    )).not.toThrow()

    f.settingsWith({ bartender_can_receive_goods: false })
    expectCode(
      () => createUpload(f.db, f.venueId, f.actor('Emir'), { bytes: jpegBytes() }, 'delivery'),
      'KIND_FORBIDDEN',
    )
  })

  it('stops at the 26th file of a day', () => {
    for (let i = 0; i < 25; i++) {
      const upload = chatPhoto()
      // Only **referenced** uploads count toward a cap: an orphan is a send that
      // failed, and charging somebody for it would lock him out of the retry.
      postMessage(f.db, f.venueId, f.actor('Amar'), 'svi', {
        client_id: randomUUID(), kind: 'image', upload_id: upload.id,
      }, f.clock.now())
    }
    expectCode(() => chatPhoto(), 'USER_CAP')
  })

  it('stops the venue at 200 MB of chat photos in a month', () => {
    // One oversized row written straight into the table, and one message
    // pointing at it — writing 200 MB of real files to prove arithmetic would
    // make the suite unusable.
    const id = randomUUID()
    f.db.insert(schema.uploads).values({
      id, venueId: f.venueId, kind: 'chat', path: 'chat/2026/09/x.jpg',
      bytes: 201 * 1024 * 1024, width: 0, height: 0, mime: 'image/jpeg',
      createdBy: f.userId('Emir'), createdAt: f.clock.now(),
    }).run()
    f.db.insert(schema.chatMessages).values({
      id: randomUUID(), venueId: f.venueId,
      channelId: f.db.select().from(schema.chatChannels).all().find(c => c.kind === 'svi')!.id,
      clientId: randomUUID(), seq: 1, kind: 'image', uploadId: id,
      authorId: f.userId('Emir'), createdAt: f.clock.now(),
    }).run()

    expectCode(() => chatPhoto(), 'STORAGE_CAP')
  })

  it('writes a quiet chat_cap_hit naming the person whenever a cap trips', () => {
    f.settingsWith({ upload_user_day_files: 0 })
    expectCode(() => chatPhoto(), 'USER_CAP')

    const entry = f.db.select().from(schema.logEntries).all()
      .find(e => e.kind === 'chat_cap_hit')!
    expect(JSON.parse(entry.bodyJson).user_id).toBe(f.userId('Amar'))
  })

  it('writes the file at kind/YYYY/MM/<uuid>.jpg with mode 0600', () => {
    const upload = chatPhoto()
    const row = f.db.select().from(schema.uploads).where(eq(schema.uploads.id, upload.id)).get()!

    expect(row.path).toMatch(/^chat\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/)
    expect(existsSync(absolutePath(row.path))).toBe(true)
    // 0600: readable by the one Node process and nobody else on the box.
    expect(fileMode(row.path)).toBe(0o600)
  })

  it('reads the dimensions out of the SOF marker, and answers 0 × 0 on a header it cannot parse', () => {
    const upload = chatPhoto('Amar', jpegBytes(1280, 960))
    expect([upload.width, upload.height]).toEqual([1280, 960])
    // Three magic bytes and nothing else: still a "JPEG" by check 1, no frame.
    expect(jpegSize(Buffer.from([0xFF, 0xD8, 0xFF]))).toEqual({ width: 0, height: 0 })
  })
})

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

describe('readUpload', () => {
  it('answers nothing for an orphan nobody has posted yet', () => {
    const upload = chatPhoto()
    expect(readUpload(f.db, f.venueId, f.actor('Amar'), upload.id)).toBeNull()
  })

  it('lets the owner read every delivery photo, and the šanker read his own', () => {
    const mine = createUpload(f.db, f.venueId, f.actor('Emir'), { bytes: jpegBytes() }, 'delivery')
    expect(readUpload(f.db, f.venueId, f.adminActor(), mine.id)).not.toBeNull()
    expect(readUpload(f.db, f.venueId, f.actor('Emir'), mine.id)).not.toBeNull()
    // A waiter who did not take it has no business with an invoice photo.
    expect(readUpload(f.db, f.venueId, f.actor('Amar'), mine.id)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The two collectors
// ---------------------------------------------------------------------------

describe('gcOrphans', () => {
  it('leaves an orphan alone for an hour and unlinks it after, keeping the row', () => {
    const upload = chatPhoto()
    const row = f.db.select().from(schema.uploads).where(eq(schema.uploads.id, upload.id)).get()!

    expect(gcOrphans(f.db, f.venueId, 60, f.clock.now())).toBe(0)
    expect(existsSync(absolutePath(row.path))).toBe(true)

    f.clock.advance(61 * 60)
    expect(gcOrphans(f.db, f.venueId, 60, f.clock.now())).toBe(1)

    expect(existsSync(absolutePath(row.path))).toBe(false)
    const after = f.db.select().from(schema.uploads).where(eq(schema.uploads.id, upload.id)).get()!
    // The row outlives the file: that is how the reference count stays honest
    // and how the screen knows to render "Slika istekla".
    expect(after.deletedAt).not.toBeNull()
    expect(after.path).toBe(row.path)
  })

  it('never touches a photo a live message points at', () => {
    const upload = chatPhoto()
    postMessage(f.db, f.venueId, f.actor('Amar'), 'svi', {
      client_id: randomUUID(), kind: 'image', upload_id: upload.id,
    }, f.clock.now())

    f.clock.advance(61 * 60)
    expect(gcOrphans(f.db, f.venueId, 60, f.clock.now())).toBe(0)
  })

  it('keeps a parsed scan\'s photo and collects a discarded one\'s', async () => {
    setScanModel(stubScanModel())

    const kept = createUpload(f.db, f.venueId, f.adminActor(), { bytes: jpegBytes() }, 'delivery', f.clock.now())
    await scanDelivery(f.db, f.venueId, f.adminActor(), { upload_id: kept.id }, f.clock.now())

    const thrown = createUpload(f.db, f.venueId, f.adminActor(), { bytes: jpegBytes() }, 'delivery', f.clock.now())
    const draft = await scanDelivery(f.db, f.venueId, f.adminActor(), { upload_id: thrown.id }, f.clock.now())
    discardScan(f.db, f.venueId, f.adminActor(), draft.scan_id, { reason: 'pogrešna slika' }, f.clock.now())

    f.clock.advance(61 * 60)
    expect(gcOrphans(f.db, f.venueId, 60, f.clock.now())).toBe(1)

    const rows = f.db.select().from(schema.uploads).all()
    expect(rows.find(r => r.id === kept.id)!.deletedAt).toBeNull()
    expect(rows.find(r => r.id === thrown.id)!.deletedAt).not.toBeNull()
    // Both **rows** survive; only one file went.
    expect(rows).toHaveLength(2)
  })
})

describe('expireChatImages', () => {
  it('unlinks a chat photo at 91 days and leaves a 400-day-old delivery photo alone', () => {
    const chat = chatPhoto()
    const delivery = createUpload(
      f.db, f.venueId, f.adminActor(), { bytes: jpegBytes() }, 'delivery', f.clock.now(),
    )

    f.clock.advance(91 * 86_400)
    expect(expireChatImages(f.db, f.venueId, 90, f.clock.now())).toBe(1)

    const rows = f.db.select().from(schema.uploads).all()
    expect(rows.find(r => r.id === chat.id)!.deletedAt).not.toBeNull()
    expect(rows.find(r => r.id === delivery.id)!.deletedAt).toBeNull()

    // …and still nothing at 400 days: a delivery photo is evidence beside a
    // posted delivery and follows the ledger, not the retention clock.
    f.clock.advance(310 * 86_400)
    expect(expireChatImages(f.db, f.venueId, 90, f.clock.now())).toBe(0)
    expect(f.db.select().from(schema.uploads).all()
      .find(r => r.id === delivery.id)!.deletedAt).toBeNull()
  })

  it('leaves the message in place — the thread says "Slika istekla", it does not lose the line', () => {
    const upload = chatPhoto()
    const sent = postMessage(f.db, f.venueId, f.actor('Amar'), 'svi', {
      client_id: randomUUID(), kind: 'image', upload_id: upload.id, body: 'led je stigao',
    }, f.clock.now())

    f.clock.advance(91 * 86_400)
    expireChatImages(f.db, f.venueId, 90, f.clock.now())

    const message = f.db.select().from(schema.chatMessages)
      .where(eq(schema.chatMessages.id, sent.message.id)).get()!
    expect(message.deletedAt).toBeNull()
    expect(message.body).toBe('led je stigao')
  })
})

// ---------------------------------------------------------------------------
// The trigger
// ---------------------------------------------------------------------------

describe('uploads, at the database level', () => {
  it('refuses a DELETE and a second deleted_at', () => {
    const upload = chatPhoto()
    f.expectRefused(`DELETE FROM uploads WHERE id = '${upload.id}'`, /append-only/)

    f.sqlite.exec(`UPDATE uploads SET deleted_at = '2026-09-10T00:00:00.000Z' WHERE id = '${upload.id}'`)
    f.expectRefused(
      `UPDATE uploads SET deleted_at = '2026-09-11T00:00:00.000Z' WHERE id = '${upload.id}'`,
      /only deleted_at/,
    )
  })

  it('refuses re-pointing a row at another file', () => {
    const upload = chatPhoto()
    f.expectRefused(
      `UPDATE uploads SET path = 'chat/2020/01/other.jpg' WHERE id = '${upload.id}'`,
      /only deleted_at/,
    )
  })
})
