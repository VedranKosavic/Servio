/**
 * The `/admin` kit: the logic behind it, and the two house rules the light theme
 * rests on.
 *
 * There is no DOM in this suite (`environment: 'node'`), and deliberately so —
 * mounting components to assert that a button says "Odobri" tests Vue, not Šank.
 * What is worth a test is what a rendering cannot catch:
 *
 * - `attentionTarget()` fills the right ids into the right paths. It moved to
 *   `shared/` in Phase 2 precisely so that the server and `UiAttentionRow` fill
 *   them the same way, and a wrong id here is a button that decides somebody
 *   else's storno.
 * - the formatters that every amount, date and duration on the dashboard goes
 *   through, including the real minus sign.
 * - the period presets, which are business dates and not calendar dates.
 * - **no hex value and no emoji anywhere under `/admin`.** The palette lives in one
 *   file; a stray `#fbfaf7` in a component is how a theme starts drifting, and
 *   an emoji is a house rule (`CLAUDE.md`) with no exceptions.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { adminBack, adminBackAria, adminBackLabel } from '../../app/utils/adminNav'
import { attentionTarget } from '../../shared/attention'
import { ATTENTION_ROUTES } from '../../shared/types/owner'
import type { AttentionItem } from '../../shared/types/owner'
import { ROUTE_ROLES } from '../../shared/routeRoles'
import {
  dateBs, dateTimeBs, durationBs, formatKm, signedAmount, signedKm, spanBs, timeBs,
} from '../../app/utils/adminFormat'
import { PERIOD_OPTIONS, resolvePeriod } from '../../app/composables/useAdminPeriod'

const ID = '3f9a1c22-0000-4000-8000-000000000001'

function item(patch: Partial<AttentionItem>): AttentionItem {
  return {
    kind: 'void',
    ref_type: 'line_adjustment',
    ref_id: ID,
    title_bs: 'Traži storno · Dino · Sto 9',
    at: '2026-09-08T20:41:00Z',
    actions: ['approve', 'reject'],
    ...patch,
  }
}

// ===========================================================================

describe('attentionTarget', () => {
  it('fills the row id into the path for the simple ref types', () => {
    expect(attentionTarget(item({}), 'approve'))
      .toBe(`POST /api/adjustments/${ID}/decide`)
    expect(attentionTarget(item({ ref_type: 'tab', kind: 'unpaid_tab' }), 'reject'))
      .toBe(`POST /api/tabs/${ID}/unpaid/decide`)
    expect(attentionTarget(item({ ref_type: 'cash_movement', kind: 'payout' }), 'approve'))
      .toBe(`POST /api/cash-movements/${ID}/decide`)
    expect(attentionTarget(item({ ref_type: 'stock_count', kind: 'count' }), 'approve'))
      .toBe(`POST /api/stock/counts/${ID}/confirm`)
  })

  it('fills both ids for a settlement, and the shift alone for a pair', () => {
    const shift = 'aaaaaaaa-0000-4000-8000-000000000009'

    // A real settlement row: the shift comes from the page, the id from the row.
    expect(attentionTarget(
      item({ ref_type: 'waiter_settlement', kind: 'settlement' }), 'approve', shift,
    )).toBe(`POST /api/shifts/${shift}/settlements/${ID}/accept`)

    // `shifts.pendingFor` has no settlement to point at — nobody handed anything
    // in — so it names the `shiftId:userId` pair it does have.
    expect(attentionTarget(
      item({ ref_type: 'waiter_settlement', kind: 'settlement', ref_id: `${shift}:user-7` }),
      'note',
    )).toBe(`POST /api/shifts/${shift}/force-close`)
  })

  it('returns null for a pair that has no route, rather than a half-filled path', () => {
    // A submitted count is confirmed or left alone; Korak 2 has no reject.
    expect(attentionTarget(item({ ref_type: 'stock_count', kind: 'count' }), 'reject')).toBeNull()
  })

  /**
   * The invariant behind the whole *Zahtijeva pažnju* list: every button the
   * kit can draw posts to a route that exists and that an admin may call. A row
   * the owner cannot clear is the one thing that list must never contain.
   */
  it('every route in the table is declared and admin-callable', () => {
    for (const [refType, actions] of Object.entries(ATTENTION_ROUTES)) {
      for (const [action, route] of Object.entries(actions)) {
        const roles = ROUTE_ROLES[route!]
        expect(roles, `${refType}.${action} → ${route}`).toBeDefined()
        expect(roles === 'any' || (Array.isArray(roles) && roles.includes('admin'))).toBe(true)
      }
    }
  })
})

