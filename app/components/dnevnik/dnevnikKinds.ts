/**
 * How the *Dnevnik* draws each of the 51 kinds: its Bosnian name in the *Vrsta*
 * filter, its 32 px icon, and the colour that icon is tinted.
 *
 * **Why a table and not a rule.** The server already renders `title_bs` — the
 * sentence in the feed is not built here and must not be. What is missing on
 * the client is only the *chrome*: a filter needs a short name for a kind
 * (`LOG` has a title *template*, which needs a body to render and would throw
 * on an empty one), and a row needs an icon and a tone. So this is a lookup and
 * nothing else, and `Record<LogKind, …>` is what keeps it honest: a kind added
 * to `shared/logTemplates.ts` that nobody named here is a typecheck error, not
 * a blank row in the owner's feed.
 *
 * It is a plain `.ts` beside the components rather than an auto-imported
 * `app/utils/` file because `app/utils/adminFormat.ts` belongs to WP0 and a
 * path in Šank has exactly one owner (`docs/PHASE2.md` §3).
 */
import { bsCompare } from '#shared/collate'
import { LOG } from '#shared/logTemplates'
import type { LogGroup } from '#shared/logTemplates'
import type { LogKind } from '#shared/types'

/**
 * The names in `UiIcon`'s set.
 *
 * Written out rather than imported from `UiIcon.vue`: the project typechecks
 * with plain `tsc`, which cannot read a type out of a single-file component —
 * `app/layouts/admin.vue` spells the same union out for the same reason. An
 * icon renamed there fails in the template here, which is where it shows.
 */
type IconName =
  | 'pulse' | 'money' | 'box' | 'list' | 'users' | 'calendar'
  | 'chevron-right' | 'check' | 'x' | 'clock' | 'more'
  | 'chat' | 'image'

/** The tint on the 32 px icon tile. `plain` is the quiet grey of the mockup. */
export type DnevnikTone = 'plain' | 'accent' | 'good' | 'bad'

/** The filter's six groups, in the order the dropdown lists them. */
export const DNEVNIK_GROUPS: Array<{ key: LogGroup, label: string }> = [
  { key: 'smjena', label: 'Smjena' },
  { key: 'novac', label: 'Novac' },
  { key: 'storno', label: 'Storno i gratis' },
  { key: 'roba', label: 'Roba' },
  { key: 'postavke', label: 'Postavke' },
  { key: 'uredaji', label: 'Uređaji' },
  // Phase 4 — Razgovor, Raspored, Pravila: everything about the team itself.
  { key: 'ekipa', label: 'Ekipa' },
]

