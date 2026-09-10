/**
 * *Smjena* — the arithmetic and the vocabulary behind the owner's night.
 *
 * No DOM here, on purpose: a test that mounts `SmjenaCashBox` and asserts a
 * button says "Odobri" is a test of Vue. What is worth asserting is what a
 * rendering cannot catch — that the tolerance word matches the tolerance the
 * server would compute, that a flagged waiter reads *označeno za razgovor* and
 * never an accusation, that the cash box's rows come out in the order the drawer
 * actually filled and emptied, and that a settlement shows both the difference
 * at the moment of the handover and the one that stands now.
 *
 * The two file-level rules `admin-ui.test.ts` keeps over `app/components/ui`
 * and `app/pages/admin` are repeated here over `app/components/smjena`, which
 * that suite does not walk: no hex value and no emoji anywhere on this page
 * either.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  cardRows,
  cashRows,
  cashVerdict,
  categoryMix,
  countPill,
  decimalBs,
  katChips,
  KAT_PRESETS,
  LINE_STATUS_WORDS,
  perBowl,
  pendingMovements,
  pluralBs,
  stockVarianceNote,
  settlementDrift,
  shiftStatusPill,
  toleranceFen,
  waiterVerdict,
} from '../../app/components/smjena/smjenaLogic'
import { DEFAULT_SETTINGS } from '../../shared/settings'
import type {
  CashMovement, Settings, Settlement, Shift, ShiftCountBrief, ShiftSummary, UserSummary,
} from '../../shared/types'

const settings: Settings = { ...DEFAULT_SETTINGS, cash_tolerance_fen: 500, cash_tolerance_pct: 1 }

function shift(patch: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    business_date: '2026-09-11',
    status: 'closed',
    opened_at: '2026-09-11T16:03:00Z',
    opened_by: 'u-emir',
    opened_by_name: 'Emir',
    auto_opened: true,
    stock_custodian_id: null,
    closing_started_at: null,
    closing_started_by: null,
    closed_at: '2026-09-11T22:42:00Z',
    closed_by: 'u-emir',
    closed_kind: 'normal',
    opening_float_override_fen: null,
    cash_counted_fen: 161250,
    card_total_fen: null,
    closing_note: null,
    reviewed_by: null,
    reviewed_at: null,
    ...patch,
  }
}

function summary(patch: Partial<ShiftSummary> = {}): ShiftSummary {
  return {
    shift_id: 'shift-1',
    version: 1,
    reason: 'close',
    promet_fen: 181250,
    cash_fen: 161250,
    card_fen: 20000,
    comp_fen: 1400,
    void_count: 3,
    void_fen: 950,
    self_void_count: 1,
    self_void_fen: 300,
    unpaid_fen: 0,
    expected_cash_fen: 161650,
    outstanding_fen: 0,
    counted_cash_fen: 161250,
    diff_fen: -400,
    stock_variance_fen: -620,
    waste_fen: 0,
    bowls: 92,
    tobacco_g: 1785,
    coals: 285,
    by_category: [],
    by_user: [],
    computed_at: '2026-09-11T22:42:00Z',
    ...patch,
  }
}

function user(patch: Partial<UserSummary> = {}): UserSummary {
  return {
    user_id: 'u-amar',
    name: 'Amar',
    joined_at: '2026-09-11T16:03:00Z',
    settled_at: '2026-09-11T22:11:00Z',
    hours: 6.13,
    promet_fen: 61250,
    unpaid_fen: 0,
    cash_fen: 60250,
    card_fen: 0,
    float_out_fen: 0,
    tabs: 41,
    rounds: 88,
    bowls: 21,
    by_category: [],
    storno: { count: 1, fen: 300, pending_count: 0, pending_fen: 0 },
    self_voids: { count: 0, fen: 0 },
    gratis: { count: 1, fen: 400 },
    waste: { count: 0, fen: 0 },
    post_settle_locks: { count: 0, fen: 0 },
    ...patch,
  }
}

function movement(patch: Partial<CashMovement>): CashMovement {
  return {
    id: 'cm-1',
    type: 'payout',
    amount_fen: 6000,
    user_id: 'u-emir',
    user_name: 'Emir',
    created_by: 'u-emir',
    created_by_name: 'Emir',
    reason: 'dobavljac',
    note: null,
    status: 'pending',
    decided_by: null,
    decided_at: null,
    created_at: '2026-09-11T20:10:00Z',
    ...patch,
  }
}

function settlement(patch: Partial<Settlement> = {}): Settlement {
  return {
    id: 'st-1',
    shift_id: 'shift-1',
    user_id: 'u-amar',
    user_name: 'Amar',
    declared_fen: 59800,
    expected_at_declare_fen: 60250,
    diff_fen: -450,
    accepted_by: null,
    accepted_by_name: null,
    accepted_at: null,
    self_sealed: true,
    late: false,
    created_at: '2026-09-11T22:11:00Z',
    ...patch,
  }
}

// ===========================================================================

describe('tolerance', () => {
  /** The same `max(fixed, percentage)` as `toleranceFen()` in `services/cash.ts`. */
  it('is the larger of the fixed allowance and the percentage of the base', () => {
    expect(toleranceFen(10000, settings)).toBe(500) // 1 % of 100 KM is 1 KM; the floor wins
    expect(toleranceFen(161650, settings)).toBe(1617) // 1 % of 1.616,50 KM wins
    expect(toleranceFen(-161650, settings)).toBe(1617) // a negative base is still a size
  })

  it('says the word, not just the colour', () => {
    const verdict = cashVerdict(-400, 161650, settings)
    expect(verdict).toEqual({ word: 'u toleranciji', tone: 'good' })

    expect(cashVerdict(-5000, 161650, settings))
      .toEqual({ word: 'van tolerancije', tone: 'bad' })
  })

  it('has nothing to say about a shift that has not been counted', () => {
    expect(cashVerdict(null, 161650, settings)).toBeNull()
  })

  it('follows a raised tolerance', () => {
    const loose: Settings = { ...settings, cash_tolerance_fen: 10000, cash_tolerance_pct: 0 }
    expect(cashVerdict(-5000, 161650, loose)?.word).toBe('u toleranciji')
  })
})

