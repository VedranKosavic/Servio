/**
 * Every row of the waiter's avatar sheet, listed once, on day one.
 *
 * This file exists so that four work packages building four screens in parallel
 * never have to edit the same menu. Each row already points at the route its
 * owner will create, and each row carries the package that owns it. A row whose
 * screen is not built yet renders **disabled with its own sentence** rather
 * than being absent — a menu that grows a new item every week teaches nobody
 * where anything is, and a disabled row that says *stiže uskoro* is honest.
 *
 * `ready` is the switch a package flips when its page lands, and the only line
 * of this file it may touch.
 */

export interface WaiterMenuItem {
  /** English id; the label is what anybody reads. */
  id: string
  /** Bosnian, from PLAN §12's glossary, verbatim. */
  label: string
  to?: string
  /** A row that does something instead of navigating. */
  action?: 'logout' | 'wakelock'
  /** Which roles see this row at all. */
  roles: ('waiter' | 'bartender' | 'admin')[]
  /** Is the screen behind it built? A false renders the row greyed out. */
  ready: boolean
  /** What the greyed-out row says. */
  soon?: string
}

export const WAITER_MENU: WaiterMenuItem[] = [
  // WP4
  { id: 'my-shift', label: 'Moja smjena', to: '/k/moja-smjena', roles: ['waiter', 'bartender'], ready: true },
  // Already on disk since Korak 1.
  { id: 'settle', label: 'Završi smjenu', to: '/k/smjena', roles: ['waiter', 'bartender'], ready: true },
  // WP2
  { id: 'count', label: 'Brzi popis', to: '/k/popis', roles: ['waiter', 'bartender'], ready: true },
  { id: 'waste', label: 'Otpis', to: '/k/otpis', roles: ['waiter', 'bartender'], ready: true },
  // WP4
  { id: 'rules', label: 'Pravila', to: '/k/pravila', roles: ['waiter', 'bartender'], ready: true },
  // WP0 — this package.
  { id: 'install', label: 'Instalacija', to: '/k/instalacija', roles: ['waiter', 'bartender'], ready: true },
  { id: 'wakelock', label: 'Drži ekran upaljen', action: 'wakelock', roles: ['waiter', 'bartender'], ready: true },
  // Phase 4. Listed so nobody wonders where chat went.
  { id: 'chat', label: 'Razgovor', roles: ['waiter', 'bartender'], ready: false, soon: 'stiže uskoro' },
  { id: 'roster', label: 'Raspored', roles: ['waiter', 'bartender'], ready: false, soon: 'stiže uskoro' },
  { id: 'logout', label: 'Odjavi se', action: 'logout', roles: ['waiter', 'bartender', 'admin'], ready: true },
]
