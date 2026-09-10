/**
 * *Pravila* is a document the owner types and every phone renders. This is the
 * whole of the formatting it understands — headings, lists and bold — and the
 * whole of the machinery that renders it.
 *
 * **Why not a markdown library.** This text is written on one screen and shown
 * on every other one, so it is the only place in the app where one person's
 * typing reaches everybody else's device. A library would bring HTML with it
 * (`<img onerror=…>`, `<script>`, a link to somewhere else), and the standard
 * answer — sanitise the output — is a second dependency guarding the first.
 * Forty lines that understand four things and can only ever produce *text*
 * are smaller, faster and impossible to inject into.
 *
 * **It never produces HTML.** `markdownish()` gives back plain objects, which
 * `PravilaDoc.vue` draws with `v-for` and `{{ }}`. Vue escapes interpolated
 * text by construction, so there is no `v-html` anywhere in this feature and
 * nothing to sanitise.
 *
 * The second half of the file is the threshold tokens: `{{cash_tolerance_fen}}`
 * typed in the editor becomes "5,00 KM" on the phone, read from the venue's
 * live settings at render time. That is what keeps a published document from
 * lying the day the owner changes a number in *Podešavanja* (PHASE4 §3, WP4).
 */
import { formatKm } from '#shared/money'
import type { Settings } from '#shared/settings'

/** A stretch of text inside a block, bold or not. There is no other mark. */
export interface InlineRun {
  text: string
  bold: boolean
}

export type Block =
  | { kind: 'h2' | 'h3' | 'p', runs: InlineRun[] }
  | { kind: 'ul', items: InlineRun[][] }

/** `**bold**` and nothing else; everything between the stars stays literal. */
function inline(text: string): InlineRun[] {
  const runs: InlineRun[] = []
  const pattern = /\*\*([^*]+)\*\*/g
  let last = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) runs.push({ text: text.slice(last, match.index), bold: false })
    runs.push({ text: match[1]!, bold: true })
    last = match.index + match[0].length
  }
  if (last < text.length) runs.push({ text: text.slice(last), bold: false })
  return runs
}

/**
 * The document, as blocks.
 *
 * `#` and `##` are both an `h2` — one level of heading is what a page of house
 * rules needs, and a document whose first line is `#` should not render at a
 * different size from one that starts with `##`. `###` is the sub-heading.
 * A line starting `-` or `*` is a list item; a blank line ends a paragraph;
 * everything else is prose, and consecutive prose lines join into one
 * paragraph the way markdown does.
 */
export function markdownish(source: string): Block[] {
  const blocks: Block[] = []
  const lines = source.replace(/\r\n?/g, '\n').split('\n')

  let paragraph: string[] = []
  let list: InlineRun[][] | null = null

  function flushParagraph() {
    if (paragraph.length === 0) return
    blocks.push({ kind: 'p', runs: inline(paragraph.join(' ')) })
    paragraph = []
  }

  function flushList() {
    if (!list) return
    blocks.push({ kind: 'ul', items: list })
    list = null
  }

  function flush() {
    flushParagraph()
    flushList()
  }

  for (const raw of lines) {
    const line = raw.trim()

    if (line.length === 0) {
      flush()
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      const level = heading[1]!.length
      blocks.push({ kind: level >= 3 ? 'h3' : 'h2', runs: inline(heading[2]!.trim()) })
      continue
    }

    const item = /^[-*]\s+(.*)$/.exec(line)
    if (item) {
      flushParagraph()
      list ??= []
      list.push(inline(item[1]!.trim()))
      continue
    }

    flushList()
    paragraph.push(line)
  }

  flush()
  return blocks
}

// --- the thresholds, written once and rendered everywhere -------------------

/**
 * The settings a rules document may quote, and the Bosnian word for each.
 *
 * Not every key of `Settings` — only the ones that are a *rule a person is
 * measured against* (PLAN §8). `payment_methods` and `timezone` are
 * configuration; they belong in *Podešavanja* and nowhere near this page.
 */
export const RULE_TOKENS: { key: keyof Settings, label: string }[] = [
  { key: 'void_self_window_s', label: 'Vlastiti storno — rok' },
  { key: 'self_void_max_per_shift', label: 'Vlastiti storno — po smjeni' },
  { key: 'self_void_max_fen', label: 'Vlastiti storno — do iznosa' },
  { key: 'bartender_approve_window_s', label: 'Storno preko šankera — rok' },
  { key: 'staff_drinks_per_shift', label: 'Na račun kuće — po smjeni' },
  { key: 'staff_drink_max_fen', label: 'Na račun kuće — po piću' },
  { key: 'cash_tolerance_fen', label: 'Tolerancija pazara' },
  { key: 'cash_tolerance_pct', label: 'Tolerancija pazara — postotak' },
  { key: 'waste_pin_threshold_fen', label: 'Otpis traži PIN iznad' },
  { key: 'waste_events_per_shift_per_user', label: 'Otpisa po osobi po smjeni' },
  { key: 'shared_device_idle_s', label: 'Zajednički uređaj — zaključavanje' },
  { key: 'chat_delete_own_s', label: 'Brisanje vlastite poruke — rok' },
  { key: 'chat_retention_days', label: 'Slike u razgovoru — koliko žive' },
  { key: 'upload_user_day_files', label: 'Slika po osobi dnevno' },
  { key: 'roster_late_grace_min', label: 'Kašnjenje — tolerancija' },
]

/** "5 minuta", "15 sekundi" — a threshold said the way a person says it. */
function seconds(value: number): string {
  if (value < 60) return `${value} sekundi`
  const minutes = Math.round(value / 60)
  return minutes === 1 ? '1 minut' : `${minutes} minuta`
}

/**
 * One setting as the sentence it belongs in.
 *
 * The suffix carries the unit — `_fen` is money, `_s` is seconds, `_pct` a
 * percentage, `_days` and `_min` say themselves — which is why the settings
 * are named that way in the first place.
 */
export function formatSetting(key: keyof Settings, settings: Settings): string {
  const value = settings[key] as unknown

  if (typeof value === 'boolean') return value ? 'da' : 'ne'
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value !== 'number') return String(value)

  if (key.endsWith('_fen')) return formatKm(value)
  if (key.endsWith('_pct')) return `${String(value).replace('.', ',')} %`
  if (key.endsWith('_bytes')) return `${Math.round(value / (1024 * 1024))} MB`
  if (key.endsWith('_s')) return seconds(value)
  if (key.endsWith('_days')) return `${value} dana`
  if (key.endsWith('_min')) return `${value} minuta`
  return String(value)
}

/**
 * `{{cash_tolerance_fen}}` → `5,00 KM`, on every render.
 *
 * A token nobody recognises is **left standing**: a typo has to be visible on
 * the preview, not silently swallowed into an empty sentence.
 */
export function fillTokens(source: string, settings: Settings | null): string {
  if (!settings) return source
  return source.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (whole, name: string) => {
    const key = name as keyof Settings
    return key in settings ? formatSetting(key, settings) : whole
  })
}

/** The two steps in the order every screen does them. */
export function renderRules(source: string, settings: Settings | null): Block[] {
  return markdownish(fillTokens(source, settings))
}
