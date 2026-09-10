/**
 * Every row of the `/admin` navigation, listed once — the light twin of
 * `app/utils/waiterMenu.ts`.
 *
 * It exists for exactly the reason that file does: `app/layouts/admin.vue` (the
 * left nav and the bottom tabs) and `app/pages/admin/vise.vue` (the phone's *Više*
 * list) each used to carry their own inline array, so a Phase 4 package adding
 * *Razgovor* would have had to edit two files two other packages also own. Now
 * both read this, WP0 writes every row on day one, and a package's only change
 * here is flipping one boolean.
 *
 * A row whose screen is not built yet renders **disabled with its own
 * sentence** rather than being absent: a nav that grows an item every week
 * teaches nobody where anything is.
 */

/** The names in `UiIcon`'s set, spelled out — plain `tsc` cannot read a type
 * out of a single-file component, which is why `admin.vue` and
 * `dnevnikKinds.ts` spell the same union. */
export type AdminIcon =
  | 'pulse' | 'money' | 'box' | 'list' | 'users' | 'calendar'
  | 'chevron-right' | 'check' | 'x' | 'clock' | 'more' | 'chat' | 'image'

export interface AdminNavItem {
  /** English id; the label is what anybody reads. */
  id: string
  to: string
  /** Bosnian, from PLAN §12's glossary, verbatim. */
  label: string
  icon: AdminIcon
  /** One line under the label on the phone's *Više* list. */
  sub: string
  /** Shown in the bottom tab bar as well as in the left nav. */
  tab?: boolean
  /** Is the screen behind it built? A false renders the row greyed out. */
  ready: boolean
  /** What the greyed-out row says. */
  soon?: string
}

export const ADMIN_NAV: AdminNavItem[] = [
  { id: 'puls', to: '/admin', label: 'Puls', icon: 'pulse', sub: 'Večeras, uživo', tab: true, ready: true },
  { id: 'smjene', to: '/admin/smjene', label: 'Smjena', icon: 'money', sub: 'Noći, pazar i predaje', tab: true, ready: true },
  { id: 'roba', to: '/admin/roba', label: 'Roba', icon: 'box', sub: 'Stanje, prijem, popisi, otpis', tab: true, ready: true },
  // Phase 4 — WP1 flips `ready`, and that is the only line it touches here.
  { id: 'razgovor', to: '/admin/razgovor', label: 'Razgovor', icon: 'chat', sub: 'Svi i Admini', ready: true },
  // Phase 4 — WP2 flips `ready`.
  { id: 'raspored', to: '/admin/raspored', label: 'Raspored', icon: 'calendar', sub: 'Sedmica, zamjene i sati', ready: true },
  { id: 'postavke', to: '/admin/postavke', label: 'Meni i postavke', icon: 'users', sub: 'Cijene, normativi, stolovi, osoblje, uređaji', ready: true },
  { id: 'dnevnik', to: '/admin/dnevnik', label: 'Dnevnik', icon: 'list', sub: 'Ko je šta uradio, po danima', ready: true },
  { id: 'izvoz', to: '/admin/izvoz', label: 'Izvoz', icon: 'calendar', sub: 'CSV fajlovi za period', ready: true },
]

/** The rows the phone's bottom bar shows. Four targets, and *Više* is the fifth. */
export function adminTabs(): AdminNavItem[] {
  return ADMIN_NAV.filter(item => item.tab)
}

/** Everything the bottom bar cannot fit — the *Više* list. */
export function adminMore(): AdminNavItem[] {
  return ADMIN_NAV.filter(item => !item.tab)
}
