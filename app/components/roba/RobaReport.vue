<script setup lang="ts">
/**
 * The shell both *Roba* reports sit in: a card, an optional strip of chips that
 * spells the arithmetic out, and a dense table with a bold totals row.
 *
 * The chip strip is the point of the design. *Nargila* is a subtraction the
 * owner does on paper — početno + primljeno − završno = potrošeno, ÷ grama po
 * luli = očekivano — and showing it as an equation rather than as six columns is
 * what makes the answer arguable instead of magic.
 */
import type { UiColumn } from '~/components/ui/UiTable.vue'

defineProps<{
  title: string
  count?: string | number
  columns: UiColumn[]
  loading?: boolean
  /** Rendered under the table when there are no rows. Bosnian. */
  empty?: string
  /** True while there is nothing to draw — the empty line then shows. */
  isEmpty?: boolean
}>()
</script>

<template>
  <UiCard :title="title" :count="count">
    <template v-if="$slots.actions" #actions><slot name="actions" /></template>

    <div v-if="$slots.chips" class="a-eq"><slot name="chips" /></div>

    <UiTable :columns="columns" :loading="loading">
      <slot />
    </UiTable>

    <p v-if="!loading && isEmpty && empty" class="a-muted">{{ empty }}</p>

    <slot name="foot" />
  </UiCard>
</template>

<style scoped>
.a-eq {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

/* The chips are written by the page in its own slot, so `:deep` is how this
   component styles them without every report repeating the same rules. */
.a-eq :deep(.chip) {
  height: 28px;
  padding: 0 10px;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: var(--surface);
  font-size: var(--text-micro);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-variant-numeric: tabular-nums;
}

.a-eq :deep(.chip.on) {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
}

.a-eq :deep(.op) { color: var(--muted); font-weight: 600; }

.a-muted { margin: 0; color: var(--muted); font-size: var(--text-label); }
</style>
