<script setup lang="ts">
/**
 * One stock item: name, how much is left, and what last moved it.
 *
 * On hand is never stored anywhere — it is `SUM(qty_delta)` over the movement
 * ledger (PLAN.md §9). A number that can only be summed cannot quietly drift;
 * it is either right or visibly missing a row. That is also why a negative is
 * shown rather than clamped to zero: it means a movement is missing, and the
 * screen says so instead of hiding it.
 *
 * **The row is two lines, not one, and that is the whole point.** It used to put
 * the name, a red chip of the last movement and the quantity on one line, which
 * cost the shelf both of the things it is read for: the names truncated to
 * "Al Fakher · Gro…" to make room for the chip, and the quantities could not line
 * up because the chip in front of them was a different width on every row. Now
 * the name and the amount own the first line — the amount in a fixed tabular
 * column with the unit in a column of its own, so a group of twenty items reads
 * down the decimal comma — and the last movement is a quiet caption underneath.
 *
 * Colour is spent only where it means something: `u minusu` is a danger chip
 * because a negative shelf is a missing row, and everything else is muted ink. A
 * list where every sale is red is a list where nothing is.
 */
import type { StockItem } from '#shared/types'

const props = defineProps<{ item: StockItem }>()

const negative = computed(() => props.item.on_hand < 0)

/** The opening count is not news — every item has one, so it is not shown. */
const movement = computed(() => {
  const last = props.item.last_movement
  return last && last.type !== 'opening' ? last : null
})

const movementText = computed(() => {
  const last = movement.value
  if (!last) return ''
  return [
    formatMovementQty(last.qty_delta, props.item.base_unit),
    movementShortLabel(last),
    clockHm(last.occurred_at),
  ].join(' · ')
})

/**
 * `formatStockQty` answers "2,386 kg" as one string; the column needs the digits
 * and the unit apart, or "5,0 l" and "70 kom" cannot share a right edge.
 */
const qty = computed(() => {
  const text = formatStockQty(props.item.on_hand, props.item.base_unit)
  const cut = text.lastIndexOf(' ')
  return cut < 0 ? { value: text, unit: '' } : { value: text.slice(0, cut), unit: text.slice(cut + 1) }
})
</script>

<template>
  <div class="st" :class="{ minus: negative }">
    <div class="st-top">
      <span class="st-name">{{ item.name }}</span>
      <span class="num st-value">{{ qty.value }}</span>
      <span class="st-unit">{{ qty.unit }}</span>
    </div>

    <div v-if="negative || movement" class="st-under">
      <span v-if="negative" class="chip chip-danger">u minusu</span>
      <span v-if="movement" class="num st-move">{{ movementText }}</span>
    </div>
  </div>
</template>

<style scoped>
.st {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 56px;
  justify-content: center;
  padding: 10px 0;
  border-bottom: 1px solid var(--line-soft);
}

.st:last-child { border-bottom: 0; }

.st-top {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.st-name {
  flex: 1;
  min-width: 0;
  font-size: var(--text-body);
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The two columns that make the group scan: digits right-aligned against a
   fixed edge, the unit left-aligned in its own fixed width beside them. */
.st-value {
  flex-shrink: 0;
  min-width: 68px;
  text-align: right;
  font-size: var(--text-body);
  font-weight: 600;
  color: var(--ink);
}

.st-unit {
  flex-shrink: 0;
  width: 34px;
  font-size: var(--text-label);
  color: var(--muted);
}

.minus .st-value { color: var(--danger); }

.st-under {
  display: flex;
  align-items: center;
  gap: 8px;
}

.st-move {
  font-size: var(--text-caption);
  letter-spacing: 0.02em;
  color: var(--muted);
}
</style>
