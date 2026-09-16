<script lang="ts">
/**
 * *Stanje šanka* as one dense table — **the laptop half of the screen.** Below
 * 1024 px the page draws `RobaStanjeList` instead and this component is not
 * rendered at all; six columns in a 390 px box is a sideways drag past the name
 * to reach a status nobody can see.
 *
 * The row shape and the pure functions that build and group it live in this
 * plain `<script>` block rather than in `<script setup>`, because the page and
 * the phone list need them too: the page counts the chips off exactly the rows
 * that get drawn, so a chip saying "U minusu 1" over a list showing none is
 * impossible, and both layouts read one row shape and one set of sections
 * rather than two.
 *
 * **One table per section.** The page draws *Kafa*, *Nargila* and *Ostalo* as
 * three cards, each with one of these inside it, which is the same shape *Meni*
 * gives its categories on a laptop.
 */
import type {
  BaseUnit, CountView, StockItem, StockItemStock,
  StockKind, StockLastMovement, StockStatus,
} from '#shared/types'

export interface StanjeRow {
  id: string
  name: string
  base_unit: BaseUnit
  /** The true shelf: `SUM(qty_delta)` over the whole ledger. `settled + pending`. */
  on_hand: number
  /**
   * The number the screen prints large — the shelf as the last closed shift
   * left it. It is `on_hand` when no shift is open, which is most of the day.
   */
  settled: number
  /**
   * What the open shift has moved so far, negative on a normal night, `0` when
   * none is open. Drawn in `--danger` beside `settled` and nowhere else.
   */
  pending: number
  status: StockStatus
  value_fen: number
  par_qty: number | null
  /** The ledger's last word on this item, when `GET /api/stock` answered. */
  last_movement: StockLastMovement | null
  /** A round arrived for this item after a popis had already counted it. */
  late_sync: boolean
  /** Which category of the shelf this article belongs to (`category_id`). */
  group: StanjeGroup
  category_id: string | null
  category_name: string | null
}

/** The three nag lists of PLAN §9 that are still warnings worth a chip. */
export type StanjeFilter = 'sve' | 'u-minusu' | 'bez-cijene' | 'kasno'

/**
 * The shelf **by category** — the same categories *Meni* and *Prijem robe* use
 * (the owner, 16.09.2026: "kategorije su iste za sve").
 *
 * It used to be three fixed sections (*Kafa*, *Nargila*, *Ostalo*) guessed from
 * an article's kind and a category name. Now every article sits in the category
 * it was received into, and the sections are exactly those categories, in the
 * order the owner put them in. An older article that never got one is under
 * *Bez kategorije*, last, so it is visible and can be moved.
 */
export type StanjeGroup = string

/** The key of an article with no category. */
export const NO_CATEGORY = 'bez-kategorije'

export interface StanjeSection {
  key: StanjeGroup
  /** The Bosnian heading — the category's own name. */
  label: string
  rows: StanjeRow[]
}

export function stanjeGroup(item: { category_id: string | null }): StanjeGroup {
  return item.category_id ?? NO_CATEGORY
}

/**
 * Sections in the categories' own order (`categoryOrder`, ids by `sort`), empty
 * ones dropped. A category the order does not know — one deleted since, say —
 * comes after the known ones, and *Bez kategorije* is always last.
 */
export function groupSections<T extends { category_id: string | null, category_name: string | null }>(
  rows: T[], categoryOrder: string[] = [],
): Array<{ key: StanjeGroup, label: string, rows: T[] }> {
  const byKey = new Map<string, { key: StanjeGroup, label: string, rows: T[] }>()
  for (const row of rows) {
    const key = stanjeGroup(row)
    let section = byKey.get(key)
    if (!section) {
      section = { key, label: row.category_name ?? 'Bez kategorije', rows: [] }
      if (key === NO_CATEGORY) section.label = 'Bez kategorije'
      byKey.set(key, section)
    }
    section.rows.push(row)
  }
  const rank = (key: string) => {
    if (key === NO_CATEGORY) return Number.MAX_SAFE_INTEGER
    const at = categoryOrder.indexOf(key)
    return at === -1 ? categoryOrder.length : at
  }
  return [...byKey.values()]
    .sort((a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label, 'bs'))
}

/** The rows in sections, empty sections dropped. */
export function groupStanjeRows(rows: StanjeRow[], categoryOrder: string[] = []): StanjeSection[] {
  return groupSections(rows, categoryOrder)
}

/**
 * Which articles had a round arrive after a popis had already counted them —
 * the *Kasno sinhronizovano* nag list of PLAN §9.
 *
 * **Why it is read off the counts and not off the movement ledger.** A
 * `late_sync` offset is stamped with the *sale's* `occurred_at`, which is by
 * definition older than the popis it landed behind, so it is almost never an
 * item's newest movement and `GET /api/stock`'s `last_movement` would report it
 * roughly never. What is visible from a list read is the count itself: when the
 * confirm applied something other than the variance that was submitted, the
 * difference is exactly the rounds that arrived in between. Both signals are
 * used — the count's disagreement, and the rare case where the offset really is
 * the last row.
 */
function lateSyncItems(counts: CountView[]): Set<string> {
  const late = new Set<string>()
  for (const count of counts) {
    for (const line of count.lines) {
      if (line.applied_adjust !== null && line.applied_adjust !== line.variance_qty) {
        late.add(line.stock_item_id)
      }
    }
  }
  return late
}

