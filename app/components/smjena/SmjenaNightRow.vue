<script setup lang="ts">
/**
 * One night on *Smjene*, the way a phone draws it.
 *
 * The laptop gets a six-column table and should: *Datum · Status · Otvorena —
 * zatvorena · Pazar · Razlika*, eight nights compared down a column at a desk.
 * In a hand that same table was a 390 px box cut off at the right edge with a
 * scrollbar under it — and the two columns over the edge were the pazar and the
 * razlika, which are the only reason the owner opened the screen.
 *
 * So below 1024 px the row stops being a table row and becomes the question it
 * answers: **which night, how much came in, and did the cash match.**
 *
 * - The date leads on the left, with its weekday, because a night is "petak"
 *   before it is "11.09.".
 * - The pazar leads on the right at a size nothing else on the row has.
 * - **The status is a mark**, not a column — and it is on every row rather than
 *   only on the unusual ones, because a missing pill would have to mean
 *   *zatvorena* and a meaning carried by an absence is a meaning nobody reads.
 * - The clock is the quietest thing here. A night that is still running says
 *   only when it started; the pill beside it already says *otvorena*, and
 *   printing "— u toku" as well is the same fact twice.
 *
 * **The razlika is not restyled.** It is `UiMoney` exactly as the table cell
 * always was: a shortfall in `--danger` and nothing more — no tint behind it,
 * no badge, no size of its own. PLAN §8 is the reason. A drawer difference is a
 * number the owner reads before he knows what it is, and inventing a louder
 * treatment for it would turn a screen he checks into a screen that accuses.
 * A night with no counted cash shows nothing there rather than an em dash: the
 * pill already says why, and a column of dashes is noise in a list.
 */
import { shiftStatusPill } from './smjenaLogic'
import type { OwnerShiftRow } from '#shared/types'

const props = defineProps<{ row: OwnerShiftRow }>()

const pill = computed(() => shiftStatusPill(props.row.status))

/** "18:03 – 00:42" for a night that ended, "od 18:03" for one still running. */
const clock = computed(() => props.row.closed_at
  ? `${timeBs(props.row.opened_at)} – ${timeBs(props.row.closed_at)}`
  : `od ${timeBs(props.row.opened_at)}`)
</script>

<template>
  <NuxtLink class="s-row" :to="`/admin/smjena/${row.id}`">
    <span class="s-when">
      <span class="s-date">{{ weekdayBs(row.business_date) }} {{ dateBs(row.business_date) }}</span>
      <span class="s-marks">
        <UiPill :tone="pill.tone">{{ pill.word }}</UiPill>
        <span class="s-clock num">{{ clock }}</span>
      </span>
    </span>

    <span class="s-nums">
      <UiMoney class="s-pazar" :fen="row.promet_fen" :colour="false" />
      <span v-if="row.diff_fen !== null" class="s-diff">
        <span class="s-diff-label">razlika</span>
        <UiMoney :fen="row.diff_fen" :currency="false" />
      </span>
    </span>

    <UiIcon class="s-chev" name="chevron-right" :size="20" />
  </NuxtLink>
</template>

<style scoped>
/* which night · what it made · the way in */
.s-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  min-height: var(--tap);
  padding: 12px 8px 12px 16px;
  border-bottom: 1px solid var(--line-soft);
  color: var(--ink);
  text-decoration: none;
  transition: background var(--dur-fast) var(--ease-standard);
}

.s-row:last-child { border-bottom: 0; }
.s-row:hover { background: var(--surface-3); }
.s-row:active { background: var(--surface-2); }
.s-row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

.s-when { display: flex; flex-direction: column; gap: 4px; min-width: 0; }

.s-date {
  font-size: var(--text-body);
  font-weight: 600;
  line-height: 1.25;
  white-space: nowrap;
}

.s-marks { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; min-width: 0; }

.s-clock { font-size: var(--text-micro); color: var(--muted); }

/* The amounts are their own column, right-aligned, so the commas line up down
   the list the way they did down the table. */
.s-nums {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  min-width: 0;
}

.s-pazar {
  font-size: var(--text-section);
  font-weight: 700;
  line-height: 1.2;
  color: var(--ink);
}

.s-diff {
  display: flex;
  align-items: baseline;
  gap: 5px;
  font-size: var(--text-micro);
}

.s-diff-label { color: var(--muted); }

.s-chev { flex-shrink: 0; color: var(--muted); }
</style>
