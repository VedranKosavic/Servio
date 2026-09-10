<script setup lang="ts">
/**
 * *Nakon zatvaranja* — rounds that reached the server after the night had
 * already been written down.
 *
 * A phone that was out of signal at 00:30 sends its outbox when it finds Wi-Fi
 * at 01:10, and by then the shift is closed and its summary sealed. The server
 * accepts them (a round that happened, happened), writes a `late_after_close`
 * log entry and folds a new summary version — so the numbers above this card
 * already include them. The card exists so the owner knows *why* a total moved
 * after he read it, which is the difference between a system he trusts and one
 * he does not.
 *
 * It renders only when there is something to say: an empty version of this card
 * is a worry with no cause.
 */
import type { LateAfterClose } from '#shared/types'

const props = defineProps<{ late: LateAfterClose }>()

const sentence = computed(() => {
  const parts = [
    `${props.late.count} ${props.late.count === 1 ? 'stavka poslana' : 'stavke poslane'} nakon zatvaranja`,
    formatKm(props.late.fen),
  ]
  if (props.late.user_names.length) parts.push(props.late.user_names.join(', '))
  return parts.join(' · ')
})
</script>

<template>
  <UiCard v-if="late.count > 0" title="Nakon zatvaranja">
    <p class="s-late">{{ sentence }}</p>
    <p class="s-quiet">
      Brojevi iznad ih već uključuju — sažetak smjene je prepisan kad su stigle.
    </p>
  </UiCard>
</template>

<style scoped>
.s-late { margin: 0; font-weight: 600; font-variant-numeric: tabular-nums; }
.s-quiet { margin: 0; color: var(--muted); font-size: var(--text-micro); }
</style>
