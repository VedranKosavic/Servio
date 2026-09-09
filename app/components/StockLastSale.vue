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
 */
import type { StockItem } from '#shared/types'

defineProps<{
  table: string
  at: string
  items: StockItem[]
}>()
</script>

<template>
  <div class="flex items-start gap-2.5 rounded-xl bg-warn-soft px-3 py-2.5 text-warn">
    <svg
      width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="mt-1 shrink-0"
    >
      <path d="M4 12l16-8-6 16-2-6z" />
    </svg>
    <div class="min-w-0 text-[15px]">
      <div>Zadnja narudžba · {{ table }} · {{ clockHm(at) }}</div>
      <div class="num font-bold">
        <span v-for="(item, index) in items" :key="item.id">
          <span v-if="index > 0"> · </span>{{ formatMovementQty(item.last_movement!.qty_delta, item.base_unit) }} {{ item.name }}
        </span>
      </div>
    </div>
  </div>
</template>
