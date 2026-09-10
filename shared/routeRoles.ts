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
 * seven `AR_APPROVE` rows below let a `radnik` in at the door, and the setting
 * decides whether the service then serves him. An owner who drops `radnik` from
 * `approver_roles` in *Postavke* gets approvals that only he can give, refused
 * by the service even though this table let the worker through.
 *
 * Note the word `owner` in some paths. Those name the owner *dashboard* screens
 * of PLAN §11; the **role** guarding them is `admin`. `'owner'` is not an
 * accepted role value anywhere after the Korak 2 migration.
 */
import type { Role } from './types'
import { CHANNEL_KINDS } from './chat'

export type RouteRole = Role[] | 'public' | 'any'

/** Every role there is — the two-role list, spelled once. */
const AR: Role[] = ['admin', 'radnik']
/**
 * The approval routes. Same two roles as `AR` — the coarse gate cannot express
 * "a worker approves only while `approver_roles` says so" — but spelled
 * separately because the *meaning* differs: these are the seven rows §5 calls
 * the coarse half of `settings.approver_roles`, and reading `AR_APPROVE` in the
 * table is how you find them.
 */
const AR_APPROVE: Role[] = ['admin', 'radnik']
const A: Role[] = ['admin']

/**
 * Turn a live request into a key. Uuid segments become `:id`, so
 * `POST /api/tabs/4f3c…/move` finds `POST /api/tabs/:id/move`. Query strings are
 * not part of the key. Method is upper-case, path has no trailing slash.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Phase 4 adds one more rule, and it is not decoration: `svi` is not a uuid, so
 * `POST /api/chat/svi/messages` would normalise to itself, find no key, and be
 * 403'd by `tenant.ts` — deny-by-default doing exactly its job against a route
 * that is perfectly legitimate. A segment in `CHANNEL_KINDS` **immediately after
 * `/api/chat`** therefore becomes `:channel`. Position matters: only that one
 * slot, so a message id that happened to be the word `svi` somewhere deeper
 * could never be mistaken for a channel.
 */
