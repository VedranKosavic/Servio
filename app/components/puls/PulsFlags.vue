<script setup lang="ts">
/**
 * The quiet half of *Zahtijeva pažnju*.
 *
 * **A flag has no buttons, and that is the whole design.** `attention[]` holds
 * rows a tap can clear — every one of them has a decide route behind it, so the
 * owner can always empty the list. A flag is *information*: a phone whose clock
 * is wrong, a shift closed an hour early, a count nobody opened. The server
 * derives them fresh on every read and they disappear by themselves when the
 * condition stops being true, so there is nothing to dismiss and no dismiss
 * control to render. A row nothing can clear is exactly what the two lists
 * exist to prevent.
 */
import type { Flag } from '#shared/types'

defineProps<{ flags: Flag[] }>()
</script>

<template>
  <div v-if="flags.length" class="a-flags">
    <p class="a-flags-note">
      <span class="a-flags-label">Za informaciju</span>
      <span>nestaje samo od sebe kad uslov prestane</span>
    </p>
    <div v-for="flag in flags" :key="flagKey(flag)" class="a-flag">
      <span class="a-flag-dot" aria-hidden="true" />
      <span class="a-flag-title">{{ flag.title_bs }}</span>
      <small>{{ timeBs(flag.at) }}</small>
    </div>
  </div>
</template>

<style scoped>
/* The quiet half sits in a well, one step *down* the surface ladder from the
   decisions above it: same card, visibly not the same job. */
.a-flags {
  display: flex;
  flex-direction: column;
  margin-top: 14px;
  padding: 4px 14px 8px;
  border-radius: var(--radius-field);
  background: var(--surface-2);
}

.a-flags-note {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 10px 0 4px;
  font-size: var(--text-micro);
  color: var(--muted);
}

.a-flags-label {
  font-size: var(--text-caption);
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--ink-2);
}

.a-flag {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 8px 0;
  color: var(--ink-2);
  font-size: var(--text-label);
  border-top: 1px solid var(--line-soft);
}

.a-flag-dot {
  flex-shrink: 0;
  width: 5px;
  height: 5px;
  border-radius: var(--radius-chip);
  background: var(--muted);
  transform: translateY(-2px);
}

.a-flag-title { flex-grow: 1; min-width: 0; }

.a-flag small {
  color: var(--muted);
  font-size: var(--text-micro);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

@media (max-width: 1023px) {
  .a-flag { padding: 11px 0; }
}
</style>