/** The short Bosnian name of every kind — the *Vrsta* filter reads this. */
export const KIND_LABEL: Record<LogKind, string> = {
  // Smjena
  shift_opened: 'Smjena otvorena',
  shift_closed: 'Smjena zatvorena',
  shift_forced: 'Smjena prisilno zatvorena',
  shift_reviewed: 'Smjena pregledana',
  override: 'Preskočeno pravilo',

  // Novac
  waiter_finished: 'Završena smjena',
  settlement_late: 'Naknadna predaja',
  settlement_accepted: 'Predaja primljena',
  unpaid_marked: 'Nije plaćeno',
  unpaid_decided: 'Nenaplaćeno riješeno',
  payment_reversed: 'Vraćeno gostu',
  pay_duplicate_attempt: 'Pokušaj druge naplate',
  pay_uncovered: 'Naplata bez pokrića',
  tab_moved: 'Sto prebačen',
  tab_offered: 'Sto ponuđen',
  tab_handed: 'Sto preuzet',
  cross_waiter_lock: 'Tura na tuđem stolu',
  draft_discarded: 'Odbačena narudžba',
  late_after_settle: 'Tura nakon predaje',
  late_after_close: 'Nakon zatvaranja',
  float_moved: 'Pazar iz kase',
  float_override: 'Početni polog ispravljen',
  payout_requested: 'Isplata iz kase',
  payout_decided: 'Isplata riješena',
  pickup: 'Uzeto iz kase',

  // Storno i gratis
  void_requested: 'Traži storno',
  void_decided: 'Storno riješen',
  self_void_capped: 'Storno ide šankeru',
  comp_requested: 'Traži gratis',
  comp_decided: 'Gratis riješen',

  // Roba
  delivery_posted: 'Prijem robe proknjižen',
  delivery_reversed: 'Prijem storniran',
  count_submitted: 'Popis predan',
  count_witnessed: 'Popis potvrdio svjedok',
  count_confirmed: 'Popis potvrđen',
  waste_logged: 'Otpis',
  waste_capped: 'Otpis iznad limita',
  stock_corrected: 'Zaliha ispravljena',
  opening_set: 'Početno stanje uneseno',

  // Postavke
  price_changed: 'Cijena promijenjena',
  product_changed: 'Artikal promijenjen',
  category_changed: 'Kategorija promijenjena',
  table_changed: 'Sto promijenjen',
  stock_item_changed: 'Roba promijenjena',
  recipe_changed: 'Normativ promijenjen',
  settings_changed: 'Postavke promijenjene',
  user_changed: 'Osoblje promijenjeno',

  // Uređaji
  device_enrolled: 'Uređaj prijavljen',
  device_revoked: 'Uređaj odjavljen',
  device_unlocked: 'Uređaj otključan',
  lockout: 'PIN zaključan',
  clock_skew: 'Sat uređaja odstupa',

  // Ekipa — Razgovor
  chat_money_warned: 'Iznos u kanalu',
  chat_muted: 'Utišan u razgovoru',
  chat_image_removed: 'Slika uklonjena',
  chat_deleted_by_admin: 'Poruku obrisao vlasnik',
  chat_cap_hit: 'Limit slika dostignut',
  chat_pin_changed: '"Za naručiti" izmijenjeno',

  // Ekipa — Raspored
  roster_published: 'Raspored objavljen',
  roster_changed: 'Raspored izmijenjen',
  roster_absent: 'Nije došao',
  roster_sick: 'Bolovanje prijavljeno',
  swap_requested: 'Traži zamjenu',
  swap_accepted: 'Zamjena prihvaćena',
  swap_assigned: 'Zamjena dodijeljena',
  swap_declined: 'Zamjena odbijena',
  swap_cancelled: 'Zamjena povučena',
  template_changed: 'Šablon smjene promijenjen',

  // Ekipa — Pravila
  rules_published: 'Objavljena nova Pravila',
  rules_acked: 'Pravila potvrđena',

  // Roba — prijem sa slike
  delivery_scanned: 'Otpremnica pročitana sa slike',
  delivery_discarded: 'Sken odbačen',
  alias_linked: 'Naziv dobavljača povezan',
}

/** The default icon of a group; a kind below may override it. */
const GROUP_ICON: Record<LogGroup, IconName> = {
  smjena: 'clock',
  novac: 'money',
  storno: 'x',
  roba: 'box',
  postavke: 'list',
  uredaji: 'users',
  ekipa: 'chat',
}

const ICON: Partial<Record<LogKind, IconName>> = {
  roster_published: 'calendar',
  roster_changed: 'calendar',
  roster_absent: 'x',
  roster_sick: 'clock',
  swap_requested: 'calendar',
  swap_accepted: 'check',
  swap_assigned: 'check',
  swap_declined: 'x',
  swap_cancelled: 'x',
  template_changed: 'calendar',
  rules_published: 'list',
  rules_acked: 'check',
  chat_image_removed: 'image',
  chat_cap_hit: 'image',
  delivery_scanned: 'image',
  delivery_discarded: 'x',
  shift_closed: 'check',
  shift_reviewed: 'check',
  waiter_finished: 'check',
  settlement_accepted: 'check',
  count_confirmed: 'check',
  count_witnessed: 'check',
  device_unlocked: 'check',
  shift_forced: 'x',
  clock_skew: 'clock',
  lockout: 'x',
  late_after_close: 'clock',
  late_after_settle: 'clock',
  settlement_late: 'clock',
}

/**
 * Red is for money that moved the wrong way or a rule that was bent; green for
 * something that closed cleanly; copper for the end of a night. Everything else
 * is grey, because a feed where every row shouts says nothing.
 */
const BAD: LogKind[] = [
  'shift_forced', 'settlement_late', 'unpaid_marked', 'payment_reversed',
  'pay_duplicate_attempt', 'pay_uncovered', 'cross_waiter_lock',
  'late_after_settle', 'late_after_close', 'float_override', 'override',
  'self_void_capped', 'waste_capped', 'device_revoked', 'lockout', 'clock_skew',
  'roster_absent', 'delivery_discarded',
]

