/**
 * Where a person lands after the PIN — one rule, written once.
 *
 * The first screen is a PIN pad and nothing else: no names, no role buttons.
 * The digits identify the person, and this function says what happens next.
 *
 * | who | what they get |
 * |---|---|
 * | `admin` | `/admin` — the dashboard. He never appears on, or shares, a staff screen. |
 * | `radnik` with a `mode` | `/konobar` or `/sanker`, whichever he picked. |
 * | `radnik` with no `mode` | `null` — the chooser, *Na čemu si večeras?* |
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

export function landingFor(role: Role, mode: ScreenMode | null | undefined): LandingPath | null {
  if (role === 'admin') return '/admin'
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
