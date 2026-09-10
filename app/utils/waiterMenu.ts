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
  /**
   * Where the same row goes for a bartender, when that is a different screen.
   *
   * `/sanker/popis` exists precisely so his back arrow returns to the ticket queue
   * and not to a floor plan he does not use; without this the row handed him
   * the waiter's copy and stranded him on `/konobar`.
   */
  toBartender?: string
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
  { id: 'my-shift', label: 'Moja smjena', to: '/konobar/moja-smjena', roles: ['waiter', 'bartender'], ready: true },
  // Already on disk since Korak 1.
  { id: 'settle', label: 'Završi smjenu', to: '/konobar/smjena', roles: ['waiter', 'bartender'], ready: true },
  // WP2
  { id: 'count', label: 'Brzi popis', to: '/konobar/popis', toBartender: '/sanker/popis', roles: ['waiter', 'bartender'], ready: true },
  { id: 'waste', label: 'Otpis', to: '/konobar/otpis', roles: ['waiter', 'bartender'], ready: true },
  // WP4
  { id: 'rules', label: 'Pravila', to: '/konobar/pravila', roles: ['waiter', 'bartender'], ready: true },
  // WP0 — this package.
  { id: 'install', label: 'Instalacija', to: '/konobar/instalacija', roles: ['waiter', 'bartender'], ready: true },
  { id: 'wakelock', label: 'Drži ekran upaljen', action: 'wakelock', roles: ['waiter', 'bartender'], ready: true },
  // Phase 4. The routes are written on day one and the rows stay disabled until
  // their screens land — WP1 flips `chat`, WP2 flips `roster`, one line each,
  // and nothing else in this file moves.
  { id: 'chat', label: 'Razgovor', to: '/konobar/razgovor', toBartender: '/sanker/razgovor', roles: ['waiter', 'bartender'], ready: true },
  { id: 'roster', label: 'Raspored', to: '/konobar/raspored', toBartender: '/sanker/raspored', roles: ['waiter', 'bartender'], ready: true },
  // The owner also serves tables, so he can be here — and this is his way back.
  // `/admin` is the only row he does not share with the waiters; the light
  // dashboard's own nav carries the mirror of it, *Konobarski ekran*.
  { id: 'dashboard', label: 'Kontrolna ploča', to: '/admin', roles: ['admin'], ready: true },
  { id: 'logout', label: 'Odjavi se', action: 'logout', roles: ['waiter', 'bartender', 'admin'], ready: true },
]
