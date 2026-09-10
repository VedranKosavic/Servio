<script setup lang="ts">
/**
 * A 24 px status pill. Colour never carries the meaning by itself — the pill
 * always contains the **word** as well ("u toleranciji", "otvorena"), because a
 * colour-blind owner and a printed screenshot both have to read the same thing.
 */
withDefaults(defineProps<{
  tone?: 'good' | 'warn' | 'bad' | 'neutral' | 'accent'
}>(), { tone: 'neutral' })
</script>

<template>
  <span class="a-pill" :class="`t-${tone}`"><slot /></span>
</template>

<style scoped>
.a-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 9px;
  border-radius: var(--radius-chip);
  font-size: var(--text-caption);
  line-height: 1;
  letter-spacing: 0.01em;
  font-weight: 600;
  white-space: nowrap;
}

.t-good { background: var(--good-soft); color: var(--good); }
.t-warn { background: var(--warn-soft); color: var(--warn); }
.t-bad { background: var(--danger-soft); color: var(--danger); }
.t-neutral { background: var(--surface-2); color: var(--ink-2); }
.t-accent { background: var(--accent-soft); color: var(--accent-text); }
</style>
