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
  /**
   * The path prefixes that light this row up, when `to` alone is not enough.
   *
   * *Meni i postavke* is the only row that needs it: its four tabs live under
   * two different prefixes (`/admin/meni` and `/admin/postavke/…`), because the
   * menu screen had its own URL long before the others were grouped behind it.
   */
  match?: string[]
  /** Is the screen behind it built? A false renders the row greyed out. */
  ready: boolean
  /** What the greyed-out row says. */
  soon?: string
}

export const ADMIN_NAV: AdminNavItem[] = [
  { id: 'puls', to: '/admin', label: 'Puls', icon: 'pulse', sub: 'Večeras, uživo', tab: true, ready: true },
  { id: 'smjene', to: '/admin/smjene', label: 'Smjena', icon: 'money', sub: 'Noći, pazar i predaje', tab: true, ready: true },
  { id: 'roba', to: '/admin/roba', label: 'Roba', icon: 'box', sub: 'Stanje, prijem, popisi, otpis', tab: true, ready: true },
  // *Razgovor* is deliberately absent. Chat is not a place the owner navigates
  // to and back from — it is something he answers while looking at a number, so
  // it lives in `ChatDock`, the copper button pinned to the corner of every
  // `/admin` screen. The page at `/admin/razgovor` still exists for a laptop.
  { id: 'raspored', to: '/admin/raspored', label: 'Raspored', icon: 'calendar', sub: 'Sedmica po smjenama', ready: true },
  // `to` is *Meni* and not `/admin/postavke`, which is *Podešavanja* — a screen
  // that moved to *Ostalo* and is no longer one of this row's four tabs. The row
  // has to land on a tab it actually shows.
  { id: 'postavke', to: '/admin/meni', match: ['/admin/meni', '/admin/postavke'], label: 'Meni i postavke', icon: 'users', sub: 'Cijene, kategorije, osoblje i uređaji', ready: true },
  // *Dnevnik* is absent too, by the owner's call — it is a record he reads when
  // a number looks wrong, not a weekly destination. Nothing about the record
  // changed: `log()` still writes an entry inside every admin transaction, and
  // */admin/dnevnik* is still the page that reads them, reached from the
  // sentence at the foot of *Podešavanja*.
  // One row for everything the owner touches a few times a year: the
  // thresholds, the published *Pravila*, the floor plan, the *Dnevnik* and the
  // CSV export. Each of those used to hold a row or a tab of its own, and
  // between them they made both the nav and the *Meni i postavke* strip longer
  // than anybody could read at a glance. They are not deleted — every one of
  // them still works, and a café needs all five eventually — they are simply
  // not in the way of the four screens this dashboard is actually for.
  { id: 'ostalo', to: '/admin/ostalo', label: 'Ostalo', icon: 'more', sub: 'Pragovi, pravila, stolovi, dnevnik i izvoz', ready: true },
]

/** The rows the phone's bottom bar shows. Four targets, and *Više* is the fifth. */
export function adminTabs(): AdminNavItem[] {
  return ADMIN_NAV.filter(item => item.tab)
}

/** Everything the bottom bar cannot fit — the *Više* list. */
export function adminMore(): AdminNavItem[] {
  return ADMIN_NAV.filter(item => !item.tab)
}
