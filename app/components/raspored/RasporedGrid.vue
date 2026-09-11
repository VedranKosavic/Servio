<script setup lang="ts">
/**
 * The laptop grid — templates down, days across. `/admin`, light kit.
 *
 * Sticky on two edges: the day header stays while the templates scroll, and the
 * template column stays while the week scrolls sideways. Without both, a café
 * with four templates and a wide week loses track of which row it is reading.
 *
 * **Two clicks per person**: the `+` in a cell, then a name. The picker stays
 * open, so a second name is one more click and not another round trip.
 *
 * `removed` rows are behind a "N uklonjeno" toggle rather than gone: after a
 * week is published, taking somebody off leaves a `removed` row on purpose —
 * the phones have already seen the name, and the owner should be able to see
 * what he took away.
 */
import type { RosterCell } from '~/composables/useRoster'
import type { Assignment, RosterWeekView } from '#shared/types'

const props = defineProps<{
  week: RosterWeekView
  rows: RosterCell[][]
  /** The café's business date, so "today" is not the laptop's midnight. */
  today: string
}>()

const emit = defineEmits<{
  add: [workDate: string, templateId: string]
  open: [person: Assignment]
}>()

/** Which cells have their `removed` rows unfolded. Keyed `date|template`. */
const shown = ref(new Set<string>())
const key = (cell: RosterCell) => `${cell.work_date}|${cell.template.id}`

function toggle(cell: RosterCell) {
  const next = new Set(shown.value)
  if (!next.delete(key(cell))) next.add(key(cell))
  shown.value = next
}

const days = computed(() => props.week.days.map(d => d.work_date))
</script>

<template>
  <div class="r-wrap">
    <table class="r-grid">
      <thead>
        <tr>
          <th class="r-corner">Smjena</th>
          <th v-for="date in days" :key="date" :class="{ now: date === today }">
            {{ dayLabelBs(date) }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(cells, i) in rows" :key="week.templates[i]!.id">
          <th class="r-tpl">
            <span>{{ week.templates[i]!.name }}</span>
            <small>{{ templateSpanBs(week.templates[i]!, cells.flatMap(c => c.people)) }}</small>
          </th>

          <td v-for="cell in cells" :key="key(cell)" :class="{ now: cell.work_date === today }">
            <div class="r-cell">
              <RasporedChip
                v-for="person in cell.people"
                :key="person.id"
                :person="person"
                :template="cell.template"
                @open="emit('open', person)"
              />

              <template v-if="cell.removed.length">
                <button
                  type="button" class="r-fold"
                  @click="toggle(cell)"
                >{{ cell.removed.length }} uklonjeno</button>
                <RasporedChip
                  v-for="person in (shown.has(key(cell)) ? cell.removed : [])"
                  :key="person.id"
                  :person="person"
                  :template="cell.template"
                  @open="emit('open', person)"
                />
              </template>

              <button
                type="button"
                class="r-add"
                :aria-label="`Dodaj u ${cell.template.name}, ${dayLabelBs(cell.work_date)}`"
                @click="emit('add', cell.work_date, cell.template.id)"
              >+</button>
            </div>
          </td>
        </tr>

        <tr v-if="!rows.length">
          <td :colspan="8" class="r-empty">
            Nema nijednog šablona smjene.
            <NuxtLink to="/admin/postavke/sabloni" class="r-empty-link">Napravi šablon</NuxtLink>
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

/* `--tap` on both axes: 32 px was a mouse-only target, and DESIGN §3 puts the
   dashboard's 44 px floor under anything inline in a dense row too. */
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

.r-fold {
  border: 0;
  background: transparent;
  padding: 0;
  font: inherit;
  font-size: var(--text-caption);
  color: var(--muted);
  text-decoration: underline;
  cursor: pointer;
}

.r-empty { color: var(--muted); }

/* The phone gets `RasporedPhoneWeek` instead — a day strip and one day open
   under it, so a week fits a 390 px screen without a sideways scroll. */
@media (max-width: 1023px) {
  .r-wrap { display: none; }
}

.r-empty-link {
  display: inline-block;
  margin-left: 4px;
  color: var(--accent-ink);
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>
