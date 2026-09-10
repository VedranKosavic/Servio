/**
 * `GET /api/uploads/:id` — the photo itself, streamed from disk.
 *
 * **404, never 403** (PHASE4 §2.6). `readUpload` answers `null` for every
 * refusal, and a 403 would confirm the file exists — which for a *Konobari*
 * photo an admin guessed the id of is exactly the thing that must not happen.
 *
 * The five headers are not decoration. `nosniff` plus a `Content-Security-Policy`
 * of `default-src 'none'` is what keeps a polyglot file — bytes that are both a
 * valid JPEG and valid HTML — from ever executing as a page on the app's own
 * origin. `private` caching keeps the photo in this browser and out of any proxy.
 */
import { createReadStream } from 'node:fs'
import { useDb } from '../../utils/db'
import { apiError, guard, requiredParam } from '../../utils/http'
import { readUpload } from '../../services/uploads'

export default defineEventHandler((event) => {
  const id = requiredParam(event, 'id')
  const file = guard(() => readUpload(useDb(), event.context.venueId, event.context.actor, id))
  if (!file) throw apiError(404, 'UPLOAD_NOT_FOUND', 'slika nije pronađena')

  setResponseHeaders(event, {
    'Content-Type': file.mime,
    'Content-Length': String(file.bytes),
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline; filename="slika.jpg"',
    'Cache-Control': 'private, max-age=3600',
    'Content-Security-Policy': "default-src 'none'",
  })
  return sendStream(event, createReadStream(file.path))
})
