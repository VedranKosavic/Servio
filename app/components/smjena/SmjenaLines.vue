<script setup lang="ts">
/**
 * *Stavke* — the rows behind a number.
 *
 * This is the component that makes every other figure on `/a` checkable: a
 * promet the owner does not recognise is one tap from the twenty rounds that
 * made it, with the time each was rung up, who rang it and what happened to it
 * afterwards.
 *
 * **`totals` is the whole filtered set, never the page.** The server computes it
 * over everything the filter matches and sends it with every page, so the footer
 * of page 1 and the footer of page 3 say the same thing — the one thing paging a
 * money screen must not get wrong.
 *
 * **`next_cursor` is a keyset cursor, not a page number.** It names the last row
 * of the page you are holding and the server returns what comes after it. An
 * offset would re-read and re-skip rows every time a new round lands mid-scroll,
 * so a reader would see a row twice or not at all.
 */
import { LINE_STATUS_WORDS, pluralBs } from './smjenaLogic'
import type { LineRow, LineTotals } from '#shared/types'

defineProps<{
  rows: LineRow[]
  totals: LineTotals | null
  loading: boolean
  /** There is another page: the button posts the cursor the server sent back. */
  hasMore: boolean
  loadingMore: boolean
}>()

const emit = defineEmits<{ more: [] }>()

const columns = [
  { key: 'vrijeme', label: 'Vrijeme', width: '76px' },
  { key: 'sto', label: 'Sto' },
  { key: 'stavka', label: 'Stavka' },
  { key: 'kolicina', label: 'Kol.', align: 'r' as const },
  { key: 'iznos', label: 'Iznos', align: 'r' as const },
  { key: 'konobar', label: 'Konobar' },
  { key: 'status', label: 'Status' },
]
</script>

<template>
  <UiCard title="Stavke" :count="totals?.rows">
    <!-- The totals are the whole filtered set, not this page, so they sit above
         the rows rather than under them: they are the answer, the rows are the
         evidence. -->
    <p v-if="totals" class="s-totals">
      <UiMoney :fen="totals.charged_fen" :colour="false" />
      <template v-if="totals.storno_fen">
        · storna <UiMoney :fen="totals.storno_fen" :currency="false" :colour="false" />
      </template>
      <template v-if="totals.gratis_fen">
        · gratis <UiMoney :fen="totals.gratis_fen" :currency="false" :colour="false" />
      </template>
      · {{ totals.qty }} {{ pluralBs(totals.qty, 'komad', 'komada', 'komada') }}
    </p>

    <p v-if="!loading && !rows.length" class="s-quiet">
      Za ovaj izbor nema nijedne stavke.
    </p>

    <UiTable v-else class="s-wide-table" :columns="columns" :loading="loading">
      <tr v-for="row in rows" :key="row.line_id">
        <td>{{ timeBs(row.at) }}</td>
        <td>{{ row.table_name }}</td>
        <td>
          {{ row.name_snapshot }}
          <small v-if="row.flavour_names.length" class="s-quiet">
            {{ row.flavour_names.join(' + ') }}
          </small>
          <small v-if="row.note" class="s-quiet">{{ row.note }}</small>
        </td>
        <td class="r">{{ row.qty }}</td>
        <td class="r"><UiMoney :fen="row.charged_fen" :currency="false" :colour="false" /></td>
        <td>{{ row.locked_by_name }}</td>
        <td>
          <UiPill :tone="LINE_STATUS_WORDS[row.status].tone">
            {{ LINE_STATUS_WORDS[row.status].word }}
          </UiPill>
          <!-- A round the phone held in its outbox: rung up at `at`, arrived
               later. The lag is why a total can move after somebody read it. -->
          <UiPill v-if="row.late_sync" tone="warn">kasno sinhronizovano</UiPill>
        </td>
      </tr>
    </UiTable>

    <div v-if="hasMore" class="s-more">
      <UiButton variant="soft" :pending="loadingMore" @click="emit('more')">Učitaj još</UiButton>
    </div>
  </UiCard>
</template>

<style scoped>
.s-totals {
  margin: 0;
  font-size: 14px;
  color: var(--ink-2);
  font-variant-numeric: tabular-nums;
}

.s-quiet { color: var(--muted); margin: 0; }
td small.s-quiet { display: block; font-size: 12px; }

.s-more { display: flex; justify-content: center; }

td :deep(.a-pill + .a-pill) { margin-left: 6px; }

@media (max-width: 1023px) {
  .s-more :deep(.a-btn) { width: 100%; }

  /* A seven-column table cannot shrink into 390 px and stay readable, so below
     the breakpoint it keeps its natural width and `UiTable`'s own wrapper
     scrolls sideways. The page body still does not. */
  .s-wide-table :deep(.a-table) { min-width: 620px; }
  .s-wide-table :deep(td) { white-space: nowrap; }
  .s-wide-table :deep(td small) { white-space: normal; max-width: 220px; }
}
</style>
