/**
 * The two things every Phase 4 suite needs: a scratch `UPLOAD_DIR` and real
 * JPEG bytes.
 *
 * The bytes matter. `createUpload` checks `FF D8 FF` **first**, so a buffer of
 * zeroes is refused as `NOT_JPEG` before any other rule is reached — a fixture
 * that used one would be testing the magic-byte check and nothing else.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * A valid, minimal JPEG: SOI, a JFIF APP0 segment, a baseline SOF0 frame whose
 * header says `height × width`, and EOI. `jpegSize()` walks exactly this chain.
 */
export function jpegBytes(width = 1, height = 1, padTo = 0): Buffer {
  const head = Buffer.from([
    0xFF, 0xD8, // SOI
    0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, // APP0 "JFIF"
    0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xFF, 0xC0, 0x00, 0x11, 0x08, // SOF0, length 17, 8-bit
    (height >> 8) & 0xFF, height & 0xFF,
    (width >> 8) & 0xFF, width & 0xFF,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ])
  const tail = Buffer.from([0xFF, 0xD9]) // EOI

  // Padding goes in COM (comment) segments, which every JPEG decoder skips — so
  // a "1.6 MB photo" for the size check is still a real, parseable JPEG.
  //
  // Plural, because a segment's length word is 16 bits: one 1.6 MB comment is
  // not a bigger segment, it is an unrepresentable one. So the padding is a
  // chain of ~64 KB ones, exactly as a real encoder would have to write it.
  const segments: Buffer[] = []
  let remaining = padTo - head.length - tail.length
  while (remaining > 4) {
    const payload = Math.min(remaining - 2, 0xFFFF) - 2
    const comment = Buffer.alloc(payload + 4)
    comment[0] = 0xFF
    comment[1] = 0xFE
    comment.writeUInt16BE(payload + 2, 2)
    segments.push(comment)
    remaining -= comment.length
  }
  return Buffer.concat([head, ...segments, tail])
}

/** PNG magic bytes with a `.jpg` name — refused at check 1 and nowhere else. */
export function pngBytes(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13])
}

export interface Scratch {
  dir: string
  cleanup: () => void
}

/** Point `UPLOAD_DIR` at a throwaway directory for the life of one test. */
export function scratchUploads(): Scratch {
  const dir = mkdtempSync(join(tmpdir(), 'sank-uploads-'))
  process.env.UPLOAD_DIR = dir
  return {
    dir,
    cleanup: () => {
      delete process.env.UPLOAD_DIR
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/**
 * Assert a service refuses with a particular **code**.
 *
 * `SankError.message` is the developer-facing explanation and `code` is the
 * stable machine string the phone branches on (BACKEND §2) — so a test that
 * matched the message would pass on a reworded sentence and fail on a renamed
 * code, which is exactly backwards.
 */
export function expectCode(fn: () => unknown, code: string): void {
  try {
    fn()
  } catch (err) {
    const actual = (err as { code?: string }).code
    if (actual !== code) {
      throw new Error(`expected code ${code}, got ${actual ?? String(err)}`)
    }
    return
  }
  throw new Error(`expected code ${code}, but nothing was thrown`)
}
