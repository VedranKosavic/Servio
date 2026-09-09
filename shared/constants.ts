/**
 * The lists that two files would otherwise have to agree about by hand.
 *
 * Everything here is checked by a test somewhere: `TRIGGER_NAMES` against
 * `sqlite_master`, `GLOBAL_UNIQUE_INDEXES` against `PRAGMA index_list`,
 * `PIN_BEARING_ROUTES` against the Zod schemas and `ROUTE_ROLES`,
 * `ALERT_RULE_KEYS` against the ✔ column of `shared/logTemplates.ts`. A list
 * that nothing checks is a comment; these are not comments.
 */

/**
 * The unique indexes that are deliberately **not** scoped by `venue_id`.
 *
 * Every other unique index in this database starts with `venue_id`, because a
 * second café must be an insert and not a rewrite. These five cannot be:
 * each one is looked up *before* anybody knows which venue the request is about.
 *
 * `tests/unit/schema.test.ts` walks every table and fails on any declared unique
 * index whose first column is not `venue_id` and which is not on this list.
 */
export const GLOBAL_UNIQUE_INDEXES = [
  'venues_slug_uq', // one slug per installation
  'users_email_uq', // an email identifies a person before a venue is known
  'enrol_codes_code_uq', // the phone has no venue yet when it posts the code
  'devices_token_uq', // a bare cookie token is looked up before the venue
  'sessions_token_uq', // same
] as const

/**
 * Every trigger `server/database/triggers.sql` installs. `schema.test.ts`
 * asserts each one exists in `sqlite_master` after a boot — which is how a
 * trigger silently dropped by a table rebuild becomes a failing test rather
 * than a ledger that quietly started accepting edits.
 */
export const TRIGGER_NAMES = [
  'alert_events_no_delete',
  'alert_events_update_guard',
  'auth_attempts_no_delete',
  'auth_attempts_no_update',
  'cash_movements_no_delete',
  'cash_movements_update_guard',
  'deliveries_no_delete',
  'deliveries_update_guard',
  'delivery_lines_no_delete',
  'delivery_lines_no_update',
  'line_adjustments_no_delete',
  'line_adjustments_update_guard',
  'log_entries_no_delete',
  'log_entries_update_guard',
  'order_lines_no_delete',
  'order_lines_no_update',
  'orders_no_delete',
  'orders_shift_required',
  'orders_update_guard',
  'payments_no_delete',
  'payments_no_update',
  'payments_reversal_needs_approver',
  'payments_shift_required',
  'price_history_no_delete',
  'price_history_update_guard',
  'shift_members_no_delete',
  'shift_members_update_guard',
  'shift_summaries_no_delete',
  'shift_summaries_no_update',
  'shifts_frozen_cols',
  'shifts_no_delete',
  'shifts_status_guard',
  'stock_count_lines_no_delete',
  'stock_count_lines_update_guard',
  'stock_counts_no_delete',
  'stock_counts_update_guard',
  'stock_movements_no_delete',
  'stock_movements_no_update',
  'tabs_assigned_required',
  'tabs_frozen_cols',
  'tabs_no_delete',
  'tabs_status_guard',
  'waiter_settlements_no_delete',
  'waiter_settlements_update_guard',
  'waste_events_no_delete',
  'waste_events_update_guard',
] as const

/** Tables whose rows are cursors or credentials, not history — no triggers, on purpose. */
export const UNGUARDED_TABLES = ['changes', 'sessions', 'enrol_codes', 'task_runs'] as const

/** Tables allowed to have no `venue_id` column. */
export const VENUELESS_TABLES = [
  'venues',
  'changes',
  'task_runs',
  'sqlite_sequence',
  '__drizzle_migrations',
] as const

/**
 * Every route whose body may carry a PIN. All of them go through
 * `verifyPinMetered` and all of them are rate-limited on
 * `(deviceId, approverUserId)` — without that, any logged-in waiter could loop
 * `POST /api/adjustments` with an admin's user id and walk the 6-digit space in
 * minutes.
 *
 * `tests/unit/pin-routes.test.ts` makes the list self-maintaining: it greps
 * `shared/schemas/*.ts` for every exported Zod object with a key matching
 * `/(^|_)pin$/` — which catches `pin` and the settle body's `receiver_pin`
 * alike — and asserts the route using it appears here, and that every route here
 * is a key in `ROUTE_ROLES`.
 */