// ===========================================================================

describe('adminFormat', () => {
  it('writes money the Bosnian way, through the shared formatter', () => {
    expect(formatKm(125050)).toBe('1.250,50 KM')
    expect(formatKm(0)).toBe('0,00 KM')
  })

  it('uses the real minus sign, not a hyphen', () => {
    // U+2212. A hyphen is narrower than a digit, so a column of tabular figures
    // stops lining up the moment one of them goes negative.
    expect(signedKm(-400)).toBe('−4,00 KM')
    expect(signedAmount(-1200)).toBe('−12,00')
    expect(signedKm(-400).includes('-')).toBe(false)
  })

  it('renders a UTC instant on the café clock, and a business date untouched', () => {
    // 22:41 UTC in September is 00:41 in Sarajevo, the next calendar day.
    expect(dateBs('2026-09-08T22:41:00Z')).toBe('09.09.2026.')
    expect(timeBs('2026-09-08T22:41:00Z')).toBe('00:41')
    expect(dateTimeBs('2026-09-08T22:41:00Z')).toBe('09.09.2026. 00:41')

    // A business date is already the café's own day: pushing it through a zone
    // a second time would move a night's takings onto the wrong date.
    expect(dateBs('2026-09-08')).toBe('08.09.2026.')
  })

  it('is empty rather than "Invalid Date" for a missing value', () => {
    expect(dateBs(null)).toBe('')
    expect(timeBs(undefined)).toBe('')
    expect(dateTimeBs('nije datum')).toBe('')
  })

  it('writes a duration with two-digit minutes past an hour', () => {
    expect(durationBs(48 * 60)).toBe('48 min')
    expect(durationBs(6 * 3600 + 8 * 60)).toBe('6 h 08')
    expect(durationBs(2 * 3600)).toBe('2 h')
    expect(durationBs(-10)).toBe('0 min')
    expect(spanBs('2026-09-08T16:03:00Z', '2026-09-08T22:42:00Z')).toBe('6 h 39')
  })
})

// ===========================================================================

describe('the period presets', () => {
  const today = '2026-09-09' // a Wednesday

  it('resolves each preset to a pair of business dates', () => {
    expect(resolvePeriod('danas', today)).toEqual({ from: today, to: today })
    expect(resolvePeriod('jucer', today)).toEqual({ from: '2026-09-08', to: '2026-09-08' })
    // The week starts on Monday here, not on Sunday.
    expect(resolvePeriod('ova-sedmica', today)).toEqual({ from: '2026-09-07', to: today })
    expect(resolvePeriod('prosla-sedmica', today))
      .toEqual({ from: '2026-08-31', to: '2026-09-06' })
    expect(resolvePeriod('ovaj-mjesec', today)).toEqual({ from: '2026-09-01', to: today })
  })

  it('puts Sunday in the week that began the Monday before it', () => {
    expect(resolvePeriod('ova-sedmica', '2026-09-13'))
      .toEqual({ from: '2026-09-07', to: '2026-09-13' })
  })

  it('offers the six presets from the spec, in order and in Bosnian', () => {
    expect(PERIOD_OPTIONS.map(o => o.label)).toEqual(
      ['Danas', 'Jučer', 'Ova sedmica', 'Prošla sedmica', 'Ovaj mjesec', 'Prilagođeno'],
    )
  })
})

// ===========================================================================

/** Every file that makes up the dashboard's surface. */
function adminFiles(): string[] {
  const roots = ['app/components/ui', 'app/pages/admin']
  const found: string[] = ['app/layouts/admin.vue']

  function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (path.endsWith('.vue') || path.endsWith('.ts')) found.push(path)
    }
  }

  for (const root of roots) walk(root)
  return found
}

