/**
 * Where a person lands after the PIN — one rule, written once.
 *
 * The first screen is a PIN pad and nothing else: no names, no role buttons.
 * The digits identify the person, and this function says what happens next.
 *
 * | who | what they get |
 * |---|---|
 * | `admin` | `/admin` — the dashboard. He never appears on, or shares, a staff screen. |
 * | `radnik` with a `mode` **and** a shift | `/konobar` or `/sanker`, whichever he picked. |
 * | `radnik` missing either | `null` — the chooser, which asks for whichever is missing. |
 *
 * **Both halves are required** since the handover (23.09.2026). The screen says
 * where he works and the shift says *whose night his rounds belong to*; with
 * two shifts open at once the second is no longer derivable from the clock, so
 * a worker who has not answered it cannot be sent to a floor plan — his first
 * lock would land on whichever crew the café happened to have open.
 *
 * `null` is deliberately not a path: the chooser is a screen the client owns
 * and the server has no opinion about, and returning a route string from
 * `shared/` would make it a second place to keep in step.
 *
 * The owner also serves tables, so `/konobar` and `/sanker` stay reachable for
 * an admin who types the address — that is a *guard* question and not a landing
 * one, and `ROUTE_ROLES` already answers it (`admin` is on every staff route).
 * This function only decides where a fresh session is sent.
 */
import type { Role, ScreenMode } from './types'

export type LandingPath = '/admin' | '/konobar' | '/sanker'

export function landingFor(
  role: Role, mode: ScreenMode | null | undefined, shiftId?: string | null,
): LandingPath | null {
  if (role === 'admin') return '/admin'
  // `undefined` rather than `null` is how a caller that has not been taught
  // about shifts reads: an old client asking for a landing gets the mode's
  // answer, not a chooser it cannot draw.
  if (shiftId === null) return null
  if (mode === 'konobar') return '/konobar'
  if (mode === 'sanker') return '/sanker'
  return null
}

/** The Bosnian name of a role, for the one or two screens that print it. */
export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Vlasnik',
  radnik: 'Radnik',
}

/** The Bosnian name of a screen mode — what the chooser's two buttons say. */
export const MODE_LABELS: Record<ScreenMode, string> = {
  konobar: 'Konobar',
  sanker: 'Šanker',
}
