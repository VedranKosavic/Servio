/**
 * `GET /api/uploads/:id` — the access-checked stream.
 *
 * **404, never 403.** `readUpload` returns `null` for every refusal, and this
 * route cannot tell the two apart on purpose: a 403 on a *Konobari* photo an
 * admin asked about would confirm the file exists, which is exactly the thing
 * §8 says must not happen.
 *
 * `private, no-store` because the answer depends on who is asking — a shared
 * cache holding one person's photo and handing it to the next request would
 * undo the check above.
 */
import { createReadStream, existsSync } from 'node:fs'
import { useDb } from '../../utils/db'
import { apiError, requiredParam } from '../../utils/http'
import { errorMessage } from '#shared/errors'
import { readUpload } from '../../services/uploads'

export default defineEventHandler((event) => {
  const id = requiredParam(event, 'id')
  const found = readUpload(useDb(), event.context.venueId, event.context.actor, id)
  if (!found || !existsSync(found.path)) {
    throw apiError(404, 'UPLOAD_NOT_FOUND', errorMessage('UPLOAD_NOT_FOUND'))
  }

  setHeader(event, 'Content-Type', found.mime)
  setHeader(event, 'Content-Length', found.bytes)
  setHeader(event, 'Cache-Control', 'private, no-store')
  return sendStream(event, createReadStream(found.path))
})
