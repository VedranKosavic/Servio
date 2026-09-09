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
    <p class="a-flags-note">Za informaciju — nestaje samo od sebe kad uslov prestane.</p>
    <div v-for="flag in flags" :key="flagKey(flag)" class="a-flag">
      <span class="a-flag-title">{{ flag.title_bs }}</span>
      <small>{{ timeBs(flag.at) }}</small>
    </div>
  </div>
</template>

<style scoped>
.a-flags {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 4px;
  border-top: 1px solid var(--surface-2);
}

.a-flags-note {
  margin: 6px 0 2px;
  font-size: 12px;
  color: var(--muted);
}

.a-flag {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 7px 0;
  color: var(--ink-2);
  font-size: 14px;
}

.a-flag-title { flex-grow: 1; min-width: 0; }

.a-flag small {
  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

@media (max-width: 1023px) {
  .a-flag { padding: 10px 0; }
}
</style>
