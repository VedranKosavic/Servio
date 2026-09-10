/**
 * *Period* — the range every report on `/admin` is read over, kept in the URL.
 *
 * It lives in the route query and not in a `ref` for two reasons the owner will
 * actually notice: a tab he leaves open and reloads comes back on the same
 * range, and a link he sends himself opens on it too.
 *
 * `?period=danas` for the presets, `?from=2026-09-01&to=2026-09-07` for
 * *Prilagođeno*. Both resolve to a pair of **business dates**.
 *
 * **A business date is not a calendar date.** The café's day starts at 06:00
 * Europe/Sarajevo, so a round locked at 02:30 belongs to the night before and
 * *Danas* at half past midnight still means yesterday's date. Every conversion
 * here goes through `shared/dates.ts`; nothing calls `getDate()` or
 * `getHours()`, which would read the laptop's own timezone.
 */
import { businessDate } from '#shared/dates'

export type PeriodKey =
  | 'danas' | 'jucer' | 'ova-sedmica' | 'prosla-sedmica' | 'ovaj-mjesec' | 'prilagodjeno'

export interface PeriodOption {
  key: PeriodKey
  label: string
}

/** The six buttons of `UiPeriod`, in the order the mockup draws them. */
export const PERIOD_OPTIONS: PeriodOption[] = [
  { key: 'danas', label: 'Danas' },
  { key: 'jucer', label: 'Jučer' },
  { key: 'ova-sedmica', label: 'Ova sedmica' },
  { key: 'prosla-sedmica', label: 'Prošla sedmica' },
  { key: 'ovaj-mjesec', label: 'Ovaj mjesec' },
  { key: 'prilagodjeno', label: 'Prilagođeno' },
]

const DAY_MS = 86_400_000

/** `"2026-09-08"` → the UTC midnight of that calendar day, for date arithmetic. */
function toUtcMs(day: string): number {
  const [year, month, date] = day.split('-').map(Number)
  return Date.UTC(year!, month! - 1, date!)
}

function fromUtcMs(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** Monday of the week `day` falls in. The week starts Monday here, not Sunday. */
function mondayOf(day: string): string {
  const ms = toUtcMs(day)
  // getUTCDay: 0 = Sunday. Sunday belongs to the week that began six days ago.
  const weekday = new Date(ms).getUTCDay()
  const back = weekday === 0 ? 6 : weekday - 1
  return fromUtcMs(ms - back * DAY_MS)
}

function plusDays(day: string, n: number): string {
  return fromUtcMs(toUtcMs(day) + n * DAY_MS)
}

/** The `{ from, to }` a preset means, given today's business date. */
export function resolvePeriod(key: PeriodKey, today: string): { from: string, to: string } {
  switch (key) {
    case 'jucer': {
      const day = plusDays(today, -1)
      return { from: day, to: day }
    }
    case 'ova-sedmica': {
      const monday = mondayOf(today)
      return { from: monday, to: today }
    }
    case 'prosla-sedmica': {
      const monday = plusDays(mondayOf(today), -7)
      return { from: monday, to: plusDays(monday, 6) }
    }
    case 'ovaj-mjesec':
      return { from: `${today.slice(0, 7)}-01`, to: today }
    case 'danas':
    case 'prilagodjeno':
    default:
      return { from: today, to: today }
  }
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * The period this page is showing, and the one function that changes it.
 *
 * `from` and `to` are computed off the route, so a page writes
 * `watch(() => period.range.value, load)` and never has to know whether the
 * owner clicked a preset or typed two dates.
 */
export function useAdminPeriod(fallback: PeriodKey = 'danas') {
  const route = useRoute()
  const router = useRouter()

  /** Today, on the café's clock — 02:30 is still last night. */
  const today = computed(() => businessDate(new Date().toISOString()))

  const key = computed<PeriodKey>(() => {
    const q = route.query
    if (ISO_DAY.test(String(q.from ?? '')) && ISO_DAY.test(String(q.to ?? ''))) {
      return 'prilagodjeno'
    }
    const raw = String(q.period ?? '')
    return PERIOD_OPTIONS.some(o => o.key === raw) ? raw as PeriodKey : fallback
  })

  const range = computed<{ from: string, to: string }>(() => {
    if (key.value === 'prilagodjeno') {
      const from = String(route.query.from ?? '')
      const to = String(route.query.to ?? '')
      if (ISO_DAY.test(from) && ISO_DAY.test(to)) {
        // A range typed backwards is still a range; sorting it beats an error.
        return from <= to ? { from, to } : { from: to, to: from }
      }
    }
    return resolvePeriod(key.value, today.value)
  })

  /** Written with `replace`, so the back button leaves the page instead of the filter. */
  function setPeriod(next: PeriodKey) {
    const query = { ...route.query }
    delete query.from
    delete query.to
    delete query.period
    if (next === 'prilagodjeno') {
      const current = range.value
      query.from = current.from
      query.to = current.to
    } else if (next !== fallback) {
      query.period = next
    }
    void router.replace({ query })
  }

  /** The two date inputs that appear only on *Prilagođeno*. */
  function setCustom(from: string, to: string) {
    const query = { ...route.query }
    delete query.period
    query.from = from
    query.to = to
    void router.replace({ query })
  }

  /** "01.09.2026. – 08.09.2026.", or one date when the range is one day. */
  const label = computed(() => {
    const { from, to } = range.value
    return from === to ? dateBs(from) : `${dateBs(from)} – ${dateBs(to)}`
  })

  return { key, range, label, today, setPeriod, setCustom }
}
