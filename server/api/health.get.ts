/**
 * `GET /api/health` — "is this release actually alive?"
 *
 * It touches the database on purpose: a process that is up but cannot open
 * SQLite is exactly the failure a health check exists to catch, and an
 * `{ ok: true }` that never asks a question would sail straight past it.
 *
 * It takes no venue. This is the one `'public'` route with no session in front
 * of it — `deploy/deploy.sh` curls it from the server itself after a restart,
 * before any cookie exists, and rolls the release back when it does not answer.
 * So it counts the whole file rather than one café's rows, and a box whose
 * database is not seeded yet still answers instead of 500ing the first deploy.
 */
import { useDb } from '../utils/db'
import { guard } from '../utils/http'
import { getHealth } from '../services/bootstrap'

export default defineEventHandler(() => guard(() => getHealth(useDb())))
