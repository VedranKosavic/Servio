<script setup lang="ts">
/**
 * The phone's week — a seven-day strip, and the chosen day underneath.
 * `/admin`, light kit. Below 1024 px only; the laptop keeps `RasporedGrid`.
 *
 * **What this replaces and why.** The phone used to draw the week as seven
 * stacked cards. A 390 px screen fits about two and a half of them, so the owner
 * could never *see a week* — he scrolled through one day at a time and had to
 * hold the other six in his head. The grid the laptop uses is the right idea and
 * the wrong shape: seven columns wide enough for a name is a sideways scroll and
 * a mis-tap.
 *
 * So the week splits in two. **The strip is the week**: seven columns, each one
 * the weekday, the date and who is on it in initials, grouped by template in the
 * template's own order — dense enough that a thin Tuesday and a heavy Saturday
 * are visible without reading a word. **The panel under it is the day**: full
 * names, the template's hours, and the `+` that opens the picker. One tap moves
 * between days, and nothing scrolls to do it.
 *
 * **What the strip is allowed to say.** It is an index, not a statement, so it
 * never leans on colour alone (DESIGN §2): a person who is off sick or did not
 * come is **struck through** and a person whose shift is out for swap has a
 * **dashed** edge — a shape in both cases, with the tint only reinforcing it.
 * Two initials have no room for a word, so the word lives where the decision
 * is: one tap down, on `RasporedChip` in the panel, which spells *bolestan* and
 * *zamjena* out in full. Each initial also carries it as a `title`, and the day
 * button's accessible name carries the date and the head count.
 *
 * **Today is the café's business date**, passed down from the page: at 01:30 the
 * owner is still working Friday and Friday is still the day the strip marks.
 */
import { weekdayBs } from '#shared/dates'
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

/**
 * A 49 px column holds two of these and no more, and the second one becomes
 * "+N" as soon as there is a third person — so **every group is exactly one
 * line**, in every column, whatever the day. That is what makes the strip read
 * as a pattern: the second line of every column is the same shift, at the same
 * height, and a thin Tuesday is visible without reading it. The names it cannot
 * fit are one tap away in the panel, which is where they are acted on.
 */
const STRIP_SLOTS = 2

/** The week, day-first: the strip reads across these, the panel reads one. */
const days = computed(() => props.week.days.map((day, index) => {
  const cells = props.rows.map(row => row[index]!).filter(Boolean)
  return {
    work_date: day.work_date,
    weekday: weekdayBs(day.work_date),
    /** Just the day of the month — the strip has no room for the year. */
    dayOfMonth: day.work_date.slice(8, 10),
    isToday: day.work_date === props.today,
    past: day.work_date < props.today,
    cells,
    /** One group per template, in template order, so a column reads positionally. */
    groups: cells.map((cell) => {
      const fits = cell.people.length <= STRIP_SLOTS
      const shown = fits ? cell.people : cell.people.slice(0, STRIP_SLOTS - 1)
      return {
        template_id: cell.template.id,
        shown,
        more: cell.people.length - shown.length,
      }
    }),
    count: cells.reduce((total, cell) => total + cell.people.length, 0),
  }
}))

/**
 * The day in the panel. Today when the week contains it, Monday otherwise —
 * opening next week on next Monday is what the owner means by "next week".
 */
const picked = ref('')

watch(days, (week) => {
  // Only when the week under the strip changed out from under the choice —
  // stepping to the next week, or the poll bringing a different one back.
  if (week.some(d => d.work_date === picked.value)) return
  picked.value = week.some(d => d.isToday)
    ? props.today
    : (week[0]?.work_date ?? '')
}, { immediate: true })

const day = computed(() => days.value.find(d => d.work_date === picked.value) ?? null)

/**
 * A day button's accessible name. The initials in it are `aria-hidden` — read
 * out one by one they are noise — so this is the whole column in one sentence:
 * which day, whether it is today, and how many people are on it.
 */
function dayAria(entry: typeof days.value[number]): string {
  const state = entry.isToday ? ', danas' : ''
  const who = entry.count === 0 ? ', nema nikoga' : `, ${entry.count} na smjeni`
  return `${dayLabelBs(entry.work_date)}${state}${who}`
}

function personAria(person: Assignment): string {
  if (person.swap_pending) return `${person.user_name} — zamjena`
  if (person.status !== 'planned') return `${person.user_name} — ${STATUS_BS[person.status]}`
  return person.user_name
}

const struck = (person: Assignment) =>
  person.status === 'sick' || person.status === 'absent'

/** `removed` rows stay folded away, exactly as they are on the laptop grid. */
const unfolded = ref(new Set<string>())
const key = (cell: RosterCell) => `${cell.work_date}|${cell.template.id}`

function toggle(cell: RosterCell) {
  const next = new Set(unfolded.value)
  if (!next.delete(key(cell))) next.add(key(cell))
  unfolded.value = next
}
</script>