const GOOD: LogKind[] = [
  'shift_reviewed', 'settlement_accepted', 'unpaid_decided', 'count_confirmed',
  'delivery_posted', 'device_unlocked', 'payout_decided',
  'swap_accepted', 'swap_assigned', 'rules_acked',
]

const ACCENT: LogKind[] = [
  'shift_closed', 'waiter_finished', 'opening_set',
  'roster_published', 'rules_published',
]

export interface DnevnikLook {
  label: string
  icon: IconName
  tone: DnevnikTone
  group: LogGroup
}

/** Everything a row needs to draw itself, for one kind. */
export function lookOf(kind: LogKind): DnevnikLook {
  const group = LOG[kind]?.group ?? 'smjena'
  return {
    label: KIND_LABEL[kind] ?? kind,
    icon: ICON[kind] ?? GROUP_ICON[group],
    tone: BAD.includes(kind) ? 'bad' : GOOD.includes(kind) ? 'good' : ACCENT.includes(kind) ? 'accent' : 'plain',
    group,
  }
}

/** The *Vrsta* dropdown: "Sve vrste", then every kind under its group's name. */
export function kindOptions(): Array<{ value: string, label: string }> {
  const options = [{ value: '', label: 'Sve vrste' }]
  for (const group of DNEVNIK_GROUPS) {
    const kinds = (Object.keys(KIND_LABEL) as LogKind[])
      .filter(kind => LOG[kind].group === group.key)
      .sort((a, b) => bsCompare(KIND_LABEL[a], KIND_LABEL[b]))
    for (const kind of kinds) {
      options.push({ value: kind, label: `${group.label} · ${KIND_LABEL[kind]}` })
    }
  }
  return options
}

/**
 * The title the server rendered, split into the bold heading and the rest.
 *
 * Every template writes `Naslov · detalj · detalj`, so the first segment is the
 * headline and the tail is the muted line under it — exactly the two-part row
 * the mockup draws. Splitting here rather than sending two fields keeps one
 * sentence on the server, where the names and the amounts are.
 */
export function splitTitle(titleBs: string): { head: string, rest: string } {
  const [head, ...rest] = titleBs.split(' · ')
  return { head: head ?? titleBs, rest: rest.join(' · ') }
}

/**
 * The body fields `/a/dnevnik/:id` prints under the sentence, with the Bosnian
 * label each one gets.
 *
 * It is a **whitelist**, and that is deliberate twice over. A body is
 * `.loose()`, so a writer may add a key nobody planned; printing an unknown key
 * would put an English identifier (`within_tolerance`) on a Bosnian screen,
 * which CLAUDE.md calls a bug. And ids are skipped on purpose — a uuid tells
 * the owner nothing, and the row it points at is already named in the sentence.
 */
const FACT_LABEL: Record<string, string> = {
  promet_fen: 'Promet',
  cash_fen: 'Gotovina',
  card_fen: 'Kartica',
  card_total_fen: 'Kartica ukupno',
  card_diff_fen: 'Razlika po kartici',
  diff_fen: 'Razlika',
  declared_fen: 'Predao',
  amount_fen: 'Iznos',
  remaining_fen: 'Ostalo za naplatu',
  total_fen: 'Ukupno',
  cost_fen: 'Vrijednost',
  variance_fen: 'Manjak',
  total_value_fen: 'Vrijednost',
  before: 'Prije',
  after: 'Poslije',
  qty: 'Količina',
  qty_delta: 'Promjena količine',
  lines: 'Stavki',
  items: 'Stavki',
  n_items: 'Stavki',
  adjusted_items: 'Korigovano stavki',
  out_of_tolerance: 'Van tolerancije',
  count: 'Broj',
  max: 'Limit',
  fails: 'Pogrešnih pokušaja',
  shift_seq: 'Tura',
  line: 'Stavka',
  reason: 'Razlog',
  note: 'Napomena',
  supplier: 'Dobavljač',
  label: 'Uređaj',
  what: 'Šta',
}

/** Which of those are money, so they render through `formatKm`. */
const MONEY_KEYS = new Set([
  'promet_fen', 'cash_fen', 'card_fen', 'card_total_fen', 'card_diff_fen',
  'diff_fen', 'declared_fen', 'amount_fen', 'remaining_fen', 'total_fen',
  'cost_fen', 'variance_fen', 'total_value_fen',
])

/** `before` / `after` are feninga on these two kinds and plain text elsewhere. */
const MONEY_BEFORE_AFTER: LogKind[] = ['price_changed', 'float_override']

