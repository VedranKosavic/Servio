import { useDb } from '../../utils/db'
import { guard } from '../../utils/http'
import { currentVenueId } from '../../utils/venue'
import { getStock } from '../../services/stock'

export default defineEventHandler(() => guard(() => {
  const db = useDb()
  return getStock(db, currentVenueId(db))
}))