describe('a waiter’s ocjena', () => {
  it('never accuses: outside tolerance reads "označeno za razgovor"', () => {
    expect(waiterVerdict(user({ within_tolerance: false }), settings))
      .toEqual({ word: 'označeno za razgovor', tone: 'warn' })
  })

  it('trusts the verdict the server recorded at the moment of the declaration', () => {
    // A void approved the next morning moves today's expectation. The person
    // declared honestly against last night's, and must not be re-judged by it.
    const row = user({ within_tolerance: true, expected_fen: 90000, declared_fen: 59800 })
    expect(waiterVerdict(row, settings).word).toBe('u toleranciji')
  })

  it('says so plainly when nobody has handed anything in', () => {
    expect(waiterVerdict(user({ settled_at: null }), settings))
      .toEqual({ word: 'nije predao', tone: 'neutral' })
  })

  it('falls back to the shared formula when the server sent no verdict', () => {
    expect(waiterVerdict(user({ expected_fen: 60250, declared_fen: 59800 }), settings).word)
      .toBe('u toleranciji')
    expect(waiterVerdict(user({ expected_fen: 60250, declared_fen: 50000 }), settings).word)
      .toBe('označeno za razgovor')
  })
})

// ===========================================================================

describe('the shift’s own words', () => {
  it('maps every status to a Bosnian word', () => {
    expect(shiftStatusPill('open').word).toBe('otvorena')
    expect(shiftStatusPill('closing').word).toBe('predaja u toku')
    expect(shiftStatusPill('closed').word).toBe('zatvorena')
    expect(shiftStatusPill('reviewed')).toEqual({ word: 'pregledano', tone: 'good' })
  })

  it('has a word for every line status the drill-down can render', () => {
    expect(Object.values(LINE_STATUS_WORDS).map(v => v.word)).toEqual([
      'otvoreno', 'naplaćeno', 'nije plaćeno', 'storno', 'storno na čekanju', 'gratis',
    ])
  })

  it('offers exactly the four pseudo-categories the lines route understands', () => {
    // `matchesKat` in `services/summaries.ts`: anything else is a category id.
    expect(KAT_PRESETS.map(p => p.value)).toEqual(['sve', 'storno', 'gratis', 'nijeplaceno'])
  })
})

// ===========================================================================

