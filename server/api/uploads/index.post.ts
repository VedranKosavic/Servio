/**
 * `POST /api/uploads` — multipart, one image, the only door bytes come through.
 *
 * The five checks and the file on disk are `services/uploads.ts`'s; this handler
 * only unwraps the multipart body. `readMultipartFormData` gives back one entry
 * per form field — the file part is the one with a `filename`, and everything
 * else is a plain text field, which is where `kind` arrives.
 *
 * No `bump` (PHASE4 §2.11): an orphan upload nobody can see is not an event.
 */
import { useDb } from '../../utils/db'
import { apiError, guard } from '../../utils/http'
import { createUpload, parseUploadKind } from '../../services/uploads'

export default defineEventHandler(async (event) => {
  const parts = await readMultipartFormData(event).catch(() => undefined)
  if (!parts || parts.length === 0) throw apiError(400, 'INVALID_BODY', 'body: nevalidan zahtjev')

  const file = parts.find(part => part.filename !== undefined && part.data.length > 0)
  if (!file) throw apiError(400, 'INVALID_BODY', 'image: nevalidan zahtjev')

  const kindField = parts.find(part => part.name === 'kind' && part.filename === undefined)

  return guard(() => {
    const kind = parseUploadKind(kindField ? kindField.data.toString('utf8') : 'chat')
    return createUpload(
      useDb(), event.context.venueId, event.context.actor,
      { bytes: file.data, filename: file.filename }, kind,
    )
  })
})
