/**
 * `POST /api/uploads` — multipart, one field `image` and one field `kind`.
 *
 * The five checks live in `services/uploads.ts` and run in a fixed order; this
 * file only turns the multipart body into a Buffer and a kind.
 *
 * **Multipart, not JSON.** A JPEG base64-encoded into JSON is a third bigger and
 * has to be decoded twice; `readMultipartFormData` hands us the raw bytes h3
 * already parsed, which is what the magic-byte check needs.
 *
 * It deliberately **bumps nothing** (PHASE4 §2.11): an orphan upload nobody can
 * see is not an event — the message that references it is, and that one bumps
 * `chat`.
 */
import { useDb } from '../../utils/db'
import { apiError, guard } from '../../utils/http'
import { createUpload, parseUploadKind } from '../../services/uploads'

export default defineEventHandler(async (event) => {
  const parts = await readMultipartFormData(event).catch(() => undefined)
  const image = parts?.find(part => part.name === 'image')
  if (!image?.data?.length) throw apiError(400, 'INVALID_BODY', 'image: missing file part')

  const kindPart = parts?.find(part => part.name === 'kind')
  const result = guard(() => {
    const kind = parseUploadKind(kindPart ? kindPart.data.toString('utf8').trim() : 'chat')
    return createUpload(
      useDb(), event.context.venueId, event.context.actor,
      { bytes: image.data, filename: image.filename }, kind,
    )
  })

  setResponseStatus(event, 201)
  return result
})
