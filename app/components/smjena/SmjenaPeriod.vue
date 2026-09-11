<script setup lang="ts">
/**
 * The period on *Smjene*, the way a phone draws it.
 *
 * `UiPeriod` is six chips — *Danas*, *Jučer*, *Ova sedmica*, *Prošla sedmica*,
 * *Ovaj mjesec*, *Prilagođeno* — and at 390 px they wrap onto two rows and
 * spend a third of the screen before the first shift appears. Six choices is
 * also more than the question has: the owner opens this screen for last night
 * or for the week he is in, and reaches for the rest a few times a month.
 *
 * So the phone gets **one row: an arrow, the period, an arrow.** The arrows are
 * the common move — the night before this one, the week before this one — and
 * the middle is a button that opens the full list, *Prilagođeno* and its two
 * dates included. Three targets instead of six, all of them `--tap`, and the
 * row never wraps because its middle column takes whatever is left.
 *
 * **Nothing about the URL changes.** Every path through this control ends in
 * `useAdminPeriod`'s own `setPeriod` / `setCustom`, so the period still lives
 * in the route query as `?period=` or `?from&to`, a reloaded tab comes back on
 * it and a link the owner sends himself opens on it. The stepping rules — a
 * week steps to a whole week, a month to a whole month, and a range that has a
 * preset's name is written under that name — are in `periodStep.ts`, where they
 * can be tested without mounting anything.
 *
 * The laptop keeps `UiPeriod`: six chips fit in one row at a desk, and a filter
 * that looks the same on *Puls*, *Roba* and *Izvoz* is worth more there than a
 * control of this page's own.
 */
import { canStepForward, stepPeriod } from './periodStep'
import type { PeriodKey } from '~/composables/useAdminPeriod'

/**
 * The same default `UiPeriod` builds, so the two instances of the composable
 * read one URL and can never disagree about which chip is on.
 */
const period = useAdminPeriod()

const open = ref(false)

/** The two date fields, seeded from the range and applied on *Primijeni*. */
const from = ref(period.range.value.from)
const to = ref(period.range.value.to)

watch(period.range, (next) => {
  from.value = next.from
  to.value = next.to
})

/** The word on the button: the preset's own label, or *Prilagođeno*. */
const name = computed(() =>
  PERIOD_OPTIONS.find(option => option.key === period.key.value)?.label ?? 'Period')

/**
 * The dates under it, which are the fact the word is shorthand for.
 *
 * One night carries its weekday, because "pet 11.09.2026." is how the owner
 * says which night he is looking at and "11.09.2026." is a date he has to
 * count back to.
 */
const dates = computed(() => {
  const { from: start, to: end } = period.range.value
  return start === end
    ? `${weekdayBs(start)} ${dateBs(start)}`
    : `${dateBs(start)} – ${dateBs(end)}`
})

const forward = computed(() => canStepForward(period.range.value, period.today.value))

function step(direction: -1 | 1) {
  const move = stepPeriod(period.key.value, period.range.value, direction, period.today.value)
  if (move.kind === 'preset') period.setPeriod(move.key)
  else period.setCustom(move.from, move.to)
}

/**
 * *Prilagođeno* is the one option that does not close the sheet: picking it is
 * asking for the two fields, and the period does not change until they are
 * applied.
 */
function choose(key: PeriodKey) {
  period.setPeriod(key)
  if (key !== 'prilagodjeno') open.value = false
}

function applyCustom() {
  if (!from.value || !to.value) return
  period.setCustom(from.value, to.value)
  open.value = false
}
</script>

<template>
  <div class="s-period">
    <button
      type="button"
      class="s-step"
      aria-label="Period prije ovog"
      @click="step(-1)"
    >
      <svg
        width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
      ><path d="M15 6l-6 6 6 6" /></svg>
    </button>

    <button type="button" class="s-pick" @click="open = true">
      <span class="s-name">{{ name }}</span>
      <span class="s-dates num">{{ dates }}</span>
    </button>

    <button
      type="button"
      class="s-step"
      :disabled="!forward"
      aria-label="Period poslije ovog"
      @click="step(1)"
    >
      <svg
        width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
      ><path d="M9 6l6 6-6 6" /></svg>
    </button>

    <UiSheet :open="open" title="Period" @close="open = false">
      <div class="s-opts">
        <button
          v-for="option in PERIOD_OPTIONS"
          :key="option.key"
          type="button"
          class="s-opt"
          :class="{ on: option.key === period.key.value }"
          :aria-pressed="option.key === period.key.value"
          @click="choose(option.key)"
        >
          <span>{{ option.label }}</span>
          <UiIcon v-if="option.key === period.key.value" name="check" :size="20" />
        </button>
      </div>

      <div v-if="period.key.value === 'prilagodjeno'" class="s-custom">
        <UiField v-model="from" label="Od" kind="date" />
        <UiField v-model="to" label="Do" kind="date" />
        <UiButton variant="primary" @click="applyCustom">Primijeni</UiButton>
      </div>
    </UiSheet>
  </div>
</template>

<style scoped>
/* The middle takes what is left, so the row is one row at any width and the
   two arrows keep their thumb-sized boxes. */
.s-period {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: stretch;
  gap: 6px;
  min-width: 0;
}

.s-step {
  width: var(--tap);
  min-height: var(--tap);
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--line);
  border-radius: var(--radius-field);
  background: var(--surface);
  color: var(--ink-2);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-standard),
    border-color var(--dur-fast) var(--ease-standard);
}

.s-step:hover:not(:disabled) { background: var(--surface-3); border-color: var(--muted); }
.s-step:active:not(:disabled) { background: var(--surface-2); }
.s-step:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

/* There is no tomorrow in a list of nights that have happened. */
.s-step:disabled { opacity: 0.35; cursor: default; }

/* The period reads as the label it is, not as a third button competing with
   the two arrows: a well on the page's own ground, with the copper kept for
   the one primary action a screen is allowed. */
.s-pick {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1px;
  min-width: 0;
  min-height: var(--tap);
  padding: 4px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-field);
  background: var(--surface);
  font: inherit;
  color: var(--ink);
  text-align: center;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}

.s-pick:hover { background: var(--surface-3); }
.s-pick:active { background: var(--surface-2); }
.s-pick:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

.s-name {
  font-size: var(--text-body);
  font-weight: 600;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.s-dates {
  font-size: var(--text-micro);
  color: var(--muted);
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- the sheet --------------------------------------------------------- */

.s-opts { display: flex; flex-direction: column; }

.s-opt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  min-height: var(--tap);
  padding: 10px 4px;
  border: 0;
  border-bottom: 1px solid var(--line-soft);
  background: transparent;
  font: inherit;
  font-size: var(--text-body);
  color: var(--ink);
  text-align: left;
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-standard);
}

.s-opt:last-child { border-bottom: 0; }
.s-opt:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.s-opt.on { color: var(--accent-text); font-weight: 600; }

.s-custom {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 4px;
}
</style>
