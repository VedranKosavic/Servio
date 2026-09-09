/**
 * Authorization, deny-by-default, in one table.
 *
 * `server/middleware/tenant.ts` normalises `method + path` into a key, looks it
 * up here and **403s when the key is absent**. That is the important half: a new
 * route is dead until somebody declares it, so forgetting to guard a route
 * fails closed rather than open. `tests/unit/route-roles.test.ts` walks
 * `server/api/**` and asserts the two sets match exactly, both directions.
 *
 * This is the **coarse** gate. The fine one is `settings.approver_roles`: the
 * seven `['admin','bartender']` rows below are a *default*, and an owner who
 * drops `bartender` from that setting gets a bartender the service refuses even
 * though this table let him through. A waiter never decides anybody's money.
 *
 * Note the word `owner` in some paths. Those name the owner *dashboard* screens
 * of PLAN §11; the **role** guarding them is `admin`. `'owner'` is not an
 * accepted role value anywhere after the Korak 2 migration.
 */
import type { Role } from './types'

export type RouteRole = Role[] | 'public' | 'any'

/** Every role there is — the three-role list, spelled once. */
const AWB: Role[] = ['admin', 'waiter', 'bartender']
/** Approvals: admin, plus the bartender by default (`settings.approver_roles`). */
const AB: Role[] = ['admin', 'bartender']
const A: Role[] = ['admin']

