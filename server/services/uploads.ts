/**
 * The image pipeline (PHASE4 §2.6) — the only place in Šank that touches a file.
 *
 * Five checks in a fixed order, a path on disk, a row that outlives the file,
 * and two collectors. There is no `sharp` and no native module anywhere near
 * this: the phone has already downscaled the picture (WP1's `app/utils/image.ts`)
 * and all the server needs from the bytes is "is this really a JPEG" and "how
 * big is it", both of which are twenty lines of header parsing.
 *
 * **Why the row is never deleted.** `uploads.deleted_at` is stamped when the
 * file is unlinked and the row stays. A message still points at the id, the
 * screen renders "Slika istekla" instead of a broken image, and the reference
 * count the collector runs is a count over rows that still exist. A DELETE would
 * make the ledger lie about what was once there.
 */
import { existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import { schema } from '../database/client'
import { newId, nowIso } from '../utils/ids'
import { forbidden, SankError, unprocessable } from '../utils/errors'
import { errorMessage } from '#shared/errors'
import { canSee } from '#shared/chat'
import type { UploadResult } from '#shared/types'
import type { Actor, Db, Queryable, Tx } from './types'
import { getSettings } from './contracts'
import { log } from './log'

export type UploadKind = 'chat' | 'delivery'

/** The belt behind the phone's downscale. A chat photo is 100–180 KB in practice. */
export const MAX_BYTES: Record<UploadKind, number> = {
  chat: 1_500_000,
  delivery: 2_500_000,
}

/**
 * Where the files live. `data/uploads` locally, `/var/lib/sank/uploads` on the
 * VPS. Read every time rather than cached at import, because vitest points it at
 * a temp directory per test file.
 */
export function uploadDir(): string {
  const configured = process.env.UPLOAD_DIR || 'data/uploads'
  return isAbsolute(configured) ? configured : resolve(process.cwd(), configured)
}

/** The absolute path of one row. */
export function absolutePath(relative: string): string {
  return join(uploadDir(), relative)
}

/**
 * `POST /api/uploads`. Every refusal is a Bosnian sentence in
 * `shared/errors/chat.ts`, and every cap that trips leaves a quiet
 * `chat_cap_hit` entry naming the person — so "why can I not send a photo" has
 * an answer in the Dnevnik rather than in a log file nobody reads.
 */
export function createUpload(
  db: Db, venueId: string, actor: Actor,
  file: { bytes: Buffer, filename?: string }, kind: UploadKind, now = nowIso(),
): UploadResult {
  // 1. The magic bytes. A PNG renamed `.jpg` is refused here and nowhere else —
  //    the canvas on the phone re-encodes to JPEG, so anything else got here
  //    another way.
  if (!isJpeg(file.bytes)) {
    throw new SankError(415, 'NOT_JPEG', errorMessage('NOT_JPEG'))
  }

  // 2. Size.
  if (file.bytes.length > MAX_BYTES[kind]) {
    throw new SankError(413, 'IMAGE_TOO_BIG', errorMessage('IMAGE_TOO_BIG'))
  }

  const settings = getSettings(db, venueId)

  // 3. Kind. `delivery` is the owner's, or the šanker's when the venue says so —
  //    the same setting that gates `POST /api/stock/deliveries`.
  if (kind === 'delivery') {
    const allowed = actor.role === 'admin'
      || (actor.role === 'radnik' && settings.bartender_can_receive_goods)
    if (!allowed) throw unprocessable('KIND_FORBIDDEN', 'this session may not upload a delivery photo')
  }

  const dayFrom = new Date(Date.parse(now) - 86_400_000).toISOString()
  const monthFrom = new Date(Date.parse(now) - 30 * 86_400_000).toISOString()

  // 4. Per-user daily caps, and 5. the venue's monthly chat cap. Both count
  //    **referenced** uploads only (see `countedUsage`): an orphan nobody can
  //    see is not a photo anybody sent.
  const mine = countedUsage(db, venueId, { createdBy: actor.userId, from: dayFrom })
  if (mine.files >= settings.upload_user_day_files || mine.bytes + file.bytes.length > settings.upload_user_day_bytes) {
    capHit(db, venueId, actor, 'user', now)
    throw new SankError(413, 'USER_CAP', errorMessage('USER_CAP'))
  }

  if (kind === 'chat') {
    const venue = countedUsage(db, venueId, { kind: 'chat', from: monthFrom })
    if (venue.bytes + file.bytes.length > settings.chat_image_month_bytes) {
      capHit(db, venueId, actor, 'venue', now)
      throw new SankError(413, 'STORAGE_CAP', errorMessage('STORAGE_CAP'))
    }
  }

  const id = newId()
  const at = new Date(Date.parse(now))
  const yyyy = String(at.getUTCFullYear())
  const mm = String(at.getUTCMonth() + 1).padStart(2, '0')
  const relative = `${kind}/${yyyy}/${mm}/${id}.jpg`
  const full = absolutePath(relative)

  // 0600: readable by the one Node process and nobody else on the box. The
  // directory is created first because `writeFileSync` will not make one.
  mkdirSync(join(uploadDir(), kind, yyyy, mm), { recursive: true, mode: 0o700 })
  writeFileSync(full, file.bytes, { mode: 0o600 })

  const size = jpegSize(file.bytes)

  db.insert(schema.uploads).values({
    id,
    venueId,
    kind,
    path: relative,
    bytes: file.bytes.length,
    width: size.width,
    height: size.height,
    mime: 'image/jpeg',
    createdBy: actor.userId,
    deviceId: actor.deviceId,
    createdAt: now,
    deletedAt: null,
  }).run()

  // No `bump` on purpose (PHASE4 §2.11): an orphan upload nobody can see is not
  // an event. The message that references it is, and that one bumps `chat`.
  return { id, url: `/api/uploads/${id}`, width: size.width, height: size.height, bytes: file.bytes.length }
}

/**
 * `GET /api/uploads/:id` — the access check behind the stream.
 *
 * Returns `null` for everything it refuses, and the route answers **404**, never
 * 403: a 403 would confirm the file exists, which for a *Konobari* photo an
 * admin asked about is exactly the thing that must not happen.
 */
export function readUpload(
  q: Queryable, venueId: string, actor: Actor, id: string,
): { path: string, bytes: number, mime: string } | null {
  const row = q.select().from(schema.uploads)
    .where(and(eq(schema.uploads.venueId, venueId), eq(schema.uploads.id, id)))
    .get()
  if (!row || row.deletedAt) return null

  if (row.kind === 'delivery') {
    // The owner sees every delivery photo; the person who took it sees his own,
    // which is what puts the picture at the top of his own scan draft.
    const allowed = actor.role === 'admin' || row.createdBy === actor.userId
    return allowed ? { path: absolutePath(row.path), bytes: row.bytes, mime: row.mime } : null
  }

  // A chat photo is visible exactly where the message that carries it is. The
  // channel set comes from `canSee`, so a forward into *Admini* is what makes an
  // admin's request start answering 200 — and the author deleting the original
  // does not take the copy's evidence with it.
  const visible = visibleChannelIds(q, venueId, actor)
  if (visible.length === 0) return null

  const referenced = q.select({ id: schema.chatMessages.id })
    .from(schema.chatMessages)
    .where(and(
      eq(schema.chatMessages.venueId, venueId),
      eq(schema.chatMessages.uploadId, id),
      isNull(schema.chatMessages.deletedAt),
      inArray(schema.chatMessages.channelId, visible),
    ))
    .get()

  return referenced ? { path: absolutePath(row.path), bytes: row.bytes, mime: row.mime } : null
}

/** Every channel id this actor may read. Built from `canSee`, never filtered after. */
export function visibleChannelIds(q: Queryable, venueId: string, actor: Actor): string[] {
  return q.select({ id: schema.chatChannels.id, kind: schema.chatChannels.kind })
    .from(schema.chatChannels)
    .where(eq(schema.chatChannels.venueId, venueId))
    .all()
    .filter(c => canSee(actor.role, c.kind))
    .map(c => c.id)
}

/**
 * The hourly collector: unlink the file of every upload older than
 * `olderThanMin` that no non-deleted message and no `parsed|applied` scan
 * references. Returns how many files went.
 */
export function gcOrphans(db: Db, venueId: string, olderThanMin: number, now = nowIso()): number {
  const before = new Date(Date.parse(now) - olderThanMin * 60_000).toISOString()

  const orphans = db.select({ id: schema.uploads.id, path: schema.uploads.path })
    .from(schema.uploads)
    .where(and(
      eq(schema.uploads.venueId, venueId),
      isNull(schema.uploads.deletedAt),
      lt(schema.uploads.createdAt, before),
      sql`${schema.uploads.id} NOT IN (
        SELECT upload_id FROM chat_messages
        WHERE venue_id = ${venueId} AND upload_id IS NOT NULL AND deleted_at IS NULL
      )`,
      sql`${schema.uploads.id} NOT IN (
        SELECT upload_id FROM delivery_scans
        WHERE venue_id = ${venueId} AND status IN ('parsed','applied')
      )`,
    ))
    .all()

  for (const orphan of orphans) unlink(db, venueId, orphan.id, orphan.path, now)
  return orphans.length
}

/**
 * At 05:40: unlink chat photos older than `chat_retention_days`. The message
 * stays and renders "Slika istekla".
 *
 * Delivery photos are deliberately untouched — they are evidence beside a posted
 * delivery and follow the ledger, so a 400-day-old otpremnica is still there.
 */
export function expireChatImages(db: Db, venueId: string, days: number, now = nowIso()): number {
  const before = new Date(Date.parse(now) - days * 86_400_000).toISOString()

  const stale = db.select({ id: schema.uploads.id, path: schema.uploads.path })
    .from(schema.uploads)
    .where(and(
      eq(schema.uploads.venueId, venueId),
      eq(schema.uploads.kind, 'chat'),
      isNull(schema.uploads.deletedAt),
      lt(schema.uploads.createdAt, before),
    ))
    .all()

  for (const row of stale) unlink(db, venueId, row.id, row.path, now)
  return stale.length
}

/**
 * Unlink one file and stamp its row. Exported because `deleteMessage` calls it
 * **inside** its own transaction, after counting the references that are left.
 */
export function unlinkUpload(tx: Tx, venueId: string, id: string, path: string, at: string): void {
  removeFile(path)
  tx.update(schema.uploads)
    .set({ deletedAt: at })
    .where(and(eq(schema.uploads.venueId, venueId), eq(schema.uploads.id, id)))
    .run()
}

function unlink(db: Db, venueId: string, id: string, path: string, at: string): void {
  db.transaction(tx => unlinkUpload(tx, venueId, id, path, at))
}

function removeFile(path: string): void {
  const full = absolutePath(path)
  try {
    if (existsSync(full)) unlinkSync(full)
  } catch {
    // A file already gone is the state we wanted. The row still gets stamped.
  }
}

/** The file's mode, as `0o600` — the test that proves the umask did not widen it. */
export function fileMode(path: string): number {
  return statSync(absolutePath(path)).mode & 0o777
}

// ---------------------------------------------------------------------------
// The caps
// ---------------------------------------------------------------------------

/**
 * How much of a cap has actually been used.
 *
 * Only uploads a message or a kept scan references are counted (§2.6): an
 * orphan is a picture nobody ever saw, and charging somebody's daily budget for
 * a send that failed halfway would lock him out of the one he is retrying.
 */
function countedUsage(
  q: Queryable, venueId: string,
  filter: { createdBy?: string, kind?: UploadKind, from: string },
): { files: number, bytes: number } {
  const where = [
    eq(schema.uploads.venueId, venueId),
    sql`${schema.uploads.createdAt} >= ${filter.from}`,
    sql`(
      ${schema.uploads.id} IN (
        SELECT upload_id FROM chat_messages
        WHERE venue_id = ${venueId} AND upload_id IS NOT NULL AND deleted_at IS NULL
      )
      OR ${schema.uploads.id} IN (
        SELECT upload_id FROM delivery_scans
        WHERE venue_id = ${venueId} AND status IN ('parsed','applied')
      )
    )`,
  ]
  if (filter.createdBy) where.push(eq(schema.uploads.createdBy, filter.createdBy))
  if (filter.kind) where.push(eq(schema.uploads.kind, filter.kind))

  const row = q.select({
    files: sql<number>`count(*)`,
    bytes: sql<number>`coalesce(sum(${schema.uploads.bytes}), 0)`,
  }).from(schema.uploads).where(and(...where)).get()

  return { files: row?.files ?? 0, bytes: row?.bytes ?? 0 }
}

function capHit(db: Db, venueId: string, actor: Actor, which: 'user' | 'venue', at: string): void {
  db.transaction((tx) => {
    log(tx, venueId, {
      kind: 'chat_cap_hit',
      body: { user_id: actor.userId, cap: which },
      actorId: actor.userId,
      deviceId: actor.deviceId,
      ref: { type: 'user', id: actor.userId },
      at,
    })
  })
}

// ---------------------------------------------------------------------------
// Reading a JPEG header, in about twenty lines
// ---------------------------------------------------------------------------

/** `FF D8 FF` — the three bytes every JPEG in the world starts with. */
export function isJpeg(bytes: Buffer): boolean {
  return bytes.length > 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF
}

/**
 * The picture's dimensions, from the SOF ("start of frame") marker.
 *
 * A JPEG is a chain of segments, each `FF <marker> <2-byte length> <payload>`.
 * One of them — any of `C0`–`CF` except the four that mean something else —
 * carries the height and width as two big-endian 16-bit numbers. Walking the
 * chain until we find it is the whole algorithm.
 *
 * A header we cannot parse answers `0 × 0` rather than failing the upload:
 * dimensions are a placeholder so the message list does not jump when the image
 * loads, and a missing placeholder is a worse screen, not a broken one.
 */
export function jpegSize(bytes: Buffer): { width: number, height: number } {
  let i = 2
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xFF) { i++; continue }
    const marker = bytes[i + 1]!
    // Padding (FF) and the standalone markers carry no length word.
    if (marker === 0xFF) { i++; continue }
    if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD9)) { i += 2; continue }

    const length = bytes.readUInt16BE(i + 2)
    const isSof = marker >= 0xC0 && marker <= 0xCF
      && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC
    if (isSof) {
      return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) }
    }
    if (length < 2) return { width: 0, height: 0 }
    i += 2 + length
  }
  return { width: 0, height: 0 }
}

/** A `kind` that arrived as a form field. Anything else is a 422. */
export function parseUploadKind(value: unknown): UploadKind {
  if (value === 'chat' || value === 'delivery') return value
  throw unprocessable('KIND_FORBIDDEN', `unknown upload kind ${String(value)}`)
}

/** Guard used by the scan service: the photo has to be a delivery photo. */
export function requireDeliveryUpload(
  q: Queryable, venueId: string, actor: Actor, id: string,
): typeof schema.uploads.$inferSelect {
  const row = q.select().from(schema.uploads)
    .where(and(eq(schema.uploads.venueId, venueId), eq(schema.uploads.id, id)))
    .get()
  if (!row || row.deletedAt) throw new SankError(404, 'UPLOAD_NOT_FOUND', errorMessage('UPLOAD_NOT_FOUND'))
  if (row.kind !== 'delivery') throw unprocessable('KIND_FORBIDDEN', 'that photo is not a delivery photo')
  if (actor.role !== 'admin' && row.createdBy !== actor.userId) {
    throw forbidden('KIND_FORBIDDEN', 'that photo is not yours')
  }
  return row
}
