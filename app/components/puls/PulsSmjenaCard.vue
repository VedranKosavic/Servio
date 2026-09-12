<script setup lang="ts">
/**
 * One of the two shift cards at the top of *Puls*.
 *
 * The owner's words: *"instead of this 'nema otvorene smjene', we show 2 cards -
 * current shift and the current amount being updated live and next shift. If
 * there is no current shift (its night time), we show last shift (and amount)
 * and next shift."* So this component is one of that pair, and it is deliberately
 * the same object in both roles: the same eyebrow, name, hours and quiet line,
 * with or without a number in the middle.
 *
 * **The card never draws a number it cannot justify.** `fen` is `null` for a
 * shift that has no takings to report — the one that has not started, and the
 * one the café never opened — and then `empty` says so in a sentence where the
 * figure would be. `0,00 KM` at four in the morning is indistinguishable from a
 * night that took nothing, and the owner reads this screen to know which of those
 * it is.
 *
 * **`to` makes the whole card the target.** Tapping the shift that is running
 * opens what it has sold, which is the owner's third ask, and a card-sized target
 * is better than a link inside one — the foot row with the chevron is there to say
 * the card is tappable, not to be the only place a thumb may land.
 *
 * `NuxtLink` is imported from `#components` and switched as a **component, not a
 * name**: `<component is="NuxtLink">` renders a literal `<nuxtlink>` element,
 * which looks right on the screen and navigates nowhere, because a string `is`
 * is resolved against globally registered components and Nuxt's are
 * auto-imported rather than registered.
 */
import { NuxtLink } from '#components'
const props = withDefaults(defineProps<{
  /** "U toku", "Zadnja smjena", "Sljedeća smjena" — which of the two this is. */
  eyebrow: string
  /** The shift's own name from the roster: "Prva smjena". */
  title: string
  /** "07–15", the template's own hours. */
  hours: string
  /** The quiet line under it: "počinje sutra u 07:00", "pet 11.09.2026.". */
  note?: string
  /** "u toku", "zatvorena" — the state, in a word. */
  pill?: string
  pillTone?: 'accent' | 'warn' | 'neutral' | 'good'
  /** The takings, in feninga. `null` when there are none to report. */
  fen?: number | null
  /** What stands where the figure would be when there is none. */
  empty?: string
  /** Where tapping goes. Without it the card is not a target. */
  to?: string
  /** The foot row's words — the card says what is behind it. */
  action?: string
}>(), {
  note: '',
  pill: '',
  pillTone: 'neutral',
  fen: null,
  empty: '',
  to: '',
  action: '',
})

/** The formatted figure, or null — which is what draws `empty` instead. */
const money = computed(() =>
  (props.fen === null || props.fen === undefined ? null : signedAmount(props.fen)))

/** A link when there is somewhere to go, and a plain card when there is not. */
const tag = computed(() => (props.to ? NuxtLink : 'div'))
</script>

<template>
  <component :is="tag" :to="to || undefined" class="a-sc" :class="{ tap: !!to }">
    <div class="a-sc-top">
      <span class="a-sc-eyebrow">{{ eyebrow }}</span>
      <UiPill v-if="pill" :tone="pillTone">{{ pill }}</UiPill>
    </div>

    <h2 class="a-sc-title">
      {{ title }}<span class="a-sc-hours num">{{ hours }}</span>
    </h2>

    <p v-if="money" class="a-sc-metric num">
      {{ money }}<span class="a-sc-unit">KM</span>
    </p>
    <p v-else-if="empty" class="a-sc-empty">{{ empty }}</p>

    <p v-if="note" class="a-sc-note num">{{ note }}</p>

    <span v-if="to && action" class="a-sc-go">
      {{ action }}
      <UiIcon name="chevron-right" :size="16" />
    </span>
  </component>
</template>

<style scoped>
/**
 * The card is written here rather than wrapped around `UiCard`, because a
 * `NuxtLink` has to *be* the card for the whole card to be the target — and the
 * material is the kit's, token for token: `--surface`, one `--line`,
 * `--radius-card`, one hairline of contact shadow.
 */
.a-sc {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 14px 16px 16px;
  border-radius: var(--radius-card);
  border: 1px solid var(--line);
  background: var(--surface);
  box-shadow: var(--shadow-card);
  color: var(--ink);
  text-decoration: none;
}

.a-sc.tap {
  cursor: pointer;
  transition: box-shadow var(--dur-fast) var(--ease-standard);
}

.a-sc.tap:hover { box-shadow: var(--shadow-raise); }
.a-sc.tap:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.a-sc-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 22px;
}

.a-sc-eyebrow {
  font-size: var(--text-caption);
  line-height: 1.3;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--muted);
  font-weight: 600;
}

/* The shift's name at the card-heading step, with its hours beside it in the
   quiet colour — one line, because "Prva smjena" and "07–15" are one fact. */
.a-sc-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  margin: 0;
  font-size: var(--text-section);
  line-height: 1.3;
  letter-spacing: -0.005em;
  font-weight: 600;
}

.a-sc-hours {
  font-size: var(--text-label);
  font-weight: 500;
  color: var(--muted);
  letter-spacing: 0;
}

/**
 * The hero. `--text-display` is the one step above the tile metric and the only
 * place on the dashboard it is used: there is one number this screen is about
 * and everything else on it is smaller. The unit sits beside the figure at
 * heading size rather than on a line of its own — "1.250,50" with "KM" under it
 * reads as two facts, and it is one.
 */
.a-sc-metric {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 2px 0 0;
  min-width: 0;
  font-family: var(--font-display);
  font-size: var(--text-display);
  line-height: 1.02;
  letter-spacing: -0.03em;
  font-weight: 700;
  color: var(--ink);
}

.a-sc-unit {
  font-family: var(--font-sans);
  font-size: var(--text-section);
  font-weight: 600;
  letter-spacing: 0;
  color: var(--muted);
}

/* No number: a sentence at the heading step where the figure would be. */
.a-sc-empty {
  margin: 2px 0 0;
  font-family: var(--font-display);
  font-size: var(--text-section);
  font-weight: 600;
  color: var(--ink-2);
}

.a-sc-note {
  margin: 2px 0 0;
  font-size: var(--text-micro);
  color: var(--muted);
}

/* The foot row says what the card opens. `--tap` tall, so it is a comfortable
   target of its own inside a card that is already one. */
.a-sc-go {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-top: auto;
  padding-top: 8px;
  min-height: 28px;
  color: var(--accent-text);
  font-size: var(--text-label);
  font-weight: 600;
}
</style>
