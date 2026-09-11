<script setup lang="ts">
/**
 * One line of the drill-down, the way a phone draws it.
 *
 * The laptop gets seven columns — *Vrijeme · Sto · Stavka · Kol. · Iznos ·
 * Konobar · Status* — and at a desk that is exactly right: the owner is
 * scanning down the *Iznos* column for the round he does not recognise. On a
 * 390 px screen the same seven columns could not shrink and stay readable, so
 * the table kept its natural width and the card scrolled sideways under a
 * scrollbar. That is the same box the *Smjene* list stopped being.
 *
 * So below 1024 px a line is a row of its own:
 *
 * - **what was sold and what it cost**, on the first line, because that is the
 *   pair every other number on the dashboard is built out of;
 * - the flavours and the waiter's note under the name, where they belong to it;
 * - **when, which table, who** as one quiet sentence — three columns that are
 *   each too short to deserve a line;
 * - the status as a mark, on every row rather than only the unusual ones: a
 *   *storno* and a *naplaćeno* differ by nothing else on the row, and that
 *   difference is the whole reason somebody opened this screen.
 *
 * The quantity appears only when it is not one. "1 kom" on nineteen rows out of
 * twenty is a column of noise around the one row that says 4.
 */
import { LINE_STATUS_WORDS } from './smjenaLogic'
import type { LineRow } from '#shared/types'

const props = defineProps<{ row: LineRow }>()

const status = computed(() => LINE_STATUS_WORDS[props.row.status])

/** "20:41 · Sto 9 · Dino" — the three short columns as one muted sentence. */
const meta = computed(() => [
  timeBs(props.row.at),
  props.row.table_name,
  props.row.locked_by_name,
].filter(Boolean).join(' · '))
</script>

<template>
  <article class="s-line">
    <span class="s-what">
      <span class="s-name">{{ row.name_snapshot }}</span>
      <span v-if="row.flavour_names.length" class="s-sub">{{ row.flavour_names.join(' + ') }}</span>
      <span v-if="row.note" class="s-sub">{{ row.note }}</span>
    </span>

    <span class="s-amount">
      <UiMoney :fen="row.charged_fen" :colour="false" />
      <span v-if="row.qty !== 1" class="s-qty num">{{ row.qty }} kom</span>
    </span>

    <span class="s-marks">
      <UiPill :tone="status.tone">{{ status.word }}</UiPill>
      <!-- A round the phone held in its outbox: rung up at `at`, arrived later.
           The lag is why a total can move after somebody read it. -->
      <UiPill v-if="row.late_sync" tone="warn">kasno sinhronizovano</UiPill>
      <span class="s-meta num">{{ meta }}</span>
    </span>
  </article>
</template>

<style scoped>
.s-line {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: baseline;
  gap: 4px 10px;
  /* No side padding: the card it sits in already has its own, and a rule that
     stops short of the card's edge is the shape every other list of rows on
     this page uses. */
  padding: 12px 0;
  border-bottom: 1px solid var(--line-soft);
}

.s-line:last-child { border-bottom: 0; }

.s-what { display: flex; flex-direction: column; gap: 2px; min-width: 0; }

.s-name {
  font-size: var(--text-body);
  font-weight: 600;
  line-height: 1.3;
  color: var(--ink);
}

.s-sub { font-size: var(--text-micro); color: var(--muted); }

.s-amount {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  font-size: var(--text-body);
  font-weight: 600;
  color: var(--ink);
  white-space: nowrap;
}

.s-qty { font-size: var(--text-micro); font-weight: 500; color: var(--muted); }

/* The marks run under both columns, so a long list of flavours never squeezes
   the pill into two letters and a hyphen. */
.s-marks {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
  min-width: 0;
  margin-top: 2px;
}

.s-meta { font-size: var(--text-micro); color: var(--muted); }
</style>
