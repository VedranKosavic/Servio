<script setup lang="ts">
/**
 * One stock item: name, what last moved it, how much is left.
 *
 * On hand is never stored anywhere — it is `SUM(qty_delta)` over the movement
 * ledger (PLAN.md §9). A number that can only be summed cannot quietly drift;
 * it is either right or visibly missing a row. That is also why a negative is
 * shown rather than clamped to zero: it means a movement is missing, and the
 * screen says so instead of hiding it.
 */
import type { StockItem } from '#shared/types'

const props = defineProps<{ item: StockItem }>()

const negative = computed(() => props.item.on_hand < 0)

/** The opening count is not news — every item has one, so it earns no chip. */
const movement = computed(() => {
  const last = props.item.last_movement
  return last && last.type !== 'opening' ? last : null
})

const chipTone = computed(() => {
  switch (movement.value?.type) {
    case 'sale': return 'chip-danger'
    case 'delivery': return 'chip-good'
    default: return 'chip-warn'
  }
})

const chipText = computed(() => {
  const last = movement.value
  if (!last) return ''
  return [
    formatMovementQty(last.qty_delta, props.item.base_unit),
    movementShortLabel(last),
    clockHm(last.occurred_at),
  ].join(' · ')
})
</script>

<template>
  <div class="flex min-h-[52px] items-center gap-2.5 border-b border-line py-1.5 last:border-b-0">
    <span class="min-w-0 flex-1 truncate text-base">{{ item.name }}</span>

    <span v-if="negative" class="chip chip-danger shrink-0">u minusu</span>
    <span v-else-if="movement" class="chip shrink-0" :class="chipTone">{{ chipText }}</span>

    <span class="num shrink-0 font-semibold" :class="negative ? 'text-danger' : ''">
      {{ formatStockQty(item.on_hand, item.base_unit) }}
    </span>
  </div>
</template>
