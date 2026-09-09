<script setup lang="ts">
/**
 * The dense table `/a` is mostly made of.
 *
 * Three things it takes care of so no page has to:
 *
 * - **The wrapper scrolls, the page does not.** A wide table on a 390 px phone
 *   scrolls inside its own box; the body never scrolls sideways.
 * - **The header sticks** while the rows move under it.
 * - **`align: 'r'` right-aligns a column**, which is where every amount goes.
 *
 * Rows are a slot, not a prop: every page's row is different, and a "column
 * renderer" abstraction would be a worse version of `<template #row>`.
 */
export interface UiColumn {
  key: string
  label: string
  /** `'r'` right-aligns the cells and the header. Amounts, counts, times. */
  align?: 'l' | 'r'
  /** A fixed column width, e.g. `'52px'`. */
  width?: string
}

defineProps<{
  columns: UiColumn[]
  /** Rendered in place of the rows when there is nothing to show. Bosnian. */
  empty?: string
  /** Draws three skeleton rows instead of a spinner over stale numbers. */
  loading?: boolean
}>()
</script>

<template>
  <div class="a-table-wrap">
    <table class="a-table">
      <thead>
        <tr>
          <th
            v-for="column in columns"
            :key="column.key"
            :class="{ r: column.align === 'r' }"
            :style="column.width ? { width: column.width } : undefined"
          >{{ column.label }}</th>
        </tr>
      </thead>
      <tbody v-if="loading">
        <tr v-for="n in 3" :key="n" class="skeleton">
          <td v-for="column in columns" :key="column.key"><span class="bar" /></td>
        </tr>
      </tbody>
      <tbody v-else>
        <slot />
      </tbody>
    </table>
    <p v-if="!loading && empty && !$slots.default" class="a-table-empty">{{ empty }}</p>
  </div>
</template>

<style scoped>
.a-table-wrap {
  /* The table scrolls inside this box; the page body never scrolls sideways. */
  overflow-x: auto;
  min-width: 0;
  -webkit-overflow-scrolling: touch;
}

.a-table {
  border-collapse: collapse;
  width: 100%;
  font-size: 14px;
}

.a-table th {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  font-weight: 600;
  text-align: left;
  padding: 6px 10px;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
  position: sticky;
  top: 0;
  background: var(--surface);
  z-index: 1;
}

.a-table :deep(td) {
  padding: 8px 10px;
  border-bottom: 1px solid var(--surface-2);
  vertical-align: middle;
  /* Tabular figures: every digit the same width, so a column of amounts
     lines up on the comma instead of shuffling as the numbers change. */
  font-variant-numeric: tabular-nums;
}

.a-table :deep(tr:last-child td) { border-bottom: 0; }
.a-table th.r, .a-table :deep(td.r) { text-align: right; }

.a-table-empty {
  margin: 12px 2px 2px;
  color: var(--muted);
  font-size: 14px;
}

.skeleton .bar {
  display: block;
  height: 12px;
  border-radius: 6px;
  background: var(--surface-2);
}

@media (max-width: 1023px) {
  .a-table { font-size: 15px; }
  .a-table :deep(td) { padding: 12px 10px; }
}
</style>