describe('the light theme is one palette', () => {
  /**
   * The whole point of `[data-theme='light']`: a colour that is *nearly* right
   * is how an app stops looking like one thing, and a hex in a component is a
   * colour nobody can change from the palette file.
   *
   * The one exception is `theme-color`, the meta tag that paints the browser's
   * own chrome — it takes a literal colour and cannot read a CSS variable.
   */
  it('no file under /admin writes a hex value', () => {
    const offenders: string[] = []

    for (const path of adminFiles()) {
      const lines = readFileSync(path, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (line.includes('theme-color')) return
        if (/#[0-9a-fA-F]{3,8}\b/.test(line)) offenders.push(`${path}:${i + 1} ${line.trim()}`)
      })
    }

    expect(offenders).toEqual([])
  })

  it('the palette defines every token the kit reads, and defines it once', () => {
    const css = readFileSync('app/assets/css/admin.css', 'utf8')

    // Scoped to the attribute, never to `:root` — `:root` belongs to the
    // waiter's dark theme and the two must never meet.
    expect(css).toContain("[data-theme='light']")
    expect(css).not.toMatch(/^:root\s*\{/m)

    for (const token of [
      'bg', 'surface', 'surface-2', 'line', 'ink', 'ink-2', 'muted',
      'accent', 'accent-soft', 'accent-ink', 'nav', 'nav-ink', 'nav-muted',
      'good', 'good-soft', 'warn', 'warn-soft', 'danger', 'danger-soft',
    ]) {
      expect(css, token).toContain(`--${token}:`)
    }
  })

  /** `CLAUDE.md`: no emoji in a label, a log title or a commit message. */
  it('no emoji anywhere under /admin', () => {
    const emoji = /\p{Extended_Pictographic}/u
    const offenders = adminFiles()
      .filter(path => emoji.test(readFileSync(path, 'utf8')))

    expect(offenders).toEqual([])
  })
})

/**
 * *Nazad*, which is computed and not hand-written on each page.
 *
 * The failure this guards against is a back button that points at a URL which
 * is not a page — the exact thing that happens when you chop a segment off a
 * path and hope. `adminBack` climbs the real router instead, so the fake
 * `exists` here has to behave like one: it matches dynamic segments too, the
 * way `router.resolve` does.
 */
describe('the way back', () => {
  const PAGES = new Set([
    '/admin', '/admin/smjene', '/admin/roba', '/admin/roba/prijem', '/admin/raspored',
    '/admin/raspored/zamjene', '/admin/meni', '/admin/postavke/kategorije',
    '/admin/postavke/osoblje', '/admin/postavke/uredaji', '/admin/vise', '/admin/razgovor',
  ])
  const DYNAMIC = [
    /^\/admin\/smjena\/[^/]+$/,
    /^\/admin\/smjena\/[^/]+\/stavke$/,
    /^\/admin\/roba\/artikal\/[^/]+$/,
  ]
  const exists = (path: string) => PAGES.has(path) || DYNAMIC.some(r => r.test(path))

  it('offers nothing on a screen a tab reaches directly', () => {
    for (const root of ['/admin', '/admin/smjene', '/admin/roba', '/admin/roba/prijem',
      '/admin/meni', '/admin/postavke/osoblje', '/admin/raspored']) {
      expect(adminBack(root, exists), root).toBeNull()
    }
  })

  it('climbs to the nearest ancestor that is really a page', () => {
    expect(adminBack('/admin/smjena/abc/stavke', exists)).toBe('/admin/smjena/abc')
    expect(adminBack('/admin/roba/artikal/xyz', exists)).toBe('/admin/roba')
    expect(adminBack('/admin/raspored/zamjene', exists)).toBe('/admin/raspored')
  })

  it('sends a shift to Smjene, whose path is spelled differently', () => {
    expect(adminBack('/admin/smjena/abc', exists)).toBe('/admin/smjene')
  })

  it('falls back to Puls rather than to a 404', () => {
    expect(adminBack('/admin/postavke/uredaji', exists)).toBe('/admin')
    expect(adminBack('/admin/razgovor', exists)).toBe('/admin')
  })

  it('never returns a path the router would not resolve', () => {
    const paths = ['/admin/smjena/a', '/admin/smjena/a/stavke', '/admin/roba/artikal/b',
      '/admin/raspored/zamjene', '/admin/postavke/uredaji', '/admin/razgovor']
    for (const path of paths) {
      const target = adminBack(path, exists)
      if (target !== null) expect(exists(target), `${path} -> ${target}`).toBe(true)
    }
  })

  it('names the destination when it is a nav row', () => {
    expect(adminBackLabel('/admin')).toBe('Puls')
    expect(adminBackLabel('/admin/roba')).toBe('Roba')
    expect(adminBackLabel('/admin/smjena/abc')).toBe('Nazad')
  })

  /** *na* governs the accusative: Smjenu and Robu, but Puls and Raspored. */
  it('inflects the destination in the accessible name', () => {
    expect(adminBackAria('/admin/smjene')).toBe('Nazad na Smjenu')
    expect(adminBackAria('/admin/roba')).toBe('Nazad na Robu')
    expect(adminBackAria('/admin')).toBe('Nazad na Puls')
    expect(adminBackAria('/admin/raspored')).toBe('Nazad na Raspored')
    // No name worth reading out, so the label is the whole sentence.
    expect(adminBackAria('/admin/smjena/abc')).toBe('Nazad')
  })
})
