<script setup lang="ts">
/**
 * The 92 px stat tile across the top of *Puls* and *Smjena*.
 *
 * `value` is 30 px / 600 and **tabular** — every digit the same width, so a row
 * of tiles lines up on the comma and 1.284,00 does not jump about when it
 * becomes 1.290,00.
 */
withDefaults(defineProps<{
  /** The eyebrow: "Promet danas". */
  label: string
  /** Already formatted — this component never formats money itself. */
  value: string | number
  /** The quiet second line: "7 stolova · 145,50 KM". */
  sub?: string
  tone?: 'plain' | 'good' | 'warn' | 'bad'
}>(), { tone: 'plain' })
</script>

<template>
  <div class="a-tile" :class="`t-${tone}`">
    <div class="a-tile-label">{{ label }}</div>
    <div class="a-tile-value"><slot name="value">{{ value }}</slot></div>
    <div v-if="sub || $slots.sub" class="a-tile-sub"><slot name="sub">{{ sub }}</slot></div>
  </div>
</template>

<style scoped>
.a-tile {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 92px;
  min-width: 0;
}

.a-tile-label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
  font-weight: 600;
}

.a-tile-value {
  font-size: 30px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
  letter-spacing: -0.01em;
}

.a-tile-sub {
  font-size: 13px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.t-good .a-tile-value { color: var(--good); }
.t-warn .a-tile-value { color: var(--warn); }
.t-bad .a-tile-value { color: var(--danger); }

/* On a phone the tiles stack two-up and the number can come down a size. */
@media (max-width: 1023px) {
  .a-tile { min-height: 84px; padding: 12px 14px; }
  .a-tile-value { font-size: 26px; }
}
</style>
