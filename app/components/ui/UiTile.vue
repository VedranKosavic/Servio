<script setup lang="ts">
/**
 * The stat tile across the top of *Puls*, *Smjena* and *Roba*.
 *
 * **The tile leads with the number.** The eyebrow above it is 12 px caps in
 * `--muted` and the line under it is 13 px — both are there to be read *after*
 * the figure, when the eye has already found the one thing the tile is about.
 * The value is the display face at `--text-metric` and **tabular**: every digit
 * the same width, so a row of tiles lines up on the comma and 1.284,00 does not
 * shuffle when it becomes 1.290,00.
 *
 * `unit` is the currency, set beside the number at label size rather than on a
 * line of its own — "86,00" with "KM" underneath it reads as two facts, and it
 * is one. A tile whose value is a count passes no unit.
 *
 * `tone` colours the number and nothing else, and it never carries the meaning
 * alone: a red figure always has a sub-line saying what is red about it.
 *
 * There is deliberately no slot for the value. A tile whose "figure" was a strip
 * of names dropped the metric size and the display face and took the row's
 * shared baseline with it; whatever is not a number belongs in `sub`.
 */
withDefaults(defineProps<{
  /** The eyebrow: "Promet danas". */
  label: string
  /** Already formatted — this component never formats money itself. */
  value: string | number
  /** "KM", beside the number. Omit for a count. */
  unit?: string
  /** The quiet second line: "7 stolova · 145,50 KM". */
  sub?: string
  tone?: 'plain' | 'good' | 'warn' | 'bad'
}>(), { tone: 'plain' })
</script>

<template>
  <div class="a-tile" :class="`t-${tone}`">
    <div class="a-tile-label">{{ label }}</div>
    <div class="a-tile-value">
      {{ value }}<span v-if="unit" class="a-tile-unit">{{ unit }}</span>
    </div>
    <div v-if="sub || $slots.sub" class="a-tile-sub"><slot name="sub">{{ sub }}</slot></div>
  </div>
</template>

<style scoped>
.a-tile {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  padding: 14px 16px 16px;
  display: flex;
  flex-direction: column;
  min-height: 104px;
  min-width: 0;
}

.a-tile-label {
  font-size: var(--text-caption);
  line-height: 1.3;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--muted);
  font-weight: 600;
  /* Two words of eyebrow must not push the number down a line on one tile and
     not on its neighbour — the row of figures has to sit on one baseline. */
  min-height: 32px;
}

.a-tile-value {
  display: flex;
  align-items: baseline;
  gap: 5px;
  min-width: 0;
  font-family: var(--font-display);
  font-size: var(--text-metric);
  line-height: 1.05;
  letter-spacing: -0.02em;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
}

.a-tile-unit {
  font-family: var(--font-sans);
  font-size: var(--text-label);
  font-weight: 600;
  letter-spacing: 0;
  color: var(--muted);
}

/* `auto`, not a gap: the row of figures has to sit on one baseline whether or
   not a given tile has a second line under it. */
.a-tile-sub {
  margin-top: auto;
  padding-top: 8px;
  font-size: var(--text-micro);
  line-height: 1.35;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.t-good .a-tile-value { color: var(--good); }
.t-warn .a-tile-value { color: var(--warn); }
.t-bad .a-tile-value { color: var(--danger); }

/* There is no escape hatch for a tile whose value is not a figure. *Ko radi*
   used one, and the result was the widest card in the row holding one word at
   body weight while the other five sat on a shared number baseline. A tile
   leads with the number; anything that is not one goes in `sub`. */

@media (max-width: 1023px) {
  .a-tile { min-height: 96px; padding: 12px 14px 14px; }
  .a-tile-label { min-height: 30px; }
}
</style>
