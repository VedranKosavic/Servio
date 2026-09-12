<script setup lang="ts">
/**
 * *Ko radi* — today's plan, with tonight's fact laid over the shift that is
 * running.
 *
 * **It reads from *Raspored*, not from who has signed on.** The card used to be
 * `live.who` alone, which is the list of people who have PIN-ed in and rung
 * something up. That answered "who is ringing things up" and not "who is
 * working today": at ten in the morning it was empty, and on an evening nobody
 * had opened a shift it was empty too, on a screen whose whole job is to say
 * what the café is doing. The owner's words: *ko radi should be automatically
 * shown by the raspored for that day*.
 *
 * So the rows are the plan, and the live list is folded into the running shift:
 * a planned person who has signed on is ordinary, one who has not carries
 * *nije prijavljen*, and somebody working whom the plan does not have is added
 * as *van rasporeda* — because a card called *Ko radi* that does not name a
 * person standing behind the bar is wrong. `whoShifts()` in `app/utils/puls.ts`
 * is where that fold lives, and it is a pure function under test.
 *
 * Every shift of the day gets a group, the running one first. A shift that is
 * not running is plan and nothing else: there is no fact to compare it against.
 *
 * **No money per person here.** The card says who is on, not who took what:
 * per-person figures live on *Smjena*, one screen further in, and CLAUDE.md is
 * explicit that the dashboard is accountability rather than a scoreboard. The
 * same rule is why *nije prijavljen* is a word and not a warning colour — the
 * card reports, the person reading it judges (PLAN §8).
 */
import type { WhoShift, WhoState } from '~/utils/puls'

const props = defineProps<{ shifts: WhoShift[] }>()

/** How many people are actually behind the bar — the number beside the title. */
const working = computed(() => props.shifts
  .filter(shift => shift.running)
  .reduce((n, shift) =>
    n + shift.rows.filter(row => row.state === 'radi' || row.state === 'van-rasporeda').length, 0))

/** The plan for the whole day, which is what the count means when none is running. */
const planned = computed(() => props.shifts
  .reduce((n, shift) => n + shift.rows.length, 0))

const count = computed(() => {
  if (!props.shifts.length) return undefined
  const running = props.shifts.some(shift => shift.running)
  return running ? `${working.value}` : `${planned.value}`
})

/**
 * A state's tone. `bolest` and `odsutan` are the two holes in tonight's plan and
 * are the only ones that get a colour; the rest are words.
 */
function tone(state: WhoState): 'warn' | 'neutral' {
  return state === 'bolest' || state === 'odsutan' ? 'warn' : 'neutral'
}
</script>

<template>
  <UiCard title="Ko radi" :count="count">
    <div v-for="shift in shifts" :key="shift.template_id" class="a-who-shift">
      <div class="a-who-head">
        <span class="a-who-when">{{ shift.name }}</span>
        <span class="a-who-hours num">{{ shift.hours }}</span>
        <UiPill v-if="shift.running" tone="accent">u toku</UiPill>
      </div>

      <ul v-if="shift.rows.length" class="a-who">
        <li v-for="person in shift.rows" :key="person.user_id" class="a-who-row">
          <span class="avatar avatar-sm" aria-hidden="true">{{ person.initials }}</span>
          <span class="a-who-name" :class="{ off: person.state === 'bolest' || person.state === 'odsutan' }">
            {{ person.name }}
          </span>
          <UiPill v-if="person.settled" tone="good">predao</UiPill>
          <UiPill v-else-if="whoStateBs(person.state)" :tone="tone(person.state)">
            {{ whoStateBs(person.state) }}
          </UiPill>
        </li>
      </ul>

      <p v-else class="a-who-none">Niko nije u rasporedu za ovu smjenu.</p>
    </div>

    <p v-if="!shifts.length" class="a-who-none">
      Raspored za danas je prazan.
    </p>
  </UiCard>
</template>

<style scoped>
/* One group per shift. The gap is the card body's own, so two shifts read as
   two blocks without a rule between them — the eyebrow is what separates them. */
.a-who-shift { display: flex; flex-direction: column; gap: 2px; min-width: 0; }

.a-who-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.a-who-when {
  font-size: var(--text-caption);
  text-transform: uppercase;
  letter-spacing: 0.11em;
  font-weight: 600;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.a-who-hours { font-size: var(--text-caption); color: var(--muted); }

/* The pill sits on the baseline of an uppercase caption, which is too high for
   it — it is a box, not a word. */
.a-who-head :deep(.a-pill) { align-self: center; }

.a-who { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }

.a-who-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 4px 0;
  border-bottom: 1px solid var(--line-soft);
  min-width: 0;
}

.a-who-row:last-child { border-bottom: 0; }

.a-who-name {
  flex-grow: 1;
  min-width: 0;
  font-size: var(--text-body);
  font-weight: 500;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Somebody who is not coming. The name stays legible — this is a plan with a
   hole in it, not a deleted row — but it stops competing with the people who
   are actually on. */
.a-who-name.off { color: var(--muted); }

.a-who-none { margin: 0; color: var(--muted); font-size: var(--text-label); }
</style>
