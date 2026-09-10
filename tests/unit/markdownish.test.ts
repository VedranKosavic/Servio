/**
 * The rules renderer (`app/utils/markdownish.ts`).
 *
 * It is worth its own test file for one reason: it is the only place in the app
 * where text one person types is rendered on everybody else's phone. The first
 * block of tests is the formatting; the second is the promise that no markup
 * ever survives the parser, which is what makes `v-html` unnecessary and the
 * feature un-injectable.
 */
import { describe, expect, it } from 'vitest'
import {
  fillTokens, formatSetting, markdownish, renderRules, RULE_TOKENS,
} from '~/utils/markdownish'
import { DEFAULT_SETTINGS } from '#shared/settings'

/** Every run's text, joined — what a reader actually sees for one block. */
function textOf(block: ReturnType<typeof markdownish>[number]): string {
  if (block.kind === 'ul') return block.items.map(item => item.map(r => r.text).join('')).join(' | ')
  return block.runs.map(r => r.text).join('')
}

describe('markdownish', () => {
  it('reads headings, prose, lists and bold — and nothing else', () => {
    const blocks = markdownish([
      '# Pravila lokala',
      '',
      'Ovo su pravila po kojima',
      'radimo u ovom lokalu.',
      '',
      '### Smjena',
      '- Dolazak je **na vrijeme**.',
      '- Pazar se predaje.',
      '',
      'Kraj.',
    ].join('\n'))

    expect(blocks.map(b => b.kind)).toEqual(['h2', 'p', 'h3', 'ul', 'p'])
    // Consecutive prose lines join into one paragraph, the way markdown does.
    expect(textOf(blocks[1]!)).toBe('Ovo su pravila po kojima radimo u ovom lokalu.')
    expect(textOf(blocks[3]!)).toBe('Dolazak je na vrijeme. | Pazar se predaje.')
  })

  it('makes `#` and `##` the same size, and `###` smaller', () => {
    expect(markdownish('# A')[0]!.kind).toBe('h2')
    expect(markdownish('## A')[0]!.kind).toBe('h2')
    expect(markdownish('### A')[0]!.kind).toBe('h3')
    expect(markdownish('#### A')[0]!.kind).toBe('h3')
  })

  it('splits bold into runs, and leaves a lone star alone', () => {
    const [block] = markdownish('prvo **drugo** treće * i kraj')
    expect(block!.kind).toBe('p')
    const runs = (block as { runs: { text: string, bold: boolean }[] }).runs
    expect(runs).toEqual([
      { text: 'prvo ', bold: false },
      { text: 'drugo', bold: true },
      { text: ' treće * i kraj', bold: false },
    ])
  })

  it('never produces markup — a tag stays text', () => {
    const nasty = '<script>alert(1)</script> <img src=x onerror=alert(1)> [link](http://x)'
    const [block] = markdownish(nasty)
    // One paragraph of one plain run: the parser has no
    // way to emit anything but `text` and `bold`, so there is no field a tag
    // could arrive in and no `v-html` to hand it to.
    expect(markdownish(nasty)).toEqual([
      { kind: 'p', runs: [{ text: nasty, bold: false }] },
    ])
    expect(textOf(block!)).toBe(nasty)
  })

  it('handles the empty document and stray blank lines', () => {
    expect(markdownish('')).toEqual([])
    expect(markdownish('\n\n\n')).toEqual([])
    expect(markdownish('  \n jedan \n\n').map(textOf)).toEqual(['jedan'])
  })
})

describe('the thresholds', () => {
  it('formats each kind of setting the way a person says it', () => {
    expect(formatSetting('cash_tolerance_fen', DEFAULT_SETTINGS)).toBe('5,00\u00a0KM')
    expect(formatSetting('void_self_window_s', DEFAULT_SETTINGS)).toBe('5 minuta')
    expect(formatSetting('cash_tolerance_pct', DEFAULT_SETTINGS)).toBe('1 %')
    expect(formatSetting('chat_retention_days', DEFAULT_SETTINGS)).toBe('90 dana')
    expect(formatSetting('roster_late_grace_min', DEFAULT_SETTINGS)).toBe('30 minuta')
    expect(formatSetting('chat_image_month_bytes', DEFAULT_SETTINGS)).toBe('200 MB')
    expect(formatSetting('bartender_can_receive_goods', DEFAULT_SETTINGS)).toBe('ne')
    expect(formatSetting('self_void_max_per_shift', DEFAULT_SETTINGS)).toBe('5')
  })

  it('fills a token from the venue settings, and leaves a typo standing', () => {
    expect(fillTokens('do {{cash_tolerance_fen}} je uredu', DEFAULT_SETTINGS))
      .toBe('do 5,00\u00a0KM je uredu')
    expect(fillTokens('{{ cash_tolerance_fen }}', DEFAULT_SETTINGS)).toBe('5,00\u00a0KM')
    // A typo has to be visible on the preview, not swallowed into an empty
    // sentence — that is how the owner finds it before he publishes.
    expect(fillTokens('{{nema_takvog}}', DEFAULT_SETTINGS)).toBe('{{nema_takvog}}')
  })

  it('follows the settings, so a published document cannot go stale', () => {
    const strict = { ...DEFAULT_SETTINGS, cash_tolerance_fen: 200 }
    expect(fillTokens('{{cash_tolerance_fen}}', strict)).toBe('2,00\u00a0KM')
    // No settings yet (a phone before its first `/api/me`): the token stays
    // rather than rendering a wrong number.
    expect(fillTokens('{{cash_tolerance_fen}}', null)).toBe('{{cash_tolerance_fen}}')
  })

  it('offers only tokens that exist, so the editor cannot suggest a typo', () => {
    for (const token of RULE_TOKENS) {
      expect(Object.keys(DEFAULT_SETTINGS)).toContain(token.key)
      expect(token.label.length).toBeGreaterThan(0)
    }
  })

  it('renders in one step: tokens first, then blocks', () => {
    const blocks = renderRules('## Pazar\n- do {{cash_tolerance_fen}}', DEFAULT_SETTINGS)
    expect(blocks.map(b => b.kind)).toEqual(['h2', 'ul'])
    expect(textOf(blocks[1]!)).toBe('do 5,00\u00a0KM')
  })
})
