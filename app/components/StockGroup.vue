<script setup lang="ts">
/**
 * One kind of goods — Pića, Duhan, Žar, Potrošni — as a titled card of rows.
 */
import type { StockItem } from '#shared/types'

defineProps<{
  title: string
  items: StockItem[]
}>()
</script>

<template>
  <section v-if="items.length" class="flex flex-col gap-2">
    <h2 class="text-sm font-semibold uppercase tracking-wider text-muted">
      {{ title }}
    </h2>
    <div class="card px-3.5 py-1">
      <StockRow v-for="item in items" :key="item.id" :item="item" />
    </div>
  </section>
</template>
