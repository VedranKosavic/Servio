/**
 * `GET /api/bootstrap` — the whole boot in one request (§7).
 *
 * Fetched once when a screen opens and again only when `menu_version` moves;
 * everything that changes during a shift arrives through `GET /api/changes`
 * instead (§4.4). There is no second timer on this route.
 */
import { useDb } from '../utils/db'
import { guard } from '../utils/http'
import { getBootstrap } from '../services/bootstrap'

export default defineEventHandler(event => guard(() =>
  getBootstrap(useDb(), event.context.venueId, event.context.actor)))
