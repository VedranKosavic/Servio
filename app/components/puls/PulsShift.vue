<script setup lang="ts">
/**
 * The one number the owner opens the app for: what the café has taken on the
 * shift that is running, and which shift that is.
 *
 * **The figure is the loudest thing on the screen** — `--text-display` in the
 * display face, which DESIGN §1 reserves for the wordmark and a hero number,
 * and this is the hero number. The unit sits beside it at label size rather
 * than on a line of its own, because "1.250,50" with "KM" underneath reads as
 * two facts and it is one.
 *
 * **It is the shift's promet, not the day's.** `promet_danas_fen` sums every
 * shift on the business date, which on a day the *Dnevna* worked is a different
 * number from the one the evening is taking; `shiftPrometFen()` folds
 * `live.who`, whose rows the server refuses to write unless they add up to the
 * shift's promet exactly.
 *
 * **With no shift open it says so and draws nothing.** A dashboard that prints
 * `0,00 KM` at four in the afternoon is indistinguishable from one whose café
 * has taken nothing all evening, and the owner reads this screen to know which
 * of those it is.
 */
import type { ShiftBrief } from '#shared/types'
import type { ShiftNaming } from '~/utils/puls'

const props = defineProps<{
  /** Null unless a shift is `open` or `closing` — the server's own rule. */
  shift: ShiftBrief | null
  prometFen: number
  /** Which of the venue's shift templates this is; null while they load. */
  naming: ShiftNaming | null
}>()

/** The shift's own word — *Večernja* — or what it is doing when it is closing. */
const pill = computed(() => {
  if (props.shift?.closing) return shiftLineBs('closing', props.shift.closer_name)
  return props.naming?.name ?? shiftLineBs('open', null)
})

const pillTone = computed<'accent' | 'warn'>(() => (props.shift?.closing ? 'warn' : 'accent'))

/** "druga smjena · 16–01" — the owner asks for the shift by its number. */
const sub = computed(() => (props.naming
  ? `${props.naming.ordinal_bs} · ${props.naming.hours}`
  : ''))
</script>

<template>
  <UiCard>
    <div v-if="shift" class="a-block">
      <div class="a-top">
        <span class="a-eyebrow">Promet u smjeni</span>
        <UiPill :tone="pillTone">{{ pill }}</UiPill>
      </div>

      <p class="a-metric num">
        {{ signedAmount(prometFen) }}<span class="a-unit">KM</span>
      </p>

      <p v-if="sub" class="a-sub num">{{ sub }}</p>
    </div>

    <div v-else class="a-block">
      <span class="a-eyebrow">Smjena</span>
      <p class="a-none">Nema otvorene smjene</p>
      <p class="a-sub">Promet se prikazuje čim neko otvori smjenu.</p>
    </div>
  </UiCard>
</template>

<style scoped>
/* The eyebrow, the figure and its line are one block, so they sit tighter than
   the 12 px the card puts between the things it holds. */
.a-block { display: flex; flex-direction: column; gap: 4px; min-width: 0; }

.a-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.a-eyebrow {
  font-size: var(--text-caption);
  line-height: 1.3;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--muted);
  font-weight: 600;
}

/* The hero. `--text-display` is the one step above the tile metric and the only
   place on the dashboard it is used — there is one number this screen is about
   and everything else on it is smaller. */
.a-metric {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 0;
  min-width: 0;
  font-family: var(--font-display);
  font-size: var(--text-display);
  line-height: 1.02;
  letter-spacing: -0.03em;
  font-weight: 700;
  color: var(--ink);
}

.a-unit {
  font-family: var(--font-sans);
  font-size: var(--text-section);
  font-weight: 600;
  letter-spacing: 0;
  color: var(--muted);
}

.a-sub {
  margin: 0;
  font-size: var(--text-micro);
  color: var(--muted);
}

/* No shift: a sentence where the figure would be, at the heading step. A
   dashboard drawing 0,00 KM here would be lying about a quiet evening. */
.a-none {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-section);
  font-weight: 600;
  color: var(--ink-2);
}
</style>
