import { useDb } from '../../utils/db'
import { guard } from '../../utils/http'
import { currentVenueId } from '../../utils/venue'
import { getTablesState } from '../../services/tabs'

export default defineEventHandler(() => guard(() => {
  const db = useDb()
  return getTablesState(db, currentVenueId(db))
}))