/**
 * The rows the table draws.
 *
 * Three reads meet here. `GET /api/owner/stock` is the priced shelf; `GET
 * /api/stock` carries each item's last movement, which is what the *u minusu*
 * row quotes underneath its pill, **and the settled/pending split** the two
 * numbers on every row come from; and the confirmed counts say which items a
 * round reached late.
 *
 * **The menu is no longer read here.** It was, for one thing only — *Bez
 * normativa*, the warning that nothing on the menu consumed an article — and the
 * owner had that removed everywhere it appeared. The recipes themselves are
 * untouched: `recipe_lines` is how a sale deducts stock and is not going
 * anywhere. What is gone is the nag.
 *
 * An item the live read does not carry falls back to "all settled, nothing
 * pending", which is the honest answer: the split is a reading of the ledger,
 * and with no reading the whole quantity is simply the shelf.
 */
export function buildStanjeRows(
  items: StockItemStock[],
  live: StockItem[],
  counts: CountView[],
): StanjeRow[] {
  const liveById = new Map(live.map(item => [item.id, item]))
  const late = lateSyncItems(counts)

  return items.map((item): StanjeRow => {
    const now = liveById.get(item.id)
    const last = now?.last_movement ?? null
    const pending = now?.pending ?? 0
    return {
      id: item.id,
      name: item.name,
      base_unit: item.base_unit,
      on_hand: item.on_hand,
      // Subtracted from the priced read's own on-hand rather than taken from
      // `now.settled`, so the two numbers on the row always add back up to the
      // quantity the rest of the row is about, even if the two reads landed a
      // second apart and one of them is a lock older than the other.
      settled: item.on_hand - pending,
      pending,
      status: item.status,
      value_fen: item.value_fen,
      par_qty: item.par_qty,
      last_movement: last,
      late_sync: late.has(item.id) || last?.type === 'late_sync',
      group: stanjeGroup(item),
      category_id: item.category_id,
      category_name: item.category_name,
    }
  })
}

/** Whether one row belongs in one nag list. */
export function matchesFilter(row: StanjeRow, filter: StanjeFilter): boolean {
  switch (filter) {
    case 'u-minusu': return row.status === 'u_minusu'
    case 'bez-cijene': return row.status === 'bez_cijene'
    case 'kasno': return row.late_sync
    default: return true
  }
}
</script>

<script setup lang="ts">
// A component is auto-imported; the type it exports is not, so the column shape
// comes in by hand. The same line appears on every table under `/admin/roba`.
import type { UiColumn } from '~/components/ui/UiTable.vue'

defineProps<{
  rows: StanjeRow[]
  loading?: boolean
}>()

const COLUMNS: UiColumn[] = [
  { key: 'name', label: 'Artikal' },
  { key: 'on_hand', label: 'Na stanju', align: 'r' },
  { key: 'pending', label: 'Večeras', align: 'r' },
  { key: 'value', label: 'Vrijednost', align: 'r' },
  { key: 'status', label: 'Status' },
]

/** The pill's word and colour. Colour never carries the meaning by itself. */
function statusPill(row: StanjeRow): { tone: 'good' | 'warn' | 'bad', text: string } {
  switch (row.status) {
    case 'u_minusu': return { tone: 'bad', text: 'u minusu' }
    case 'bez_cijene': return { tone: 'warn', text: 'bez cijene' }
    case 'nisko':
      return {
        tone: 'warn',
        text: row.par_qty === null ? 'nisko' : `nisko · minimum ${row.par_qty}`,
      }
    default: return { tone: 'good', text: 'ok' }
  }
}
</script>

<template>
  <div class="a-stanje">
    <UiTable :columns="COLUMNS" :loading="loading">
      <tr v-for="row in rows" :key="row.id">
        <td>
          <span class="a-roba-link">{{ row.name }}</span>
          <span v-if="row.late_sync" class="a-roba-note">kasno sinhronizovano</span>
        </td>
        <td class="r">{{ formatStockQty(row.settled, row.base_unit) }}</td>
        <!-- Only when there is something to say. A column of dashes down a
             quiet afternoon is a column the eye stops reading. -->
        <td class="r">
          <span v-if="row.pending !== 0" class="a-roba-pending num">
            {{ formatMovementQty(row.pending, row.base_unit) }}
          </span>
        </td>
        <td class="r"><UiMoney :fen="row.value_fen" :currency="false" /></td>
        <td>
          <div class="a-roba-status">
            <UiPill :tone="statusPill(row).tone">{{ statusPill(row).text }}</UiPill>
          </div>
        </td>
      </tr>
    </UiTable>
  </div>
</template>

<style scoped>
.a-roba-link {
  color: var(--ink);
  text-decoration: none;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
}
.a-roba-link:hover { color: var(--accent-ink); text-decoration: underline; }

.a-roba-note {
  display: block;
  font-size: var(--text-caption);
  color: var(--muted);
}

.a-roba-dash { color: var(--muted); }

/* Tonight, in the one colour on this screen that means "still moving". The
   word for it is in the column header and in the sentence under the card —
   colour never carries the meaning alone (DESIGN §2). */
.a-roba-pending { color: var(--danger); font-weight: 600; white-space: nowrap; }

.a-roba-status { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.a-roba-status small { font-size: var(--text-caption); color: var(--muted); }

.a-stanje { display: flex; flex-direction: column; gap: 10px; min-width: 0; }

@media (max-width: 1023px) {
  /* The article name is the row's link into its ledger, so it is a thumb's
     target and not a line of text with a tap area the height of a capital.
     It stays a text height on a laptop: twenty rows at `--tap` each would
     cost this table a third of its density, which is the one thing the light
     theme exists for (DESIGN §8). */
  .a-roba-link { min-height: var(--tap); }
}
</style>
