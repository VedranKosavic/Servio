<script setup lang="ts">
/**
 * *Stavke* — the rows behind a number.
 *
 * This is the component that makes every other figure on `/admin` checkable: a
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
 *
 * **Two layouts, one page of rows.** Seven columns is right at a desk and
 * impossible in a hand: below 1024 px this table used to keep its natural
 * 620 px width and scroll sideways inside the card, which put the *Iznos*
 * column over the edge on the one screen whose job is showing amounts. So the
 * phone gets a list (`SmjenaLineRow`) instead, and nothing on the screen is
 * wider than the screen.
 *
 * **`useMounted` is not optional.** `useMediaQuery` answers truthfully from the
 * first client render, and the server — which has no viewport — always says the
 * laptop; without the gate the two renders disagree and Vue throws the server's
 * markup away with a hydration mismatch.
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

/** The dashboard's own breakpoint — the width `admin.css` changes density at. */
const mounted = useMounted()
const narrow = useMediaQuery('(max-width: 1023px)')
const isPhone = computed(() => mounted.value && narrow.value)

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

    <!-- ---- the phone ------------------------------------------------- -->
    <div v-else-if="isPhone" class="s-rows">
      <div v-if="loading" class="s-skel" aria-hidden="true">
        <div v-for="n in 4" :key="n" class="s-skel-row">
          <span class="s-skel-bar wide" />
          <span class="s-skel-bar" />
        </div>
      </div>
      <template v-else>
        <SmjenaLineRow v-for="row in rows" :key="row.line_id" :row="row" />
      </template>
    </div>

    <!-- ---- the laptop ------------------------------------------------ -->
    <UiTable v-else :columns="columns" :loading="loading">
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
  font-size: var(--text-label);
  color: var(--ink-2);
  font-variant-numeric: tabular-nums;
}

.s-quiet { color: var(--muted); margin: 0; }
td small.s-quiet { display: block; font-size: var(--text-caption); }

.s-more { display: flex; justify-content: center; }

td :deep(.a-pill + .a-pill) { margin-left: 6px; }

/* ---- the phone list ----------------------------------------------------- */

.s-rows { display: flex; flex-direction: column; min-width: 0; }

/* Bars, not a spinner over stale rows — the same shape `UiTable` draws. */
.s-skel-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 0;
  border-bottom: 1px solid var(--line-soft);
}

.s-skel-row:last-child { border-bottom: 0; }

.s-skel-bar {
  display: block;
  height: 10px;
  width: 72px;
  border-radius: var(--radius-chip);
  background: var(--surface-2);
}

.s-skel-bar.wide { width: 45%; }

@media (max-width: 1023px) {
  .s-more :deep(.a-btn) { width: 100%; }
}
</style>
