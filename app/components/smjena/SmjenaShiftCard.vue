<script setup lang="ts">
/**
 * One shift of a day on *Smjene* — one of the two cards under a date.
 *
 * The card answers three things and stops: **which shift, how much it made, and
 * did the cash match.** The date is not on it, because the day's heading above
 * already said it once for both cards.
 *
 * - The slot leads: *Prva smjena* / *Druga smjena*, the words the café uses.
 * - **The status is a mark**, on every worked card and not only on the unusual
 *   ones: a missing pill would have to mean *zatvorena*, and a meaning carried
 *   by an absence is a meaning nobody reads.
 * - The clock is the quietest thing here, and it is the **real** one — a shift
 *   opened at 16:00 sits in the 15:00–23:00 slot and prints "16:00 – 02:00", so
 *   the slot is never a claim about hours nobody worked. A shift still running
 *   says only when it started; the pill beside it already says *otvorena*.
 * - The pazar leads on the right at a size nothing else on the card has.
 *
 * **A slot nobody worked is not a shift that took 0,00 KM**, and the two must
 * never read alike. So it is a dashed card with **no amount on it at all** — the
 * `.empty` treatment DESIGN §4 keeps for something that is missing — carrying
 * the template's nominal window and the words *nije radila*. Printing 0,00 there
 * would be the screen inventing a night.
 *
 * **The razlika is not restyled.** It is `UiMoney` exactly as the old table cell
 * was: a shortfall in `--danger` and nothing else — no tint behind it, no badge,
 * no size of its own. PLAN §8 is the reason. A drawer difference is a number the
 * owner reads before he knows what it is, and inventing a louder treatment for
 * it turns a screen he checks into a screen that accuses. A shift with no
 * counted cash shows nothing there rather than an em dash: the pill already says
 * why, and a column of dashes is noise in a list.
 */
import { shiftStatusPill } from './smjenaLogic'
import type { DayShiftSlot } from './smjeneDays'

/**
 * Not called `slot`: `slot` is a reserved attribute name in a Vue template, and
 * a prop bound as `:slot="…"` would be read as the old named-slot syntax.
 */
const props = defineProps<{ shiftSlot: DayShiftSlot }>()

const pill = computed(() =>
  (props.shiftSlot.shift ? shiftStatusPill(props.shiftSlot.shift.status) : null))

/** "16:00 – 02:00" for a shift that ended, "od 16:00" for one still running. */
const clock = computed(() => {
  const shift = props.shiftSlot.shift
  if (shift) {
    return shift.closed_at
      ? `${timeBs(shift.opened_at)} – ${timeBs(shift.closed_at)}`
      : `od ${timeBs(shift.opened_at)}`
  }
  // The slot's own window, which is the only clock an unworked one has.
  const { start_time: start, end_time: end } = props.shiftSlot
  return start && end ? `${start} – ${end}` : ''
})
</script>

<template>
  <NuxtLink
    v-if="shiftSlot.shift"
    class="s-card"
    :to="`/admin/smjena/${shiftSlot.shift.id}`"
  >
    <span class="s-what">
      <span class="s-name">{{ shiftSlot.name }}</span>
      <span class="s-marks">
        <UiPill v-if="pill" :tone="pill.tone">{{ pill.word }}</UiPill>
        <span v-if="clock" class="s-clock num">{{ clock }}</span>
      </span>
    </span>

    <span class="s-nums">
      <UiMoney class="s-pazar" :fen="shiftSlot.shift.promet_fen" :colour="false" />
      <span v-if="shiftSlot.shift.diff_fen !== null" class="s-diff">
        <span class="s-diff-label">razlika</span>
        <UiMoney :fen="shiftSlot.shift.diff_fen" :currency="false" />
      </span>
    </span>

    <UiIcon class="s-chev" name="chevron-right" :size="20" />
  </NuxtLink>

  <!-- Worked by nobody: dashed, and with no number on it anywhere. -->
  <div v-else class="s-card s-off">
    <span class="s-what">
      <span class="s-name">{{ shiftSlot.name }}</span>
      <span v-if="clock" class="s-clock num">{{ clock }}</span>
    </span>
    <span class="s-none">nije radila</span>
  </div>
</template>

<style scoped>
/* which shift · what it made · the way in */
.s-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  min-height: var(--tap);
  padding: 12px 10px 12px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--surface);
  box-shadow: var(--shadow-card);
  color: var(--ink);
  text-decoration: none;
  transition:
    background var(--dur-fast) var(--ease-standard),
    border-color var(--dur-fast) var(--ease-standard);
}

a.s-card:hover { background: var(--surface-2); border-color: var(--muted); }
a.s-card:active { background: var(--surface-3); }
a.s-card:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

.s-what { display: flex; flex-direction: column; gap: 4px; min-width: 0; }

.s-name {
  font-size: var(--text-section);
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.005em;
}

.s-marks { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; min-width: 0; }

.s-clock { font-size: var(--text-micro); color: var(--muted); }

/* The amounts are their own column, right-aligned, so the commas line up down
   the day's two cards and down the days under each other. */
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

/* ---- a slot nobody worked --------------------------------------------- */

/* Dashed and quiet, and structurally not the same object as a worked card: no
   chevron, nothing to tap, and no amount — "nije radila" is the whole content
   on the right, where a pazar would have been. */
.s-off {
  grid-template-columns: minmax(0, 1fr) auto;
  border-style: dashed;
  background: transparent;
  box-shadow: none;
  color: var(--muted);
}

.s-off .s-name { color: var(--ink-2); font-weight: 500; }

.s-none {
  font-size: var(--text-label);
  color: var(--muted);
  white-space: nowrap;
}
</style>
