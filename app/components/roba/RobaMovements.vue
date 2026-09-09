<script lang="ts">
/**
 * One article's movement ledger — the append-only truth behind every number on
 * *Stanje šanka*.
 *
 * `on hand = SUM(qty_delta)`; there is no stored balance anywhere and nothing on
 * this page can be edited. A mistake is corrected by *adding* a `correction`
 * row, which is why the table only ever grows.
 */
import type { ItemMovementRow, MovementType } from '#shared/types'

/** The Bosnian word for each movement type — PLAN §12's vocabulary, verbatim. */
export const MOVEMENT_LABELS: Record<MovementType, string> = {
  opening: 'početno stanje',
  delivery: 'prijem robe',
  sale: 'prodaja',
  sale_storno: 'storno prodaje',
  late_sync: 'kasno sinhronizovano',
  waste: 'otpis',
  count_adjust: 'popis',
  correction: 'korekcija',
  return_supplier: 'povrat dobavljaču',
}

/** Colour follows the meaning, and the word is always there beside it. */
export function movementTone(type: MovementType): 'good' | 'warn' | 'bad' | 'neutral' | 'accent' {
  switch (type) {
    case 'delivery':
    case 'opening':
      return 'good'
    case 'waste':
    case 'return_supplier':
      return 'bad'
    case 'late_sync':
    case 'count_adjust':
    case 'correction':
      return 'warn'
    case 'sale_storno':
      return 'accent'
    default:
      return 'neutral'
  }
}
</script>

<script setup lang="ts">
import type { BaseUnit } from '#shared/types'
import type { UiColumn } from '~/components/ui/UiTable.vue'

defineProps<{
  rows: ItemMovementRow[]
  unit: BaseUnit
  loading?: boolean
  /** There is another page behind the keyset cursor. */
  hasMore?: boolean
  loadingMore?: boolean
}>()

defineEmits<{ more: [] }>()

const COLUMNS: UiColumn[] = [
  { key: 'at', label: 'Kada', width: '150px' },
  { key: 'type', label: 'Vrsta' },
  { key: 'qty', label: 'Količina', align: 'r' },
  { key: 'value', label: 'Vrijednost', align: 'r' },
  { key: 'after', label: 'Stanje poslije', align: 'r' },
  { key: 'who', label: 'Ko' },
  { key: 'ref', label: 'Opis' },
]
</script>

<template>
  <div class="a-mov">
    <UiTable :columns="COLUMNS" :loading="loading">
      <tr v-for="row in rows" :key="row.id">
        <td class="a-mov-when">{{ dateTimeBs(row.occurred_at) }}</td>
        <td><UiPill :tone="movementTone(row.type)">{{ MOVEMENT_LABELS[row.type] }}</UiPill></td>
        <td class="r">{{ formatMovementQty(row.qty_delta, unit) }}</td>
        <td class="r"><UiMoney :fen="row.value_fen" :currency="false" /></td>
        <td class="r">{{ formatStockQty(row.running_on_hand, unit) }}</td>
        <td>{{ row.user_name ?? '—' }}</td>
        <td class="a-mov-ref">
          {{ row.ref_label }}
          <small v-if="row.note">{{ row.note }}</small>
        </td>
      </tr>
    </UiTable>

    <p v-if="!loading && rows.length === 0" class="a-mov-empty">
      Ova roba još nema nijedan promet.
    </p>

    <div v-if="hasMore" class="a-mov-more">
      <UiButton variant="soft" :pending="loadingMore" @click="$emit('more')">
        Učitaj starije
      </UiButton>
    </div>
  </div>
</template>

<style scoped>
.a-mov { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.a-mov-when { white-space: nowrap; color: var(--ink-2); }
.a-mov-ref { min-width: 160px; }
.a-mov-ref small { display: block; font-size: 12px; color: var(--muted); }
.a-mov-more { display: flex; justify-content: center; }
.a-mov-empty { margin: 0; color: var(--muted); font-size: 14px; }
</style>
