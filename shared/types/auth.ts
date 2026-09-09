/**
 * The shapes every screen boots from (`docs/BACKEND.md` §5.5).
 *
 * `GET /api/me`, `POST /api/auth/pin`, `POST /api/auth/admin/login` and
 * `GET /api/bootstrap` all answer with these same objects, built by one function
 * — `getMe()` in `server/services/auth.ts` — so the client has one parser and
 * not four.
 *
 * **Nothing here carries a secret.** `MeUser` deliberately has no `pin_hash`,
 * no `password_hash`, no `email` and no `telegram_chat_id`: `GET /api/auth/users`
 * is served *before* any session exists, to whoever is holding an enrolled
 * device, and it must contain no more than the lock screen draws.
 * `api-shapes.test.ts` walks every response and fails on any key matching
 * `/_hash$|token|password|pepper/`.
 */
import type { Role } from '../types'
import type { Settings } from '../settings'

/** A person, as every screen sees them. Never a hash, never an email. */
export interface MeUser {
  id: string
  name: string
  initials: string
  role: Role
  active: boolean
  /** 4 or 6 — how many dots the PIN pad draws before it auto-submits. */
  pin_len: 4 | 6
  /** False = this person cannot log in until an admin sets a PIN. */
  has_pin: boolean
}

/** The phone or tablet this request came from. `null` on an admin email session. */
export interface DeviceBrief {
  id: string
  label: string
  mode: 'personal' | 'shared'
  /** A personal device: whose it is. */
  bound_user_id: string | null
  /** Set by the 15th consecutive wrong PIN; cleared by a reset or an unlock. */
  locked_at: string | null
  /** What the last heartbeat said was still queued in the phone's outbox. */
  pending_count: number
  /** device clock − server clock, seconds. */
  clock_skew_s: number
}

export interface SessionBrief {
  id: string
  kind: 'admin' | 'staff'
  expires_at: string
  /** Somebody PIN'd into a colleague's personal phone: 2 h, not 14 h. */
  borrowed: boolean
}

export interface VenueBrief {
  id: string
  name: string
  slug: string
  settings: Settings
}

/** The envelope `GET /api/me` returns, and the one every login answers with. */
export interface MeContext {
  user: MeUser
  session: SessionBrief
  device: DeviceBrief | null
  venue: VenueBrief
  /** The sync cursor at this moment, so a screen can poll from here. */
  seq: number
}

/** `POST /api/auth/admin/login` — a laptop session, no device. */
export interface AdminLoginResult {
  user: MeUser
  venue: VenueBrief
  expires_at: string
}

/** `POST /api/auth/pin` — the staff session. */
export interface PinLoginResult {
  user: MeUser
  session: SessionBrief
  device: DeviceBrief
}

/**
 * `POST /api/devices/enrol` and `POST /api/dev/enrol`. The staff list rides
 * along so the lock screen has names to draw before any session exists.
 */
export interface EnrolResult {
  device: DeviceBrief
  venue: VenueBrief
  users: MeUser[]
}

/** `POST /api/admin/enrol-codes` — what the admin reads out across the bar. */
export interface EnrolCodeResult {
  code: string
  expires_at: string
  uses_left: number
}

/** One row of the *Uređaji* list in `/a`. */
export interface DeviceAdmin {
  id: string
  label: string
  mode: 'personal' | 'shared'
  bound_user_id: string | null
  bound_user_name: string | null
  enrolled_at: string
  last_seen_at: string | null
  app_version: string | null
  standalone: boolean | null
  pending_count: number
  clock_skew_s: number
  locked_at: string | null
  revoked_at: string | null
}

/**
 * A device that locked rounds in this shift and has not checked in since
 * `heartbeat_fresh_s` — reported to the person settling rather than thrown at
 * him, because a phone that is simply switched off must not block a hand-over
 * (§6.6).
 */
export interface StaleDevice {
  device_id: string
  label: string
  pending_count: number
  last_seen_at: string | null
}

// `HeartbeatResult` was declared here too, identically. The one that ships is
// WP5's in `shared/types/sync.ts`, next to the route, the service and the
// `changes` cursor it carries.
