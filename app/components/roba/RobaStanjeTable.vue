<script lang="ts">
/**
 * *Stanje šanka* — the shelf as one dense table, and the four nag lists under it.
 *
 * The row shape and the two pure functions that build it live in this plain
 * `<script>` block rather than in `<script setup>`, because the page needs them
 * too: it counts the four chips off exactly the rows the table draws, so a chip
 * that says "U minusu 1" and a table that shows none is impossible.
 */
import type {
  BaseUnit, CountView, ProductAdmin, StockItem, StockItemStock,
  StockLastMovement, StockStatus,
} from '#shared/types'

export interface StanjeRow {
  id: string
  name: string
  base_unit: BaseUnit
  on_hand: number
  status: StockStatus
  value_fen: number
  par_qty: number | null
  /** "3 × gajba + 7", or null when the item has no pack size on it. */
  packs_label: string | null
  /** The ledger's last word on this item, when `GET /api/stock` answered. */
  last_movement: StockLastMovement | null
  /** A round arrived for this item after a popis had already counted it. */
  late_sync: boolean
  /** Nothing on the menu takes this off the shelf: no recipe line, no 1:1 item. */
  no_recipe: boolean
}

/** The four nag lists of PLAN §9, in the mockup's order. */
export type StanjeFilter = 'sve' | 'u-minusu' | 'bez-cijene' | 'bez-normativa' | 'kasno'

/**
 * "3 × gajba + 7".
 *
 * Deliberately **not** "3 gajbe + 7". Bosnian counts in three plural forms
 * (1 gajba · 2–4 gajbe · 5+ gajbi) and the rule differs per noun, so a generated
 * plural would be wrong on the shelf more often than it was right. The multiply
 * sign is honest and reads the same for every pack name the owner ever types.
 */
function packsLabel(item: StockItemStock): string | null {
  const size = item.pack_qty
  if (!size || size <= 0 || !item.pack_name) return null
  if (item.on_hand < 0) return null

  const packs = Math.floor(item.on_hand / size)
  const rest = item.on_hand - packs * size
  if (packs === 0) return null

  const restText = rest === 0
    ? ''
    : ` + ${item.base_unit === 'kom' ? String(Math.round(rest * 100) / 100) : formatStockQty(rest, item.base_unit)}`
  return `${packs} × ${item.pack_name}${restText}`
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
 * Four reads meet here. `GET /api/owner/stock` is the priced shelf; `GET
 * /api/stock` carries each item's last movement, which is what the *u minusu*
 * row quotes underneath its pill; `GET /api/admin/products` says which shelf
 * items the menu actually consumes — an item no recipe and no 1:1 product points
 * at can never be reconciled, which is *Bez normativa*; and the confirmed counts
 * say which items a round reached late.
 */
export function buildStanjeRows(
  items: StockItemStock[],
  live: StockItem[],
  products: ProductAdmin[],
  counts: CountView[],
): StanjeRow[] {
  const lastById = new Map(live.map(item => [item.id, item.last_movement]))
  const late = lateSyncItems(counts)

  const consumed = new Set<string>()
  let sellsShisha = false
  for (const product of products) {
    if (!product.active) continue
    if (product.kind === 'shisha') sellsShisha = true
    if (product.sells_stock_item_id) consumed.add(product.sells_stock_item_id)
    for (const line of product.recipe) consumed.add(line.stock_item_id)
  }

  return items.map((item): StanjeRow => {
    const last = lastById.get(item.id) ?? null
    return {
      id: item.id,
      name: item.name,
      base_unit: item.base_unit,
      on_hand: item.on_hand,
      status: item.status,
      value_fen: item.value_fen,
      par_qty: item.par_qty,
      packs_label: packsLabel(item),
      last_movement: last,
      late_sync: late.has(item.id) || last?.type === 'late_sync',
      // Tobacco has no recipe line by design: a shisha product carries
      // `shisha_grams` and the aromas are chosen at lock, so the tins are
      // consumed by every bowl even though nothing points at them statically.
      no_recipe: !consumed.has(item.id) && !(sellsShisha && item.kind === 'duhan'),
    }
  })
}

/** Whether one row belongs in one nag list. */
export function matchesFilter(row: StanjeRow, filter: StanjeFilter): boolean {
  switch (filter) {
    case 'u-minusu': return row.status === 'u_minusu'
    case 'bez-cijene': return row.status === 'bez_cijene'
    case 'bez-normativa': return row.no_recipe
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
  { key: 'packs', label: 'Paketi + komadi' },
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

/** "zadnje: prijem robe · 09.09.2026." — the ledger's own words, in one line. */
function lastLine(row: StanjeRow): string {
  if (!row.last_movement) return ''
  return `zadnje: ${row.last_movement.ref_label} · ${dateBs(row.last_movement.occurred_at)}`
}
</script>

<template>
  <div class="a-stanje">
    <UiTable :columns="COLUMNS" :loading="loading">
      <tr v-for="row in rows" :key="row.id">
        <td>
          <NuxtLink :to="`/admin/roba/artikal/${row.id}`" class="a-roba-link">{{ row.name }}</NuxtLink>
          <span v-if="row.no_recipe" class="a-roba-note">bez normativa</span>
          <span v-else-if="row.late_sync" class="a-roba-note">kasno sinhronizovano</span>
        </td>
        <td class="r">{{ formatStockQty(row.on_hand, row.base_unit) }}</td>
        <td class="a-roba-packs">
          <span v-if="row.packs_label">{{ row.packs_label }}</span>
          <span v-else class="a-roba-dash">—</span>
        </td>
        <td class="r"><UiMoney :fen="row.value_fen" :currency="false" /></td>
        <td>
          <div class="a-roba-status">
            <UiPill :tone="statusPill(row).tone">{{ statusPill(row).text }}</UiPill>
            <small v-if="row.status === 'u_minusu' && row.last_movement">{{ lastLine(row) }}</small>
          </div>
        </td>
      </tr>
    </UiTable>

    <p v-if="!loading && rows.length === 0" class="a-roba-empty">
      Nema robe za ovaj filter.
    </p>
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

.a-roba-packs { white-space: nowrap; }
.a-roba-dash { color: var(--muted); }

.a-roba-status { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.a-roba-status small { font-size: var(--text-caption); color: var(--muted); }

.a-stanje { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.a-roba-empty { margin: 0; color: var(--muted); font-size: var(--text-label); }

@media (max-width: 1023px) {
  /* The article name is the row's link into its ledger, so it is a thumb's
     target and not a line of text with a tap area the height of a capital.
     It stays a text height on a laptop: twenty rows at `--tap` each would
     cost this table a third of its density, which is the one thing the light
     theme exists for (DESIGN §8). */
  .a-roba-link { min-height: var(--tap); }
}
</style>
