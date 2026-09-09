import { useDb } from '../utils/db'
import { guard } from '../utils/http'
import { currentVenueId } from '../utils/venue'
import { getBootstrap } from '../services/bootstrap'

export default defineEventHandler(() => guard(() => {
  const db = useDb()
  return getBootstrap(db, currentVenueId(db))
}))