export function routeKey(method: string, path: string): string {
  const clean = (path.split('?')[0] ?? '').replace(/\/+$/, '') || '/'
  const segments = clean.split('/')
  const normalised = segments
    .map((seg, i) => {
      if (UUID.test(seg)) return ':id'
      const isChannelSlot = i === 3 && segments[1] === 'api' && segments[2] === 'chat'
      if (isChannelSlot && (CHANNEL_KINDS as string[]).includes(seg)) return ':channel'
      return seg
    })
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
  // A radnik picking (or switching) his screen for tonight. `any`, not a role
  // list: an admin may call it too and the service simply keeps his mode null.
  'POST /api/auth/mode': 'any',
  'POST /api/devices/enrol': 'public',
  'POST /api/devices/heartbeat': 'any',
  'GET /api/me': 'any',
  // 404s outright unless SANK_DEV_ENROL=1, which /opt/sank/.env never sets.
  'POST /api/dev/enrol': 'public',
  // Same gate, same reason: the e2e suite clears the auth window between files.
  'POST /api/dev/reset-limits': 'public',

  // -- Orders, tabs, payments, adjustments ---------------------------------
  'POST /api/orders': AR,
  'GET /api/tables/state': AR,
  'GET /api/tabs/:id': AR,
  'POST /api/payments': AR,
  'POST /api/tabs/unpaid': AR,
  'POST /api/tabs/:id/unpaid/decide': A,
  'POST /api/tabs/:id/move': AR,
  'POST /api/tabs/:id/assign': AR,
  'POST /api/tabs/:id/accept': AR,
  'POST /api/adjustments': AR,
  'POST /api/adjustments/:id/decide': AR_APPROVE,
  'GET /api/adjustments/pending': AR,
  'POST /api/drafts/discard': AR,
  'GET /api/prep': AR,
  'POST /api/prep/:id/done': AR,

  // -- Shifts, cash, settlement --------------------------------------------
  'POST /api/shifts/open': AR,
  'POST /api/shifts/:id/closing': AR_APPROVE,
  'POST /api/shifts/:id/close': AR_APPROVE,
  'POST /api/shifts/:id/force-close': A,
  'POST /api/shifts/:id/review': A,
  // Self-service: the service refuses a settle for anybody but the actor.
  'POST /api/shifts/:id/settle': AR,
  'POST /api/shifts/:id/settlements/:id/accept': AR_APPROVE,
  'POST /api/shifts/:id/leave': AR,
  'POST /api/shifts/:id/float': AR_APPROVE,
  'POST /api/shifts/:id/payout': AR,
  'POST /api/shifts/:id/pickup': A,
  'POST /api/shifts/:id/opening-float': A,
  'POST /api/cash-movements/:id/decide': AR_APPROVE,
  // The receiver acknowledges his own float_out; that is the whole point.
  'POST /api/cash-movements/:id/ack': AR,
  'GET /api/me/shift': AR,
  'GET /api/me/shift/lines': AR,
  'GET /api/me/shifts': AR,
  // Own row only — the service refuses a shift this person was not on (§1.6).
  'PUT /api/me/shifts/:id/note': AR,
  'GET /api/me/sessions': AR,

  // -- Stock ---------------------------------------------------------------
  'GET /api/stock': AR,
  'POST /api/stock/opening': A,
  // Admin always; a radnik only when `bartender_can_receive_goods` is on,
  // which the service checks — this row is the coarse half of that rule.
  'POST /api/stock/deliveries': AR_APPROVE,
  'GET /api/stock/deliveries': AR_APPROVE,
  'POST /api/stock/deliveries/:id/reverse': A,
  'POST /api/stock/waste': AR,
  'POST /api/stock/waste/:id/approve': AR_APPROVE,
  'POST /api/stock/corrections': A,
  'POST /api/stock/counts': AR,
  'POST /api/stock/counts/:id/confirm': A,
  // *Potvrđujem stanje*: the incoming custodian, whoever he is. A worker taking
  // the bar over witnesses exactly like the one handing it over does, and the
  // service refuses the one person who must not — the counter himself.
  'POST /api/stock/counts/:id/witness': AR,
  'GET /api/stock/counts': AR,
  'GET /api/stock/counts/:id': AR,

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

  // -- Phase 4: Razgovor ---------------------------------------------------
  // Every row here is AR and the *channel* is what decides access, through
  // `canSee` inside the service — the coarse gate cannot express "an admin may
  // open two of the three rooms".
  'GET /api/chat/since': AR,
  'GET /api/chat/:channel/messages': AR,
  'POST /api/chat/:channel/messages': AR,
  'POST /api/chat/:channel/pin': AR,
  'POST /api/chat/messages/:id/delete': AR,
  'POST /api/chat/messages/:id/forward': AR,
  'POST /api/chat/read': AR,
  'POST /api/chat/users/:id/mute': A,

  // -- Phase 4: slike ------------------------------------------------------
  // `kind='delivery'` is gated inside the service by `bartender_can_receive_goods`,
  // the same setting that gates `POST /api/stock/deliveries`.
  'POST /api/uploads': AR,
  'GET /api/uploads/:id': AR,

  // -- Phase 4: Raspored ---------------------------------------------------
  'GET /api/roster': AR,
  'GET /api/me/roster': AR,
  'GET /api/me/roster/hours': AR,
  'POST /api/roster/weeks/copy': A,
  'POST /api/roster/weeks/publish': A,
  'POST /api/roster/assignments': A,
  'PATCH /api/roster/assignments/:id': A,
  'DELETE /api/roster/assignments/:id': A,
  'GET /api/roster/swaps': A,
  // Own row only — the service refuses a swap on anybody else's shift.
  'POST /api/roster/swaps': AR,
  'POST /api/roster/swaps/:id/accept': AR,
  'POST /api/roster/swaps/:id/decline': AR,
  'POST /api/roster/swaps/:id/cancel': AR,
  'POST /api/roster/swaps/:id/assign': A,
  'GET /api/roster/hours': A,
  'GET /api/admin/shift-templates': A,
  'POST /api/admin/shift-templates': A,
  'PATCH /api/admin/shift-templates/:id': A,

  // -- Phase 4: Pravila ----------------------------------------------------
  'GET /api/rules': AR,
  'POST /api/me/rules/ack': AR,
  'GET /api/admin/rules': A,
  'POST /api/admin/rules': A,

  // -- Phase 4: Prijem sa slike --------------------------------------------
  'POST /api/stock/deliveries/scan': AR_APPROVE,
  'POST /api/stock/scans/:id/discard': A,
  'POST /api/stock/supplier-aliases': A,
}
