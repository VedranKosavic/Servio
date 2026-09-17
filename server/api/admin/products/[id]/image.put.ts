/**
 * `PUT /api/admin/products/:id/image` — multipart, one field `image`: the tile's
 * thumbnail, already shrunk to a small JPEG on the admin's phone.
 */
import { useDb } from '../../../../utils/db'
import { apiError, guard, requiredParam } from '../../../../utils/http'
import { requireRole } from '../../../../utils/auth'
import { setProductImage } from '../../../../services/admin'

export default defineEventHandler(async (event) => {
  requireRole(event.context.actor, 'admin')
  const id = requiredParam(event, 'id')
  const parts = await readMultipartFormData(event).catch(() => undefined)
  const image = parts?.find(part => part.name === 'image')
  if (!image?.data?.length) throw apiError(400, 'INVALID_BODY', 'image: missing file part')
  return guard(() => setProductImage(useDb(), event.context.venueId, event.context.actor, id, image.data))
})
