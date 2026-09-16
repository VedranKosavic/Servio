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
   * Where the same row goes for a bartender, when that is a different screen —
   * *Raspored* is the one row left with two copies, so his back arrow returns to
   * the ticket queue and not to a floor plan he does not use.
   */
  toBartender?: string
  /** A row that does something instead of navigating. */
  action?: 'logout' | 'wakelock'
  /** Which roles see this row at all. */
  roles: ('radnik' | 'admin')[]
  /**
   * Which of tonight's screens see it, when that matters. Absent: both. The
   * mode is on the session, so an admin (whose mode is always null) never
   * matches a row that names one.
   */
  modes?: ('konobar' | 'sanker')[]
  /** Is the screen behind it built? A false renders the row greyed out. */
  ready: boolean
  /** What the greyed-out row says. */
  soon?: string
}

export const WAITER_MENU: WaiterMenuItem[] = [
  // WP4
  { id: 'my-shift', label: 'Moja smjena', to: '/konobar/moja-smjena', roles: ['radnik'], ready: true },
  // *Zaključi smjenu* — only on the šanker's screen. The waiter's own
  // *Završi smjenu* is gone (the owner's call, 15.09.2026): the šanker closes the
  // whole night, and a konobar session never sees this row.
  { id: 'close-shift', label: 'Zaključi smjenu', to: '/sanker/zakljuci', roles: ['radnik'], modes: ['sanker'], ready: true },
  // WP4
  { id: 'rules', label: 'Pravila', to: '/konobar/pravila', roles: ['radnik'], ready: true },
  // WP0 — this package.
  { id: 'install', label: 'Instalacija', to: '/konobar/instalacija', roles: ['radnik'], ready: true },
  { id: 'wakelock', label: 'Drži ekran upaljen', action: 'wakelock', roles: ['radnik'], ready: true },
  // Phase 4. *Razgovor* was removed on the owner's call (15.09.2026).
  { id: 'roster', label: 'Raspored', to: '/konobar/raspored', toBartender: '/sanker/raspored', roles: ['radnik'], ready: true },
  // *Brzi popis*, *Otpis* and *Prebaci ekran* were removed on the owner's call
  // (16.09.2026). The screen a worker is on is still chosen after the PIN.
  // An admin who opens the staff app by URL has this as his way back. `/admin`
  // is the only row he does not share with the waiters; the dashboard itself no
  // longer links across to the staff screens.
  { id: 'dashboard', label: 'Kontrolna ploča', to: '/admin', roles: ['admin'], ready: true },
  { id: 'logout', label: 'Odjavi se', action: 'logout', roles: ['radnik', 'admin'], ready: true },
]
