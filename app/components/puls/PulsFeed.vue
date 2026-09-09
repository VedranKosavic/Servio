<script setup lang="ts">
/**
 * *Zadnje stavke* — the last twenty lines rung up tonight, newest first.
 *
 * The one place on the dashboard where the owner watches the bar rather than
 * reads a report, so it is deliberately plain: time, who, what, how much. A
 * storno is red and says *storno*; a gratis is amber and says *gratis* — the
 * colour is never the only thing carrying the meaning, because half the point
 * of the row is that somebody can read it out over the phone.
 */
import type { LineRow } from '#shared/types'

defineProps<{ rows: LineRow[] }>()
</script>

<template>
  <UiCard title="Zadnje stavke" :count="rows.length || undefined">
    <div v-if="rows.length" class="a-feed">
      <div
        v-for="row in rows"
        :key="row.line_id"
        class="a-feed-row"
        :class="`f-${feedTone(row.status)}`"
      >
        <span class="a-feed-time">{{ timeBs(row.at) }}</span>
        <span class="a-feed-who">{{ row.locked_by_name }}</span>
        <span class="a-feed-what">
          {{ feedTitle(row) }}
          <em v-if="feedMark(row)">· {{ feedMark(row) }}</em>
          <em v-if="row.note" class="a-feed-note">· {{ row.note }}</em>
          <em v-if="row.late_sync" class="a-feed-note">· kasno sinhronizovano</em>
        </span>
        <UiMoney class="a-feed-amt" :fen="feedAmountFen(row)" :currency="false" :colour="false" />
      </div>
    </div>

    <!-- The empty state is the sentence the spec fixes word for word: it is the
         first thing the owner sees on a laptop opened before the café fills. -->
    <p v-else class="a-feed-empty">
      Još nema narudžbi večeras — prvi sto se pojavi ovdje čim ga konobar zaključi.
    </p>
  </UiCard>
</template>

<style scoped>
.a-feed { display: flex; flex-direction: column; }

.a-feed-row {
  display: flex;
  gap: 10px;
  padding: 6px 0;
  font-size: 13px;
  border-bottom: 1px solid var(--surface-2);
  align-items: center;
}

.a-feed-row:last-child { border-bottom: 0; }

.a-feed-time {
  color: var(--muted);
  width: 44px;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.a-feed-who {
  width: 52px;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.a-feed-what {
  flex-grow: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.a-feed-what em { font-style: normal; color: var(--muted); }

.a-feed-amt { margin-left: auto; flex-shrink: 0; }

/* Only the item and its amount take the colour; the time and the name stay
   readable. The status word beside the item is what actually says which it is. */
.f-void .a-feed-what, .f-void .a-feed-what em, .f-void .a-feed-amt { color: var(--danger); }
.f-comp .a-feed-what, .f-comp .a-feed-what em, .f-comp .a-feed-amt { color: var(--warn); }

.a-feed-what em.a-feed-note { color: var(--muted); }

.a-feed-empty { margin: 0; color: var(--muted); font-size: 14px; }

@media (max-width: 1023px) {
  .a-feed-row { padding: 10px 0; font-size: 14px; }
  .a-feed-who { width: 46px; }
}
</style>