/**
 * `settings_changed` is the third one, but only sometimes: the body carries the
 * setting's `key`, and a `*_fen` key is money while `early_close_min` is not.
 */
function settingIsMoney(body: Record<string, unknown>): boolean {
  return typeof body.key === 'string' && body.key.endsWith('_fen')
}

/**
 * The reason enums, in Bosnian.
 *
 * `VOID_REASONS`, `COMP_REASONS`, the unpaid reasons and the payout reasons are
 * stored as English slugs (`wrong_entry`, `owner_guest`) because they are
 * *values*, not text — but a slug on the screen is an English word on a Bosnian
 * screen, which CLAUDE.md calls a bug. The waste reasons are already Bosnian
 * and fall through unchanged, as does anything a template adds later.
 */
const REASON_BS: Record<string, string> = {
  wrong_entry: 'pogrešan unos',
  guest_changed_mind: 'gost se predomislio',
  not_served: 'nije posluženo',
  complaint: 'žalba',
  other: 'ostalo',
  staff_drink: 'piće osoblja',
  owner_guest: 'gost vlasnika',
  promo: 'promocija',
  walked_out: 'otišao bez plaćanja',
  dispute: 'spor',
  dobavljac: 'dobavljač',
  sitno: 'sitno',
}

export interface DnevnikFact {
  label: string
  value: string
  /** Right-aligned and tabular: it is a figure, not a sentence. */
  numeric: boolean
}

export function bodyFacts(kind: LogKind, body: Record<string, unknown>): DnevnikFact[] {
  const facts: DnevnikFact[] = []

  for (const [key, label0] of Object.entries(FACT_LABEL)) {
    const value = body[key]
    if (value === undefined || value === null || value === '') continue

    // `label` means the device on the device kinds and the setting's name here,
    // and "Uređaj · Tolerancija kase" is a sentence about the wrong thing.
    const label = key === 'label' && kind === 'settings_changed' ? 'Postavka' : label0

    const isMoney = MONEY_KEYS.has(key)
      || ((key === 'before' || key === 'after') && typeof value === 'number'
        && (MONEY_BEFORE_AFTER.includes(kind)
          || (kind === 'settings_changed' && settingIsMoney(body))))

    if (isMoney && typeof value === 'number') {
      facts.push({ label, value: signedKm(value), numeric: true })
    } else if (typeof value === 'number') {
      facts.push({ label, value: String(value), numeric: true })
    } else if (typeof value === 'string') {
      facts.push({
        label,
        value: key === 'reason' ? REASON_BS[value] ?? value : value,
        numeric: false,
      })
    }
  }

  return facts
}

export interface DnevnikPill {
  text: string
  tone: 'good' | 'warn' | 'bad' | 'neutral' | 'accent'
}

/**
 * The pills on a row: the few facts in the body that the title does not say in
 * words, or says in a way worth repeating as a status.
 *
 * A body is `Record<string, unknown>` — the templates are `.loose()`, so a
 * writer may add context nobody typed — which is why every read below is
 * guarded rather than cast.
 */
export function pillsOf(body: Record<string, unknown>): DnevnikPill[] {
  const pills: DnevnikPill[] = []
  const flag = (key: string) => body[key] === true

  const outcome = typeof body.outcome === 'string' ? body.outcome : null
  if (outcome === 'applied' || outcome === 'approved') pills.push({ text: 'odobreno', tone: 'good' })
  if (outcome === 'rejected') pills.push({ text: 'odbijeno', tone: 'bad' })
  if (outcome === 'otpis') pills.push({ text: 'otpisano', tone: 'neutral' })
  if (outcome === 'naplatiti') pills.push({ text: 'na naplatu', tone: 'warn' })

  if (body.within_tolerance === true) pills.push({ text: 'u toleranciji', tone: 'good' })
  if (body.within_tolerance === false) pills.push({ text: 'van tolerancije', tone: 'warn' })

  if (flag('was_paid')) pills.push({ text: 'nakon naplate', tone: 'bad' })
  if (flag('foreign_device')) pills.push({ text: 'posuđen telefon', tone: 'neutral' })
  if (flag('early_close')) pills.push({ text: 'ranije zatvoreno', tone: 'warn' })
  if (flag('needs_approval')) pills.push({ text: 'čeka odobrenje', tone: 'warn' })
  if (flag('auto')) pills.push({ text: 'automatski', tone: 'neutral' })

  return pills
}
