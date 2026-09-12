<script setup lang="ts">
/**
 * One day on *Smjene*: the date, and the day's shifts as cards under it.
 *
 * The café runs two shifts, so a day is **a heading and two cards** — first and
 * second — and the date is written once for both instead of on every row. What
 * the heading carries besides the date is the day's pazar, which is the one
 * number the old flat list had per day and the owner still reads first; the sum
 * of these is the period total at the top of the page, because every shift the
 * read returned is on exactly one card here.
 *
 * **Two layouts, one component.** On a phone the heading sits above its two
 * stacked cards. From 700 px the two cards go side by side, and from 1024 px the
 * heading becomes a left-hand column — so a laptop reads down a column of dates
 * with *Prva* always in the same place and *Druga* beside it, which is the
 * comparison the old table was for. Nothing here is wider than its column at any
 * width, so the page never scrolls sideways.
 *
 * A shift that matched no template window takes a card of its own after the two
 * and spans the width of both, because it is not one of the day's slots and
 * lining it up under one of them would say that it was.
 */
import type { ShiftDay } from './smjeneDays'

defineProps<{ day: ShiftDay }>()
</script>

<template>
  <section class="s-day">
    <h3 class="s-day-head">
      <span class="s-day-date">{{ weekdayBs(day.business_date) }} {{ dateBs(day.business_date) }}</span>
      <span class="s-day-sum">
        <span class="s-day-label">pazar</span>
        <UiMoney class="s-day-value" :fen="day.promet_fen" :colour="false" />
      </span>
    </h3>

    <div class="s-day-cards">
      <SmjenaShiftCard
        v-for="slot in day.slots"
        :key="slot.key"
        :shift-slot="slot"
        :class="{ 's-wide': !slot.start_time }"
      />
    </div>
  </section>
</template>

<style scoped>
.s-day { display: flex; flex-direction: column; gap: 8px; min-width: 0; }

.s-day-head {
  margin: 0;
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
  padding: 2px 2px 0;
}

.s-day-date {
  font-size: var(--text-section);
  font-weight: 600;
  letter-spacing: -0.005em;
  color: var(--ink);
  white-space: nowrap;
}

.s-day-sum {
  margin-left: auto;
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.s-day-label {
  font-size: var(--text-caption);
  letter-spacing: 0.09em;
  text-transform: uppercase;
  font-weight: 600;
  color: var(--muted);
}

/* The day's own total in the sans face: it is a column of digits that has to
   stay tabular (DESIGN §1), and Bricolage is the face for words. */
.s-day-value { font-size: var(--text-body); font-weight: 600; color: var(--ink-2); }

.s-day-cards { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; min-width: 0; }

/* Two across as soon as two fit — a big phone in landscape and every tablet. */
@media (min-width: 700px) {
  .s-day-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  /* Not one of the day's slots, so it sits under both instead of beside one. */
  .s-wide { grid-column: 1 / -1; }
}

/* The laptop: the date is a column of its own and the cards are the row. */
@media (min-width: 1024px) {
  .s-day {
    display: grid;
    grid-template-columns: 172px minmax(0, 1fr);
    align-items: start;
    gap: 16px;
  }

  .s-day-head {
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 10px 0 0;
  }

  .s-day-sum { margin-left: 0; }
}
</style>
