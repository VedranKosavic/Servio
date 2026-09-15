/**
 * The image pipeline (PHASE4 §2.6): the checks, a file on disk, and the
 * collector. Since *Razgovor* was removed the only kind is `delivery`.
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
  absolutePath, createUpload, fileMode, gcOrphans, jpegSize, parseUploadKind, readUpload,
} from '../../server/services/uploads'
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

const deliveryPhoto = (bytes = jpegBytes(1600, 1200)) =>
  createUpload(f.db, f.venueId, f.adminActor(), { bytes }, 'delivery', f.clock.now())

/** A row as an old database holds it: a chat photo from before *Razgovor* went. */
function legacyChatRow(): string {
  const id = randomUUID()
  f.db.insert(schema.uploads).values({
    id, venueId: f.venueId, kind: 'chat', path: `chat/2026/09/${id}.jpg`,
    bytes: 1000, width: 0, height: 0, mime: 'image/jpeg',
    createdBy: f.userId('Amar'), createdAt: f.clock.now(),
  }).run()
  return id
}

// ---------------------------------------------------------------------------
// The checks, in order
// ---------------------------------------------------------------------------

describe('createUpload', () => {
  it('refuses PNG bytes wearing a .jpg name — check 1, and nowhere else', () => {
    expectCode(
      () => createUpload(f.db, f.venueId, f.adminActor(), {
        bytes: pngBytes(), filename: 'slika.jpg',
      }, 'delivery'),
      'NOT_JPEG',
    )
  })

  it('accepts a 2.4 MB delivery photo and refuses a 2.6 MB one', () => {
    expect(deliveryPhoto(jpegBytes(1600, 1200, 2_400_000)).bytes).toBeGreaterThan(2_000_000)
    expectCode(() => deliveryPhoto(jpegBytes(1, 1, 2_600_000)), 'IMAGE_TOO_BIG')
  })

  it('knows no kind but delivery — chat photos went with Razgovor', () => {
    expect(parseUploadKind('delivery')).toBe('delivery')
    expectCode(() => parseUploadKind('chat'), 'KIND_FORBIDDEN')
  })

  /**
   * A delivery photo is the owner's alone. A šanker reads Stanje šanka and
   * never receives goods, whatever the old bartender setting says.
   */
  it('refuses a delivery photo from any worker, whatever the old bartender setting says', () => {
    f.settingsWith({ bartender_can_receive_goods: true })
    expectCode(
      () => createUpload(f.db, f.venueId, f.actor('Emir'), { bytes: jpegBytes() }, 'delivery'),
      'KIND_FORBIDDEN',
    )

    f.settingsWith({ bartender_can_receive_goods: false })
    expectCode(
      () => createUpload(f.db, f.venueId, f.actor('Amar'), { bytes: jpegBytes() }, 'delivery'),
      'KIND_FORBIDDEN',
    )
  })

  it('writes a quiet chat_cap_hit naming the person whenever the daily cap trips', () => {
    f.settingsWith({ upload_user_day_files: 0 })
    expectCode(() => deliveryPhoto(), 'USER_CAP')

    const entry = f.db.select().from(schema.logEntries).all()
      .find(e => e.kind === 'chat_cap_hit')!
    expect(JSON.parse(entry.bodyJson).user_id).toBe(f.adminActor().userId)
  })

  it('writes the file at kind/YYYY/MM/<uuid>.jpg with mode 0600', () => {
    const upload = deliveryPhoto()
    const row = f.db.select().from(schema.uploads).where(eq(schema.uploads.id, upload.id)).get()!

    expect(row.path).toMatch(/^delivery\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/)
    expect(existsSync(absolutePath(row.path))).toBe(true)
    // 0600: readable by the one Node process and nobody else on the box.
    expect(fileMode(row.path)).toBe(0o600)
  })

  it('reads the dimensions out of the SOF marker, and answers 0 × 0 on a header it cannot parse', () => {
    const upload = deliveryPhoto(jpegBytes(1280, 960))
    expect([upload.width, upload.height]).toEqual([1280, 960])
    // Three magic bytes and nothing else: still a "JPEG" by check 1, no frame.
    expect(jpegSize(Buffer.from([0xFF, 0xD8, 0xFF]))).toEqual({ width: 0, height: 0 })
  })
})

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

describe('readUpload', () => {
  it('lets the owner read a delivery photo, and no worker', () => {
    const owners = deliveryPhoto()
    expect(readUpload(f.db, f.venueId, f.adminActor(), owners.id)).not.toBeNull()
    expect(readUpload(f.db, f.venueId, f.actor('Emir'), owners.id)).toBeNull()
    expect(readUpload(f.db, f.venueId, f.actor('Amar'), owners.id)).toBeNull()
  })

  it('serves a legacy chat photo to nobody', () => {
    const id = legacyChatRow()
    expect(readUpload(f.db, f.venueId, f.adminActor(), id)).toBeNull()
    expect(readUpload(f.db, f.venueId, f.actor('Amar'), id)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The collector
// ---------------------------------------------------------------------------

describe('gcOrphans', () => {
  it('leaves an orphan alone for an hour and unlinks it after, keeping the row', () => {
    const upload = deliveryPhoto()
    const row = f.db.select().from(schema.uploads).where(eq(schema.uploads.id, upload.id)).get()!

    expect(gcOrphans(f.db, f.venueId, 60, f.clock.now())).toBe(0)
    expect(existsSync(absolutePath(row.path))).toBe(true)

    f.clock.advance(61 * 60)
    expect(gcOrphans(f.db, f.venueId, 60, f.clock.now())).toBe(1)

    expect(existsSync(absolutePath(row.path))).toBe(false)
    const after = f.db.select().from(schema.uploads).where(eq(schema.uploads.id, upload.id)).get()!
    // The row outlives the file: that is how the reference count stays honest.
    expect(after.deletedAt).not.toBeNull()
    expect(after.path).toBe(row.path)
  })

  it('never touches a legacy chat photo — removing Razgovor deletes no file', () => {
    const id = legacyChatRow()
    f.clock.advance(61 * 60)
    expect(gcOrphans(f.db, f.venueId, 60, f.clock.now())).toBe(0)
    expect(f.db.select().from(schema.uploads).where(eq(schema.uploads.id, id)).get()!.deletedAt).toBeNull()
  })

  it('keeps a parsed scan\'s photo and collects a discarded one\'s', async () => {
    setScanModel(stubScanModel())

    const kept = deliveryPhoto()
    await scanDelivery(f.db, f.venueId, f.adminActor(), { upload_id: kept.id }, f.clock.now())

    const thrown = deliveryPhoto()
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

// ---------------------------------------------------------------------------
// The trigger
// ---------------------------------------------------------------------------

describe('uploads, at the database level', () => {
  it('refuses a DELETE and a second deleted_at', () => {
    const upload = deliveryPhoto()
    f.expectRefused(`DELETE FROM uploads WHERE id = '${upload.id}'`, /append-only/)

    f.sqlite.exec(`UPDATE uploads SET deleted_at = '2026-09-10T00:00:00.000Z' WHERE id = '${upload.id}'`)
    f.expectRefused(
      `UPDATE uploads SET deleted_at = '2026-09-11T00:00:00.000Z' WHERE id = '${upload.id}'`,
      /only deleted_at/,
    )
  })

  it('refuses re-pointing a row at another file', () => {
    const upload = deliveryPhoto()
    f.expectRefused(
      `UPDATE uploads SET path = 'delivery/2020/01/other.jpg' WHERE id = '${upload.id}'`,
      /only deleted_at/,
    )
  })
})
