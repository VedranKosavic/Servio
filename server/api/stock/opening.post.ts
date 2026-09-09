/** `POST /api/stock/opening` — the *Početno stanje* screen (§6.8). */
import { openingStockBody } from '#shared/schemas'
import { useDb } from '../../utils/db'
import { guard, readValidatedJson } from '../../utils/http'
import { setOpeningStock } from '../../services/stock'

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, openingStockBody)
  return guard(() =>
    setOpeningStock(useDb(), event.context.venueId, event.context.actor, body))
})
