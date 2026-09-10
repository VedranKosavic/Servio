<script setup lang="ts">
/**
 * The phone's week — one card per day, one row per template. `/a`, light kit.
 *
 * Same data as `RasporedGrid`, same `weekCells()` behind it, different shape:
 * a seven-column grid on a 390 px screen is a sideways scroll and a mis-tap, so
 * the phone reads a week the way a person says it — Monday, then Tuesday.
 *
 * **Two taps per person**, the same budget as the laptop's two clicks: `+`, then
 * a name in the sheet that stays open.
 */
import type { RosterCell } from '~/composables/useRoster'
import type { Assignment, RosterWeekView } from '#shared/types'

const props = defineProps<{
  week: RosterWeekView
  rows: RosterCell[][]
  today: string
}>()

const emit = defineEmits<{
  add: [workDate: string, templateId: string]
  open: [person: Assignment]
}>()

const shown = ref(new Set<string>())
const key = (cell: RosterCell) => `${cell.work_date}|${cell.template.id}`

function toggle(cell: RosterCell) {
  const next = new Set(shown.value)
  if (!next.delete(key(cell))) next.add(key(cell))
  shown.value = next
}

/** The same cells, re-cut day-first: seven cards, each with its templates. */
const cards = computed(() => props.week.days.map((day, d) => ({
  work_date: day.work_date,
  cells: props.rows.map(row => row[d]!).filter(Boolean),
})))
</script>

<template>
  <div class="r-days">
    <section
      v-for="card in cards"
      :key="card.work_date"
      class="r-day"
      :class="{ now: card.work_date === today }"
    >
      <h3>{{ dayLabelBs(card.work_date) }}</h3>

      <p v-if="!card.cells.length" class="r-empty">
        Nema nijednog šablona smjene.
      </p>

      <div v-for="cell in card.cells" :key="cell.template.id" class="r-row">
        <div class="r-tpl">
          <span>{{ cell.template.name }}</span>
          <small>{{ templateSpanBs(cell.template, cell.people) }}</small>
        </div>

        <div class="r-people">
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
      </div>
    </section>
  </div>
</template>

<style scoped>
/* The laptop gets `RasporedGrid` instead. */
.r-days { display: none; }

@media (max-width: 1023px) {
  .r-days { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
}

.r-day {
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.r-day.now { border-color: var(--accent); }

.r-day h3 { margin: 0; font-size: 15px; font-weight: 700; }

.r-row { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.r-row + .r-row { border-top: 1px solid var(--line); padding-top: 10px; }

.r-tpl { display: flex; align-items: baseline; gap: 8px; }
.r-tpl span { font-weight: 600; font-size: 14px; }
.r-tpl small { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }

.r-people { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }

.r-add {
  width: 44px;
  height: 44px;
  border-radius: 22px;
  border: 1px dashed var(--line);
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.r-fold {
  border: 0;
  background: transparent;
  padding: 0 4px;
  min-height: 44px;
  font: inherit;
  font-size: 13px;
  color: var(--muted);
  text-decoration: underline;
  cursor: pointer;
}

.r-empty { margin: 0; color: var(--muted); font-size: 14px; }
</style>
