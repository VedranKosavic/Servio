<script setup lang="ts">
/**
 * The laptop grid — shift templates down, the seven weekdays across. `/admin`,
 * light kit. No dates: the week is a pattern that repeats.
 *
 * Sticky on two edges: the weekday header stays while the templates scroll, and
 * the template column stays while the week scrolls sideways.
 *
 * **Two clicks per person**: the `+` in a cell, then a name. The picker stays
 * open, so the second name is one more click. A cell with two people has no `+`
 * — the server would refuse a third (`409 SHIFT_FULL`).
 */
import { WEEKDAYS, weekdayLongBs } from '#shared/dates'
import { timeSpanBs, type PatternCell } from '~/composables/useRoster'
import type { PatternEntry, RosterPatternView } from '#shared/types'

const props = defineProps<{
  view: RosterPatternView
  cells: PatternCell[][]
  /** Today's ISO weekday on the café's business day. */
  today: number
}>()

const emit = defineEmits<{
  add: [weekday: number, templateId: string]
  open: [person: PatternEntry]
}>()
</script>

<template>
  <div class="r-wrap">
    <table class="r-grid">
      <thead>
        <tr>
          <th class="r-corner">Smjena</th>
          <th v-for="weekday in WEEKDAYS" :key="weekday" :class="{ now: weekday === props.today }">
            {{ weekdayLongBs(weekday) }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, i) in cells" :key="view.templates[i]!.id">
          <th class="r-tpl">
            <span>{{ view.templates[i]!.name }}</span>
            <small>{{ timeSpanBs(view.templates[i]!.start_time, view.templates[i]!.end_time) }}</small>
          </th>

          <td
            v-for="cell in row"
            :key="`${cell.weekday}|${cell.template.id}`"
            :class="{ now: cell.weekday === props.today }"
          >
            <div class="r-cell">
              <RasporedChip
                v-for="person in cell.people"
                :key="person.id"
                :person="person"
                @open="emit('open', person)"
              />

              <button
                v-if="!cell.full"
                type="button"
                class="r-add"
                :aria-label="`Dodaj u ${cell.template.name}, ${weekdayLongBs(cell.weekday)}`"
                @click="emit('add', cell.weekday, cell.template.id)"
              >+</button>
            </div>
          </td>
        </tr>

        <tr v-if="!cells.length">
          <td :colspan="8" class="r-empty">
            Nema nijednog šablona smjene.
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
/* The grid scrolls inside its own box; the page body never scrolls sideways.
   `contain: paint` stops Chromium adding the table's full width to the
   document's own scrollable overflow. */
.r-wrap { overflow-x: auto; contain: paint; min-width: 0; }

.r-grid { border-collapse: collapse; width: 100%; min-width: 900px; }

.r-grid th,
.r-grid td {
  border: 1px solid var(--line);
  padding: 8px;
  vertical-align: top;
  text-align: left;
}

.r-grid thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--surface-2);
  font-size: var(--text-micro);
  font-weight: 600;
  color: var(--ink-2);
  white-space: nowrap;
}

.r-grid thead th.now,
.r-grid td.now { background: var(--accent-soft); }

.r-corner,
.r-tpl {
  position: sticky;
  left: 0;
  z-index: 3;
  background: var(--surface-2);
  width: 150px;
  min-width: 150px;
}

.r-tpl { display: table-cell; }
.r-tpl span { display: block; font-weight: 600; }
.r-tpl small { display: block; color: var(--muted); font-size: var(--text-caption); font-variant-numeric: tabular-nums; }

.r-cell { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }

/* `--tap` on both axes: DESIGN §3 puts the dashboard's 44 px floor under
   anything inline in a dense row too. */
.r-add {
  width: var(--tap);
  height: var(--tap);
  border-radius: var(--radius-chip);
  border: 1px dashed var(--line);
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: var(--text-section);
  line-height: 1;
  cursor: pointer;
}

.r-add:hover { border-color: var(--accent); color: var(--accent); }

.r-empty { color: var(--muted); }

/* The phone gets `RasporedPhoneWeek` instead — a weekday strip and one day open
   under it, so a week fits a 390 px screen without a sideways scroll. */
@media (max-width: 1023px) {
  .r-wrap { display: none; }
}
</style>
