import { useDb } from '../../utils/db'
import { guard } from '../../utils/http'
import { currentVenueId } from '../../utils/venue'
import { getPrep } from '../../services/prep'

export default defineEventHandler(() => guard(() => {
  const db = useDb()
  return getPrep(db, currentVenueId(db))
}))
