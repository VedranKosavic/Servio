/**
 * `GET /api/health` — "is this release actually alive?"
 *
 * It touches the database on purpose: a process that is up but cannot open
 * SQLite is exactly the failure a health check exists to catch, and an
 * `{ ok: true }` that never asks a question would sail straight past it.
 */
import { useDb } from '../utils/db'
import { guard } from '../utils/http'
import { currentVenueId } from '../utils/venue'
import { getHealth } from '../services/bootstrap'

export default defineEventHandler(() => guard(() => {
  const db = useDb()
  return getHealth(db, currentVenueId(db))
}))
