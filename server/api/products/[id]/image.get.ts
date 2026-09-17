/**
 * `GET /api/products/:id/image?v=` — a menu article's thumbnail.
 *
 * The URL carries the picture's version, so the answer may be cached for a year
 * and never revalidated: a new picture is a new URL. The same picture for
 * everybody in the venue, so the service worker keeps it for offline use too.
 * `nosniff` and `default-src 'none'` keep the bytes from ever running as a page.
 */
import { useDb } from '../../../utils/db'
import { apiError, requiredParam } from '../../../utils/http'
import { readProductImage } from '../../../services/admin'

export default defineEventHandler((event) => {
  const id = requiredParam(event, 'id')
  const row = readProductImage(useDb(), event.context.venueId, id)
  if (!row) throw apiError(404, 'UPLOAD_NOT_FOUND', 'slika nije pronađena')
  setResponseHeaders(event, {
    'Content-Type': 'image/jpeg',
    'Content-Length': String(row.bytes.length),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=31536000, immutable',
    'Content-Security-Policy': "default-src 'none'",
  })
  return row.bytes
})
