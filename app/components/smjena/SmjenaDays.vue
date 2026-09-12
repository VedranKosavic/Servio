<script setup lang="ts">
/**
 * *Smjene* — the period as a list of days, at both widths.
 *
 * This used to be a laptop table of one row per shift and a phone list beside
 * it, and the café does not work in rows: it works **two shifts a day**. So the
 * unit on the screen is the day, `SmjenaDay` draws one, and the same structure
 * serves both widths — a phone stacks the day's cards, a laptop puts the date in
 * a left-hand column with the two shifts side by side, which is the down-a-column
 * comparison the table existed for.
 *
 * The head is **sticky and carries the period's total**, the same shape *Meni*
 * and *Osoblje* use for their group heads with the one addition that matters
 * here: the owner's question is "how did the shifts go", and the answer is a
 * single number that must not scroll away after two days. It sits on `--bg`, the
 * page's own ground and opaque, so the days pass cleanly underneath it. `top: 0`
 * is the top of the viewport — the dashboard's phone layout puts its tab bar at
 * the **bottom**, and the laptop's rail is beside the page, so there is nothing
 * up there to sit under.
 *
 * The total is the sum of the shifts the read returned, and every one of them is
 * on exactly one card below (`smjeneDays.ts`), so the number at the top and the
 * numbers under it can never stop agreeing.
 *
 * Nothing here is wider than the screen, so the page body never scrolls sideways.
 */
import type { ShiftDay } from './smjeneDays'

defineProps<{
  /** The days in the period, newest first. */
  days: ShiftDay[]
  /** How many shifts they hold — the count beside the heading. */
  shifts: number
  /** The first read has not landed: draw bars, not an empty screen. */
  loading: boolean
  /** What the period adds up to, in feninga. The page computes it, not this. */
  total: number
}>()
</script>

<template>
  <div class="s-list">
    <h2 class="s-head">
      <span class="s-head-name">Smjene</span>
      <span class="s-head-n num">{{ shifts }}</span>
      <span class="s-head-total">
        <span class="s-head-label">Ukupno</span>
        <UiMoney class="s-head-value" :fen="total" :colour="false" />
      </span>
    </h2>

    <!-- Bars, not a spinner over stale takings — a day's shape, twice. -->
    <div v-if="loading" class="s-skel" aria-hidden="true">
      <div v-for="n in 2" :key="n" class="s-skel-day">
        <span class="s-skel-bar date" />
        <div class="s-skel-cards">
          <span v-for="c in 2" :key="c" class="s-skel-card" />
        </div>
      </div>
    </div>

    <template v-else-if="days.length">
      <SmjenaDay v-for="day in days" :key="day.business_date" :day="day" />
    </template>

    <p v-else class="s-empty">U ovom periodu nema nijedne smjene.</p>
  </div>
</template>

<style scoped>
.s-list { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

.s-head {
  position: sticky;
  top: 0;
  z-index: 2;
  margin: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-height: var(--tap);
  padding: 10px 2px 7px;
  background: var(--bg);
  font-size: var(--text-section);
  font-weight: 600;
  letter-spacing: -0.005em;
  color: var(--ink);
}

.s-head-n { font-size: var(--text-label); font-weight: 500; color: var(--muted); }

.s-head-total {
  margin-left: auto;
  display: inline-flex;
  align-items: baseline;
  gap: 7px;
  min-width: 0;
}

.s-head-label {
  font-size: var(--text-caption);
  letter-spacing: 0.09em;
  text-transform: uppercase;
  font-weight: 600;
  color: var(--muted);
}

/* The period's total in the sans face, not the display one: it is a column of
   digits that has to stay tabular (DESIGN §1), and Bricolage is the face for
   words. */
.s-head-value {
  font-size: var(--text-section);
  font-weight: 700;
  color: var(--ink);
}

/* ---- the skeleton ------------------------------------------------------ */

.s-skel { display: flex; flex-direction: column; gap: 16px; }
.s-skel-day { display: flex; flex-direction: column; gap: 8px; }

.s-skel-bar {
  display: block;
  height: 10px;
  border-radius: var(--radius-chip);
  background: var(--surface-2);
}

.s-skel-bar.date { width: 120px; margin: 0 2px; }

.s-skel-cards { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }

.s-skel-card {
  display: block;
  height: 68px;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--surface);
}

.s-empty {
  margin: 0;
  padding: 22px 16px;
  border: 1px dashed var(--line);
  border-radius: var(--radius-card);
  color: var(--muted);
  font-size: var(--text-body);
  text-align: center;
}

@media (min-width: 700px) {
  .s-skel-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
}

/* A hairline between the days, so a laptop reads them as the rows they are. */
@media (min-width: 1024px) {
  .s-list { gap: 4px; }

  .s-list :deep(.s-day + .s-day) {
    border-top: 1px solid var(--line-soft);
    padding-top: 8px;
  }

  .s-skel-day { display: grid; grid-template-columns: 172px minmax(0, 1fr); gap: 16px; }
  .s-skel-bar.date { margin-top: 12px; }
}
</style>