/**
 * Turn a live request into a key. Uuid segments become `:id`, so
 * `POST /api/tabs/4f3c…/move` finds `POST /api/tabs/:id/move`. Query strings are
 * not part of the key. Method is upper-case, path has no trailing slash.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function routeKey(method: string, path: string): string {
  const clean = (path.split('?')[0] ?? '').replace(/\/+$/, '') || '/'
  const normalised = clean
    .split('/')
    .map(seg => (UUID.test(seg) ? ':id' : seg))
    .join('/')
  return `${method.toUpperCase()} ${normalised}`
}

export const ROUTE_ROLES: Record<string, RouteRole> = {
  // -- Auth and devices ----------------------------------------------------
  // `public` means "before a session exists", not "before anything exists":
  // the PIN and user-list routes still require an enrolled device cookie.
  'POST /api/auth/admin/login': 'public',
  'POST /api/auth/pin': 'public',
  'GET /api/auth/users': 'public',
  'POST /api/auth/logout': 'any',
  'POST /api/devices/enrol': 'public',
  'POST /api/devices/heartbeat': 'any',
  'GET /api/me': 'any',
  // 404s outright unless SANK_DEV_ENROL=1, which /opt/sank/.env never sets.
  'POST /api/dev/enrol': 'public',

  // -- Orders, tabs, payments, adjustments ---------------------------------
  'POST /api/orders': AWB,
  'GET /api/tables/state': AWB,
  'GET /api/tabs/:id': AWB,
  'POST /api/payments': AWB,
  'POST /api/tabs/unpaid': AWB,
  'POST /api/tabs/:id/unpaid/decide': A,
  'POST /api/tabs/:id/move': AWB,
  'POST /api/tabs/:id/assign': AWB,
  'POST /api/tabs/:id/accept': AWB,
  'POST /api/adjustments': AWB,
  'POST /api/adjustments/:id/decide': AB,
  'GET /api/adjustments/pending': AWB,
  'POST /api/drafts/discard': AWB,
  'GET /api/prep': AWB,
  'POST /api/prep/:id/done': AWB,

  // -- Shifts, cash, settlement --------------------------------------------
  'POST /api/shifts/open': AWB,
  'POST /api/shifts/:id/closing': AB,
  'POST /api/shifts/:id/close': AB,
  'POST /api/shifts/:id/force-close': A,
  'POST /api/shifts/:id/review': A,
  // Self-service: the service refuses a settle for anybody but the actor.
  'POST /api/shifts/:id/settle': AWB,
  'POST /api/shifts/:id/settlements/:id/accept': AB,
  'POST /api/shifts/:id/leave': AWB,
  'POST /api/shifts/:id/float': AB,
  'POST /api/shifts/:id/payout': AWB,
  'POST /api/shifts/:id/pickup': A,
  'POST /api/shifts/:id/opening-float': A,
  'POST /api/cash-movements/:id/decide': AB,
  // The receiver acknowledges his own float_out; that is the whole point.
  'POST /api/cash-movements/:id/ack': AWB,
  'GET /api/me/shift': AWB,
  'GET /api/me/shift/lines': AWB,
  'GET /api/me/shifts': AWB,
  // Own row only — the service refuses a shift this person was not on (§1.6).
  'PUT /api/me/shifts/:id/note': AWB,
  'GET /api/me/sessions': AWB,

  // -- Stock ---------------------------------------------------------------
  'GET /api/stock': AWB,
  'POST /api/stock/opening': A,
  // Admin always; the bartender only when `bartender_can_receive_goods` is on,
  // which the service checks — this row is the coarse half of that rule.
  'POST /api/stock/deliveries': AB,
  'GET /api/stock/deliveries': AB,
  'POST /api/stock/deliveries/:id/reverse': A,
  'POST /api/stock/waste': AWB,
  'POST /api/stock/waste/:id/approve': AB,
  'POST /api/stock/corrections': A,
  'POST /api/stock/counts': AWB,
  'POST /api/stock/counts/:id/confirm': A,
  // *Potvrđujem stanje*: the incoming custodian, whoever he is. A waiter taking
  // the bar over from the šanker witnesses exactly like a šanker does, and the
  // service refuses the one person who must not — the counter himself.
  'POST /api/stock/counts/:id/witness': AWB,
  'GET /api/stock/counts': AWB,
  'GET /api/stock/counts/:id': AWB,

  // -- Sync and boot -------------------------------------------------------
  'GET /api/changes': 'any',
  'GET /api/bootstrap': 'any',
  // The deploy health gate curls this before any cookie exists.
  'GET /api/health': 'public',

  // -- Owner reads (the dashboard screens; the role is admin) ---------------
  'GET /api/owner/live': A,
  'GET /api/owner/shifts': A,
  'GET /api/owner/shift/:id': A,
  'GET /api/owner/shift/:id/summary': A,
  'GET /api/owner/shift/:id/lines': A,
  'GET /api/owner/stock': A,
  'GET /api/owner/stock/:id/movements': A,
  'GET /api/owner/categories': A,
  'GET /api/owner/nargila': A,
  'GET /api/owner/log': A,
  'GET /api/owner/log/:id': A,
  'POST /api/owner/log/seen': A,

  // -- Izvoz: the four CSV files (Phase 2 WP5) ------------------------------
  // Reads, so they bump nothing; owner-only, so per-person money and the
  // night's takings cannot be fetched by a phone that guessed the path.
  'GET /api/owner/export/smjene': A,
  'GET /api/owner/export/dnevni-pazar': A,
  'GET /api/owner/export/stavke': A,
  'GET /api/owner/export/popis': A,

  // -- Admin CRUD ----------------------------------------------------------
  'GET /api/admin/products': A,
  'POST /api/admin/products': A,
  'PATCH /api/admin/products/:id': A,
  'PUT /api/admin/products/:id/recipe': A,
  'GET /api/admin/categories': A,
  'POST /api/admin/categories': A,
  'PATCH /api/admin/categories/:id': A,
  'GET /api/admin/tables': A,
  'POST /api/admin/tables': A,
  'PATCH /api/admin/tables/:id': A,
  'GET /api/admin/stock-items': A,
  'POST /api/admin/stock-items': A,
  'PATCH /api/admin/stock-items/:id': A,
  'GET /api/admin/users': A,
  'POST /api/admin/users': A,
  'PATCH /api/admin/users/:id': A,
  'POST /api/admin/users/:id/pin': A,
  'GET /api/admin/devices': A,
  'PATCH /api/admin/devices/:id': A,
  'POST /api/admin/devices/:id/revoke': A,
  'POST /api/admin/devices/:id/unlock': A,
  'POST /api/admin/enrol-codes': A,
  'GET /api/admin/settings': A,
  'PATCH /api/admin/settings': A,
}
