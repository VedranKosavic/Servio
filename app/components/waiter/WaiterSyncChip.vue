<script setup lang="ts">
/**
 * The one chip in every `/k` and `/s` header. Always visible, never a spinner.
 *
 * Colour **and** icon **and** word, because a chip that only changed colour is
 * no chip at all in a dark corner of the terrace. Red says the network is gone
 * and the rounds are safe; it does not say anything is broken, and it blocks
 * nothing (PLAN §10, invariant 5).
 */
/**
 * `compact` is for a header that already carries a title and an amount — the
 * *Sto N* screen at 390 px, where the full red sentence pushes the table name
 * out of the bar. It keeps the colour, the icon and the number, and the whole
 * sentence stays on the screen's `aria-label` and on *Stolovi*, where the
 * waiter starts and ends every round.
 */
withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })

const { state, label, pending } = useSync()
</script>

<template>
  <span
    class="chip"
    :class="{
      'chip-good': state === 'ok',
      'chip-warn': state === 'waiting',
      'chip-danger': state === 'offline',
    }"
    :aria-label="label"
  >
    <!-- ok: a check. waiting: a clock. offline: a struck-through cloud. -->
    <svg
      v-if="state === 'ok'"
      width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
    <svg
      v-else-if="state === 'waiting'"
      width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
    <svg
      v-else
      width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
    >
      <path d="M17.5 19H7a4 4 0 010-8 5.5 5.5 0 0110.5-1.5" />
      <path d="M3 3l18 18" />
    </svg>
    <span v-if="!compact" class="truncate">{{ label }}</span>
    <span v-else-if="pending > 0" class="num">{{ pending }}</span>
  </span>
</template>
