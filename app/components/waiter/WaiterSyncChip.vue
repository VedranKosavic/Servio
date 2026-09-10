<script setup lang="ts">
/**
 * The one chip in every `/konobar` and `/sanker` header. Always visible, never
 * a spinner.
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
const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })

const { state, label, pending } = useSync()

/**
 * The short form of the same sentence. Compact still says a word whenever it
 * has something to say — a coloured pill with nothing but an icon in it is a
 * blob, and colour is never allowed to carry the meaning on its own (DESIGN §2).
 * The settled state has nothing to say, so it drops the fill as well and sits
 * as a quiet check; the full sentence stays on `aria-label` in every state.
 */
const compactLabel = computed(() => {
  if (state.value === 'offline') {
    return pending.value > 0 ? `Nema veze (${pending.value})` : 'Nema veze'
  }
  if (state.value === 'waiting') return `Čeka (${pending.value})`
  return ''
})

/** Compact + synced + nothing queued is the only state without a fill. */
const quiet = computed(() => props.compact && state.value === 'ok')
</script>

<template>
  <span
    class="chip"
    :class="{
      'chip-good': state === 'ok' && !quiet,
      'chip-warn': state === 'waiting',
      'chip-danger': state === 'offline',
      'chip-quiet': quiet,
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
    <span v-else-if="compactLabel" class="truncate">{{ compactLabel }}</span>
  </span>
</template>

<style scoped>
/* No fill, no colour: the state where everything is in order says so by being
   the quietest thing in the header, not by being a green blob. */
.chip-quiet {
  background: transparent;
  color: var(--muted);
  padding-left: 0;
  padding-right: 0;
}
</style>
