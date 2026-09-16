/**
 * Every row of the `/admin` navigation, listed once — the light twin of
 * `app/utils/waiterMenu.ts`.
 *
 * It exists for exactly the reason that file does: `app/layouts/admin.vue` (the
 * left nav and the bottom tabs) and `app/pages/admin/vise.vue` (the phone's *Više*
 * list) each used to carry their own inline array, so a Phase 4 package adding
 * a row would have had to edit two files two other packages also own. Now
 * both read this, WP0 writes every row on day one, and a package's only change
 * here is flipping one boolean.
 *
 * A row whose screen is not built yet renders **disabled with its own
 * sentence** rather than being absent: a nav that grows an item every week
 * teaches nobody where anything is.
 */

/** The names in `UiIcon`'s set, spelled out — plain `tsc` cannot read a type
 * out of a single-file component, which is why this file spells the union. */
export type AdminIcon =
  | 'pulse' | 'money' | 'box' | 'list' | 'users' | 'calendar'
  | 'chevron-right' | 'check' | 'x' | 'clock' | 'more'

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
  // *Analitika* (the owner's call, 16.09.2026): the month's pazar, costs and
  // records. First under *Više*, because it is the screen he opens it for.
  { id: 'analitika', to: '/admin/analitika', label: 'Analitika', icon: 'money', sub: 'Mjesečni pazar, troškovi i rekordi', ready: true },
  { id: 'raspored', to: '/admin/raspored', label: 'Raspored', icon: 'calendar', sub: 'Sedmica po smjenama', ready: true },
  // *Kontrolna ploča* replaced *Meni i postavke*: one door to every table the
  // owner may edit (`app/utils/kontrola.ts`). `match` keeps the row lit on the
  // screens it links to, which kept their own URLs.
  { id: 'kontrola', to: '/admin/kontrola', match: ['/admin/kontrola', '/admin/meni', '/admin/postavke'], label: 'Kontrolna ploča', icon: 'list', sub: 'Osoblje, meni, zaliha, stolovi i postavke', ready: true },
  // Five rows, and that is the whole dashboard. *Dnevnik*, *Izvoz*,
  // *Podešavanja*, *Pravila*, *Stolovi*, *Šabloni* and *Razgovor* were deleted outright on
  // the owner's call — not hidden, deleted, pages and all. `log()` still writes
  // an entry inside every admin transaction and `log_entries` is still the
  // record behind it; what is gone is the screen that read it.
]

/** The rows the phone's bottom bar shows. Four targets, and *Više* is the fifth. */
export function adminTabs(): AdminNavItem[] {
  return ADMIN_NAV.filter(item => item.tab)
}

/** Everything the bottom bar cannot fit — the *Više* list. */
export function adminMore(): AdminNavItem[] {
  return ADMIN_NAV.filter(item => !item.tab)
}

/**
 * Where *Nazad* goes from a given `/admin` path, or `null` on a screen that is
 * already a destination.
 *
 * The owner's words were that navigating back and forth was "missing and
 * heavily needed": the phone has four bottom tabs and no browser chrome, so a
 * drill-down — a shift, an article, a delivery — was a one-way trip ending in a
 * tab tap that threw the context away.
 *
 * **It walks up the real router, not the string.** Chopping a segment off a path
 * produces plenty of URLs that are not pages: `/admin/smjena/<id>` would give
 * `/admin/smjena`, which 404s. So the caller passes `exists`, backed by
 * `router.resolve`, and this climbs until it finds an ancestor that actually
 * resolves. Two consequences worth knowing: a page added tomorrow is handled
 * with no change here, and a page deleted tomorrow cannot leave a back button
 * pointing into nothing.
 *
 * `ROOTS` are the screens a tab reaches directly. They end the climb rather than
 * starting one, because *Nazad* out of a destination is the bottom bar's job.
 * `OVERRIDES` are the handful of places where the nearest resolvable ancestor is
 * not the one a person means — a shift belongs to *Smjene* even though the two
 * spell their path differently.
 */
const BACK_ROOTS = new Set([
  '/admin',
  '/admin/smjene',
  '/admin/roba',
  '/admin/roba/prijem',
  '/admin/roba/artikli',
  '/admin/raspored',
  '/admin/kontrola',
  '/admin/vise',
])

const BACK_OVERRIDES: Array<[RegExp, string]> = [
  // `/admin/smjena/<id>` — singular path, plural list. Climbing finds `/admin`.
  [/^\/admin\/smjena\/[^/]+$/, '/admin/smjene'],
  // Every screen *Kontrolna ploča* lists goes back to *Više*, which now draws
  // those rows directly under *Raspored*. They kept their old URLs, and climbing
  // `/admin/postavke/…` would try a path that is not a page and land on *Puls*;
  // climbing `/admin/kontrola/…` would land on the hub the phone no longer uses.
  [/^\/admin\/meni$/, '/admin/vise'],
  [/^\/admin\/postavke\/[^/]+$/, '/admin/vise'],
  [/^\/admin\/kontrola\/[^/]+$/, '/admin/vise'],
  // *Analitika* is opened from *Više*, and climbing its path would land on *Puls*.
  [/^\/admin\/analitika$/, '/admin/vise'],
]

export function adminBack(path: string, exists: (candidate: string) => boolean): string | null {
  const clean = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
  if (BACK_ROOTS.has(clean)) return null
  if (!clean.startsWith('/admin')) return null

  for (const [pattern, target] of BACK_OVERRIDES) {
    if (pattern.test(clean)) return target
  }

  let candidate = clean
  for (;;) {
    const cut = candidate.lastIndexOf('/')
    if (cut < '/admin'.length - 1) break
    candidate = candidate.slice(0, cut) || '/admin'
    if (candidate === '/admin') return '/admin'
    if (exists(candidate)) return candidate
  }
  return '/admin'
}

/** The label on the way back — a nav row's own name when the target is one. */
export function adminBackLabel(to: string): string {
  return ADMIN_NAV.find(item => item.to === to)?.label ?? 'Nazad'
}

/**
 * The same destination in the accusative, because *na* governs it.
 *
 * The visible label is the screen's own name and is right as it stands — a
 * button reading *Smjena* is a noun, not a sentence. The **accessible** name is
 * a sentence, and "Nazad na Smjena" is not Bosnian: feminine nouns in *-a* take
 * *-u* after *na* (*Smjenu*, *Robu*), while the masculine ones do not change
 * (*Puls*, *Raspored*). Five rows, so the forms are written out rather than
 * guessed at by a rule that would be wrong the first time somebody adds a sixth.
 *
 * A target that is not a nav row — the middle of a drill-down, say — has no name
 * worth reading out, so the label is the whole sentence.
 */
const BACK_ACCUSATIVE: Record<string, string> = {
  '/admin': 'Puls',
  '/admin/smjene': 'Smjenu',
  '/admin/roba': 'Robu',
  '/admin/raspored': 'Raspored',
  '/admin/kontrola': 'Kontrolnu ploču',
  '/admin/vise': 'Više',
}

export function adminBackAria(to: string): string {
  const accusative = BACK_ACCUSATIVE[to]
  return accusative ? `Nazad na ${accusative}` : 'Nazad'
}
