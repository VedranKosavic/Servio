<script setup lang="ts">
/**
 * The pinned strip: what the last round took off the shelf.
 *
 * `GET /api/stock` gives one *last movement* per item, so the last order is
 * rebuilt here from the items whose newest movement is the same sale — same
 * `ref_label` ("Sto 7 · narudžba"), same instant, because every line of one
 * round is written with a single `occurred_at` inside one transaction.
 *
 * It reads in stock units, not menu units: two coffees leave as "−14 g Kafa
 * (mljevena)", which is exactly the deduction the bartender is being shown.
 *
 * **It is no longer amber.** A warn-toned slab at the top of the shelf reads as
 * a problem, and this is the most ordinary event in the café: a round went out.
 * It is a card with an eyebrow now — the same shape as a group heading over its
 * card — so it belongs to the page instead of interrupting it.
 */
import type { StockItem } from '#shared/types'

defineProps<{
  table: string
  at: string
  items: StockItem[]
}>()
</script>

<template>
  <section class="ls card">
    <header class="ls-head">
      <span class="eyebrow">Zadnja narudžba</span>
      <span class="num ls-when">{{ table }} · {{ clockHm(at) }}</span>
    </header>

    <ul class="ls-items">
      <li v-for="item in items" :key="item.id" class="ls-item">
        <span class="num ls-qty">{{ formatMovementQty(item.last_movement!.qty_delta, item.base_unit) }}</span>
        <span class="ls-name">{{ item.name }}</span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.ls {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
}

.ls-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.ls-when {
  margin-left: auto;
  font-size: var(--text-caption);
  color: var(--muted);
}

.ls-items {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ls-item {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

/* The same right-aligned tabular column the shelf below uses, so the strip and
   the list read on one grid. */
.ls-qty {
  flex-shrink: 0;
  min-width: 68px;
  text-align: right;
  font-size: var(--text-body);
  font-weight: 600;
  color: var(--ink);
}

.ls-name {
  min-width: 0;
  font-size: var(--text-label);
  color: var(--ink-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