describe('the cash box', () => {
  const movements = [
    movement({ id: 'cm-float', type: 'float_out', amount_fen: 5000, user_name: 'Amar', status: 'approved' }),
    movement({ id: 'cm-payout', type: 'payout', amount_fen: 6000, status: 'pending' }),
    movement({ id: 'cm-pickup', type: 'owner_pickup', amount_fen: 20000, status: 'approved' }),
  ]

  it('reads top to bottom the way the drawer filled and emptied', () => {
    const rows = cashRows(shift(), summary(), movements)
    expect(rows.map(r => r.key)).toEqual([
      'opening',
      'float_out:cm-float',
      'payout:cm-payout',
      'pickup',
      'expected',
      'counted',
      'diff',
    ])
  })

  it('signs the money that left the drawer as negative', () => {
    const rows = cashRows(shift(), summary(), movements)
    expect(rows.find(r => r.key === 'float_out:cm-float')?.fen).toBe(-5000)
    expect(rows.find(r => r.key === 'pickup')?.fen).toBe(-20000)
  })

  it('carries a decision only on the rows that are still pending', () => {
    const rows = cashRows(shift(), summary(), movements)
    expect(rows.find(r => r.key === 'payout:cm-payout')?.movementId).toBe('cm-payout')
    expect(rows.find(r => r.key === 'float_out:cm-float')?.movementId).toBeUndefined()
    expect(pendingMovements(movements).map(m => m.id)).toEqual(['cm-payout'])
  })

  it('costs a rejected payout nothing', () => {
    const rows = cashRows(shift(), summary(), [
      movement({ id: 'cm-no', status: 'rejected', amount_fen: 6000 }),
    ])
    expect(rows.find(r => r.key === 'payout:cm-no')?.fen).toBe(0)
  })

  it('says where the opening float came from rather than inventing a number', () => {
    expect(cashRows(shift(), summary(), []).find(r => r.key === 'opening'))
      .toMatchObject({ fen: null, sub: 'izveden iz sinoćnjeg brojanja' })

    expect(cashRows(shift({ opening_float_override_fen: 20000 }), summary(), [])
      .find(r => r.key === 'opening'))
      .toMatchObject({ fen: 20000, sub: 'unesen ručno' })
  })

  it('shows what the waiters are still holding only while somebody is', () => {
    expect(cashRows(shift(), summary(), []).some(r => r.key === 'outstanding')).toBe(false)
    expect(cashRows(shift(), summary({ outstanding_fen: 4800 }), [])
      .find(r => r.key === 'outstanding')?.fen).toBe(4800)
  })

  it('compares the terminal against the card payments, and only when it has one', () => {
    expect(cardRows(shift(), summary()).map(r => r.fen)).toEqual([20000, null])

    const rows = cardRows(shift({ card_total_fen: 20500 }), summary())
    expect(rows.find(r => r.key === 'card_diff')?.fen).toBe(500)
  })
})

// ===========================================================================

describe('settlements', () => {
  /**
   * "u trenutku predaje −4,50 · sada −0,50". The two numbers differ exactly when
   * something was decided after the envelope was sealed, and printing only one
   * of them is how a person gets asked about a shortfall already explained.
   */
  it('reports the difference at the handover and the one that stands now', () => {
    expect(settlementDrift(settlement(), user({ expected_fen: 59850 })))
      .toEqual({ then: -450, now: -50 })
  })

  it('has no "now" for a person the summary cannot price yet', () => {
    expect(settlementDrift(settlement(), undefined)).toEqual({ then: -450, now: null })
  })
})

// ===========================================================================

