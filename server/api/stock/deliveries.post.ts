/** `POST /api/stock/deliveries` — *prijem robe*. Returns the whole updated list. */
import { createDeliveryBody } from '#shared/schemas'
import { useDb } from '../../utils/db'
import { guard, readValidatedJson } from '../../utils/http'
import { currentVenueId } from '../../utils/venue'
import { createDelivery } from '../../services/stock'

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, createDeliveryBody)
  return guard(() => {
    const db = useDb()
    return createDelivery(db, currentVenueId(db), body)
  })
})