<template>
  <div class="r-phone">
    <div class="r-strip" role="group" aria-label="Dani u sedmici">
      <button
        v-for="entry in days"
        :key="entry.work_date"
        type="button"
        class="r-col"
        :class="{ now: entry.isToday, past: entry.past, on: entry.work_date === picked }"
        :aria-pressed="entry.work_date === picked"
        :aria-label="dayAria(entry)"
        @click="picked = entry.work_date"
      >
        <span class="r-wd" aria-hidden="true">{{ entry.weekday }}</span>
        <span class="r-dm num" aria-hidden="true">{{ entry.dayOfMonth }}</span>

        <span class="r-mini" aria-hidden="true">
          <span v-for="group in entry.groups" :key="group.template_id" class="r-grp">
            <span v-if="!group.shown.length" class="r-nobody">–</span>
            <span
              v-for="person in group.shown"
              :key="person.id"
              class="r-ini"
              :class="{ struck: struck(person), swap: person.swap_pending }"
              :title="personAria(person)"
            >{{ person.user_initials }}</span>
            <span v-if="group.more" class="r-ini r-more">+{{ group.more }}</span>
          </span>
        </span>
      </button>
    </div>

    <section v-if="day" class="r-detail">
      <header class="r-dayhead">
        <h3>{{ dayLabelBs(day.work_date) }}</h3>
        <UiPill v-if="day.isToday" tone="accent">danas</UiPill>
        <UiPill v-else-if="day.past" tone="neutral">prošlo</UiPill>
      </header>

      <p v-if="!day.cells.length" class="r-empty">
        Nema nijednog šablona smjene.
            <NuxtLink to="/admin/postavke/sabloni" class="r-empty-link">Napravi šablon</NuxtLink>
      </p>

      <div v-for="cell in day.cells" :key="cell.template.id" class="r-row">
        <div class="r-tpl">
          <span>{{ cell.template.name }}</span>
          <small class="num">{{ templateSpanBs(cell.template, cell.people) }}</small>
        </div>

        <div class="r-people">
          <RasporedChip
            v-for="person in cell.people"
            :key="person.id"
            :person="person"
            :template="cell.template"
            @open="emit('open', person)"
          />

          <p v-if="!cell.people.length" class="r-nobody-row">Niko nije na ovoj smjeni.</p>

          <template v-if="cell.removed.length">
            <button
              type="button" class="r-fold"
              @click="toggle(cell)"
            >{{ cell.removed.length }} uklonjeno</button>
            <RasporedChip
              v-for="person in (unfolded.has(key(cell)) ? cell.removed : [])"
              :key="person.id"
              :person="person"
              :template="cell.template"
              @open="emit('open', person)"
            />
          </template>

          <!-- No `+` on a day already worked: the server refuses it
               (`409 ROSTER_LOCKED`), and a button that cannot work is worse
               than no button. The sentence under the panel says why. -->
          <button
            v-if="!day.past"
            type="button"
            class="r-add"
            :aria-label="`Dodaj u ${cell.template.name}, ${dayLabelBs(cell.work_date)}`"
            @click="emit('add', cell.work_date, cell.template.id)"
          >
            <span aria-hidden="true">+</span>
          </button>
        </div>
      </div>

      <p v-if="day.past" class="r-quiet">
        Prošli dan se ne mijenja — ostaje zapisano ko je bio na rasporedu.
      </p>
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

/**
 * Seven equal columns and no scroller. `minmax(0, 1fr)` rather than `1fr`: a
 * column whose initials are wider than its share must shrink and wrap, never
 * push the page sideways.
 */
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
  gap: 3px;
  /* Far past `--tap` on the short axis; the column is the target, not the date. */
  min-height: var(--tap);
  min-width: 0;
  padding: 6px 1px 7px;
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
  font-size: var(--text-caption);
  font-weight: 600;
  text-transform: lowercase;
  color: var(--muted);
}

.r-dm {
  font-size: var(--text-body);
  font-weight: 700;
  line-height: 1.1;
}

/* A day already worked recedes: it is history, and the owner is planning. */
.r-col.past .r-dm { color: var(--muted); font-weight: 600; }
.r-col.past .r-mini { opacity: 0.6; }

/* Today, in the one colour this screen already uses for it on the laptop grid. */
.r-col.now .r-wd,
.r-col.now .r-dm { color: var(--accent-text); }

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

/* One group per template, always in the same order and always one line high, so
   the second line of every column is the same shift and the week reads down as
   well as across. `nowrap` holds that line: `STRIP_SLOTS` is what keeps the
   content inside it. */
.r-grp {
  display: flex;
  flex-wrap: nowrap;
  justify-content: center;
  gap: 2px;
  width: 100%;
  min-width: 0;
}

.r-grp + .r-grp { border-top: 1px solid var(--line-soft); padding-top: 3px; }

.r-ini {
  padding: 0 2px;
  border: 1px solid transparent;
  border-radius: var(--radius-chip);
  background: var(--surface-2);
  font-size: var(--text-caption);
  letter-spacing: 0;
  font-weight: 600;
  color: var(--ink-2);
}

/* Struck through, not merely tinted: shape carries the meaning and the colour
   only reinforces it, so the strip survives a colour-blind reading. */
.r-ini.struck {
  text-decoration: line-through;
  background: var(--danger-soft);
  color: var(--danger);
}

/* Dashed: a shift that is out for swap is not settled yet. */
.r-ini.swap {
  border-style: dashed;
  border-color: var(--warn);
  background: var(--warn-soft);
  color: var(--warn);
}

.r-more { background: transparent; color: var(--muted); }

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
.r-dayhead h3 {
  margin: 0;
  font-size: var(--text-section);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

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

.r-fold {
  border: 0;
  background: transparent;
  padding: 0 4px;
  min-height: var(--tap);
  font: inherit;
  font-size: var(--text-micro);
  color: var(--muted);
  text-decoration: underline;
  cursor: pointer;
}

.r-empty { margin: 0; color: var(--muted); font-size: var(--text-label); }
.r-nobody-row { margin: 0; color: var(--muted); font-size: var(--text-micro); }
.r-quiet { margin: 2px 0 0; color: var(--muted); font-size: var(--text-caption); line-height: 1.35; }

.r-empty-link {
  display: inline-block;
  margin-left: 4px;
  color: var(--accent-ink);
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>