describe('counts, bowls and categories', () => {
  it('calls a submitted count predan and a confirmed one potvrđeno', () => {
    const base = {
      id: 'c1', kind: 'full' as const, phase: 'close' as const,
      counted_by: 'u-emir', counted_by_name: 'Emir',
      submitted_at: '2026-09-11T21:55:00Z', confirmed_at: null, variance_fen: -620,
    }
    expect(countPill({ ...base, status: 'submitted' })).toEqual({ word: 'predan', tone: 'warn' })
    expect(countPill({ ...base, status: 'confirmed' }).word).toBe('potvrđeno')
  })

  it('divides tobacco and coal by bowls, and refuses to divide by none', () => {
    expect(perBowl(summary())).toEqual({ grams: 19.4, coals: 3.1 })
    expect(perBowl(summary({ bowls: 0 }))).toBeNull()
  })

  it('writes a quantity with a Bosnian decimal comma', () => {
    expect(decimalBs(19.4)).toBe('19,4')
    expect(decimalBs(3)).toBe('3,0')
  })

  it('sorts the category mix largest first and drops the empty ones', () => {
    const mix = categoryMix([
      { category_id: 'k1', name: 'Piće', qty: 120, fen: 60000 },
      { category_id: 'k2', name: 'Nargila', qty: 92, fen: 120000 },
      { category_id: 'k3', name: 'Hrana', qty: 0, fen: 0 },
    ])
    expect(mix.map(s => s.name)).toEqual(['Nargila', 'Piće'])
    expect(Math.round(mix[0]!.pct)).toBe(67)
  })

  it('builds one chip per category a person actually sold', () => {
    const chips = katChips([
      { category_id: 'k2', name: 'Nargila', qty: 34, fen: 40000 },
      { category_id: 'k3', name: 'Hrana', qty: 0, fen: 0 },
    ])
    // The chip's `kat` is the category id: that is what the lines route filters on.
    expect(chips).toEqual([{ kat: 'k2', label: 'Nargila', qty: 34, fen: 40000 }])
  })
})

// ===========================================================================

/** Every file WP2 adds under `app/components/smjena`. */
function smjenaFiles(): string[] {
  const dir = 'app/components/smjena'
  return readdirSync(dir)
    .filter(name => name.endsWith('.vue') || name.endsWith('.ts'))
    .map(name => join(dir, name))
}

describe('the Smjena components obey the house rules', () => {
  it('no file writes a hex value — the palette is one file', () => {
    const offenders = smjenaFiles().filter(path =>
      /#[0-9a-fA-F]{3,8}\b/.test(readFileSync(path, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('no emoji anywhere', () => {
    const emoji = /\p{Extended_Pictographic}/u
    const offenders = smjenaFiles().filter(path => emoji.test(readFileSync(path, 'utf8')))
    expect(offenders).toEqual([])
  })
})

// ===========================================================================

describe('Bosnian counts nouns in three shapes', () => {
  it('picks the shape the number actually takes', () => {
    const t = (n: number) => `${n} ${pluralBs(n, 'tura', 'ture', 'tura')}`
    expect(t(1)).toBe('1 tura')
    expect(t(2)).toBe('2 ture')
    expect(t(4)).toBe('4 ture')
    // The mistake this function exists to prevent: "5 ture".
    expect(t(5)).toBe('5 tura')
    // The teens go back to the last shape, even though they end in 1–4.
    expect(t(11)).toBe('11 tura')
    expect(t(12)).toBe('12 tura')
    expect(t(21)).toBe('21 tura')
    expect(t(22)).toBe('22 ture')
    expect(t(0)).toBe('0 tura')
  })
})

describe('the Manjak robe note', () => {
  const count = (patch: Partial<ShiftCountBrief>): ShiftCountBrief => ({
    id: 'c1', kind: 'full', phase: 'close', status: 'confirmed',
    counted_by: 'u-emir', counted_by_name: 'Emir',
    submitted_at: '2026-09-11T21:55:00Z', confirmed_at: '2026-09-12T08:10:00Z',
    variance_fen: 0, ...patch,
  })

  /**
   * A 0,00 with no explanation is the screen inventing a fact: a night with no
   * confirmed count has no shortage figure at all, and the tile has to say so.
   */
  it('distinguishes no count, an unapplied one, and a clean one', () => {
    expect(stockVarianceNote([])).toBe('KM · nema popisa')
    expect(stockVarianceNote([count({ status: 'submitted', confirmed_at: null })]))
      .toBe('KM · popis još nije primijenjen')
    expect(stockVarianceNote([count({})])).toBe('KM · popis bez odstupanja')
    expect(stockVarianceNote([count({ variance_fen: -620 })]))
      .toBe('KM · 1 popis s odstupanjem')
    expect(stockVarianceNote([count({ variance_fen: -620 }), count({ id: 'c2', variance_fen: 5 })]))
      .toBe('KM · 2 popisa s odstupanjem')
  })
})