export const PIN_BEARING_ROUTES = [
  'POST /api/adjustments',
  'POST /api/adjustments/:id/decide',
  'POST /api/shifts/:id/settle',
  'POST /api/shifts/:id/close',
  'POST /api/cash-movements/:id/decide',
  'POST /api/stock/waste',
] as const

/**
 * The fourteen things worth the owner's attention (BACKEND §9). `queueAlert`
 * takes one of these, so a log kind marked ✔ with no key here is a kind that
 * would throw at 03:10 on a shift close. They surface **inside the app**, on
 * the *Puls* attention list — nothing is sent anywhere.
 *
 * Deliberately absent: an item for every shift *opening* is noise, and telling
 * the owner about the payout decision he just made is noise.
 *
 * **`shift_not_closed` is WP8's, and it is the one key with no log kind behind
 * it besides `health`.** §10 asks the nightly task to raise it when a shift is
 * still open three hours past closing time; there is no *event* to log, because
 * the whole point is that nothing happened. `tests/unit/alerts.test.ts` names
 * its caller in `NON_LOG_CALLERS` the same way it names `health`'s.
 */
export const ALERT_RULE_KEYS = [
  'shift_closed',
  'shift_forced',
  /** A settlement outside tolerance — the word and the declared amount, never the diff. */
  'cash_variance',
  'settlement_late',
  /** A void decided after payment, or an admin PIN on somebody else's phone. */
  'void_after_payment',
  'payment_reversed',
  'comp_large',
  'late_after_settle',
  'late_after_close',
  /** A confirmed count over `variance_alert_fen`. */
  'stock_variance',
  'payout_pending',
  'device_lockout',
  /** Nobody closed the night: still `open` three hours past `closing_time`. */
  'shift_not_closed',
  /** A backup or a nightly task that failed. */
  'health',
] as const

/** How long past `closing_time` a shift may stay open before the nightly says so. */
export const SHIFT_NOT_CLOSED_GRACE_H = 3

export type AlertRuleKey = typeof ALERT_RULE_KEYS[number]

/** Quiet hours, local: an alert queued inside them waits until 10:00. */
export const QUIET_HOURS_FROM = 3
export const QUIET_HOURS_TO = 10
/** …except these three, which are the reason he opens the app at all. */
export const QUIET_HOURS_EXEMPT: AlertRuleKey[] = ['shift_closed', 'cash_variance', 'health']

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * How far back `lockoutState` counts failures. The 5-fail (60 s) and 10-fail
 * (900 s) step-ups are windowed; the 15-fail **device lock is not**, so pacing
 * the guesses cannot evade it.
 */
export const LOCKOUT_WINDOW_S = 900
export const LOCKOUT_STEPS = [
  { fails: 5, lockS: 60 },
  { fails: 10, lockS: 900 },
] as const
/** The unwindowed one: `devices.locked_at`, cleared by a PIN reset or an unlock. */
export const DEVICE_LOCK_FAILS = 15

/** Session lifetimes, seconds. An admin's slides; a staff session never does. */
export const ADMIN_SESSION_S = 30 * 24 * 3600
export const STAFF_SESSION_S = 14 * 3600
export const BORROWED_SESSION_S = 2 * 3600
export const DEVICE_COOKIE_S = 365 * 24 * 3600
/** An admin session is extended at most once a day. */
export const ADMIN_SLIDE_EVERY_S = 24 * 3600

/** Enrol codes: 6 characters, no I/O/0/1, ten minutes, two uses. */
export const ENROL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const ENROL_CODE_LEN = 6
export const ENROL_CODE_TTL_S = 600
export const ENROL_CODE_USES = 2

/**
 * Rate limits, in `(limit, windowSeconds)` pairs. They are **widened** in dev
 * and in vitest, never disabled — the last line of defence behind three
 * critical auth findings must not be the one thing that never runs on the
 * developer's machine.
 */
export const RATE_LIMITS = {
  /** Keyed by the `sank_d` token hash when present, else the IP. */
  auth: { limit: 10, windowS: 60 },
  /** Keyed by `deviceId + ':' + approverUserId` on the PIN-bearing routes. */
  pin: { limit: 10, windowS: 60 },
  /** Keyed by `deviceId ?? sessionId`. */
  orders: { limit: 60, windowS: 60 },
} as const

/** Every money field in a body: `z.int().min(0).max(MAX_MONEY_FEN)`. */
export const MAX_MONEY_FEN = 10_000_000

/** Cookie names. `server/utils/auth.ts` is the only file that touches them. */
export const SESSION_COOKIE = 'sank_s'
export const DEVICE_COOKIE = 'sank_d'
