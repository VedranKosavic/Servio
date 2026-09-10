<script setup lang="ts">
/**
 * One kind of goods — Pića, Duhan, Žar, Potrošni — as a titled card of rows.
 *
 * The heading carries the count, because "how many kinds of tobacco do we
 * stock" is a question the shelf gets asked, and counting rows to answer it is
 * how a list stops being scannable.
 */
import type { StockItem } from '#shared/types'

defineProps<{
  title: string
  items: StockItem[]
}>()
</script>

<template>
  <section v-if="items.length" class="gr">
    <h2 class="gr-head">
      <span class="eyebrow gr-title">{{ title }}</span>
      <span class="num gr-count">{{ items.length }}</span>
    </h2>

    <div class="card gr-card">
      <StockRow v-for="item in items" :key="item.id" :item="item" />
    </div>
  </section>
</template>

<style scoped>
.gr {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.gr-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0;
  padding: 0 4px;
}

.gr-title { color: var(--ink-2); }

.gr-count {
  font-size: var(--text-caption);
  font-weight: 600;
  color: var(--muted);
}

.gr-card { padding: 2px 16px; }
</style>
