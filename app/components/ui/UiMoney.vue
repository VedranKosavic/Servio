<script setup lang="ts">
/**
 * An amount, everywhere on `/a`.
 *
 * **Money is an integer number of feninga**, never a float: `12.30` has no exact
 * binary representation, so a column of floats that each look right sums to
 * 0,01 KM wrong. `fen` in, a string out, through `shared/money.ts` — the same
 * function the server uses to write the amount into a Dnevnik title.
 *
 * Negative renders with the real minus sign (U+2212, wider than a hyphen so a
 * tabular column keeps its alignment) and in `--danger`; zero goes `--muted`,
 * because a row of 0,00 KM is noise the eye should skip.
 */
const props = withDefaults(defineProps<{
  fen: number
  /** Off inside a table cell, where the column header already says KM. */
  currency?: boolean
  /** Colour negatives red and zeros grey. Off for a column that is all deltas. */
  colour?: boolean
}>(), { currency: true, colour: true })

const text = computed(() =>
  props.currency ? signedKm(props.fen) : signedAmount(props.fen))
</script>

<template>
  <span
    class="a-money"
    :class="{ neg: colour && fen < 0, zero: colour && fen === 0 }"
  >{{ text }}</span>
</template>

<style scoped>
.a-money {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.neg { color: var(--danger); }
.zero { color: var(--muted); }
</style>
