/**
 * The Dnevnik's vocabulary: every kind of thing worth recording, its body
 * shape, and the Bosnian sentence it renders as.
 *
 * There is **one** activity record in Šank (CLAUDE.md): `log_entries`, written
 * by `log()` inside the same transaction as the event, feeding the owner's
 * *Dnevnik* page and the in-app attention list. There is no separate audit
 * table, and
 * locks and payments are deliberately not entries — they are the ledger.
 *
 * `LOG_KINDS` is **frozen for Korak 2** and `kind` is typed, so calling `log()`
 * with a kind nobody defined is a typecheck error rather than a shift close that
 * fails at 03:10 in the morning. That is also why this whole file belongs to
 * WP0: every later package writes entries, none of them edits this list.
 *
 * Three fields carry rules rather than text:
 *
 *   `quiet`     — a routine record. The Dnevnik's *važno* filter hides these
 *                 unless a later entry resolves one.
 *   `alert`     — the ✔ column: which of the thirteen `ALERT_RULE_KEYS` this
 *                 kind queues onto the attention list, and (optionally) under
 *                 what condition. A kind marked here with a key that is not in
 *                 that list would throw when it fired, so `alerts.test.ts`
 *                 checks both directions.
 *   `group`     — the Dnevnik's filter chips.
 *
 * Bodies are `.loose()`: the documented fields are validated, and extra context
 * a caller adds is stored rather than stripped. Bodies carry ids and integers
 * and never a hash, a token, an email or a chat id — `log.test.ts` greps every
 * rendered body for exactly that.
 */
import { z } from 'zod'
import type { AlertRuleKey } from './constants'
import type { Settings } from './settings'

/**
 * Names are looked up **lazily**, at render time, from the ids in the body — so
 * an entry stores `{ user_id }` and the screen shows "Amar", and renaming a
 * product tomorrow does not rewrite what happened tonight.
 */
export interface LogNames {
  user: (id: string | null | undefined) => string
  product: (id: string | null | undefined) => string
  table: (id: string | null | undefined) => string
  category: (id: string | null | undefined) => string
  stockItem: (id: string | null | undefined) => string
  device: (id: string | null | undefined) => string
  formatKm: (fen: number) => string
  localTime: (iso: string) => string
}

export type LogGroup = 'smjena' | 'novac' | 'storno' | 'roba' | 'postavke' | 'uredaji'

export interface LogTemplate<B = unknown> {
  body: z.ZodType<B>
  title: (body: B, n: LogNames) => string
  /** Routine: hidden behind the Dnevnik's *važno* filter. */
  quiet?: true
  /**
   * The attention list. `when` decides per event — a settlement is raised only
   * when it lands outside tolerance, a comp only when it is a large one — and
   * receives the venue's settings because that is where the thresholds live.
   */
  alert?: { rule: AlertRuleKey, when?: (body: B, settings: Settings) => boolean }
  group: LogGroup
}

// --- small shared pieces ---------------------------------------------------

const id = z.string()
const fen = z.int()
const iso = z.string()

/** `zod.loose()` on an object with these fields plus whatever the caller adds. */
function body<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).loose()
}

/** "· nakon naplate" and friends: a suffix that disappears when it is not true. */
function suffix(when: boolean | undefined, text: string): string {
  return when ? ` · ${text}` : ''
}

/**
 * `defineLog` exists for one reason: it infers `B` from the Zod schema so each
 * `title(b, n)` below is fully typed without anybody writing the type twice.
 */
function defineLog<S extends z.ZodType>(t: {
  body: S
  title: (b: z.infer<S>, n: LogNames) => string
  quiet?: true
  alert?: { rule: AlertRuleKey, when?: (b: z.infer<S>, s: Settings) => boolean }
  group: LogGroup
}): LogTemplate<z.infer<S>> {
  return t as LogTemplate<z.infer<S>>
}

