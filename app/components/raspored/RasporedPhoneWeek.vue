<script setup lang="ts">
/**
 * The phone's week — seven weekday chips, and the chosen weekday underneath.
 * `/admin`, light kit. Below 1024 px only; the laptop keeps `RasporedGrid`.
 *
 * **The strip is the week**: seven columns, each one the weekday (no date — the
 * pattern repeats every week) and who is on it in initials, one line per shift
 * in the template's own order. With at most two people per shift every group
 * fits its line, so a thin Tuesday and a full Saturday are visible without
 * reading a word. **The panel under it is the day**: full names, the shift's
 * hours, and the `+` while a shift has room.
 *
 * Today's weekday is marked, on the café's business day: at 01:30 on Saturday
 * the owner is still working Friday.
 */
import { WEEKDAYS, weekdayLongBs, weekdayShortBs } from '#shared/dates'
import { dayCells, timeSpanBs } from '~/composables/useRoster'
import type { PatternEntry, RosterPatternView } from '#shared/types'

const props = defineProps<{
  view: RosterPatternView
  /** Today's ISO weekday on the café's business day. */
  today: number
}>()

const emit = defineEmits<{
  add: [weekday: number, templateId: string]
  open: [person: PatternEntry]
}>()

const days = computed(() => WEEKDAYS.map((weekday) => {
  const cells = dayCells(props.view, weekday)
  return {
    weekday,
    short: weekdayShortBs(weekday),
    long: weekdayLongBs(weekday),
    isToday: weekday === props.today,
    cells,
    count: cells.reduce((total, cell) => total + cell.people.length, 0),
  }
}))

/** The weekday in the panel: today's to start with. */
const picked = ref(props.today)

const day = computed(() => days.value.find(d => d.weekday === picked.value) ?? days.value[0]!)

/** The whole column in one sentence, because the initials are `aria-hidden`. */
function dayAria(entry: typeof days.value[number]): string {
  const state = entry.isToday ? ', danas' : ''
  const who = entry.count === 0 ? ', nema nikoga' : `, ${entry.count} na smjeni`
  return `${entry.long}${state}${who}`
}
</script>

<template>
  <div class="r-phone">
    <div class="r-strip" role="group" aria-label="Dani u sedmici">
      <button
        v-for="entry in days"
        :key="entry.weekday"
        type="button"
        class="r-col"
        :class="{ now: entry.isToday, on: entry.weekday === picked }"
        :aria-pressed="entry.weekday === picked"
        :aria-label="dayAria(entry)"
        @click="picked = entry.weekday"
      >
        <span class="r-wd" aria-hidden="true">{{ entry.short }}</span>

        <span class="r-mini" aria-hidden="true">
          <span v-for="cell in entry.cells" :key="cell.template.id" class="r-grp">
            <span v-if="!cell.people.length" class="r-nobody">–</span>
            <span
              v-for="person in cell.people"
              :key="person.id"
              class="r-ini"
              :title="person.user_name"
            >{{ person.user_initials }}</span>
          </span>
        </span>
      </button>
    </div>

    <section class="r-detail">
      <header class="r-dayhead">
        <h3>{{ day.long }}</h3>
        <UiPill v-if="day.isToday" tone="accent">danas</UiPill>
      </header>

      <p v-if="!day.cells.length" class="r-empty">
        Nema nijednog šablona smjene.
      </p>

      <div v-for="cell in day.cells" :key="cell.template.id" class="r-row">
        <div class="r-tpl">
          <span>{{ cell.template.name }}</span>
          <small class="num">{{ timeSpanBs(cell.template.start_time, cell.template.end_time) }}</small>
        </div>

        <div class="r-people">
          <RasporedChip
            v-for="person in cell.people"
            :key="person.id"
            :person="person"
            @open="emit('open', person)"
          />

          <p v-if="!cell.people.length" class="r-nobody-row">Niko nije na ovoj smjeni.</p>

          <button
            v-if="!cell.full"
            type="button"
            class="r-add"
            :aria-label="`Dodaj u ${cell.template.name}, ${day.long}`"
            @click="emit('add', cell.weekday, cell.template.id)"
          >
            <span aria-hidden="true">+</span>
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* The laptop gets `RasporedGrid` instead; this whole screen is below 1024 px. */
.r-phone { display: none; }

@media (max-width: 1023px) {
  .r-phone { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
}

/* ---- the strip -------------------------------------------------------- */

/* Seven equal columns and no scroller. `minmax(0, 1fr)`: a column whose initials
   are wider than its share must shrink, never push the page sideways. */
.r-strip {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 2px;
  padding: 4px;
  border-radius: var(--radius-card);
  border: 1px solid var(--line);
  background: var(--bg-2);
  min-width: 0;
}

.r-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-height: var(--tap);
  min-width: 0;
  padding: 7px 1px;
  border: 1px solid transparent;
  border-radius: var(--radius-field);
  background: transparent;
  font: inherit;
  color: var(--ink);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-standard),
    border-color var(--dur-fast) var(--ease-standard);
}

.r-wd {
  font-size: var(--text-label);
  font-weight: 700;
  text-transform: lowercase;
  color: var(--ink-2);
}

/* Today, in the one colour this screen already uses for it on the laptop grid. */
.r-col.now .r-wd { color: var(--accent-text); }

/* The chosen day is a step up the surface ladder plus a border — DESIGN §3,
   depth is material. Copper stays reserved for the primary action. */
.r-col.on {
  background: var(--surface);
  border-color: var(--line);
  box-shadow: var(--shadow-card);
}

.r-col.now.on { border-color: var(--accent-line); }

/* ---- the initials inside a column ------------------------------------- */

.r-mini {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  width: 100%;
  min-width: 0;
}

/* One group per template, always in the same order, so the second line of every
   column is the same shift and the week reads down as well as across. */
.r-grp {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  width: 100%;
  min-width: 0;
}

.r-grp + .r-grp { border-top: 1px solid var(--line-soft); padding-top: 3px; }

.r-ini {
  max-width: 100%;
  overflow: hidden;
  padding: 0 2px;
  border-radius: var(--radius-chip);
  background: var(--surface-2);
  font-size: var(--text-caption);
  font-weight: 600;
  color: var(--ink-2);
}

/* An empty shift is information — the owner is looking for exactly this. */
.r-nobody { font-size: var(--text-caption); color: var(--muted); }

/* ---- the day under the strip ------------------------------------------ */

.r-detail {
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--surface);
  box-shadow: var(--shadow-card);
  padding: 12px 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.r-dayhead { display: flex; align-items: center; gap: 8px; min-width: 0; }
.r-dayhead h3 { margin: 0; font-size: var(--text-section); font-weight: 700; }

.r-row { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.r-row + .r-row { border-top: 1px solid var(--line-soft); padding-top: 10px; }

.r-tpl { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.r-tpl span { font-weight: 600; font-size: var(--text-label); }
.r-tpl small { color: var(--muted); font-size: var(--text-caption); }

.r-people { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }

.r-add {
  width: var(--tap);
  height: var(--tap);
  border-radius: var(--radius-chip);
  border: 1px dashed var(--line);
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: var(--text-title);
  line-height: 1;
  cursor: pointer;
}

.r-add:hover { border-color: var(--accent); color: var(--accent); }

.r-empty { margin: 0; color: var(--muted); font-size: var(--text-label); }
.r-nobody-row { margin: 0; color: var(--muted); font-size: var(--text-micro); }
</style>