/**
 * The payout reasons, in Bosnian.
 *
 * They are stored as slugs because they are *values*, not text — but a slug
 * printed inside a Bosnian sentence is an English word on a Bosnian screen,
 * which CLAUDE.md calls a bug. Anything a later reason adds falls through
 * unchanged rather than disappearing.
 */
/**
 * A count's phase, in Bosnian. Same reason as the payout reasons below: the
 * slug is a *value*, and a slug printed inside a Bosnian sentence is an English
 * word on a Bosnian screen. Anything a later phase adds falls through unchanged.
 */
const COUNT_PHASE_BS: Record<string, string> = {
  open: 'otvaranje',
  close: 'zatvaranje',
  adhoc: 'usput',
}

const PAYOUT_REASON_BS: Record<string, string> = {
  dobavljac: 'dobavljač',
  sitno: 'sitno',
  ostalo: 'ostalo',
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

export const LOG = {
  // -- Smjena ---------------------------------------------------------------
  shift_opened: defineLog({
    group: 'smjena',
    body: body({ shift_id: id, user_id: id.optional(), at: iso, auto: z.boolean().optional() }),
    title: (b, n) =>
      `Smjena otvorena · ${n.user(b.user_id)} · ${n.localTime(b.at)}`
      + suffix(b.auto, 'automatski (prva tura)'),
  }),

  shift_closed: defineLog({
    group: 'smjena',
    alert: { rule: 'shift_closed' },
    body: body({
      shift_id: id,
      promet_fen: fen,
      cash_fen: fen,
      diff_fen: fen.nullable().optional(),
      early_close: z.boolean().optional(),
      by_user: z.array(z.object({ user_id: id, declared_fen: fen, diff_fen: fen })).optional(),
    }),
    title: (b, n) =>
      `Smjena zatvorena · pazar ${n.formatKm(b.promet_fen)}`
      + ` · gotovina ${n.formatKm(b.cash_fen)}`
      + (b.diff_fen === null || b.diff_fen === undefined
        ? ''
        : ` · razlika ${n.formatKm(b.diff_fen)}`)
      + suffix(b.early_close, 'ranije zatvoreno'),
  }),

  shift_forced: defineLog({
    group: 'smjena',
    alert: { rule: 'shift_forced' },
    body: body({ shift_id: id, note: z.string(), missing_user_ids: z.array(id).optional() }),
    title: b => `Smjena prisilno zatvorena · ${b.note}`,
  }),

  shift_reviewed: defineLog({
    group: 'smjena',
    body: body({ shift_id: id, card_total_fen: fen.nullable().optional(), card_diff_fen: fen.optional() }),
    title: (b, n) =>
      'Smjena pregledana'
      + (b.card_total_fen === null || b.card_total_fen === undefined
        ? ''
        : ` · kartica ${n.formatKm(b.card_total_fen)}`),
  }),

  waiter_finished: defineLog({
    group: 'novac',
    // Raised only when the envelope did not match — a settlement that lands
    // inside tolerance is the normal end of a normal night.
    alert: { rule: 'cash_variance', when: b => !b.within_tolerance },
    body: body({
      settlement_id: id,
      shift_id: id,
      user_id: id,
      from: iso,
      to: iso,
      promet_fen: fen,
      declared_fen: fen,
      within_tolerance: z.boolean(),
    }),
    title: (b, n) =>
      `Završena smjena · ${n.user(b.user_id)} · ${n.localTime(b.from)}–${n.localTime(b.to)}`
      + ` · promet ${n.formatKm(b.promet_fen)} · predao ${n.formatKm(b.declared_fen)}`
      + ` · ${b.within_tolerance ? 'u toleranciji' : 'van tolerancije'}`,
  }),

  settlement_late: defineLog({
    group: 'novac',
    alert: { rule: 'settlement_late' },
    body: body({ settlement_id: id, shift_id: id, user_id: id, declared_fen: fen }),
    title: (b, n) => `Naknadna predaja · ${n.user(b.user_id)} · ${n.formatKm(b.declared_fen)}`,
  }),

  settlement_accepted: defineLog({
    group: 'novac',
    body: body({ settlement_id: id, user_id: id, receiver_id: id, declared_fen: fen }),
    title: (b, n) =>
      `Predaja primljena · ${n.user(b.receiver_id)} · od ${n.user(b.user_id)}`
      + ` · ${n.formatKm(b.declared_fen)}`,
  }),

  // -- Storno i gratis ------------------------------------------------------
  void_requested: defineLog({
    group: 'storno',
    quiet: true,
    body: body({
      adjustment_id: id, tab_id: id, table_id: id.optional(), user_id: id,
      line: z.string(), amount_fen: fen,
    }),
    title: (b, n) =>
      `Traži storno · ${n.user(b.user_id)} · ${n.table(b.table_id)}`
      + ` · ${b.line} ${n.formatKm(b.amount_fen)}`,
  }),

  void_decided: defineLog({
    group: 'storno',
    // The two cases the owner has to see: money already in the till going back
    // out, and an admin PIN typed on somebody else's phone.
    alert: { rule: 'void_after_payment', when: b => Boolean(b.was_paid || b.foreign_device) },
    body: body({
      adjustment_id: id, tab_id: id, table_id: id.optional(),
      user_id: id, approver_id: id.optional(),
      line: z.string(), amount_fen: fen, outcome: z.enum(['applied', 'rejected']),
      was_paid: z.boolean().optional(), foreign_device: z.boolean().optional(),
      restock: z.boolean().optional(),
      refund_kind: z.enum(['none', 'from_waiter', 'from_drawer']).optional(),
    }),
    title: (b, n) =>
      `Storno ${b.outcome === 'applied' ? 'odobren' : 'odbijen'}`
      + ` · ${n.user(b.approver_id)} · ${n.user(b.user_id)} · ${n.table(b.table_id)}`
      + ` · ${b.line} ${n.formatKm(b.amount_fen)}`
      + suffix(b.was_paid, 'nakon naplate')
      + suffix(b.foreign_device, 'na tuđem telefonu'),
  }),

  self_void_capped: defineLog({
    group: 'storno',
    body: body({ user_id: id, count: z.int(), max: z.int(), fen: fen.optional() }),
    title: (b, n) =>
      `Storno ide šankeru · ${n.user(b.user_id)} · prekoračen limit (${b.count}/${b.max})`,
  }),

  comp_requested: defineLog({
    group: 'storno',
    quiet: true,
    body: body({
      adjustment_id: id, tab_id: id, user_id: id,
      line: z.string(), amount_fen: fen, reason: z.string(),
    }),
    title: (b, n) =>
      `Traži gratis · ${n.user(b.user_id)} · ${b.line} ${n.formatKm(b.amount_fen)}`,
  }),

  comp_decided: defineLog({
    group: 'storno',
    alert: { rule: 'comp_large', when: (b, s) => b.amount_fen >= s.comp_large_fen },
    body: body({
      adjustment_id: id, tab_id: id, user_id: id, approver_id: id.optional(),
      line: z.string(), amount_fen: fen, reason: z.string(),
      outcome: z.enum(['applied', 'rejected']),
    }),
    title: (b, n) =>
      `Gratis ${b.outcome === 'applied' ? 'odobren' : 'odbijen'}`
      + ` · ${n.user(b.approver_id)} · ${n.user(b.user_id)}`
      + ` · ${b.line} ${n.formatKm(b.amount_fen)}`,
  }),

  // -- Naplata --------------------------------------------------------------
  unpaid_marked: defineLog({
    group: 'novac',
    quiet: true,
    body: body({ tab_id: id, table_id: id.optional(), user_id: id, remaining_fen: fen, reason: z.string() }),
    title: (b, n) =>
      `Nije plaćeno · ${n.user(b.user_id)} · ${n.table(b.table_id)}`
      + ` · ${n.formatKm(b.remaining_fen)} · ${b.reason}`,
  }),

  unpaid_decided: defineLog({
    group: 'novac',
    body: body({
      tab_id: id, table_id: id.optional(), amount_fen: fen,
      outcome: z.enum(['otpis', 'naplatiti']),
    }),
    title: (b, n) =>
      `Nenaplaćeno ${b.outcome === 'otpis' ? 'otpisano' : 'na naplatu'}`
      + ` · ${n.table(b.table_id)} · ${n.formatKm(b.amount_fen)}`,
  }),

  payment_reversed: defineLog({
    group: 'novac',
    alert: { rule: 'payment_reversed' },
    // §8 gives this kind two writers: `insertReversal`, which writes a negative
    // `payments` row, and `insertRefund`, which writes a `cash_movements` one.
    // Neither id is therefore required — the row it points at is named by
    // whichever of the two fields is present.
    body: body({
      payment_id: id.optional(), movement_id: id.optional(),
      tab_id: id, table_id: id.optional(),
      amount_fen: fen, method: z.enum(['cash', 'card']),
      adjustment_id: id.optional(),
      refund_kind: z.enum(['none', 'from_waiter', 'from_drawer']).optional(),
    }),
    title: (b, n) =>
      `Vraćeno gostu · ${n.table(b.table_id)} · ${n.formatKm(Math.abs(b.amount_fen))}`
      + ` · ${b.method === 'cash' ? 'gotovina' : 'kartica'}`,
  }),

  pay_duplicate_attempt: defineLog({
    group: 'novac',
    quiet: true,
    body: body({ tab_id: id, table_id: id.optional(), user_id: id, paid_by: id }),
    title: (b, n) =>
      `Pokušaj druge naplate · ${n.user(b.user_id)} · ${n.table(b.table_id)}`
      + ` · već naplatio ${n.user(b.paid_by)}`,
  }),

  pay_uncovered: defineLog({
    group: 'novac',
    quiet: true,
    body: body({ tab_id: id, table_id: id.optional(), user_id: id }),
    title: (b, n) => `Naplata bez pokrića · ${n.user(b.user_id)} · ${n.table(b.table_id)}`,
  }),

  // -- Stolovi --------------------------------------------------------------
  tab_moved: defineLog({
    group: 'novac',
    quiet: true,
    body: body({ tab_id: id, user_id: id, from_table_id: id, to_table_id: id }),
    title: (b, n) =>
      `Račun prebačen · ${n.user(b.user_id)}`
      + ` · ${n.table(b.from_table_id)} → ${n.table(b.to_table_id)}`,
  }),

  tab_offered: defineLog({
    group: 'novac',
    quiet: true,
    body: body({ tab_id: id, table_id: id.optional(), user_id: id, to: id }),
    title: (b, n) =>
      `Sto ponuđen · ${n.user(b.user_id)} → ${n.user(b.to)} · ${n.table(b.table_id)}`,
  }),

  tab_handed: defineLog({
    group: 'novac',
    body: body({ tab_id: id, table_id: id.optional(), from: id, to: id }),
    title: (b, n) =>
      `Sto preuzet · ${n.user(b.to)} · od ${n.user(b.from)} · ${n.table(b.table_id)}`,
  }),

  cross_waiter_lock: defineLog({
    group: 'novac',
    quiet: true,
    body: body({ tab_id: id, order_id: id, table_id: id.optional(), assigned_to: id, locked_by: id }),
    title: (b, n) =>
      `Tura na tuđem stolu · ${n.user(b.locked_by)} · ${n.table(b.table_id)}`
      + ` · vodi ${n.user(b.assigned_to)}`,
  }),

  draft_discarded: defineLog({
    group: 'novac',
    quiet: true,
    // `total_fen` describes a cart the server never saw. It is written here as
    // evidence and summed into nothing, which is the only reason a phone is
    // allowed to send it at all.
    body: body({ table_id: id, user_id: id.optional(), lines: z.int(), total_fen: fen }),
    title: (b, n) =>
      `Odbačena nezaključana narudžba · ${n.user(b.user_id)} · ${n.table(b.table_id)}`
      + ` · ${b.lines} stavki · ${n.formatKm(b.total_fen)}`,
  }),

  late_after_settle: defineLog({
    group: 'novac',
    alert: { rule: 'late_after_settle' },
    // Two writers again (§8): a round locked after the settlement, and a
    // payment taken after it. A payment has no order, so `order_id` is optional
    // and `payment_id` names the row in that case.
    body: body({
      order_id: id.optional(), payment_id: id.optional(),
      tab_id: id.optional(), table_id: id.optional(),
      user_id: id, shift_seq: z.int().optional(), amount_fen: fen,
      method: z.enum(['cash', 'card']).optional(),
    }),
    title: (b, n) =>
      `Tura nakon predaje · ${n.user(b.user_id)} · ${n.table(b.table_id)}`
      + ` · ${n.formatKm(b.amount_fen)}`,
  }),

  late_after_close: defineLog({
    group: 'novac',
    alert: { rule: 'late_after_close' },
    body: body({
      tab_id: id, order_id: id, shift_id: id.optional(), table_id: id.optional(),
      user_id: id.optional(), amount_fen: fen, count: z.int(),
    }),
    title: (b, n) =>
      `Nakon zatvaranja · ${n.user(b.user_id)} · ${n.table(b.table_id)}`
      + ` · ${n.formatKm(b.amount_fen)} · ${b.count}. tura`,
  }),

  // -- Kasa -----------------------------------------------------------------
  float_moved: defineLog({
    group: 'novac',
    body: body({
      movement_id: id, type: z.enum(['float_in', 'float_out']),
      user_id: id, created_by: id, amount_fen: fen,
    }),
    title: (b, n) =>
      `Pazar iz kase · ${n.user(b.created_by)} → ${n.user(b.user_id)}`
      + ` · ${n.formatKm(b.amount_fen)}`,
  }),

  float_override: defineLog({
    group: 'novac',
    body: body({ shift_id: id, before: fen, after: fen }),
    title: (b, n) =>
      `Početni polog ispravljen · ${n.formatKm(b.before)} → ${n.formatKm(b.after)}`,
  }),

  payout_requested: defineLog({
    group: 'novac',
    // Over the owner's threshold it is his decision, so he has to hear about it.
    alert: { rule: 'payout_pending', when: (b, s) => b.amount_fen > s.payout_owner_fen },
    body: body({ movement_id: id, user_id: id, amount_fen: fen, reason: z.string(), note: z.string().nullish() }),
    title: (b, n) =>
      `Isplata iz kase · ${n.user(b.user_id)} · ${n.formatKm(b.amount_fen)}`
      + ` · ${PAYOUT_REASON_BS[b.reason] ?? b.reason} · čeka odobrenje`,
  }),

  payout_decided: defineLog({
    group: 'novac',
    // Never mirrored: the owner is the decider, and telling him what he just
    // decided is noise.
    body: body({
      movement_id: id, user_id: id, approver_id: id.optional(), amount_fen: fen,
      outcome: z.enum(['approved', 'rejected']),
    }),
    title: (b, n) =>
      `Isplata ${b.outcome === 'approved' ? 'odobrena' : 'odbijena'} · ${n.user(b.approver_id)}`
      + ` · ${n.formatKm(b.amount_fen)}`,
  }),

  pickup: defineLog({
    group: 'novac',
    body: body({ movement_id: id, amount_fen: fen, note: z.string().nullish() }),
    title: (b, n) => `Uzeto iz kase · ${n.formatKm(b.amount_fen)}`,
  }),

  override: defineLog({
    group: 'smjena',
    body: body({ what: z.string(), ref_id: id.optional() }),
    title: b => `Preskočeno pravilo · ${b.what}`,
  }),

  // -- Roba -----------------------------------------------------------------
  delivery_posted: defineLog({
    group: 'roba',
    body: body({ delivery_id: id, supplier: z.string(), total_fen: fen, lines: z.int() }),
    title: (b, n) =>
      `Prijem robe proknjižen · ${b.supplier} · ${n.formatKm(b.total_fen)} · ${b.lines} stavki`,
  }),

  delivery_reversed: defineLog({
    group: 'roba',
    body: body({ delivery_id: id, note: z.string() }),
    title: b => `Prijem storniran · ${b.note}`,
  }),

  count_submitted: defineLog({
    group: 'roba',
    body: body({ count_id: id, items: z.int(), out_of_tolerance: z.int() }),
    title: b => `Popis predan · ${b.items} stavki · ${b.out_of_tolerance} van tolerancije`,
  }),

  /**
   * *Potvrđujem stanje* — the incoming custodian saw the same shelf (F9 step 4).
   *
   * Quiet: it is the routine half of a handover, and the owner reads it only as
   * the reassurance behind a variance. What is **not** quiet is its absence —
   * an unwitnessed count is an attention line on *Puls*, which is the honest way
   * round: nothing happened is what deserves the owner's eye here.
   */
  count_witnessed: defineLog({
    group: 'roba',
    quiet: true,
    body: body({ count_id: id, witness_id: id, phase: z.string() }),
    title: (b, n) => `Popis potvrdio svjedok · ${n.user(b.witness_id)} · ${COUNT_PHASE_BS[b.phase] ?? b.phase}`,
  }),

  count_confirmed: defineLog({
    group: 'roba',
    alert: {
      rule: 'stock_variance',
      when: (b, s) => Math.abs(b.variance_fen) > s.variance_alert_fen,
    },
    body: body({ count_id: id, variance_fen: fen, adjusted_items: z.int() }),
    title: (b, n) =>
      `Popis potvrđen · manjak ${n.formatKm(Math.abs(b.variance_fen))}`
      + ` · ${b.adjusted_items} stavki korigovano`,
  }),

  waste_logged: defineLog({
    group: 'roba',
    // Routine breakage is routine. An otpis that needs approval is not.
    body: body({
      waste_id: id, stock_item_id: id, user_id: id,
      qty: z.number(), cost_fen: fen, reason: z.string(),
      needs_approval: z.boolean().optional(),
    }),
    title: (b, n) =>
      `Otpis · ${n.user(b.user_id)} · ${n.stockItem(b.stock_item_id)} ${b.qty}`
      + ` · ${n.formatKm(b.cost_fen)} · ${b.reason}`,
  }),

  waste_capped: defineLog({
    group: 'roba',
    body: body({ waste_id: id, user_id: id, count: z.int() }),
    title: (b, n) => `Otpis iznad limita · ${n.user(b.user_id)} · ${b.count}. put u smjeni`,
  }),

  stock_corrected: defineLog({
    group: 'roba',
    body: body({ movement_id: id, stock_item_id: id, qty_delta: z.number(), note: z.string() }),
    title: (b, n) =>
      `Zaliha ispravljena · ${n.stockItem(b.stock_item_id)} ${b.qty_delta > 0 ? '+' : ''}${b.qty_delta}`
      + ` · ${b.note}`,
  }),

  opening_set: defineLog({
    group: 'roba',
    body: body({ n_items: z.int(), total_value_fen: fen }),
    title: (b, n) =>
      `Početno stanje uneseno · ${b.n_items} stavki · ${n.formatKm(b.total_value_fen)}`,
  }),

  // -- Postavke i katalog ---------------------------------------------------
  price_changed: defineLog({
    group: 'postavke',
    body: body({ product_id: id, before: fen, after: fen }),
    title: (b, n) =>
      `Cijena promijenjena · ${n.product(b.product_id)}`
      + ` · ${n.formatKm(b.before)} → ${n.formatKm(b.after)}`,
  }),

  product_changed: defineLog({
    group: 'postavke',
    body: body({ product_id: id, what: z.string() }),
    title: (b, n) => `Artikal promijenjen · ${n.product(b.product_id)} · ${b.what}`,
  }),

  category_changed: defineLog({
    group: 'postavke',
    body: body({ category_id: id, what: z.string() }),
    title: (b, n) => `Kategorija promijenjena · ${n.category(b.category_id)} · ${b.what}`,
  }),

  table_changed: defineLog({
    group: 'postavke',
    body: body({ table_id: id, what: z.string() }),
    title: (b, n) => `Sto promijenjen · ${n.table(b.table_id)} · ${b.what}`,
  }),

  stock_item_changed: defineLog({
    group: 'postavke',
    body: body({ stock_item_id: id, what: z.string() }),
    title: (b, n) => `Roba promijenjena · ${n.stockItem(b.stock_item_id)} · ${b.what}`,
  }),

  recipe_changed: defineLog({
    group: 'postavke',
    body: body({ product_id: id, what: z.string() }),
    title: (b, n) => `Normativ promijenjen · ${n.product(b.product_id)} · ${b.what}`,
  }),

  settings_changed: defineLog({
    group: 'postavke',
    body: body({ key: z.string(), label: z.string(), before: z.unknown(), after: z.unknown() }),
    // A `*_fen` setting is money and is written as money — 5,00 KM, never 500.
    title: (b, n) => {
      const v = (x: unknown) =>
        b.key.endsWith('_fen') && typeof x === 'number' ? n.formatKm(x) : String(x)
      return `Postavke promijenjene · ${b.label} ${v(b.before)} → ${v(b.after)}`
    },
  }),

  user_changed: defineLog({
    group: 'postavke',
    body: body({
      user_id: id,
      what: z.enum(['dodan', 'pin_resetovan', 'deaktiviran', 'promijenjen']),
    }),
    title: (b, n) => {
      const what = {
        dodan: 'Konobar dodan',
        pin_resetovan: 'PIN resetovan',
        deaktiviran: 'Konobar deaktiviran',
        promijenjen: 'Konobar promijenjen',
      }[b.what]
      return `${what} · ${n.user(b.user_id)}`
    },
  }),

  // -- Uređaji --------------------------------------------------------------
  device_enrolled: defineLog({
    group: 'uredaji',
    body: body({ device_id: id, label: z.string() }),
    title: b => `Uređaj prijavljen · ${b.label}`,
  }),

  device_revoked: defineLog({
    group: 'uredaji',
    body: body({ device_id: id, label: z.string() }),
    title: b => `Uređaj odjavljen · ${b.label}`,
  }),

  device_unlocked: defineLog({
    group: 'uredaji',
    body: body({ device_id: id, label: z.string(), via: z.enum(['reset_pin', 'unlock']) }),
    title: b => `Uređaj otključan · ${b.label}`,
  }),

  lockout: defineLog({
    group: 'uredaji',
    alert: { rule: 'device_lockout' },
    body: body({ device_id: id.nullish(), user_id: id.nullish(), fails: z.int() }),
    title: (b, n) => `PIN zaključan · ${n.device(b.device_id)} · ${b.fails} pogrešnih`,
  }),

  clock_skew: defineLog({
    group: 'uredaji',
    body: body({ device_id: id, skew_s: z.int() }),
    title: (b, n) => {
      const minutes = Math.round(Math.abs(b.skew_s) / 60)
      const direction = b.skew_s < 0 ? 'kasni' : 'žuri'
      return `${n.device(b.device_id)}: sat ${direction} ${minutes} min`
    },
  }),
}

// No `satisfies Record<string, LogTemplate<…>>` here on purpose: `LogTemplate<B>`
// uses `B` both as an input (`title(body)`) and inside an output (`body`), which
// makes it invariant — there is no single `B` every entry satisfies. `defineLog`
// already types each entry individually, which is the check that matters.

/** Every kind there is. Frozen for Korak 2. */
export type LogKind = keyof typeof LOG

export const LOG_KINDS = Object.keys(LOG) as LogKind[]

/** Is this kind hidden behind the Dnevnik's *važno* filter? */
export function isQuiet(kind: LogKind): boolean {
  return LOG[kind].quiet === true
}
